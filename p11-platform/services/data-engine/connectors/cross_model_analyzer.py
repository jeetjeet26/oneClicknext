"""
Cross-Model Analyzer for PropertyAudit
Analyzes results from both OpenAI and Claude runs to generate:
- Consensus recommendations (where both models agree)
- Divergent insights (where models disagree)
- Unified actionable recommendations

This runs AFTER both model runs complete in a batch.
"""
import os
import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class CrossModelAnalyzer:
    """
    Analyzes and synthesizes results from parallel OpenAI and Claude runs.
    """
    
    def __init__(self, supabase):
        self.supabase = supabase
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
    
    async def analyze_batch(self, batch_id: str) -> Dict[str, Any]:
        """
        Perform cross-model analysis for a completed batch.
        
        Args:
            batch_id: UUID of the batch containing OpenAI and Claude runs
            
        Returns:
            Analysis results with consensus, divergence, and recommendations
        """
        logger.info(f"[CrossModel] Starting analysis for batch {batch_id}")
        
        try:
            # 1. Fetch all runs and their results for this batch
            runs_data = self._fetch_batch_runs(batch_id)
            
            completed_runs = [run for run in runs_data.values() if run]
            if len(completed_runs) < 2:
                logger.warning(f"[CrossModel] Batch {batch_id} has fewer than two completed surfaces")
                return {
                    'success': False,
                    'error': 'At least two completed surface runs are required for analysis',
                    'batch_id': batch_id
                }

            if not runs_data.get('openai') or not runs_data.get('claude'):
                analysis = self._compare_surface_scores(completed_runs)
                recommendations = {
                    'summary': 'Surface-level comparison completed for PropertyAudit v1 surfaces.',
                    'key_insights': [],
                    'action_items': [],
                }
                result = self._store_analysis(
                    batch_id=batch_id,
                    analysis=analysis,
                    recommendations=recommendations
                )
                return {
                    'success': True,
                    'batch_id': batch_id,
                    'analysis': analysis,
                    'recommendations': recommendations,
                    'stored': result
                }
            
            # 2. Fetch answers from both runs
            openai_answers = self._fetch_run_answers(runs_data['openai']['id'])
            claude_answers = self._fetch_run_answers(runs_data['claude']['id'])
            
            # 3. Fetch scores from both runs
            openai_scores = self._fetch_run_scores(runs_data['openai']['id'])
            claude_scores = self._fetch_run_scores(runs_data['claude']['id'])
            
            # 4. Perform comparative analysis
            analysis = self._compare_results(
                openai_answers=openai_answers,
                claude_answers=claude_answers,
                openai_scores=openai_scores,
                claude_scores=claude_scores,
                property_id=runs_data['openai']['property_id']
            )
            
            # 5. Generate unified recommendations using LLM
            recommendations = await self._generate_recommendations(
                analysis=analysis,
                openai_answers=openai_answers,
                claude_answers=claude_answers,
                property_id=runs_data['openai']['property_id']
            )
            
            # 6. Store cross-model analysis results
            result = self._store_analysis(
                batch_id=batch_id,
                analysis=analysis,
                recommendations=recommendations
            )
            
            logger.info(f"[CrossModel] ✅ Analysis complete for batch {batch_id}")
            
            return {
                'success': True,
                'batch_id': batch_id,
                'analysis': analysis,
                'recommendations': recommendations,
                'stored': result
            }
            
        except Exception as e:
            logger.error(f"[CrossModel] Error analyzing batch {batch_id}: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'batch_id': batch_id
            }
    
    def _fetch_batch_runs(self, batch_id: str) -> Dict[str, Optional[Dict]]:
        """Fetch OpenAI and Claude runs for a batch."""
        response = self.supabase.table('geo_runs')\
            .select('id, surface, status, property_id, progress_pct, error_message')\
            .eq('batch_id', batch_id)\
            .execute()
        
        runs = {}
        
        for run in response.data or []:
            surface = run.get('surface', '').lower()
            if surface:
                runs[surface] = run
        
        return runs

    def _compare_surface_scores(self, runs: List[Dict]) -> Dict[str, Any]:
        surface_scores = {}
        highest = None
        lowest = None

        for run in runs:
            scores = self._fetch_run_scores(run['id']) or {}
            surface = run.get('surface')
            score = scores.get('overall_score', 0) or 0
            visibility = scores.get('visibility_pct', 0) or 0
            surface_scores[surface] = {
                'overall_score': score,
                'visibility_pct': visibility,
                'avg_llm_rank': scores.get('avg_llm_rank'),
                'avg_sov': scores.get('avg_sov')
            }
            if highest is None or score > highest['score']:
                highest = {'surface': surface, 'score': score}
            if lowest is None or score < lowest['score']:
                lowest = {'surface': surface, 'score': score}

        difference = abs((highest or {}).get('score', 0) - (lowest or {}).get('score', 0))
        return {
            'analyzed_at': datetime.utcnow().isoformat(),
            'agreement_rate': None,
            'surface_scores': surface_scores,
            'score_comparison': {
                'difference': difference,
                'higher_model': (highest or {}).get('surface'),
                'lower_model': (lowest or {}).get('surface')
            },
            'visibility_comparison': {
                'surfaces': {
                    surface: data.get('visibility_pct', 0)
                    for surface, data in surface_scores.items()
                }
            },
            'query_comparisons': [],
            'consensus_entities': [],
            'divergent_entities': {}
        }
    
    def _fetch_run_answers(self, run_id: str) -> List[Dict]:
        """Fetch all answers for a run."""
        response = self.supabase.table('geo_answers')\
            .select('*')\
            .eq('run_id', run_id)\
            .execute()
        return response.data or []
    
    def _fetch_run_scores(self, run_id: str) -> Optional[Dict]:
        """Fetch aggregate scores for a run."""
        response = self.supabase.table('geo_scores')\
            .select('*')\
            .eq('run_id', run_id)\
            .single()\
            .execute()
        return response.data
    
    def _compare_results(
        self,
        openai_answers: List[Dict],
        claude_answers: List[Dict],
        openai_scores: Optional[Dict],
        claude_scores: Optional[Dict],
        property_id: str
    ) -> Dict[str, Any]:
        """
        Compare results between OpenAI and Claude runs.
        
        Returns structured comparison with:
        - Score differences
        - Ranking differences per query
        - Consensus entities (mentioned by both)
        - Divergent entities (mentioned by one but not other)
        """
        comparison = {
            'score_comparison': {},
            'visibility_comparison': {},
            'query_comparisons': [],
            'consensus_entities': [],
            'divergent_entities': {
                'openai_only': [],
                'claude_only': []
            },
            'agreement_rate': 0.0
        }
        
        # Score comparison
        if openai_scores and claude_scores:
            comparison['score_comparison'] = {
                'openai_overall': openai_scores.get('overall_score', 0),
                'claude_overall': claude_scores.get('overall_score', 0),
                'difference': abs(
                    (openai_scores.get('overall_score') or 0) - 
                    (claude_scores.get('overall_score') or 0)
                ),
                'higher_model': 'openai' if (openai_scores.get('overall_score') or 0) > (claude_scores.get('overall_score') or 0) else 'claude'
            }
            
            comparison['visibility_comparison'] = {
                'openai_visibility': openai_scores.get('visibility_pct', 0),
                'claude_visibility': claude_scores.get('visibility_pct', 0),
                'difference': abs(
                    (openai_scores.get('visibility_pct') or 0) - 
                    (claude_scores.get('visibility_pct') or 0)
                )
            }
        
        # Query-by-query comparison
        openai_by_query = {a['query_id']: a for a in openai_answers}
        claude_by_query = {a['query_id']: a for a in claude_answers}
        
        all_query_ids = set(openai_by_query.keys()) | set(claude_by_query.keys())
        agreements = 0
        
        for query_id in all_query_ids:
            openai_answer = openai_by_query.get(query_id, {})
            claude_answer = claude_by_query.get(query_id, {})
            
            openai_presence = openai_answer.get('presence', False)
            claude_presence = claude_answer.get('presence', False)
            
            # Check agreement on presence
            if openai_presence == claude_presence:
                agreements += 1
            
            query_comp = {
                'query_id': query_id,
                'openai_presence': openai_presence,
                'claude_presence': claude_presence,
                'openai_rank': openai_answer.get('llm_rank'),
                'claude_rank': claude_answer.get('llm_rank'),
                'rank_agreement': openai_answer.get('llm_rank') == claude_answer.get('llm_rank'),
                'presence_agreement': openai_presence == claude_presence
            }
            comparison['query_comparisons'].append(query_comp)
            
            # Extract entities for consensus/divergence analysis
            openai_entities = set()
            claude_entities = set()
            
            for entity in openai_answer.get('ordered_entities', []) or []:
                if isinstance(entity, dict):
                    openai_entities.add(entity.get('name', '').lower())
            
            for entity in claude_answer.get('ordered_entities', []) or []:
                if isinstance(entity, dict):
                    claude_entities.add(entity.get('name', '').lower())
            
            # Track consensus and divergence
            consensus = openai_entities & claude_entities
            openai_only = openai_entities - claude_entities
            claude_only = claude_entities - openai_entities
            
            for entity in consensus:
                if entity and entity not in [e['name'] for e in comparison['consensus_entities']]:
                    comparison['consensus_entities'].append({'name': entity, 'query_id': query_id})
            
            for entity in openai_only:
                if entity:
                    comparison['divergent_entities']['openai_only'].append({'name': entity, 'query_id': query_id})
            
            for entity in claude_only:
                if entity:
                    comparison['divergent_entities']['claude_only'].append({'name': entity, 'query_id': query_id})
        
        if all_query_ids:
            comparison['agreement_rate'] = round(agreements / len(all_query_ids) * 100, 2)
        
        return comparison
    
    async def _generate_recommendations(
        self,
        analysis: Dict[str, Any],
        openai_answers: List[Dict],
        claude_answers: List[Dict],
        property_id: str
    ) -> Dict[str, Any]:
        """
        Use LLM to generate unified recommendations based on cross-model analysis.
        """
        # Get property context
        property_data = self._get_property_context(property_id)
        
        # Build context for LLM
        context = {
            'property_name': property_data.get('name', 'Unknown'),
            'agreement_rate': analysis.get('agreement_rate', 0),
            'score_comparison': analysis.get('score_comparison', {}),
            'visibility_comparison': analysis.get('visibility_comparison', {}),
            'consensus_count': len(analysis.get('consensus_entities', [])),
            'divergent_count': (
                len(analysis.get('divergent_entities', {}).get('openai_only', [])) +
                len(analysis.get('divergent_entities', {}).get('claude_only', []))
            )
        }
        
        # Try OpenAI first for recommendation generation
        try:
            recommendations = await self._generate_recommendations_openai(context, analysis)
            return recommendations
        except Exception as e:
            logger.warning(f"[CrossModel] OpenAI recommendation failed: {e}, trying Claude")
        
        # Fallback to Claude
        try:
            recommendations = await self._generate_recommendations_claude(context, analysis)
            return recommendations
        except Exception as e:
            logger.error(f"[CrossModel] Both recommendation generators failed: {e}")
            return self._generate_fallback_recommendations(analysis)
    
    async def _generate_recommendations_openai(
        self,
        context: Dict[str, Any],
        analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate recommendations using OpenAI."""
        import openai
        
        client = openai.OpenAI(api_key=self.openai_api_key)
        
        prompt = f"""You are a GEO (Generative Engine Optimization) expert analyzing cross-model audit results.

Property: {context['property_name']}

Cross-Model Analysis Results:
- Model Agreement Rate: {context['agreement_rate']}%
- OpenAI Overall Score: {context['score_comparison'].get('openai_overall', 'N/A')}
- Claude Overall Score: {context['score_comparison'].get('claude_overall', 'N/A')}
- OpenAI Visibility: {context['visibility_comparison'].get('openai_visibility', 'N/A')}%
- Claude Visibility: {context['visibility_comparison'].get('claude_visibility', 'N/A')}%
- Consensus Entities (both models agree): {context['consensus_count']}
- Divergent Entities (models disagree): {context['divergent_count']}

Score Differences:
{json.dumps(context['score_comparison'], indent=2)}

Query Agreement Details:
{json.dumps(analysis.get('query_comparisons', [])[:5], indent=2)}

Generate actionable recommendations in this JSON format:
{{
  "summary": "2-3 sentence executive summary",
  "model_reliability": {{
    "assessment": "which model seems more reliable and why",
    "confidence": "high/medium/low"
  }},
  "key_insights": [
    {{"insight": "...", "priority": "high/medium/low", "action": "..."}}
  ],
  "consensus_recommendations": [
    "recommendations where both models agree"
  ],
  "divergence_analysis": {{
    "significant_differences": ["list of significant disagreements"],
    "likely_cause": "explanation of why models might disagree"
  }},
  "action_items": [
    {{"action": "...", "priority": 1, "effort": "low/medium/high", "impact": "low/medium/high"}}
  ]
}}

Focus on actionable GEO improvements for apartment/property marketing visibility."""

        response = client.chat.completions.create(
            model='gpt-4o',
            messages=[{'role': 'user', 'content': prompt}],
            response_format={'type': 'json_object'},
            temperature=0.3,
            max_tokens=2000
        )
        
        content = response.choices[0].message.content
        return json.loads(content)
    
    async def _generate_recommendations_claude(
        self,
        context: Dict[str, Any],
        analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate recommendations using Claude as fallback."""
        import anthropic
        
        client = anthropic.Anthropic(api_key=self.anthropic_api_key)
        
        prompt = f"""Analyze cross-model GEO audit results and provide recommendations.

Property: {context['property_name']}
Agreement Rate: {context['agreement_rate']}%
OpenAI Score: {context['score_comparison'].get('openai_overall', 'N/A')}
Claude Score: {context['score_comparison'].get('claude_overall', 'N/A')}

Return JSON with: summary, key_insights (array), action_items (array with priority/effort/impact)."""

        response = client.messages.create(
            model='claude-sonnet-4-20250514',
            max_tokens=2000,
            messages=[{'role': 'user', 'content': prompt}]
        )
        
        content = response.content[0].text
        
        # Try to parse JSON
        try:
            return json.loads(content)
        except:
            import re
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                return json.loads(match.group(0))
            raise ValueError("Could not parse JSON from Claude")
    
    def _generate_fallback_recommendations(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Generate basic recommendations without LLM."""
        score_comp = analysis.get('score_comparison', {})
        vis_comp = analysis.get('visibility_comparison', {})
        
        recommendations = {
            'summary': f"Cross-model analysis complete. Agreement rate: {analysis.get('agreement_rate', 0)}%",
            'model_reliability': {
                'assessment': 'Both models show similar patterns',
                'confidence': 'medium'
            },
            'key_insights': [],
            'action_items': []
        }
        
        # Add insights based on score differences
        if score_comp.get('difference', 0) > 10:
            recommendations['key_insights'].append({
                'insight': f"Significant score difference ({score_comp.get('difference')}%) between models",
                'priority': 'high',
                'action': 'Review queries where models disagree most'
            })
        
        # Add visibility insights
        openai_vis = vis_comp.get('openai_visibility', 0)
        claude_vis = vis_comp.get('claude_visibility', 0)
        avg_vis = (openai_vis + claude_vis) / 2
        
        if avg_vis < 50:
            recommendations['action_items'].append({
                'action': 'Improve brand visibility in AI responses - currently below 50%',
                'priority': 1,
                'effort': 'medium',
                'impact': 'high'
            })
        
        return recommendations
    
    def _get_property_context(self, property_id: str) -> Dict:
        """Get property details."""
        response = self.supabase.table('properties')\
            .select('name, address')\
            .eq('id', property_id)\
            .single()\
            .execute()
        return response.data or {}
    
    def _store_analysis(
        self,
        batch_id: str,
        analysis: Dict[str, Any],
        recommendations: Dict[str, Any]
    ) -> bool:
        """Store cross-model analysis in the batch record."""
        try:
            # Update all runs in the batch with cross-model analysis
            # Store in a JSONB column on geo_runs or create a separate table
            
            # For now, update the batch metadata on the runs
            self.supabase.table('geo_runs')\
                .update({
                    'cross_model_analysis': {
                        'analyzed_at': datetime.utcnow().isoformat(),
                        'agreement_rate': analysis.get('agreement_rate'),
                        'score_comparison': analysis.get('score_comparison'),
                        'visibility_comparison': analysis.get('visibility_comparison'),
                        'recommendations': recommendations
                    }
                })\
                .eq('batch_id', batch_id)\
                .execute()
            
            logger.info(f"[CrossModel] Stored analysis for batch {batch_id}")
            return True
            
        except Exception as e:
            logger.error(f"[CrossModel] Failed to store analysis: {e}")
            return False







