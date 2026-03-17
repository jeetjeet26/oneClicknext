"""
PropertyAudit Job Execution
Executes GEO audit runs by calling LLM connectors and writing results to Supabase.
Migrated from /api/propertyaudit/process/route.ts to avoid Vercel timeout issues.

Full feature parity with TypeScript:
- Structured mode (direct GEO extraction)
- Natural mode (two-phase: natural response → analysis)
- Web search integration
- Quality flag detection
- Proper scoring formula
"""
import os
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from supabase import Client
from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)


def _is_no_rows_error(error: Exception) -> bool:
    code = getattr(error, 'code', None)
    if code == 'PGRST116':
        return True
    message = str(error)
    return 'PGRST116' in message and '0 rows' in message

class PropertyAuditExecutor:
    """
    Executes PropertyAudit GEO runs against LLM APIs.
    """
    
    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
        self.enable_web_search = os.environ.get('GEO_ENABLE_WEB_SEARCH', 'false').lower() == 'true'
        self.audit_mode = os.environ.get('GEO_AUDIT_MODE', 'structured').lower()
        
        if self.audit_mode not in ['structured', 'natural']:
            logger.warning(f"Unknown GEO_AUDIT_MODE '{self.audit_mode}', defaulting to 'structured'")
            self.audit_mode = 'structured'
        
        logger.info(f"[PropertyAudit] Mode: {self.audit_mode}, Web search: {self.enable_web_search}")
    
    async def execute_run(self, run_id: str) -> Dict[str, Any]:
        """
        Execute a PropertyAudit run.
        
        Args:
            run_id: UUID of the geo_run to execute
            
        Returns:
            Dict with execution results
        """
        logger.info(f"[PropertyAudit] Starting execution for run_id={run_id}")
        
        try:
            # 1. Get the run
            run = self._get_run(run_id)
            if not run:
                raise ValueError(f"Run {run_id} not found")
            
            if run['status'] != 'queued':
                raise ValueError(f"Run {run_id} is not in queued state (status={run['status']})")
            
            # 2. Update status to running
            self._update_run_status(run_id, 'running', progress_pct=0)
            
            # 3. Get queries for the property
            queries = self._get_queries(run['property_id'])
            if not queries:
                self._update_run_status(
                    run_id, 
                    'failed', 
                    error_message='No active queries found',
                    progress_pct=0
                )
                return {'success': False, 'error': 'No active queries found'}
            
            # 4. Get property context
            property_data = self._get_property_context(run['property_id'])
            
            # 5. Get property config for domains
            config = self._get_property_config(run['property_id'], property_data['name'])
            
            # 6. Process each query (use global execution_count from run)
            results = []
            errors = []
            execution_count = max(1, int(run.get('execution_count') or 1))
            total_executions = len(queries) * execution_count
            executed = 0
            
            for query in queries:
                for attempt in range(execution_count):
                    try:
                        executed += 1
                        logger.info(
                            f"[PropertyAudit] Processing query ({executed}/{total_executions}) "
                            f"[{attempt+1}/{execution_count}]: {query['text'][:50]}..."
                        )
                        
                        # Update progress
                        progress_pct = int(((executed - 1) / max(1, total_executions)) * 100)
                        self._update_progress(run_id, progress_pct, executed - 1)
                        
                        # Process query (this will call LLM connectors)
                        result = await self._process_query(
                            run=run,
                            query=query,
                            property_data=property_data,
                            config=config
                        )
                        
                        results.append(result)
                        
                        # Check AI Overview visibility (only on first execution per query to avoid rate limits)
                        if attempt == 0:
                            await self._check_and_store_ai_overview(
                                property_id=run['property_id'],
                                query=query
                            )
                        
                    except Exception as e:
                        logger.error(f"[PropertyAudit] Error processing query {query['id']}: {e}")
                        errors.append(f"Query {query['id']}: {str(e)}")
            
            # 7. Calculate aggregate scores
            aggregate = self._calculate_aggregate_scores(results)
            
            # 8. Insert score record
            self._insert_scores(run_id, aggregate, results)
            
            # 9. Update run status
            final_status = 'failed' if (errors and not results) else 'completed'
            self._update_run_status(
                run_id,
                final_status,
                progress_pct=100,
                error_message='; '.join(errors) if errors else None
            )
            
            logger.info(f"[PropertyAudit] Completed run_id={run_id}: {len(results)} queries processed, {len(errors)} errors")
            
            return {
                'success': True,
                'run_id': run_id,
                'processed': len(results),
                'errors': len(errors),
                'score': aggregate['overall_score'],
                'visibility': aggregate['visibility_pct']
            }
            
        except Exception as e:
            logger.error(f"[PropertyAudit] Fatal error for run_id={run_id}: {e}", exc_info=True)
            self._update_run_status(
                run_id,
                'failed',
                error_message=str(e),
                progress_pct=0
            )
            return {'success': False, 'error': str(e)}
    
    def _get_run(self, run_id: str) -> Optional[Dict]:
        """Get run record from database."""
        response = self.supabase.table('geo_runs').select('*').eq('id', run_id).single().execute()
        return response.data if response.data else None
    
    def _update_run_status(
        self, 
        run_id: str, 
        status: str, 
        progress_pct: Optional[int] = None,
        error_message: Optional[str] = None
    ):
        """Update run status in database."""
        update_data = {'status': status}
        
        if progress_pct is not None:
            update_data['progress_pct'] = progress_pct
        
        if status in ['completed', 'failed']:
            update_data['finished_at'] = datetime.utcnow().isoformat()
        
        if error_message:
            update_data['error_message'] = error_message
        
        self.supabase.table('geo_runs').update(update_data).eq('id', run_id).execute()
        logger.debug(f"[PropertyAudit] Updated run {run_id}: status={status}, progress={progress_pct}%")
    
    def _update_progress(self, run_id: str, progress_pct: int, current_query_index: int):
        """Update progress tracking fields."""
        self.supabase.table('geo_runs').update({
            'progress_pct': progress_pct,
            'current_query_index': current_query_index
        }).eq('id', run_id).execute()
    
    def _get_queries(self, property_id: str) -> List[Dict]:
        """Get active queries for property."""
        response = self.supabase.table('geo_queries')\
            .select('*')\
            .eq('property_id', property_id)\
            .eq('is_active', True)\
            .execute()
        return response.data if response.data else []
    
    def _get_property_context(self, property_id: str) -> Dict:
        """Get property details for context."""
        response = self.supabase.table('properties')\
            .select('name, address, website_url')\
            .eq('id', property_id)\
            .single()\
            .execute()
        return response.data if response.data else {}
    
    def _get_property_config(self, property_id: str, property_name: str) -> Dict:
        """Get or create property config for domains."""
        try:
            response = self.supabase.table('geo_property_config')\
                .select('domains, competitor_domains')\
                .eq('property_id', property_id)\
                .single()\
                .execute()

            if response.data:
                return response.data
        except APIError as error:
            if not _is_no_rows_error(error):
                raise
        
        # Auto-create config if it doesn't exist
        logger.info(f"[PropertyAudit] Creating default config for property {property_id}")
        
        inferred_domain = self._infer_domain_from_name(property_name)
        
        create_response = self.supabase.table('geo_property_config').insert({
            'property_id': property_id,
            'domains': [inferred_domain] if inferred_domain else [],
            'competitor_domains': [],
            'is_active': True
        }).execute()
        
        return create_response.data[0] if create_response.data else {'domains': [], 'competitor_domains': []}
    
    def _infer_domain_from_name(self, name: str) -> Optional[str]:
        """Infer domain from property name."""
        name_lower = name.lower()
        
        company_domains = {
            'amli': 'amli.com',
            'avalon': 'avaloncommunities.com',
            'greystar': 'greystar.com',
            'essex': 'essexapartmenthomes.com',
            'equity': 'equityapartments.com',
            'camden': 'camdenliving.com',
            'bozzuto': 'bozzuto.com',
            'gables': 'gables.com',
            'cortland': 'cortland.com',
            'lincoln': 'lincolnapts.com',
        }
        
        for key, domain in company_domains.items():
            if key in name_lower:
                return domain
        
        return None
    
    async def _process_query(
        self,
        run: Dict,
        query: Dict,
        property_data: Dict,
        config: Dict
    ) -> Dict:
        """
        Process a single query using LLM connectors.
        Supports both structured and natural modes.
        """
        from connectors.openai_connector import OpenAIConnector
        from connectors.claude_connector import ClaudeConnector
        from connectors.openai_natural_connector import OpenAINaturalConnector
        from connectors.claude_natural_connector import ClaudeNaturalConnector
        from connectors.evaluator import score_answer
        
        # Build context
        address = property_data.get('address') or {}
        context = {
            'queryId': query['id'],
            'queryText': query['text'],
            'brandName': property_data['name'],
            'brandDomains': config.get('domains', []),
            'competitors': config.get('competitor_domains', []),
            'propertyLocation': {
                'city': address.get('city', ''),
                'state': address.get('state', ''),
                'fullAddress': ', '.join(filter(None, [
                    address.get('street'),
                    address.get('city'),
                    address.get('state'),
                    address.get('zip')
                ])),
                'websiteUrl': property_data.get('website_url', '')
            }
        }
        
        # Choose connector and mode
        result = None
        natural_response_text = None
        analysis_method = 'structured'
        
        if self.audit_mode == 'natural':
            # Natural mode: Two-phase analysis
            analysis_method = 'natural_two_phase'
            
            if run['surface'] == 'openai':
                connector = OpenAINaturalConnector()
            else:
                connector = ClaudeNaturalConnector()
            
            result = await connector.invoke_natural_mode(context)
            natural_response_text = result['raw'].get('natural_response', '')
        
        else:
            # Structured mode: Direct GEO extraction
            if run['surface'] == 'openai':
                connector = OpenAIConnector()
            else:
                connector = ClaudeConnector()
            
            result = await connector.invoke(context)
        
        answer = result['answer']
        
        # Score the answer using proper formula
        scored = score_answer(answer, context)
        
        # Insert answer into database
        answer_insert = {
            'run_id': run['id'],
            'query_id': query['id'],
            'presence': scored['presence'],
            'llm_rank': scored.get('llm_rank'),
            'link_rank': scored.get('link_rank'),
            'sov': scored.get('sov'),
            'flags': scored.get('flags', []),
            'answer_summary': answer.get('answer_summary', ''),
            'ordered_entities': answer.get('ordered_entities', []),
            'raw_json': result['raw']
        }
        
        # Add natural mode fields if applicable
        if natural_response_text:
            answer_insert['natural_response'] = natural_response_text
            answer_insert['analysis_method'] = analysis_method
        
        self.supabase.table('geo_answers').insert(answer_insert).execute()
        
        # Insert citations
        if answer.get('citations'):
            brand_domains = context['brandDomains']
            citations = []
            
            # Get the answer_id we just inserted
            answer_result = self.supabase.table('geo_answers')\
                .select('id')\
                .eq('run_id', run['id'])\
                .eq('query_id', query['id'])\
                .order('created_at', desc=True)\
                .limit(1)\
                .single()\
                .execute()
            
            if answer_result.data:
                answer_id = answer_result.data['id']
                
                for c in answer['citations']:
                    domain = c.get('domain', '')
                    # Use evaluator's is_brand_domain logic
                    from connectors.evaluator import is_brand_domain
                    citations.append({
                        'answer_id': answer_id,
                        'url': c['url'],
                        'domain': domain,
                        'is_brand_domain': is_brand_domain(domain, brand_domains),
                        'entity_ref': c.get('entity_ref')
                    })
                
                if citations:
                    self.supabase.table('geo_citations').insert(citations).execute()
        
        return scored
    
    def _calculate_aggregate_scores(self, results: List[Dict]) -> Dict:
        """Calculate aggregate scores using proper formula."""
        from connectors.evaluator import aggregate_scores
        
        aggregate = aggregate_scores(results)
        
        # Calculate breakdown averages for database storage
        breakdowns = [r.get('breakdown', {}) for r in results if r.get('breakdown')]
        
        if breakdowns:
            breakdown = {
                'position': round(sum(b.get('position', 0) for b in breakdowns) / len(breakdowns), 2),
                'link': round(sum(b.get('link', 0) for b in breakdowns) / len(breakdowns), 2),
                'sov': round(sum(b.get('sov', 0) for b in breakdowns) / len(breakdowns), 2),
                'accuracy': round(sum(b.get('accuracy', 0) for b in breakdowns) / len(breakdowns), 2)
            }
        else:
            breakdown = {'position': 0, 'link': 0, 'sov': 0, 'accuracy': 0}
        
        return {
            **aggregate,
            'breakdown': breakdown
        }
    
    def _insert_scores(self, run_id: str, aggregate: Dict, results: List[Dict]):
        """Insert aggregate scores into database."""
        # Build query_scores array
        query_scores = [
            {
                'score': r.get('score', 0),
                'presence': r.get('presence', False),
                'breakdown': r.get('breakdown', {})
            }
            for r in results
        ]
        
        self.supabase.table('geo_scores').insert({
            'run_id': run_id,
            'overall_score': aggregate['overall_score'],
            'visibility_pct': aggregate['visibility_pct'],
            'avg_llm_rank': aggregate.get('avg_llm_rank'),
            'avg_link_rank': aggregate.get('avg_link_rank'),
            'avg_sov': aggregate.get('avg_sov'),
            'breakdown': aggregate.get('breakdown', {}),
            'query_scores': query_scores
        }).execute()
    
    async def _check_and_store_ai_overview(self, property_id: str, query: Dict):
        """
        Check AI Overview visibility for a query and store the result.
        This is called once per query (not per execution) to avoid rate limits.
        """
        from connectors.evaluator import check_ai_overview_visibility
        
        try:
            # Use geo location from query if available
            location = query.get('geo') or None
            query_text = query.get('text', '')
            
            if not query_text:
                logger.warning(f"[AI Overview] Skipping check for query {query['id']}: empty text")
                return
            
            # Check visibility
            visible, source_url = await check_ai_overview_visibility(
                query_text=query_text,
                location=location
            )
            
            # Insert or update in geo_ai_overviews table
            # First check if a record already exists for this property/query combo
            existing = self.supabase.table('geo_ai_overviews')\
                .select('id')\
                .eq('property_id', property_id)\
                .eq('query_id', query['id'])\
                .order('observed_at', desc=True)\
                .limit(1)\
                .execute()
            
            # Insert new observation (we keep history, not update)
            self.supabase.table('geo_ai_overviews').insert({
                'property_id': property_id,
                'query_id': query['id'],
                'visible': visible,
                'source_url': source_url,
                'observed_at': datetime.utcnow().isoformat()
            }).execute()
            
            logger.info(
                f"[AI Overview] Stored visibility for query {query['id']}: "
                f"visible={visible}, source={source_url}"
            )
            
        except Exception as e:
            # Don't fail the entire run for AI Overview errors
            logger.error(f"[AI Overview] Error checking query {query['id']}: {e}")






