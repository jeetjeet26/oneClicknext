"""
Competitor Brand Intelligence Extractor
Scrapes competitor websites and extracts AI-powered brand insights
"""

import os
import json
import asyncio
import hashlib
import logging
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

import httpx
from openai import OpenAI

from scrapers.website_intelligence import (
    CommunityWebsiteScraper,
    CommunityKnowledge,
    ExtractedContent,
    FloorPlanUnit
)
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class BrandIntelligence:
    """Structured brand intelligence extracted from competitor website"""
    competitor_id: str
    
    # Brand Positioning
    brand_voice: Optional[str] = None
    brand_personality: Optional[str] = None
    positioning_statement: Optional[str] = None
    target_audience: Optional[str] = None
    unique_selling_points: List[str] = field(default_factory=list)
    
    # Offerings & Features
    highlighted_amenities: List[str] = field(default_factory=list)
    service_offerings: List[str] = field(default_factory=list)
    lifestyle_focus: List[str] = field(default_factory=list)
    community_events: List[str] = field(default_factory=list)
    
    # Promotions & Specials
    active_specials: List[str] = field(default_factory=list)
    promotional_messaging: Optional[str] = None
    urgency_tactics: List[str] = field(default_factory=list)
    
    # Website Analysis
    website_tone: Optional[str] = None
    key_messaging_themes: List[str] = field(default_factory=list)
    call_to_action_patterns: List[str] = field(default_factory=list)
    
    # Semantic Analysis
    sentiment_score: Optional[float] = None
    confidence_score: Optional[float] = None
    
    # Metadata
    pages_analyzed: int = 0
    raw_extraction: Optional[Dict[str, Any]] = None
    
    def to_db_dict(self) -> Dict[str, Any]:
        """Convert to database-ready dictionary"""
        return {
            "competitor_id": self.competitor_id,
            "brand_voice": self.brand_voice,
            "brand_personality": self.brand_personality,
            "positioning_statement": self.positioning_statement,
            "target_audience": self.target_audience,
            "unique_selling_points": self.unique_selling_points,
            "highlighted_amenities": self.highlighted_amenities,
            "service_offerings": self.service_offerings,
            "lifestyle_focus": self.lifestyle_focus,
            "community_events": self.community_events,
            "active_specials": self.active_specials,
            "promotional_messaging": self.promotional_messaging,
            "urgency_tactics": self.urgency_tactics,
            "website_tone": self.website_tone,
            "key_messaging_themes": self.key_messaging_themes,
            "call_to_action_patterns": self.call_to_action_patterns,
            "sentiment_score": self.sentiment_score,
            "confidence_score": self.confidence_score,
            "pages_analyzed": self.pages_analyzed,
            "raw_extraction": self.raw_extraction,
            "last_analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_version": "gpt-4o-mini-v1"
        }


# AI Prompt for brand analysis
BRAND_ANALYSIS_PROMPT = """You are an expert competitive intelligence analyst specializing in multifamily real estate marketing.

Analyze this apartment community website content and extract detailed brand intelligence.

Content to analyze:
{content}

Property Name (if known): {property_name}

Return a JSON object with the following structure. Be specific and insightful - this data will be used to understand competitive positioning:

{{
  "brand_voice": "One of: luxury, value-focused, community-oriented, modern/trendy, family-friendly, professional, boutique, resort-style",
  "brand_personality": "2-3 personality descriptors like: welcoming, sophisticated, energetic, cozy, exclusive, vibrant, serene",
  "positioning_statement": "A 1-2 sentence summary of how this property positions itself vs competitors",
  "target_audience": "Primary target demographic (e.g., 'Young professionals aged 25-35', 'Families with children', 'Active seniors')",
  "unique_selling_points": ["Array of 3-5 key differentiators they emphasize"],
  "highlighted_amenities": ["Top amenities they feature prominently"],
  "service_offerings": ["Services like concierge, package handling, maintenance guarantees"],
  "lifestyle_focus": ["Lifestyle themes: pet-friendly, work-from-home, fitness-focused, social, quiet/peaceful"],
  "community_events": ["Any events or activities they mention"],
  "active_specials": ["Current promotions or move-in specials mentioned"],
  "promotional_messaging": "How they frame their promotions (e.g., 'urgency-driven', 'value-focused', 'exclusive')",
  "urgency_tactics": ["Urgency phrases used like 'Limited availability', 'Act now', 'Only 2 left'"],
  "website_tone": "Overall website tone: professional, casual, luxury, energetic, warm, sophisticated",
  "key_messaging_themes": ["3-5 recurring themes in their marketing copy"],
  "call_to_action_patterns": ["Types of CTAs: 'Schedule a Tour', 'Apply Now', 'Contact Us'"],
  "sentiment_score": 0.0,  // Float from -1 (negative) to 1 (positive) - overall brand positivity
  "confidence_score": 0.0  // Float from 0 to 1 - your confidence in this analysis
}}

Important guidelines:
- If information is not available, use null for strings or empty arrays
- Be specific and actionable in your analysis
- Focus on competitive differentiators
- Extract actual specials/promotions text, not just their existence
- Sentiment should reflect how positive/aspirational the brand messaging is"""


class BrandIntelligenceExtractor:
    """
    Extracts brand intelligence from competitor websites.
    Uses CommunityWebsiteScraper for content extraction and GPT-4o-mini for analysis.
    """
    
    def __init__(self, openai_api_key: Optional[str] = None, prefer_playwright: bool = True):
        """
        Initialize extractor
        
        Args:
            openai_api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
            prefer_playwright: If True (default), use Playwright for scraping
                              (better for bot-protected apartment websites)
        """
        self.openai_api_key = openai_api_key or os.environ.get('OPENAI_API_KEY')
        self.scraper = CommunityWebsiteScraper(prefer_playwright=prefer_playwright)
        self.supabase = get_supabase_client()
        
        if self.openai_api_key:
            self.openai_client = OpenAI(api_key=self.openai_api_key)
        else:
            self.openai_client = None
            logger.warning("No OpenAI API key - AI analysis will be disabled")
    
    async def extract_for_competitor(
        self,
        competitor_id: str,
        website_url: str,
        competitor_name: Optional[str] = None,
        force_refresh: bool = False
    ) -> Tuple[Optional[BrandIntelligence], List[Dict[str, Any]], List[FloorPlanUnit]]:
        """
        Extract brand intelligence for a single competitor
        
        Args:
            competitor_id: Supabase competitor UUID
            website_url: Competitor website URL
            competitor_name: Name for context in AI analysis
            force_refresh: Re-analyze even if recent data exists
            
        Returns:
            Tuple of (BrandIntelligence, content_chunks, floor_plans)
        """
        if not website_url:
            logger.warning(f"No website URL for competitor {competitor_id}")
            return None, [], []
        
        # Check if we have recent analysis (within 7 days)
        if not force_refresh:
            existing = self.supabase.table('competitor_brand_intelligence').select(
                'last_analyzed_at'
            ).eq('competitor_id', competitor_id).execute()
            
            if existing.data:
                last_analyzed = existing.data[0].get('last_analyzed_at')
                if last_analyzed:
                    from datetime import timedelta
                    last_dt = datetime.fromisoformat(last_analyzed.replace('Z', '+00:00'))
                    if datetime.now(timezone.utc) - last_dt < timedelta(days=7):
                        logger.info(f"Skipping {competitor_name} - recent analysis exists")
                        return None, [], []
        
        logger.info(f"Extracting brand intelligence for: {competitor_name or competitor_id}")
        
        try:
            # Step 1: Scrape the website
            knowledge = await self.scraper.extract_community_knowledge(website_url)
            
            if not knowledge.raw_chunks:
                logger.warning(f"No content extracted from {website_url}")
                return None, [], []
            
            # Step 2: Prepare content chunks for storage
            content_chunks = self._prepare_content_chunks(
                competitor_id, 
                website_url, 
                knowledge
            )
            
            # Step 3: Extract floor plans from scraped knowledge
            floor_plans = knowledge.floor_plans
            if floor_plans:
                logger.info(f"Extracted {len(floor_plans)} floor plans with pricing from website")
            
            # Step 4: Analyze with AI
            brand_intel = await self._analyze_with_ai(
                competitor_id,
                knowledge,
                competitor_name
            )
            
            if brand_intel:
                brand_intel.pages_analyzed = knowledge.pages_scraped
            
            return brand_intel, content_chunks, floor_plans
            
        except Exception as e:
            logger.error(f"Error extracting brand intelligence for {competitor_id}: {e}")
            raise
    
    def _prepare_content_chunks(
        self,
        competitor_id: str,
        website_url: str,
        knowledge: CommunityKnowledge
    ) -> List[Dict[str, Any]]:
        """Prepare content chunks for database storage"""
        chunks = []
        
        for idx, chunk in enumerate(knowledge.raw_chunks):
            # Extract page type from chunk context
            page_type = "general"
            if chunk.startswith("[Source:"):
                # Extract page type from context marker
                import re
                match = re.match(r'\[Source:\s*(\w+)\s*page\]', chunk)
                if match:
                    page_type = match.group(1)
            
            # Create content hash for deduplication
            content_hash = hashlib.md5(chunk.encode()).hexdigest()
            
            chunks.append({
                "competitor_id": competitor_id,
                "page_url": website_url,
                "page_type": page_type,
                "chunk_index": idx,
                "content": chunk,
                "content_hash": content_hash
            })
        
        return chunks
    
    async def _analyze_with_ai(
        self,
        competitor_id: str,
        knowledge: CommunityKnowledge,
        competitor_name: Optional[str] = None
    ) -> Optional[BrandIntelligence]:
        """Analyze scraped content with GPT-4o-mini"""
        
        if not self.openai_client:
            # Return basic extraction without AI
            return BrandIntelligence(
                competitor_id=competitor_id,
                highlighted_amenities=knowledge.amenities,
                active_specials=knowledge.specials,
                brand_voice=knowledge.brand_voice,
                target_audience=knowledge.target_audience,
                pages_analyzed=knowledge.pages_scraped,
                raw_extraction=knowledge.to_dict()
            )
        
        # Combine content for analysis (limit to avoid token limits)
        combined_content = '\n\n'.join(knowledge.raw_chunks[:15])[:12000]
        
        prompt = BRAND_ANALYSIS_PROMPT.format(
            content=combined_content,
            property_name=competitor_name or knowledge.property_name or "Unknown"
        )
        
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert competitive intelligence analyst. Always respond with valid JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format={"type": "json_object"},
                max_tokens=2000,
                temperature=0.3
            )
            
            ai_data = json.loads(response.choices[0].message.content)
            
            # Create BrandIntelligence from AI response
            brand_intel = BrandIntelligence(
                competitor_id=competitor_id,
                brand_voice=ai_data.get('brand_voice'),
                brand_personality=ai_data.get('brand_personality'),
                positioning_statement=ai_data.get('positioning_statement'),
                target_audience=ai_data.get('target_audience'),
                unique_selling_points=ai_data.get('unique_selling_points', []),
                highlighted_amenities=ai_data.get('highlighted_amenities', []) or knowledge.amenities,
                service_offerings=ai_data.get('service_offerings', []),
                lifestyle_focus=ai_data.get('lifestyle_focus', []),
                community_events=ai_data.get('community_events', []),
                active_specials=ai_data.get('active_specials', []) or knowledge.specials,
                promotional_messaging=ai_data.get('promotional_messaging'),
                urgency_tactics=ai_data.get('urgency_tactics', []),
                website_tone=ai_data.get('website_tone'),
                key_messaging_themes=ai_data.get('key_messaging_themes', []),
                call_to_action_patterns=ai_data.get('call_to_action_patterns', []),
                sentiment_score=ai_data.get('sentiment_score'),
                confidence_score=ai_data.get('confidence_score'),
                raw_extraction={
                    "ai_analysis": ai_data,
                    "basic_extraction": knowledge.to_dict()
                }
            )
            
            logger.info(f"AI analysis complete for {competitor_name}: {brand_intel.brand_voice}")
            return brand_intel
            
        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            # Fall back to basic extraction
            return BrandIntelligence(
                competitor_id=competitor_id,
                highlighted_amenities=knowledge.amenities,
                active_specials=knowledge.specials,
                brand_voice=knowledge.brand_voice,
                target_audience=knowledge.target_audience,
                pages_analyzed=knowledge.pages_scraped,
                raw_extraction={"basic_extraction": knowledge.to_dict(), "ai_error": str(e)}
            )
    
    def store_brand_intelligence(
        self,
        brand_intel: BrandIntelligence,
        content_chunks: List[Dict[str, Any]],
        floor_plans: Optional[List[FloorPlanUnit]] = None
    ) -> bool:
        """
        Store brand intelligence, content chunks, and floor plans in database
        
        Args:
            brand_intel: Extracted brand intelligence
            content_chunks: Content chunks for semantic search
            floor_plans: Optional floor plans with pricing data
            
        Returns:
            True if successful
        """
        try:
            # Upsert brand intelligence
            self.supabase.table('competitor_brand_intelligence').upsert(
                brand_intel.to_db_dict(),
                on_conflict='competitor_id'
            ).execute()
            
            # Delete old chunks for this competitor
            self.supabase.table('competitor_content_chunks').delete().eq(
                'competitor_id', brand_intel.competitor_id
            ).execute()
            
            # Insert new chunks (batch in groups of 50)
            for i in range(0, len(content_chunks), 50):
                batch = content_chunks[i:i+50]
                self.supabase.table('competitor_content_chunks').insert(batch).execute()
            
            # Store floor plans/pricing data if available
            if floor_plans:
                self._store_floor_plans(brand_intel.competitor_id, floor_plans)
            
            logger.info(f"Stored brand intelligence for {brand_intel.competitor_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing brand intelligence: {e}")
            return False
    
    def _store_floor_plans(
        self,
        competitor_id: str,
        floor_plans: List[FloorPlanUnit]
    ) -> None:
        """
        Store floor plans with pricing data to competitor_units table.
        Updates existing units or creates new ones.
        """
        try:
            # Get existing units
            existing_result = self.supabase.table('competitor_units').select(
                'id, unit_type, rent_min, rent_max, available_count'
            ).eq('competitor_id', competitor_id).execute()
            
            existing_map = {u['unit_type']: u for u in (existing_result.data or [])}
            
            for fp in floor_plans:
                existing = existing_map.get(fp.unit_type)
                
                if existing:
                    # Check if price changed
                    price_changed = (
                        existing['rent_min'] != fp.rent_min or
                        existing['rent_max'] != fp.rent_max
                    )
                    
                    # Update existing unit
                    update_data = {
                        'bedrooms': fp.bedrooms,
                        'bathrooms': fp.bathrooms,
                        'sqft_min': fp.sqft_min,
                        'sqft_max': fp.sqft_max,
                        'rent_min': fp.rent_min,
                        'rent_max': fp.rent_max,
                        'deposit': fp.deposit,
                        'available_count': fp.available_count,
                        'move_in_specials': fp.move_in_specials,
                        'last_updated_at': datetime.now(timezone.utc).isoformat()
                    }
                    
                    self.supabase.table('competitor_units').update(
                        update_data
                    ).eq('id', existing['id']).execute()
                    
                    # Add price history if changed
                    if price_changed:
                        self.supabase.table('competitor_price_history').insert({
                            'competitor_unit_id': existing['id'],
                            'rent_min': fp.rent_min,
                            'rent_max': fp.rent_max,
                            'available_count': fp.available_count,
                            'source': 'website_scrape'
                        }).execute()
                        
                        logger.info(f"Price change detected for {fp.unit_type}: "
                                   f"${existing.get('rent_min')} -> ${fp.rent_min}")
                else:
                    # Insert new unit
                    unit_data = {
                        'competitor_id': competitor_id,
                        'unit_type': fp.unit_type,
                        'bedrooms': fp.bedrooms,
                        'bathrooms': fp.bathrooms,
                        'sqft_min': fp.sqft_min,
                        'sqft_max': fp.sqft_max,
                        'rent_min': fp.rent_min,
                        'rent_max': fp.rent_max,
                        'deposit': fp.deposit,
                        'available_count': fp.available_count,
                        'move_in_specials': fp.move_in_specials
                    }
                    
                    result = self.supabase.table('competitor_units').insert(
                        unit_data
                    ).execute()
                    
                    # Add initial price history
                    if result.data and (fp.rent_min or fp.rent_max):
                        self.supabase.table('competitor_price_history').insert({
                            'competitor_unit_id': result.data[0]['id'],
                            'rent_min': fp.rent_min,
                            'rent_max': fp.rent_max,
                            'available_count': fp.available_count,
                            'source': 'website_scrape'
                        }).execute()
            
            logger.info(f"Stored {len(floor_plans)} floor plans for competitor {competitor_id}")
            
        except Exception as e:
            logger.error(f"Error storing floor plans: {e}")


class CompetitorBatchProcessor:
    """
    Handles chunked/batched processing of multiple competitors.
    Implements rate limiting and progress tracking.
    """
    
    DEFAULT_BATCH_SIZE = 5
    MAX_CONCURRENT = 3
    DELAY_BETWEEN_COMPETITORS = 2.0  # seconds
    
    def __init__(
        self,
        batch_size: int = DEFAULT_BATCH_SIZE,
        max_concurrent: int = MAX_CONCURRENT,
        openai_api_key: Optional[str] = None
    ):
        """
        Initialize batch processor
        
        Args:
            batch_size: Competitors per batch for progress tracking
            max_concurrent: Maximum concurrent scrapes
            openai_api_key: OpenAI API key
        """
        self.batch_size = batch_size
        self.max_concurrent = max_concurrent
        self.extractor = BrandIntelligenceExtractor(openai_api_key)
        self.supabase = get_supabase_client()
        self._semaphore: Optional[asyncio.Semaphore] = None
    
    def create_job(
        self,
        property_id: str,
        competitor_ids: List[str]
    ) -> str:
        """
        Create a scrape job record
        
        Args:
            property_id: Property UUID
            competitor_ids: List of competitor UUIDs to process
            
        Returns:
            Job UUID
        """
        total_batches = (len(competitor_ids) + self.batch_size - 1) // self.batch_size
        
        result = self.supabase.table('competitor_scrape_jobs').insert({
            'property_id': property_id,
            'job_type': 'brand_intelligence',
            'status': JobStatus.PENDING.value,
            'total_competitors': len(competitor_ids),
            'batch_size': self.batch_size,
            'total_batches': total_batches,
            'competitor_ids': competitor_ids,
            'processed_competitor_ids': [],
            'failed_competitor_ids': []
        }).execute()
        
        job_id = result.data[0]['id']
        logger.info(f"Created scrape job {job_id} for {len(competitor_ids)} competitors")
        return job_id
    
    async def process_job(
        self,
        job_id: str,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Process all competitors in a job
        
        Args:
            job_id: Scrape job UUID
            force_refresh: Re-analyze even if recent data exists
            
        Returns:
            Job result summary
        """
        logger.info(f"[Job {job_id}] Starting process_job")
        
        # Get job details
        job_result = self.supabase.table('competitor_scrape_jobs').select(
            '*'
        ).eq('id', job_id).single().execute()
        
        if not job_result.data:
            raise ValueError(f"Job {job_id} not found")
        
        job = job_result.data
        competitor_ids = job.get('competitor_ids', [])
        
        logger.info(f"[Job {job_id}] Found {len(competitor_ids)} competitor IDs")
        
        if not competitor_ids:
            return {'success': True, 'processed': 0, 'message': 'No competitors to process'}
        
        # Update job to processing
        self.supabase.table('competitor_scrape_jobs').update({
            'status': JobStatus.PROCESSING.value,
            'started_at': datetime.now(timezone.utc).isoformat()
        }).eq('id', job_id).execute()
        
        logger.info(f"[Job {job_id}] Updated status to PROCESSING")
        
        # Get competitor details
        competitors_result = self.supabase.table('competitors').select(
            'id, name, website_url'
        ).in_('id', competitor_ids).execute()
        
        competitors = competitors_result.data or []
        
        # Filter to only those with website URLs
        competitors_with_urls = [c for c in competitors if c.get('website_url')]
        
        logger.info(f"[Job {job_id}] {len(competitors_with_urls)}/{len(competitors)} have website URLs")
        
        if not competitors_with_urls:
            self._complete_job(job_id, 0, 0, "No competitors with website URLs")
            return {'success': True, 'processed': 0, 'message': 'No competitors with website URLs'}
        
        # Process competitors
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        
        processed = 0
        failed = 0
        
        for i, competitor in enumerate(competitors_with_urls):
            logger.info(f"[Job {job_id}] Processing {i+1}/{len(competitors_with_urls)}: {competitor.get('name')}")
            
            try:
                async with self._semaphore:
                    success = await self._process_single_competitor(
                        competitor,
                        force_refresh
                    )
                
                if success:
                    processed += 1
                    logger.info(f"[Job {job_id}] ✓ {competitor.get('name')} - SUCCESS ({processed}/{len(competitors_with_urls)})")
                    self._update_job_progress(job_id, processed, failed, competitor['id'], None)
                else:
                    failed += 1
                    logger.warning(f"[Job {job_id}] ✗ {competitor.get('name')} - FAILED ({failed} failures)")
                    self._update_job_progress(job_id, processed, failed, None, competitor['id'])
                
                # Rate limiting between competitors
                if i < len(competitors_with_urls) - 1:
                    await asyncio.sleep(self.DELAY_BETWEEN_COMPETITORS)
                    
            except Exception as e:
                logger.error(f"[Job {job_id}] Error processing competitor {competitor.get('name')}: {e}", exc_info=True)
                failed += 1
                self._update_job_progress(
                    job_id, processed, failed, None, competitor['id'],
                    {'competitor_id': competitor['id'], 'error': str(e)}
                )
        
        # Complete job
        logger.info(f"[Job {job_id}] Completing job: {processed} processed, {failed} failed")
        self._complete_job(job_id, processed, failed)
        
        result = {
            'success': True,
            'job_id': job_id,
            'total': len(competitors_with_urls),
            'processed': processed,
            'failed': failed
        }
        
        logger.info(f"[Job {job_id}] COMPLETED: {result}")
        
        return result
    
    async def _process_single_competitor(
        self,
        competitor: Dict[str, Any],
        force_refresh: bool = False
    ) -> bool:
        """Process a single competitor"""
        try:
            brand_intel, chunks, floor_plans = await self.extractor.extract_for_competitor(
                competitor_id=competitor['id'],
                website_url=competitor['website_url'],
                competitor_name=competitor.get('name'),
                force_refresh=force_refresh
            )
            
            if brand_intel:
                return self.extractor.store_brand_intelligence(brand_intel, chunks, floor_plans)
            
            return True  # Skipped due to recent analysis
            
        except Exception as e:
            logger.error(f"Failed to process {competitor.get('name')}: {e}")
            return False
    
    def _update_job_progress(
        self,
        job_id: str,
        processed: int,
        failed: int,
        processed_id: Optional[str] = None,
        failed_id: Optional[str] = None,
        error_detail: Optional[Dict] = None
    ):
        """Update job progress in database"""
        try:
            update_data = {
                'processed_count': processed,
                'failed_count': failed,
                'current_batch': (processed + failed) // self.batch_size + 1
            }
            
            if processed_id:
                # Append to processed array using raw SQL would be better,
                # but for simplicity we'll fetch and update
                pass
            
            self.supabase.table('competitor_scrape_jobs').update(
                update_data
            ).eq('id', job_id).execute()
            
        except Exception as e:
            logger.error(f"Error updating job progress: {e}")
    
    def _complete_job(
        self,
        job_id: str,
        processed: int,
        failed: int,
        error_message: Optional[str] = None
    ):
        """Mark job as completed"""
        status = JobStatus.COMPLETED.value if failed == 0 else (
            JobStatus.FAILED.value if processed == 0 else JobStatus.COMPLETED.value
        )
        
        self.supabase.table('competitor_scrape_jobs').update({
            'status': status,
            'processed_count': processed,
            'failed_count': failed,
            'completed_at': datetime.now(timezone.utc).isoformat(),
            'error_message': error_message
        }).eq('id', job_id).execute()
        
        logger.info(f"Job {job_id} completed: {processed} processed, {failed} failed")
    
    def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """Get current job status"""
        result = self.supabase.table('competitor_scrape_jobs').select(
            '*'
        ).eq('id', job_id).single().execute()
        
        if not result.data:
            return {'error': 'Job not found'}
        
        job = result.data
        
        return {
            'job_id': job_id,
            'status': job['status'],
            'total_competitors': job['total_competitors'],
            'processed_count': job['processed_count'],
            'failed_count': job['failed_count'],
            'current_batch': job['current_batch'],
            'total_batches': job['total_batches'],
            'progress_percent': (
                (job['processed_count'] + job['failed_count']) / job['total_competitors'] * 100
                if job['total_competitors'] > 0 else 0
            ),
            'started_at': job['started_at'],
            'completed_at': job['completed_at'],
            'error_message': job['error_message']
        }


class SemanticSearchService:
    """
    Provides semantic search across competitor content chunks
    Uses OpenAI embeddings for similarity matching
    """
    
    def __init__(self, openai_api_key: Optional[str] = None):
        self.openai_api_key = openai_api_key or os.environ.get('OPENAI_API_KEY')
        self.supabase = get_supabase_client()
        
        if self.openai_api_key:
            self.openai_client = OpenAI(api_key=self.openai_api_key)
        else:
            self.openai_client = None
    
    async def search(
        self,
        query: str,
        property_id: Optional[str] = None,
        competitor_ids: Optional[List[str]] = None,
        limit: int = 10,
        threshold: float = 0.7
    ) -> List[Dict[str, Any]]:
        """
        Semantic search across competitor content
        
        Args:
            query: Natural language query
            property_id: Filter to competitors of this property
            competitor_ids: Filter to specific competitors
            limit: Max results to return
            threshold: Minimum similarity threshold
            
        Returns:
            List of matching content chunks with metadata
        """
        if not self.openai_client:
            logger.error("OpenAI client not initialized - cannot perform semantic search")
            return []
        
        # Generate query embedding
        embedding_response = self.openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=query
        )
        query_embedding = embedding_response.data[0].embedding
        
        # Call the Postgres function for vector search
        result = self.supabase.rpc('match_competitor_content', {
            'query_embedding': query_embedding,
            'match_threshold': threshold,
            'match_count': limit,
            'filter_property_id': property_id,
            'filter_competitor_ids': competitor_ids
        }).execute()
        
        return result.data or []
    
    async def generate_embeddings_for_competitor(
        self,
        competitor_id: str
    ) -> int:
        """
        Generate embeddings for a competitor's content chunks
        
        Args:
            competitor_id: Competitor UUID
            
        Returns:
            Number of chunks updated
        """
        if not self.openai_client:
            return 0
        
        # Get chunks without embeddings
        result = self.supabase.table('competitor_content_chunks').select(
            'id, content'
        ).eq('competitor_id', competitor_id).is_('embedding', 'null').execute()
        
        chunks = result.data or []
        
        if not chunks:
            return 0
        
        updated = 0
        
        # Process in batches of 100 (OpenAI limit)
        for i in range(0, len(chunks), 100):
            batch = chunks[i:i+100]
            contents = [c['content'] for c in batch]
            
            try:
                embedding_response = self.openai_client.embeddings.create(
                    model="text-embedding-3-small",
                    input=contents
                )
                
                for j, embedding_data in enumerate(embedding_response.data):
                    chunk_id = batch[j]['id']
                    embedding = embedding_data.embedding
                    
                    self.supabase.table('competitor_content_chunks').update({
                        'embedding': embedding
                    }).eq('id', chunk_id).execute()
                    
                    updated += 1
                    
            except Exception as e:
                logger.error(f"Error generating embeddings: {e}")
        
        logger.info(f"Generated {updated} embeddings for competitor {competitor_id}")
        return updated


# Synchronous wrapper for non-async contexts
def extract_brand_intelligence_sync(
    competitor_id: str,
    website_url: str,
    competitor_name: Optional[str] = None,
    openai_api_key: Optional[str] = None,
    prefer_playwright: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Synchronous wrapper for brand intelligence extraction
    
    Args:
        competitor_id: Competitor UUID
        website_url: Website URL to scrape
        competitor_name: Optional name for context
        openai_api_key: OpenAI API key
        prefer_playwright: If True (default), use Playwright for better
                          compatibility with bot-protected apartment websites
        
    Returns:
        Brand intelligence dict or None
    """
    extractor = BrandIntelligenceExtractor(openai_api_key, prefer_playwright=prefer_playwright)
    
    async def run():
        brand_intel, chunks, floor_plans = await extractor.extract_for_competitor(
            competitor_id=competitor_id,
            website_url=website_url,
            competitor_name=competitor_name,
            force_refresh=True
        )
        
        if brand_intel:
            extractor.store_brand_intelligence(brand_intel, chunks, floor_plans)
            return brand_intel.to_db_dict()
        return None
    
    return asyncio.run(run())


# CLI for testing
if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 3:
        print("Usage: python brand_intelligence.py <competitor_id> <website_url>")
        sys.exit(1)
    
    competitor_id = sys.argv[1]
    website_url = sys.argv[2]
    
    result = extract_brand_intelligence_sync(
        competitor_id=competitor_id,
        website_url=website_url,
        competitor_name="Test Competitor"
    )
    
    if result:
        print(json.dumps(result, indent=2, default=str))
    else:
        print("No results extracted")

