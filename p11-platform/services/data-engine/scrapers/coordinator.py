"""
Scraping Coordinator
Manages scraping jobs, syncs with Supabase, handles updates
Includes brand intelligence extraction for competitor analysis

Updated Dec 2025: Uses Apify for apartments.com scraping (replaces blocked Playwright/httpx)
"""

import logging
import asyncio
import concurrent.futures
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import hashlib


def run_async_in_thread(coro):
    """
    Run an async coroutine in a separate thread with its own event loop.
    This allows Playwright to work when called from FastAPI's async context,
    since Playwright needs full control of subprocess spawning.
    """
    def run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run)
        return future.result()

from scrapers.base import ScrapedProperty
from scrapers.discovery import CompetitorDiscovery, DiscoveryConfig, SubjectPropertyInfo
from scrapers.brand_intelligence import (
    BrandIntelligenceExtractor,
    CompetitorBatchProcessor,
    SemanticSearchService
)
from scrapers.website_intelligence import (
    CommunityWebsiteScraper,
    FloorPlanUnit
)
from scrapers.apify_apartments import (
    ApifyApartmentsScraper,
    is_apify_configured,
    get_apify_scraper
)
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


class ScrapingCoordinator:
    """
    Coordinates scraping operations and syncs with database
    """
    
    def __init__(self, proxy_url: Optional[str] = None):
        """
        Initialize coordinator
        
        Args:
            proxy_url: Optional proxy URL for scrapers
        """
        self.proxy_url = proxy_url
        self.supabase = get_supabase_client()
    
    def discover_competitors_for_property(
        self,
        property_id: str,
        radius_miles: float = 3.0,
        max_competitors: int = 20,
        auto_add: bool = True
    ) -> Dict[str, Any]:
        """
        Discover competitors near a property and optionally add them
        
        Uses intelligent filtering based on property_type to only find
        relevant competitors (e.g., only apartments for apartment properties).
        
        Args:
            property_id: Supabase property ID
            radius_miles: Search radius in miles
            max_competitors: Maximum competitors to find
            auto_add: Automatically add discovered competitors
            
        Returns:
            Dict with discovered competitors and status
        """
        # Get property details (including property_type for intelligent filtering)
        property_result = self.supabase.table('properties').select(
            'id, name, address, year_built, unit_count, amenities, property_type'
        ).eq('id', property_id).single().execute()
        
        if not property_result.data:
            return {'success': False, 'error': 'Property not found'}
        
        property_data = property_result.data
        address_json = property_data.get('address') or {}
        property_type = property_data.get('property_type')
        
        # Build address string
        address_parts = [
            address_json.get('street', ''),
            address_json.get('city', ''),
            address_json.get('state', ''),
            address_json.get('zip', '')
        ]
        full_address = ', '.join(p for p in address_parts if p)
        
        if not full_address:
            return {'success': False, 'error': 'Property has no address'}
        
        logger.info(f"Discovering competitors for: {property_data['name']} at {full_address}")
        logger.info(f"Property type filter: {property_type or 'None (no filtering)'}")
        
        # Try to get average rent from property units for classification
        avg_rent = None
        try:
            units_result = self.supabase.table('property_units').select(
                'rent_min, rent_max'
            ).eq('property_id', property_id).execute()
            
            if units_result.data:
                rents = [u.get('rent_min') or u.get('rent_max') for u in units_result.data if u.get('rent_min') or u.get('rent_max')]
                if rents:
                    avg_rent = sum(rents) / len(rents)
        except Exception as e:
            logger.debug(f"Could not fetch units for avg rent: {e}")
        
        # Create subject property info for smart matching (now with property_type)
        subject_info = SubjectPropertyInfo(
            name=property_data['name'],
            year_built=property_data.get('year_built'),
            units_count=property_data.get('unit_count'),
            avg_rent=avg_rent,
            amenities=property_data.get('amenities') or [],
            city=address_json.get('city', ''),
            property_type=property_type
        )
        
        # Configure and run discovery
        config = DiscoveryConfig(
            radius_miles=radius_miles,
            max_competitors=max_competitors,
            min_similarity=50.0,  # Only return competitors with 50%+ similarity
            use_smart_matching=True
        )
        
        discovery = CompetitorDiscovery(
            proxy_url=self.proxy_url,
            config=config,
            subject_info=subject_info
        )
        
        # Discover competitors
        discovered = discovery.discover_from_address(
            full_address,
            city=address_json.get('city'),
            state=address_json.get('state')
        )
        
        logger.info(f"Discovered {len(discovered)} potential competitors")
        
        # Get existing competitors to avoid duplicates
        existing_result = self.supabase.table('competitors').select(
            'name, address'
        ).eq('property_id', property_id).execute()
        
        existing_names = {c['name'].lower() for c in (existing_result.data or [])}
        
        # Filter out existing
        new_competitors = [
            d for d in discovered 
            if d.name.lower() not in existing_names
        ]
        
        added = []
        if auto_add and new_competitors:
            added = self._add_competitors(property_id, new_competitors)
        
        return {
            'success': True,
            'property_name': property_data['name'],
            'discovered_count': len(discovered),
            'new_count': len(new_competitors),
            'added_count': len(added),
            'competitors': [d.to_dict() for d in new_competitors] if not auto_add else added
        }
    
    def refresh_all_competitors(
        self, 
        property_id: str,
        prefer_website: bool = True
    ) -> Dict[str, Any]:
        """
        Refresh pricing data for all competitors of a property.
        
        Prioritizes competitor website over ILS listings (apartments.com).
        Falls back to apartments.com if website scraping doesn't yield pricing.
        
        Args:
            property_id: Supabase property ID
            prefer_website: If True, try website_url first before apartments.com
            
        Returns:
            Dict with refresh results
        """
        # Get all competitors with website URLs or ILS listings
        competitors_result = self.supabase.table('competitors').select(
            'id, name, website_url, ils_listings'
        ).eq('property_id', property_id).eq('is_active', True).execute()
        
        competitors = competitors_result.data or []
        
        if not competitors:
            return {'success': True, 'updated_count': 0, 'message': 'No competitors to refresh'}
        
        discovery = CompetitorDiscovery(proxy_url=self.proxy_url)
        
        updated = 0
        website_updated = 0
        ils_updated = 0
        errors = []
        
        for competitor in competitors:
            website_url = competitor.get('website_url')
            ils_listings = competitor.get('ils_listings', {})
            refreshed_from = None
            
            # Try website first if preferred and available
            if prefer_website and website_url:
                try:
                    result = self.refresh_competitor_from_website(
                        competitor_id=competitor['id'],
                        website_url=website_url
                    )
                    
                    if result.get('success') and result.get('units_updated', 0) > 0:
                        updated += 1
                        website_updated += 1
                        refreshed_from = 'website'
                        logger.info(f"Refreshed {competitor['name']} from website: {result.get('units_updated')} units")
                        continue  # Move to next competitor
                        
                except Exception as e:
                    logger.warning(f"Website refresh failed for {competitor['name']}: {e}")
            
            # Fall back to ILS listings (apartments.com, etc.)
            if not refreshed_from:
                for source, url in ils_listings.items():
                    if not url:
                        continue
                    
                    try:
                        refreshed = discovery.refresh_competitor(url, source)
                        
                        if refreshed:
                            # Update competitor and units
                            self._update_competitor(competitor['id'], refreshed)
                            updated += 1
                            ils_updated += 1
                            refreshed_from = source
                            logger.info(f"Refreshed {competitor['name']} from {source}")
                        
                        break  # Only need one successful source
                        
                    except Exception as e:
                        logger.error(f"Error refreshing {competitor['name']} from {source}: {e}")
            
            if not refreshed_from:
                errors.append({
                    'competitor': competitor['name'],
                    'error': 'No successful refresh from any source'
                })
        
        # Update last scraped timestamp
        self.supabase.table('scrape_config').update({
            'last_run_at': datetime.now(timezone.utc).isoformat(),
            'error_count': len(errors)
        }).eq('property_id', property_id).execute()
        
        return {
            'success': True,
            'total_competitors': len(competitors),
            'updated_count': updated,
            'website_updated': website_updated,
            'ils_updated': ils_updated,
            'error_count': len(errors),
            'errors': errors[:5]  # Limit errors returned
        }
    
    def refresh_competitor_from_website(
        self,
        competitor_id: str,
        website_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Refresh pricing data for a competitor from their website.
        
        Scrapes the competitor's website for floor plans and pricing data.
        This is the preferred method as it gets data directly from the source.
        
        Args:
            competitor_id: Competitor UUID
            website_url: Optional URL override (otherwise fetched from competitor record)
            
        Returns:
            Dict with refresh results
        """
        # Get competitor details if URL not provided
        if not website_url:
            competitor_result = self.supabase.table('competitors').select(
                'id, name, website_url'
            ).eq('id', competitor_id).single().execute()
            
            if not competitor_result.data:
                return {'success': False, 'error': 'Competitor not found'}
            
            competitor = competitor_result.data
            website_url = competitor.get('website_url')
            competitor_name = competitor.get('name', 'Unknown')
        else:
            competitor_name = 'Competitor'
        
        if not website_url:
            return {'success': False, 'error': 'No website URL for this competitor'}
        
        logger.info(f"Refreshing {competitor_name} pricing from website: {website_url}")
        
        try:
            # Use async scraper with Playwright priority and LLM extraction (best accuracy)
            scraper = CommunityWebsiteScraper(
                prefer_playwright=True,
                use_llm_extraction=True  # Use GPT-4o-mini for intelligent pricing extraction
            )
            # Run in separate thread to avoid event loop conflicts with Playwright
            knowledge = run_async_in_thread(scraper.extract_community_knowledge(website_url))
            
            if not knowledge.floor_plans:
                return {
                    'success': True,
                    'competitor_id': competitor_id,
                    'scraped': True,
                    'source': 'website',
                    'units_updated': 0,
                    'message': 'Website scraped but no pricing data found'
                }
            
            # Update units with extracted pricing
            units_updated = self._update_units_from_floor_plans(
                competitor_id, 
                knowledge.floor_plans
            )
            
            # Update competitor last_scraped_at
            self.supabase.table('competitors').update({
                'last_scraped_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', competitor_id).execute()
            
            return {
                'success': True,
                'competitor_id': competitor_id,
                'scraped': True,
                'source': 'website',
                'units_updated': units_updated,
                'floor_plans_found': len(knowledge.floor_plans),
                'specials_found': len(knowledge.specials),
                'amenities_found': len(knowledge.amenities)
            }
            
        except Exception as e:
            logger.error(f"Error refreshing from website: {e}")
            return {
                'success': False,
                'competitor_id': competitor_id,
                'scraped': False,
                'source': 'website',
                'error': str(e)
            }
    
    def _update_units_from_floor_plans(
        self,
        competitor_id: str,
        floor_plans: List[FloorPlanUnit]
    ) -> int:
        """
        Update competitor units from extracted floor plan data.
        
        Creates price change alerts if prices have changed.
        
        Returns:
            Number of units updated/created
        """
        # Get existing units
        existing_result = self.supabase.table('competitor_units').select(
            'id, unit_type, rent_min, rent_max, available_count'
        ).eq('competitor_id', competitor_id).execute()
        
        existing_map = {u['unit_type']: u for u in (existing_result.data or [])}
        
        # Get competitor details for alerts
        competitor_result = self.supabase.table('competitors').select(
            'name, property_id'
        ).eq('id', competitor_id).single().execute()
        
        competitor = competitor_result.data if competitor_result.data else {}
        property_id = competitor.get('property_id')
        competitor_name = competitor.get('name', 'Unknown')
        
        units_updated = 0
        
        for fp in floor_plans:
            existing = existing_map.get(fp.unit_type)
            
            if existing:
                old_rent = existing.get('rent_min')
                
                # Check if price changed
                price_changed = (
                    existing['rent_min'] != fp.rent_min or
                    existing['rent_max'] != fp.rent_max
                )
                
                # Update existing unit
                self.supabase.table('competitor_units').update({
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
                }).eq('id', existing['id']).execute()
                
                # Add price history if changed
                if price_changed or existing['available_count'] != fp.available_count:
                    self.supabase.table('competitor_price_history').insert({
                        'competitor_unit_id': existing['id'],
                        'rent_min': fp.rent_min,
                        'rent_max': fp.rent_max,
                        'available_count': fp.available_count,
                        'source': 'website_scrape'
                    }).execute()
                
                # Create price alert if significant change
                if price_changed and property_id and old_rent and fp.rent_min:
                    change = fp.rent_min - old_rent
                    change_pct = (change / old_rent) * 100
                    
                    severity = 'info'
                    if abs(change_pct) >= 10:
                        severity = 'high'
                    elif abs(change_pct) >= 5:
                        severity = 'medium'
                    
                    alert_type = 'price_increase' if change > 0 else 'price_decrease'
                    
                    self.supabase.table('market_alerts').insert({
                        'property_id': property_id,
                        'competitor_id': competitor_id,
                        'alert_type': alert_type,
                        'severity': severity,
                        'title': f"{competitor_name} {fp.unit_type} price {'increased' if change > 0 else 'decreased'}",
                        'description': f"${old_rent} → ${fp.rent_min} ({change_pct:+.1f}%)",
                        'data': {
                            'unit_type': fp.unit_type,
                            'old_rent': old_rent,
                            'new_rent': fp.rent_min,
                            'change': change,
                            'change_percent': round(change_pct, 1),
                            'source': 'website_scrape'
                        }
                    }).execute()
                
                units_updated += 1
                
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
                
                units_updated += 1
        
        return units_updated
    
    def batch_refresh_from_website(
        self,
        property_id: str,
        competitor_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Batch refresh pricing data for multiple competitors from their websites.
        
        Args:
            property_id: Property UUID
            competitor_ids: Optional list of specific competitor IDs (None = all with website URLs)
            
        Returns:
            Dict with batch refresh results
        """
        # Get competitors with website URLs
        query = self.supabase.table('competitors').select(
            'id, name, website_url'
        ).eq('property_id', property_id).eq('is_active', True).not_.is_('website_url', 'null')
        
        if competitor_ids:
            query = query.in_('id', competitor_ids)
        
        result = query.execute()
        competitors = result.data or []
        
        if not competitors:
            return {
                'success': True,
                'message': 'No competitors with website URLs',
                'refreshed': 0,
                'failed': 0
            }
        
        logger.info(f"Batch refreshing {len(competitors)} competitors from websites")
        
        refreshed = 0
        failed = 0
        errors = []
        
        for comp in competitors:
            try:
                result = self.refresh_competitor_from_website(
                    competitor_id=comp['id'],
                    website_url=comp['website_url']
                )
                
                if result.get('success') and result.get('units_updated', 0) > 0:
                    refreshed += 1
                    logger.info(f"Refreshed: {comp['name']} ({result.get('units_updated')} units)")
                else:
                    # Scraped but no pricing found - not an error
                    if result.get('scraped'):
                        logger.info(f"No pricing found for: {comp['name']}")
                    else:
                        failed += 1
                        errors.append({
                            'competitor': comp['name'],
                            'error': result.get('error', 'Unknown error')
                        })
                        
            except Exception as e:
                failed += 1
                errors.append({
                    'competitor': comp['name'],
                    'error': str(e)
                })
        
        return {
            'success': True,
            'source': 'website',
            'total': len(competitors),
            'refreshed': refreshed,
            'failed': failed,
            'errors': errors[:5],
            'message': f"Refreshed {refreshed} of {len(competitors)} competitors from websites"
        }
    
    def refresh_property_from_website(
        self,
        property_id: str,
        website_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Refresh pricing data for a property from its own website.
        
        Uses the same scraping logic as competitors but stores results in property_units.
        
        Args:
            property_id: Property UUID
            website_url: Optional URL override (otherwise fetched from properties table)
            
        Returns:
            Dict with refresh results
        """
        # Get property details
        property_result = self.supabase.table('properties').select(
            'id, name, website_url'
        ).eq('id', property_id).single().execute()
        
        if not property_result.data:
            return {'success': False, 'error': 'Property not found'}
        
        property_data = property_result.data
        
        # Get website URL
        url = website_url or property_data.get('website_url')
        if not url:
            return {'success': False, 'error': 'No website URL for this property'}
        
        logger.info(f"Refreshing {property_data['name']} from website: {url}")
        
        try:
            # Use the same website scraper as competitors
            scraper = CommunityWebsiteScraper(
                prefer_playwright=True,
                use_llm_extraction=True  # Use GPT-4o-mini for intelligent pricing extraction
            )
            # Run in separate thread to avoid event loop conflicts
            knowledge = run_async_in_thread(scraper.extract_community_knowledge(url))
            
            if not knowledge.floor_plans:
                return {
                    'success': False,
                    'error': 'No pricing/floorplan data found on website',
                    'url': url
                }
            
            # Delete existing scraped units for this property (manual entries preserved)
            self.supabase.table('property_units').delete().eq(
                'property_id', property_id
            ).eq('source', 'scraped').execute()
            
            # Insert new units
            units_to_insert = []
            for fp in knowledge.floor_plans:
                units_to_insert.append({
                    'property_id': property_id,
                    'unit_type': fp.unit_type,
                    'bedrooms': fp.bedrooms,
                    'bathrooms': fp.bathrooms,
                    'sqft_min': fp.sqft_min,
                    'sqft_max': fp.sqft_max,
                    'rent_min': fp.rent_min,
                    'rent_max': fp.rent_max,
                    'deposit': fp.deposit,
                    'available_count': fp.available_count,
                    'move_in_specials': fp.move_in_specials,
                    'source': 'scraped',
                    'source_url': url,
                    'last_updated_at': datetime.now(timezone.utc).isoformat()
                })
            
            if units_to_insert:
                result = self.supabase.table('property_units').insert(units_to_insert).execute()
                
                # Add price history for each unit
                if result.data:
                    for unit_data in result.data:
                        if unit_data.get('rent_min') or unit_data.get('rent_max'):
                            self.supabase.table('property_price_history').insert({
                                'property_unit_id': unit_data['id'],
                                'rent_min': unit_data.get('rent_min'),
                                'rent_max': unit_data.get('rent_max'),
                                'available_count': unit_data.get('available_count'),
                                'source': 'website_scrape'
                            }).execute()
            
            # Update property updated_at timestamp
            self.supabase.table('properties').update({
                'updated_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', property_id).execute()
            
            return {
                'success': True,
                'units_found': len(units_to_insert),
                'url': url,
                'property_name': property_data['name'],
                'floor_plans_found': len(knowledge.floor_plans),
                'specials_found': len(knowledge.specials),
                'amenities_found': len(knowledge.amenities),
                'message': f"Successfully scraped {len(units_to_insert)} floor plans"
            }
            
        except Exception as e:
            logger.error(f"Error scraping property website: {e}")
            return {
                'success': False,
                'error': str(e),
                'url': url
            }
    
    def _add_competitors(
        self, 
        property_id: str, 
        properties: List[ScrapedProperty]
    ) -> List[Dict[str, Any]]:
        """Add discovered competitors to database"""
        added = []
        
        for prop in properties:
            try:
                # Insert competitor
                competitor_data = {
                    'property_id': property_id,
                    'name': prop.name,
                    'address': f"{prop.address}, {prop.city}, {prop.state} {prop.zip_code}",
                    'address_json': {
                        'street': prop.address,
                        'city': prop.city,
                        'state': prop.state,
                        'zip': prop.zip_code,
                        'lat': prop.latitude,
                        'lng': prop.longitude
                    },
                    'website_url': prop.website_url,
                    'phone': prop.phone,
                    'units_count': prop.units_count,
                    'year_built': prop.year_built,
                    'property_type': prop.property_type,
                    'amenities': prop.amenities,
                    'photos': prop.photos[:10],
                    'ils_listings': {prop.source: prop.source_url},
                    'last_scraped_at': datetime.now(timezone.utc).isoformat()
                }
                
                result = self.supabase.table('competitors').insert(
                    competitor_data
                ).execute()
                
                if result.data:
                    competitor_id = result.data[0]['id']
                    
                    # Add units
                    if prop.units:
                        self._add_units(competitor_id, prop.units)
                    
                    added.append({
                        'id': competitor_id,
                        'name': prop.name,
                        'units_count': len(prop.units)
                    })
                    
                    # Create "new competitor" alert
                    self.supabase.table('market_alerts').insert({
                        'property_id': property_id,
                        'competitor_id': competitor_id,
                        'alert_type': 'new_competitor',
                        'severity': 'info',
                        'title': f'New competitor discovered: {prop.name}',
                        'description': f'Auto-discovered via {prop.source}',
                        'data': {
                            'source': prop.source,
                            'units_tracked': len(prop.units)
                        }
                    }).execute()
                    
            except Exception as e:
                logger.error(f"Error adding competitor {prop.name}: {e}")
                continue
        
        return added
    
    def _add_units(self, competitor_id: str, units: List) -> None:
        """Add units and initial price history"""
        for unit in units:
            try:
                unit_data = {
                    'competitor_id': competitor_id,
                    'unit_type': unit.unit_type,
                    'bedrooms': unit.bedrooms,
                    'bathrooms': unit.bathrooms,
                    'sqft_min': unit.sqft_min,
                    'sqft_max': unit.sqft_max,
                    'rent_min': unit.rent_min,
                    'rent_max': unit.rent_max,
                    'deposit': unit.deposit,
                    'available_count': unit.available_count,
                    'move_in_specials': unit.move_in_specials
                }
                
                result = self.supabase.table('competitor_units').insert(
                    unit_data
                ).execute()
                
                # Add initial price history
                if result.data and (unit.rent_min or unit.rent_max):
                    self.supabase.table('competitor_price_history').insert({
                        'competitor_unit_id': result.data[0]['id'],
                        'rent_min': unit.rent_min,
                        'rent_max': unit.rent_max,
                        'available_count': unit.available_count,
                        'source': 'scraper'
                    }).execute()
                    
            except Exception as e:
                logger.error(f"Error adding unit: {e}")
    
    def _update_competitor(
        self, 
        competitor_id: str, 
        refreshed: ScrapedProperty
    ) -> None:
        """Update competitor with refreshed data"""
        try:
            # Update competitor info
            self.supabase.table('competitors').update({
                'phone': refreshed.phone,
                'amenities': refreshed.amenities,
                'photos': refreshed.photos[:10],
                'last_scraped_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', competitor_id).execute()
            
            # Get existing units
            existing_units = self.supabase.table('competitor_units').select(
                'id, unit_type, rent_min, rent_max, available_count'
            ).eq('competitor_id', competitor_id).execute()
            
            existing_map = {u['unit_type']: u for u in (existing_units.data or [])}
            
            # Update or add units
            for unit in refreshed.units:
                existing = existing_map.get(unit.unit_type)
                
                if existing:
                    # Check if price changed
                    price_changed = (
                        existing['rent_min'] != unit.rent_min or
                        existing['rent_max'] != unit.rent_max
                    )
                    
                    # Update unit
                    self.supabase.table('competitor_units').update({
                        'rent_min': unit.rent_min,
                        'rent_max': unit.rent_max,
                        'sqft_min': unit.sqft_min,
                        'sqft_max': unit.sqft_max,
                        'available_count': unit.available_count,
                        'move_in_specials': unit.move_in_specials,
                        'last_updated_at': datetime.now(timezone.utc).isoformat()
                    }).eq('id', existing['id']).execute()
                    
                    # Add price history if changed (triggers alert automatically)
                    if price_changed or existing['available_count'] != unit.available_count:
                        self.supabase.table('competitor_price_history').insert({
                            'competitor_unit_id': existing['id'],
                            'rent_min': unit.rent_min,
                            'rent_max': unit.rent_max,
                            'available_count': unit.available_count,
                            'source': 'scraper'
                        }).execute()
                else:
                    # Add new unit
                    self._add_units(competitor_id, [unit])
                    
        except Exception as e:
            logger.error(f"Error updating competitor {competitor_id}: {e}")
            raise
    
    # =========================================================================
    # BRAND INTELLIGENCE METHODS
    # =========================================================================
    
    def discover_and_analyze_competitors(
        self,
        property_id: str,
        radius_miles: float = 3.0,
        max_competitors: int = 20,
        auto_add: bool = True,
        extract_brand_intelligence: bool = True
    ) -> Dict[str, Any]:
        """
        Enhanced discovery that also triggers brand intelligence extraction
        
        Args:
            property_id: Supabase property ID
            radius_miles: Search radius in miles
            max_competitors: Maximum competitors to find
            auto_add: Automatically add discovered competitors
            extract_brand_intelligence: Trigger brand intelligence extraction
            
        Returns:
            Dict with discovery results and optional brand intel job ID
        """
        # Run standard discovery
        discovery_result = self.discover_competitors_for_property(
            property_id=property_id,
            radius_miles=radius_miles,
            max_competitors=max_competitors,
            auto_add=auto_add
        )
        
        if not discovery_result.get('success'):
            return discovery_result
        
        # If brand intelligence requested and we added competitors
        brand_intel_job_id = None
        if extract_brand_intelligence and discovery_result.get('added_count', 0) > 0:
            # Get IDs of newly added competitors with website URLs
            added_competitors = discovery_result.get('competitors', [])
            competitor_ids = [c['id'] for c in added_competitors if c.get('id')]
            
            if competitor_ids:
                # Create brand intelligence job
                brand_intel_job_id = self.trigger_brand_intelligence_extraction(
                    property_id=property_id,
                    competitor_ids=competitor_ids
                )
        
        discovery_result['brand_intelligence_job_id'] = brand_intel_job_id
        return discovery_result
    
    def trigger_brand_intelligence_extraction(
        self,
        property_id: str,
        competitor_ids: Optional[List[str]] = None,
        force_refresh: bool = False
    ) -> str:
        """
        Start brand intelligence extraction job for competitors
        
        Args:
            property_id: Property UUID
            competitor_ids: Specific competitor IDs (None = all with websites)
            force_refresh: Re-analyze even if recent data exists
            
        Returns:
            Job UUID for status polling
        """
        # Get competitors with website URLs
        query = self.supabase.table('competitors').select(
            'id, name, website_url'
        ).eq('property_id', property_id).eq('is_active', True).not_.is_('website_url', 'null')
        
        if competitor_ids:
            query = query.in_('id', competitor_ids)
        
        result = query.execute()
        competitors = result.data or []
        
        if not competitors:
            logger.warning(f"No competitors with website URLs found for property {property_id}")
            # Return a completed job with 0 competitors
            job_result = self.supabase.table('competitor_scrape_jobs').insert({
                'property_id': property_id,
                'job_type': 'brand_intelligence',
                'status': 'completed',
                'total_competitors': 0,
                'processed_count': 0,
                'failed_count': 0,
                'error_message': 'No competitors with website URLs'
            }).execute()
            return job_result.data[0]['id']
        
        # Create batch processor and job
        processor = CompetitorBatchProcessor()
        competitor_ids_to_process = [c['id'] for c in competitors]
        
        job_id = processor.create_job(property_id, competitor_ids_to_process)
        
        # Run job in background thread with its own event loop
        def run_job():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                logger.info(f"[Job {job_id}] Starting brand intelligence extraction for {len(competitors)} competitors")
                result = loop.run_until_complete(processor.process_job(job_id, force_refresh))
                logger.info(f"[Job {job_id}] Completed: {result}")
            except Exception as e:
                logger.error(f"[Job {job_id}] Fatal error in background thread: {e}", exc_info=True)
                # Mark job as failed
                try:
                    from utils.supabase_client import get_supabase_client
                    supabase = get_supabase_client()
                    supabase.table('competitor_scrape_jobs').update({
                        'status': 'failed',
                        'error_message': f'Background thread error: {str(e)}',
                        'completed_at': datetime.now(timezone.utc).isoformat()
                    }).eq('id', job_id).execute()
                except Exception as update_error:
                    logger.error(f"[Job {job_id}] Failed to update job status: {update_error}")
            finally:
                loop.close()
        
        import threading
        thread = threading.Thread(target=run_job, daemon=True)
        thread.start()
        
        logger.info(f"Started brand intelligence job {job_id} for {len(competitors)} competitors in background thread")
        
        return job_id
    
    def get_brand_intelligence_job_status(self, job_id: str) -> Dict[str, Any]:
        """
        Get status of a brand intelligence extraction job
        
        Args:
            job_id: Job UUID
            
        Returns:
            Job status details
        """
        processor = CompetitorBatchProcessor()
        return processor.get_job_status(job_id)
    
    def get_competitor_brand_intelligence(
        self,
        competitor_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get brand intelligence for a specific competitor
        
        Args:
            competitor_id: Competitor UUID
            
        Returns:
            Brand intelligence data or None
        """
        result = self.supabase.table('competitor_brand_intelligence').select(
            '*'
        ).eq('competitor_id', competitor_id).single().execute()
        
        return result.data if result.data else None
    
    def get_all_brand_intelligence(
        self,
        property_id: str,
        include_raw: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get brand intelligence for all competitors of a property
        
        Args:
            property_id: Property UUID
            include_raw: Include raw extraction data
            
        Returns:
            List of brand intelligence data with competitor names
        """
        # Join with competitors table
        result = self.supabase.table('competitor_brand_intelligence').select(
            '*, competitors!inner(id, name, website_url, property_id)'
        ).eq('competitors.property_id', property_id).execute()
        
        if not result.data:
            return []
        
        intelligence_list = []
        for item in result.data:
            competitor = item.pop('competitors', {})
            
            if not include_raw:
                item.pop('raw_extraction', None)
            
            intelligence_list.append({
                'competitor_id': competitor.get('id'),
                'competitor_name': competitor.get('name'),
                'website_url': competitor.get('website_url'),
                **item
            })
        
        return intelligence_list
    
    def semantic_search_competitors(
        self,
        query: str,
        property_id: Optional[str] = None,
        competitor_ids: Optional[List[str]] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Semantic search across competitor content
        
        Args:
            query: Natural language search query
            property_id: Filter to property's competitors
            competitor_ids: Filter to specific competitors
            limit: Max results
            
        Returns:
            Matching content chunks with metadata
        """
        search_service = SemanticSearchService()
        
        # Run async search in thread to avoid event loop conflicts
        results = run_async_in_thread(search_service.search(
            query=query,
            property_id=property_id,
            competitor_ids=competitor_ids,
            limit=limit
        ))
        
        return results
    
    def generate_competitor_embeddings(
        self,
        competitor_id: str
    ) -> int:
        """
        Generate embeddings for a competitor's content chunks
        
        Args:
            competitor_id: Competitor UUID
            
        Returns:
            Number of embeddings generated
        """
        search_service = SemanticSearchService()
        return run_async_in_thread(search_service.generate_embeddings_for_competitor(competitor_id))
    
    # =========================================================================
    # APARTMENTS.COM SCRAPING METHODS (via Apify)
    # =========================================================================
    
    def refresh_competitor_from_apartments_com(
        self,
        competitor_id: str,
        apartments_com_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Refresh pricing data for a competitor from their apartments.com listing.
        
        Uses Apify's managed scraper (epctex/apartments-scraper) which handles
        anti-bot detection, proxy rotation, and JavaScript rendering.
        
        Args:
            competitor_id: Competitor UUID
            apartments_com_url: Optional URL override (otherwise fetched from ils_listings)
            
        Returns:
            Dict with refresh results
        """
        # Get competitor details
        competitor_result = self.supabase.table('competitors').select(
            'id, name, ils_listings'
        ).eq('id', competitor_id).single().execute()
        
        if not competitor_result.data:
            return {'success': False, 'error': 'Competitor not found'}
        
        competitor = competitor_result.data
        
        # Get apartments.com URL
        url = apartments_com_url
        if not url:
            ils_listings = competitor.get('ils_listings', {})
            url = ils_listings.get('apartments_com')
        
        if not url:
            return {'success': False, 'error': 'No apartments.com URL for this competitor'}
        
        logger.info(f"Refreshing {competitor['name']} from apartments.com via Apify: {url}")
        
        # Check if Apify is configured
        if not is_apify_configured():
            return {
                'success': False,
                'error': 'APIFY_API_TOKEN not configured. Set environment variable to enable apartments.com scraping.'
            }
        
        try:
            scraper = ApifyApartmentsScraper()
            property_data = scraper.scrape_property(url)
            
            if not property_data:
                return {
                    'success': False,
                    'competitor_id': competitor_id,
                    'competitor_name': competitor['name'],
                    'scraped': False,
                    'source_url': url,
                    'message': 'Apify scrape returned no data. Check the URL and try again.'
                }
            
            # Update competitor with scraped data
            self._update_competitor(competitor_id, property_data)
            
            # Create price change alerts if applicable
            self._check_and_create_price_alerts(competitor_id, property_data)
            
            return {
                'success': True,
                'competitor_id': competitor_id,
                'competitor_name': competitor['name'],
                'scraped': True,
                'scraper': 'apify',
                'units_scraped': len(property_data.units),
                'amenities_found': len(property_data.amenities),
                'source_url': url
            }
            
        except Exception as e:
            logger.error(f"Error refreshing from apartments.com via Apify: {e}")
            return {
                'success': False,
                'competitor_id': competitor_id,
                'scraped': False,
                'source_url': url,
                'error': str(e)
            }
    
    def batch_refresh_from_apartments_com(
        self,
        property_id: str,
        competitor_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Refresh pricing data for multiple competitors from apartments.com.
        
        Uses Apify's batch scraping capability for efficient multi-property refresh.
        
        Args:
            property_id: Property UUID
            competitor_ids: Optional list of specific competitor IDs (None = all with apartments.com URLs)
            
        Returns:
            Dict with batch refresh results
        """
        # Check if Apify is configured
        if not is_apify_configured():
            return {
                'success': False,
                'error': 'APIFY_API_TOKEN not configured. Set environment variable to enable apartments.com scraping.'
            }
        
        # Get competitors with apartments.com URLs
        query = self.supabase.table('competitors').select(
            'id, name, ils_listings'
        ).eq('property_id', property_id).eq('is_active', True)
        
        if competitor_ids:
            query = query.in_('id', competitor_ids)
        
        result = query.execute()
        competitors = result.data or []
        
        # Filter to those with apartments.com URLs
        competitors_with_urls = [
            c for c in competitors 
            if c.get('ils_listings', {}).get('apartments_com')
        ]
        
        if not competitors_with_urls:
            return {
                'success': True,
                'message': 'No competitors with apartments.com URLs',
                'refreshed': 0,
                'failed': 0
            }
        
        logger.info(f"Batch refreshing {len(competitors_with_urls)} competitors from apartments.com via Apify")
        
        # Collect all URLs for batch request
        url_to_competitor = {}
        urls = []
        for comp in competitors_with_urls:
            url = comp['ils_listings']['apartments_com']
            urls.append(url)
            url_to_competitor[url] = comp
        
        try:
            scraper = ApifyApartmentsScraper()
            
            # Use batch refresh for efficiency
            results = scraper.refresh_pricing(urls)
            
            refreshed = 0
            failed = 0
            errors = []
            
            # Match results back to competitors
            for property_data in results:
                source_url = property_data.source_url
                competitor = url_to_competitor.get(source_url)
                
                if competitor and property_data:
                    try:
                        self._update_competitor(competitor['id'], property_data)
                        self._check_and_create_price_alerts(competitor['id'], property_data)
                        refreshed += 1
                        logger.info(f"Refreshed: {competitor['name']}")
                    except Exception as e:
                        failed += 1
                        errors.append({
                            'competitor': competitor['name'],
                            'error': str(e)
                        })
            
            # Calculate failed (URLs that didn't return results)
            failed += len(competitors_with_urls) - refreshed - failed
            
            return {
                'success': True,
                'scraper': 'apify',
                'total': len(competitors_with_urls),
                'refreshed': refreshed,
                'failed': failed,
                'errors': errors[:5],
                'message': f"Successfully refreshed {refreshed} of {len(competitors_with_urls)} competitors via Apify"
            }
            
        except Exception as e:
            logger.error(f"Error in batch refresh via Apify: {e}")
            return {
                'success': False,
                'total': len(competitors_with_urls),
                'refreshed': 0,
                'failed': len(competitors_with_urls),
                'error': str(e)
            }
    
    def discover_and_scrape_apartments_com(
        self,
        property_id: str,
        city: str,
        state: str,
        max_results: int = 20,
        auto_add: bool = True
    ) -> Dict[str, Any]:
        """
        Discover competitors from apartments.com search and add them.
        
        Uses Apify's search capability to find properties in a city/state.
        
        Args:
            property_id: Property UUID to add competitors to
            city: City name for search
            state: State name or abbreviation
            max_results: Maximum results to scrape
            auto_add: Automatically add discovered competitors
            
        Returns:
            Dict with discovery results
        """
        # Check if Apify is configured
        if not is_apify_configured():
            return {
                'success': False,
                'error': 'APIFY_API_TOKEN not configured. Set environment variable to enable apartments.com scraping.'
            }
        
        logger.info(f"Discovering competitors from apartments.com via Apify: {city}, {state}")
        
        try:
            scraper = ApifyApartmentsScraper()
            properties = scraper.search_by_location(city, state, max_results=max_results)
            
            if not properties:
                return {
                    'success': True,
                    'scraper': 'apify',
                    'discovered': 0,
                    'added': 0,
                    'message': 'No properties found on apartments.com'
                }
            
            logger.info(f"Discovered {len(properties)} properties from apartments.com via Apify")
            
            # Get existing competitors to avoid duplicates
            existing_result = self.supabase.table('competitors').select(
                'name, address'
            ).eq('property_id', property_id).execute()
            
            existing_names = {c['name'].lower() for c in (existing_result.data or [])}
            
            # Filter out existing
            new_properties = [
                p for p in properties 
                if p.name.lower() not in existing_names
            ]
            
            added = []
            if auto_add and new_properties:
                added = self._add_competitors(property_id, new_properties)
            
            return {
                'success': True,
                'scraper': 'apify',
                'discovered': len(properties),
                'new_count': len(new_properties),
                'added': len(added),
                'competitors': [p.to_dict() for p in new_properties] if not auto_add else added
            }
            
        except Exception as e:
            logger.error(f"Error discovering from apartments.com via Apify: {e}")
            return {'success': False, 'error': str(e)}
    
    def add_apartments_com_listing(
        self,
        competitor_id: str,
        apartments_com_url: str,
        skip_scrape: bool = False
    ) -> Dict[str, Any]:
        """
        Add an apartments.com listing URL to an existing competitor and optionally scrape it.
        
        Uses Apify for scraping if not skipped.
        
        Args:
            competitor_id: Competitor UUID
            apartments_com_url: Apartments.com listing URL
            skip_scrape: If True, just save URL without scraping
            
        Returns:
            Dict with results
        """
        # Verify competitor exists
        competitor_result = self.supabase.table('competitors').select(
            'id, name, ils_listings'
        ).eq('id', competitor_id).single().execute()
        
        if not competitor_result.data:
            return {'success': False, 'error': 'Competitor not found'}
        
        competitor = competitor_result.data
        
        # Update ILS listings - always save the URL first
        ils_listings = competitor.get('ils_listings', {}) or {}
        ils_listings['apartments_com'] = apartments_com_url
        
        self.supabase.table('competitors').update({
            'ils_listings': ils_listings
        }).eq('id', competitor_id).execute()
        
        logger.info(f"Saved apartments.com URL for {competitor['name']}: {apartments_com_url}")
        
        if skip_scrape:
            return {
                'success': True,
                'competitor_id': competitor_id,
                'competitor_name': competitor['name'],
                'url_saved': True,
                'scraped': False,
                'message': 'URL saved successfully (scraping skipped)'
            }
        
        # Check if Apify is configured for scraping
        if not is_apify_configured():
            return {
                'success': True,
                'competitor_id': competitor_id,
                'competitor_name': competitor['name'],
                'url_saved': True,
                'scraped': False,
                'message': 'URL saved. APIFY_API_TOKEN not configured for scraping.'
            }
        
        # Scrape the listing via Apify
        try:
            scraper = ApifyApartmentsScraper()
            property_data = scraper.scrape_property(apartments_com_url)
            
            if property_data:
                self._update_competitor(competitor_id, property_data)
                
                return {
                    'success': True,
                    'competitor_id': competitor_id,
                    'competitor_name': competitor['name'],
                    'url_saved': True,
                    'scraped': True,
                    'scraper': 'apify',
                    'units_scraped': len(property_data.units),
                    'amenities_found': len(property_data.amenities)
                }
            else:
                return {
                    'success': True,
                    'competitor_id': competitor_id,
                    'url_saved': True,
                    'scraped': False,
                    'message': 'URL saved but Apify scraping returned no data'
                }
                
        except Exception as e:
            logger.warning(f"URL saved but Apify scraping failed: {e}")
            return {
                'success': True,
                'competitor_id': competitor_id,
                'url_saved': True,
                'scraped': False,
                'message': f'URL saved (scraping error: {str(e)})'
            }
    
    async def find_apartments_com_listings(
        self,
        property_id: str,
        competitor_ids: Optional[List[str]] = None,
        auto_scrape: bool = True,
        city_override: Optional[str] = None,
        state_override: Optional[str] = None,
        search_strategy: str = "name"
    ) -> Dict[str, Any]:
        """
        Find and save apartments.com URLs for competitors that don't have them.
        
        **Flow:**
        1. Check which competitors already have apartments.com URLs → SKIP these
        2. For those WITHOUT URLs → use search helper to find and save URLs
        3. Optionally scrape pricing data for newly found URLs
        
        NOTE: This does NOT re-scrape existing URLs. Use the refresh endpoints for that.
        
        Args:
            property_id: Property UUID
            competitor_ids: Optional specific competitor IDs (None = all without URLs)
            auto_scrape: Scrape pricing after finding new URLs
            city_override: Override city for all searches
            state_override: Override state for all searches
            search_strategy: "name" (search by property name - faster, more accurate) or 
                           "area" (search entire city - slower, may timeout)
            
        Returns:
            Dict with results: skipped (already have URLs), found, not_found, errors
        """
        import re
        
        # Check if Apify is configured
        if not is_apify_configured():
            return {
                'success': False,
                'error': 'APIFY_API_TOKEN not configured. Set environment variable to enable apartments.com scraping.'
            }
        
        # Use override values if provided
        property_city = city_override or ''
        property_state = state_override or ''
        
        # Get property details for fallback city/state (if not overridden)
        if not property_city or not property_state:
            property_result = self.supabase.table('properties').select(
                'id, name, address'
            ).eq('id', property_id).single().execute()
            
            if property_result.data:
                prop_address = property_result.data.get('address') or {}
                if not property_city:
                    property_city = prop_address.get('city', '')
                if not property_state:
                    property_state = prop_address.get('state', '')
        
        # Get all competitors
        query = self.supabase.table('competitors').select(
            'id, name, address, address_json, ils_listings'
        ).eq('property_id', property_id).eq('is_active', True)
        
        if competitor_ids:
            query = query.in_('id', competitor_ids)
        
        result = query.execute()
        competitors = result.data or []
        
        if not competitors:
            return {
                'success': True,
                'message': 'No active competitors found',
                'skipped': 0,
                'found': 0,
                'searched': 0
            }
        
        # Split into those WITH and WITHOUT apartments.com URLs
        competitors_with_urls = [
            c for c in competitors 
            if (c.get('ils_listings') or {}).get('apartments_com')
        ]
        competitors_to_search = [
            c for c in competitors 
            if not (c.get('ils_listings') or {}).get('apartments_com')
        ]
        
        logger.info(f"[Find Listings] Skipping {len(competitors_with_urls)} competitors (already have URLs), searching for {len(competitors_to_search)}")
        
        # If all competitors already have URLs, return early
        if not competitors_to_search:
            return {
                'success': True,
                'scraper': 'apify',
                'total_competitors': len(competitors),
                'skipped': len(competitors_with_urls),
                'skipped_competitors': [
                    {'id': c['id'], 'name': c['name'], 'apartments_com_url': c['ils_listings']['apartments_com']}
                    for c in competitors_with_urls
                ],
                'searched': 0,
                'found': 0,
                'not_found': 0,
                'message': 'All competitors already have apartments.com URLs. Use refresh endpoint to update pricing.'
            }
        
        # Search for competitors without URLs
        search_city = city_override or property_city
        search_state = state_override or property_state
        
        if not search_city or not search_state:
            return {
                'success': False,
                'error': 'City and state required for apartments.com search. Provide city and state overrides.',
                'skipped': len(competitors_with_urls),
                'searched': 0,
                'found': 0
            }
        
        logger.info(f"[Find Listings] Searching for {len(competitors_to_search)} competitors using '{search_strategy}' strategy in {search_city}, {search_state}")
        
        # Use the appropriate search strategy
        if search_strategy == "name":
            search_results = await self._find_listings_by_name_search(
                competitors_to_search,
                search_city,
                search_state,
                auto_scrape
            )
        else:
            search_results = await self._find_listings_by_area_search(
                competitors_to_search,
                search_city,
                search_state,
                auto_scrape
            )
        
        # Add skipped info to results
        search_results['total_competitors'] = len(competitors)
        search_results['skipped'] = len(competitors_with_urls)
        search_results['skipped_competitors'] = [
            {'id': c['id'], 'name': c['name'], 'apartments_com_url': c['ils_listings']['apartments_com']}
            for c in competitors_with_urls[:10]  # Limit to first 10
        ]
        search_results['message'] = f"Skipped {len(competitors_with_urls)} (already have URLs), found {search_results.get('found', 0)} new URLs for {len(competitors_to_search)} searched"
        
        return search_results
    
    async def _find_listings_by_name_search(
        self,
        competitors: List[Dict],
        city: str,
        state: str,
        auto_scrape: bool
    ) -> Dict[str, Any]:
        """
        Search apartments.com by property name + city for each competitor.
        
        Strategy:
        1. First try Apify search with property name
        2. If search returns no results, try constructing direct URL and scraping
        
        This is faster and more targeted than searching the entire city.
        """
        import re
        from urllib.parse import quote
        
        scraper = ApifyApartmentsScraper()
        
        found = []
        not_found = []
        errors = []
        
        def slugify(text: str) -> str:
            """Convert text to URL-friendly slug"""
            # Remove special characters, replace spaces with hyphens
            slug = re.sub(r'[^\w\s-]', '', text.lower())
            slug = re.sub(r'[\s_]+', '-', slug)
            slug = re.sub(r'-+', '-', slug).strip('-')
            return slug
        
        for competitor in competitors:
            comp_name = competitor['name']
            
            # Extract core property name (remove common suffixes for search)
            search_name = comp_name
            for suffix in [' Apartments', ' Apartment', ' Residences', ' Living', ' Homes', ' at ', ' by ']:
                if suffix.lower() in search_name.lower():
                    idx = search_name.lower().find(suffix.lower())
                    search_name = search_name[:idx]
                    break
            
            # Build search query: "Property Name City State"
            search_query = f"{search_name} {city} {state}"
            
            logger.info(f"[Name Search] Searching: '{search_query}' for competitor: {comp_name}")
            
            try:
                # First try: Apify search with property name
                results = scraper._run_sync_get_items(
                    search=search_query,
                    max_items=10,
                    end_page=2
                )
                
                logger.info(f"[Name Search] Got {len(results)} results for '{search_name}'")
                
                # If search returned no results, try direct URL construction
                if not results:
                    # Try constructing a direct apartments.com URL
                    # Pattern: https://www.apartments.com/{name-slug}-{city}-{state}/
                    name_slug = slugify(comp_name)
                    city_slug = slugify(city)
                    state_abbrev = state.upper() if len(state) == 2 else state[:2].upper()
                    
                    # Try a few URL patterns
                    url_patterns = [
                        f"https://www.apartments.com/{name_slug}-{city_slug}-{state_abbrev.lower()}/",
                        f"https://www.apartments.com/{slugify(search_name)}-{city_slug}-{state_abbrev.lower()}/",
                    ]
                    
                    for try_url in url_patterns:
                        logger.info(f"[Name Search] Trying direct URL: {try_url}")
                        try:
                            direct_result = scraper.scrape_property(try_url)
                            if direct_result and direct_result.name:
                                results = [direct_result]
                                logger.info(f"[Name Search] Direct URL worked! Found: {direct_result.name}")
                                break
                        except Exception as url_err:
                            logger.debug(f"[Name Search] Direct URL failed: {url_err}")
                            continue
                
                if not results:
                    not_found.append({
                        'id': competitor['id'],
                        'name': comp_name,
                        'search_query': search_query,
                        'reason': 'No results from apartments.com search'
                    })
                    continue
                
                # Try to find best match
                matched_property = None
                match_score = 0
                
                # Normalize competitor name for matching
                comp_name_normalized = re.sub(r'[^\w\s]', '', comp_name.lower().strip())
                search_name_normalized = re.sub(r'[^\w\s]', '', search_name.lower().strip())
                
                for prop in results:
                    prop_name_normalized = re.sub(r'[^\w\s]', '', prop.name.lower().strip())
                    
                    # Exact match
                    if prop_name_normalized == comp_name_normalized:
                        matched_property = prop
                        match_score = 100
                        break
                    
                    # Search name match (without suffixes)
                    if search_name_normalized in prop_name_normalized or prop_name_normalized in search_name_normalized:
                        if not matched_property or len(prop_name_normalized) < len(matched_property.name):
                            matched_property = prop
                            match_score = 85
                    
                    # Partial match - core words overlap
                    comp_words = set(comp_name_normalized.split())
                    prop_words = set(prop_name_normalized.split())
                    overlap = comp_words & prop_words
                    
                    # At least 2 words match, or the main word matches
                    if len(overlap) >= 2 or (search_name_normalized.split()[0] in prop_words if search_name_normalized.split() else False):
                        if not matched_property:
                            matched_property = prop
                            match_score = 70
                
                if matched_property:
                    # Found a match! Update the competitor
                    ils_listings = competitor.get('ils_listings') or {}
                    ils_listings['apartments_com'] = matched_property.source_url
                    
                    self.supabase.table('competitors').update({
                        'ils_listings': ils_listings
                    }).eq('id', competitor['id']).execute()
                    
                    found_entry = {
                        'id': competitor['id'],
                        'name': comp_name,
                        'apartments_com_url': matched_property.source_url,
                        'matched_name': matched_property.name,
                        'match_score': match_score,
                        'search_query': search_query
                    }
                    
                    # Auto-scrape (data already available from search)
                    if auto_scrape and matched_property.units:
                        self._update_competitor(competitor['id'], matched_property)
                        found_entry['units_scraped'] = len(matched_property.units)
                    
                    found.append(found_entry)
                    logger.info(f"[Name Search] ✓ Found: {comp_name} → {matched_property.name} (score: {match_score})")
                else:
                    not_found.append({
                        'id': competitor['id'],
                        'name': comp_name,
                        'search_query': search_query,
                        'results_count': len(results),
                        'reason': 'No confident match in search results'
                    })
                    logger.info(f"[Name Search] ✗ No match for: {comp_name}")
                    
            except Exception as e:
                logger.error(f"[Name Search] Error searching for {comp_name}: {e}")
                errors.append({
                    'id': competitor['id'],
                    'name': comp_name,
                    'search_query': search_query,
                    'error': str(e)
                })
        
        return {
            'success': True,
            'scraper': 'apify',
            'search_strategy': 'name',
            'searched': len(competitors),
            'found': len(found),
            'not_found': len(not_found),
            'errors': len(errors),
            'found_listings': found,
            'not_found_listings': not_found[:10],
            'error_details': errors[:5]
        }
    
    async def _find_listings_by_area_search(
        self,
        competitors: List[Dict],
        city: str,
        state: str,
        auto_scrape: bool
    ) -> Dict[str, Any]:
        """
        Search apartments.com by city/area and match competitors by name.
        
        This is the original approach - searches entire city then matches names.
        Can be slow and may timeout for large cities.
        """
        import re
        
        try:
            scraper = ApifyApartmentsScraper()
            
            # Search apartments.com for the area - reduced to 50 to avoid timeouts
            area_properties = scraper.search_by_location(
                city, 
                state, 
                max_results=50
            )
            
            logger.info(f"[Area Search] Found {len(area_properties)} properties in {city}, {state}")
            
            if not area_properties:
                return {
                    'success': True,
                    'scraper': 'apify',
                    'search_strategy': 'area',
                    'searched': len(competitors),
                    'found': 0,
                    'not_found': len(competitors),
                    'errors': 0,
                    'message': f'No properties found in {city}, {state}. Try name search strategy or manual URL upload.',
                    'not_found_listings': [{'id': c['id'], 'name': c['name'], 'reason': 'Area search returned no results'} for c in competitors[:10]]
                }
            
            # Build lookup by normalized name
            name_to_property = {}
            for prop in area_properties:
                # Normalize name for matching
                normalized = prop.name.lower().strip()
                normalized = re.sub(r'[^\w\s]', '', normalized)  # Remove punctuation
                name_to_property[normalized] = prop
                
                # Also try without common suffixes
                for suffix in [' apartments', ' apartment', ' residences', ' living', ' homes']:
                    if normalized.endswith(suffix):
                        name_to_property[normalized[:-len(suffix)]] = prop
            
            found = []
            not_found = []
            errors = []
            
            for competitor in competitors:
                try:
                    # Normalize competitor name for matching
                    comp_name = competitor['name'].lower().strip()
                    comp_name_normalized = re.sub(r'[^\w\s]', '', comp_name)
                    
                    # Try to find a match
                    matched_property = None
                    match_score = 0
                    
                    # Exact match
                    if comp_name_normalized in name_to_property:
                        matched_property = name_to_property[comp_name_normalized]
                        match_score = 100
                    else:
                        # Try without suffixes
                        for suffix in [' apartments', ' apartment', ' residences', ' living', ' homes']:
                            if comp_name_normalized.endswith(suffix):
                                short_name = comp_name_normalized[:-len(suffix)]
                                if short_name in name_to_property:
                                    matched_property = name_to_property[short_name]
                                    match_score = 90
                                    break
                        
                        # Try partial match (competitor name contained in property name or vice versa)
                        if not matched_property:
                            for prop_name, prop in name_to_property.items():
                                if comp_name_normalized in prop_name or prop_name in comp_name_normalized:
                                    matched_property = prop
                                    match_score = 70
                                    break
                    
                    if matched_property:
                        # Found a match! Update the competitor
                        ils_listings = competitor.get('ils_listings') or {}
                        ils_listings['apartments_com'] = matched_property.source_url
                        
                        self.supabase.table('competitors').update({
                            'ils_listings': ils_listings
                        }).eq('id', competitor['id']).execute()
                        
                        found_entry = {
                            'id': competitor['id'],
                            'name': competitor['name'],
                            'apartments_com_url': matched_property.source_url,
                            'matched_name': matched_property.name,
                            'match_score': match_score
                        }
                        
                        # Auto-scrape is already done (we got the data from search)
                        if auto_scrape and matched_property.units:
                            self._update_competitor(competitor['id'], matched_property)
                            found_entry['units_scraped'] = len(matched_property.units)
                        
                        found.append(found_entry)
                        logger.info(f"[Area Search] Found apartments.com listing for {competitor['name']}: {matched_property.source_url}")
                    else:
                        not_found.append({
                            'id': competitor['id'],
                            'name': competitor['name'],
                            'reason': 'No match found in area search results'
                        })
                        
                except Exception as e:
                    logger.error(f"[Area Search] Error matching {competitor['name']}: {e}")
                    errors.append({
                        'id': competitor['id'],
                        'name': competitor['name'],
                        'error': str(e)
                    })
            
            return {
                'success': True,
                'scraper': 'apify',
                'search_strategy': 'area',
                'searched': len(competitors),
                'found': len(found),
                'not_found': len(not_found),
                'errors': len(errors),
                'found_listings': found,
                'not_found_listings': not_found[:10],
                'error_details': errors[:5]
            }
            
        except Exception as e:
            logger.error(f"[Area Search] Error searching apartments.com via Apify: {e}")
            return {
                'success': False,
                'search_strategy': 'area',
                'error': str(e),
                'searched': 0,
                'found': 0
            }
    
    def _check_and_create_price_alerts(
        self,
        competitor_id: str,
        scraped_data: ScrapedProperty
    ) -> None:
        """Check for price changes and create alerts"""
        try:
            # Get existing units for comparison
            existing_result = self.supabase.table('competitor_units').select(
                'id, unit_type, rent_min, rent_max'
            ).eq('competitor_id', competitor_id).execute()
            
            existing_map = {u['unit_type']: u for u in (existing_result.data or [])}
            
            # Get competitor details for alert
            competitor_result = self.supabase.table('competitors').select(
                'name, property_id'
            ).eq('id', competitor_id).single().execute()
            
            if not competitor_result.data:
                return
            
            competitor = competitor_result.data
            
            for unit in scraped_data.units:
                existing = existing_map.get(unit.unit_type)
                
                if existing and unit.rent_min:
                    old_rent = existing.get('rent_min')
                    
                    if old_rent and unit.rent_min != old_rent:
                        # Calculate change
                        change = unit.rent_min - old_rent
                        change_pct = (change / old_rent) * 100
                        
                        # Determine severity
                        severity = 'info'
                        if abs(change_pct) >= 10:
                            severity = 'high'
                        elif abs(change_pct) >= 5:
                            severity = 'medium'
                        
                        # Create alert
                        alert_type = 'price_increase' if change > 0 else 'price_decrease'
                        
                        self.supabase.table('market_alerts').insert({
                            'property_id': competitor['property_id'],
                            'competitor_id': competitor_id,
                            'alert_type': alert_type,
                            'severity': severity,
                            'title': f"{competitor['name']} {unit.unit_type} price {'increased' if change > 0 else 'decreased'}",
                            'description': f"${old_rent} → ${unit.rent_min} ({change_pct:+.1f}%)",
                            'data': {
                                'unit_type': unit.unit_type,
                                'old_rent': old_rent,
                                'new_rent': unit.rent_min,
                                'change': change,
                                'change_percent': round(change_pct, 1),
                                'source': 'apartments_com'
                            }
                        }).execute()
                        
                        logger.info(f"Created price alert for {competitor['name']} {unit.unit_type}")
                        
        except Exception as e:
            logger.error(f"Error checking price alerts: {e}")

