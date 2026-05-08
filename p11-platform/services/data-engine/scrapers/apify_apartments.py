"""
Apify Apartments.com Scraper Integration
Uses Apify's managed Actor (epctex/apartments-scraper) for reliable data extraction.
Replaces the blocked Playwright/httpx scraper.

API Documentation: https://apify.com/epctex/apartments-scraper

Proxy Configuration:
- Uses Apify residential proxies by default (best for avoiding blocks)
- Configure via APIFY_PROXY_TYPE and APIFY_PROXY_COUNTRY env vars
- Residential proxies are more expensive but far more reliable for apartments.com
"""

import os
import re
import time
import logging
import httpx
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime

from scrapers.base import ScrapedProperty, ScrapedUnit
from utils.config import APIFY_PROXY_TYPE, APIFY_PROXY_COUNTRY

logger = logging.getLogger(__name__)

# Apify Actor details
ACTOR_ID = "epctex~apartments-scraper"
APIFY_API_BASE = "https://api.apify.com/v2"

# State abbreviation mapping (full name -> abbreviation)
STATE_ABBREV = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC'
}


# Supported proxy types
PROXY_GROUPS = {
    "residential": "RESIDENTIAL",
    "datacenter": "DATACENTER",
}


class ApifyApartmentsScraper:
    """
    Apify-based scraper for Apartments.com.
    
    Uses the epctex/apartments-scraper Actor which handles:
    - Anti-bot detection bypass
    - Proxy rotation (residential by default for reliability)
    - JavaScript rendering
    - Rate limiting
    
    This replaces the custom Playwright/httpx scraper that was getting blocked.
    
    Proxy Configuration:
        - residential: Uses real residential IPs, least likely to be blocked (recommended)
        - datacenter: Faster and cheaper, but may be blocked by apartments.com
    """
    
    def __init__(
        self,
        api_token: Optional[str] = None,
        proxy_type: Optional[str] = None,
        proxy_country: Optional[str] = None
    ):
        """
        Initialize the Apify scraper.
        
        Args:
            api_token: Apify API token (defaults to APIFY_API_TOKEN env var)
            proxy_type: Proxy type - "residential" (default) or "datacenter"
            proxy_country: Country code for geo-targeting (default: "US")
        """
        self.api_token = api_token or os.environ.get('APIFY_API_TOKEN')
        if not self.api_token:
            raise ValueError(
                "APIFY_API_TOKEN environment variable required. "
                "Get your token from https://console.apify.com/account#/integrations"
            )
        
        # Proxy configuration - defaults to residential for apartments.com
        self.proxy_type = (proxy_type or APIFY_PROXY_TYPE or "residential").lower()
        self.proxy_country = proxy_country or APIFY_PROXY_COUNTRY or "US"
        
        # Validate proxy type
        if self.proxy_type not in PROXY_GROUPS:
            logger.warning(f"[Apify] Unknown proxy type '{self.proxy_type}', defaulting to 'residential'")
            self.proxy_type = "residential"
        
        self.source = "apify_apartments_com"
        self.client = httpx.Client(timeout=300.0)  # 5 min timeout for sync calls
        
        logger.info(f"[Apify] Initialized with Actor: {ACTOR_ID}")
        logger.info(f"[Apify] Proxy config: type={self.proxy_type}, country={self.proxy_country}")
    
    def __del__(self):
        """Cleanup HTTP client"""
        if hasattr(self, 'client'):
            self.client.close()
    
    def _build_proxy_config(self) -> Dict[str, Any]:
        """
        Build Apify proxy configuration based on instance settings.
        
        Returns:
            Dict with proxy configuration for Apify Actor input
            
        Proxy Types:
            - RESIDENTIAL: Real residential IPs, best for avoiding detection
            - DATACENTER: Faster but may be blocked by sophisticated sites
        """
        proxy_group = PROXY_GROUPS.get(self.proxy_type, "RESIDENTIAL")
        
        config = {
            "useApifyProxy": True,
            "apifyProxyGroups": [proxy_group],
        }
        
        # Add country targeting if specified
        if self.proxy_country:
            config["apifyProxyCountry"] = self.proxy_country.upper()
        
        logger.debug(f"[Apify] Built proxy config: {config}")
        return config
    
    # =========================================================================
    # PUBLIC METHODS - Match old scraper interface for drop-in replacement
    # =========================================================================
    
    def scrape_property(self, url: str) -> Optional[ScrapedProperty]:
        """
        Scrape a single property URL.
        
        Args:
            url: Apartments.com property URL
            
        Returns:
            ScrapedProperty or None if failed
        """
        logger.info(f"[Apify] Scraping property: {url}")
        results = self._run_sync_get_items(start_urls=[url], max_items=1)
        return results[0] if results else None
    
    def search_by_location(
        self,
        city: str,
        state: str,
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties in a city/state.
        
        Args:
            city: City name (e.g., "Dallas")
            state: State name or abbreviation (e.g., "TX" or "Texas")
            radius_miles: Search radius (not directly used, city-wide search)
            max_results: Maximum properties to return
            
        Returns:
            List of ScrapedProperty objects
        """
        # Normalize state to abbreviation for URL
        state_abbrev = self._get_state_abbrev(state)
        search_query = f"{city} {state_abbrev}"
        
        logger.info(f"[Apify] Searching: {search_query} (max {max_results} results)")
        
        return self._run_sync_get_items(
            search=search_query,
            max_items=max_results,
            end_page=10
        )
    
    def search_by_coordinates(
        self,
        lat: float,
        lng: float,
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties near coordinates.
        
        Note: Apify Actor doesn't directly support coordinate search,
        so this falls back to empty results. Use search_by_location instead.
        """
        logger.warning("[Apify] Coordinate search not supported - use search_by_location")
        return []
    
    def refresh_pricing(self, urls: List[str], max_items: Optional[int] = None) -> List[ScrapedProperty]:
        """
        Batch refresh pricing for multiple property URLs.
        
        Args:
            urls: List of apartments.com property URLs
            max_items: Max items (defaults to len(urls))
            
        Returns:
            List of ScrapedProperty objects with fresh data
        """
        if not urls:
            return []
        
        logger.info(f"[Apify] Batch refresh for {len(urls)} properties")
        
        return self._run_sync_get_items(
            start_urls=urls,
            max_items=max_items or len(urls)
        )
    
    def refresh_single(self, url: str) -> Optional[ScrapedProperty]:
        """Alias for scrape_property for backward compatibility"""
        return self.scrape_property(url)
    
    # =========================================================================
    # APIFY API METHODS
    # =========================================================================
    
    def _run_sync_get_items(
        self,
        start_urls: Optional[List[str]] = None,
        search: Optional[str] = None,
        max_items: int = 50,
        end_page: int = 5
    ) -> List[ScrapedProperty]:
        """
        Run Actor synchronously and get dataset items directly.
        
        Uses the run-sync-get-dataset-items endpoint which:
        1. Starts the Actor
        2. Waits for completion
        3. Returns dataset items in the response
        
        This is the most efficient method for our use case.
        
        Args:
            start_urls: List of property/search URLs to scrape
            search: Location search query (e.g., "new york")
            max_items: Maximum items to return
            end_page: Last page to scrape (for search results)
            
        Returns:
            List of ScrapedProperty objects
        """
        # Build Actor input with residential proxy configuration
        run_input = {
            "proxy": self._build_proxy_config()
        }
        
        # Only add optional params if they have meaningful values
        if max_items and max_items > 0:
            run_input["maxItems"] = max_items
        if end_page and end_page > 0:
            run_input["endPage"] = end_page
        if start_urls:
            run_input["startUrls"] = start_urls
        if search:
            run_input["search"] = search
        
        # Use the synchronous endpoint that returns items directly
        url = f"{APIFY_API_BASE}/acts/{ACTOR_ID}/run-sync-get-dataset-items"
        
        logger.info(f"[Apify] Running sync request to: {url}")
        logger.info(f"[Apify] Input: {run_input}")
        
        try:
            response = self.client.post(
                url,
                params={"token": self.api_token},
                json=run_input,
                headers={"Content-Type": "application/json"}
            )
            
            # 200 OK or 201 Created are both success statuses
            if response.status_code in [200, 201]:
                items = response.json()
                logger.info(f"[Apify] Got {len(items)} items (status: {response.status_code})")
                
                if not items:
                    logger.warning("[Apify] Actor returned empty results - the URL may be invalid or the property page structure changed")
                    return []
                
                return [self._transform_item(item) for item in items if item]
            
            elif response.status_code == 402:
                logger.error("[Apify] Payment required - check your Apify subscription")
                return []
            
            elif response.status_code == 403:
                error_data = response.json() if response.text else {}
                error_type = error_data.get("error", {}).get("type", "unknown")
                error_msg = error_data.get("error", {}).get("message", "Access denied")
                
                if error_type == "actor-is-not-rented":
                    logger.error(f"[Apify] Actor not rented - subscribe at https://console.apify.com/actors/0mFoOGFw7K4hp1v0f")
                else:
                    logger.error(f"[Apify] Access denied: {error_msg}")
                return []
            
            else:
                logger.error(f"[Apify] Request failed: {response.status_code} - {response.text[:500]}")
                return []
                
        except httpx.TimeoutException:
            logger.error("[Apify] Request timed out - try reducing maxItems")
            return []
        except Exception as e:
            logger.error(f"[Apify] Error: {type(e).__name__}: {e}")
            return []
    
    def _run_async(
        self,
        start_urls: Optional[List[str]] = None,
        search: Optional[str] = None,
        max_items: int = 50,
        end_page: int = 10,
        poll_interval: int = 10,
        timeout: int = 600
    ) -> List[ScrapedProperty]:
        """
        Run Actor asynchronously with polling.
        
        Use this for large scraping jobs that may take > 5 minutes.
        
        Args:
            start_urls: List of URLs to scrape
            search: Search query
            max_items: Maximum items
            end_page: Last page to scrape
            poll_interval: Seconds between status checks
            timeout: Maximum wait time in seconds
            
        Returns:
            List of ScrapedProperty objects
        """
        # Build Actor input with residential proxy configuration
        run_input = {
            "maxItems": max_items,
            "endPage": end_page,
            "proxy": self._build_proxy_config()
        }
        
        if start_urls:
            run_input["startUrls"] = start_urls
        if search:
            run_input["search"] = search
        
        # Start the Actor run
        start_url = f"{APIFY_API_BASE}/acts/{ACTOR_ID}/runs"
        
        logger.info(f"[Apify] Starting async run: {run_input}")
        
        try:
            response = self.client.post(
                start_url,
                params={"token": self.api_token},
                json=run_input,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code not in [200, 201]:
                logger.error(f"[Apify] Failed to start run: {response.status_code}")
                return []
            
            run_data = response.json().get("data", {})
            run_id = run_data.get("id")
            default_dataset_id = run_data.get("defaultDatasetId")
            
            if not run_id:
                logger.error("[Apify] No run ID returned")
                return []
            
            logger.info(f"[Apify] Run started: {run_id}")
            
            # Poll for completion
            elapsed = 0
            status_url = f"{APIFY_API_BASE}/actor-runs/{run_id}"
            
            while elapsed < timeout:
                time.sleep(poll_interval)
                elapsed += poll_interval
                
                status_response = self.client.get(
                    status_url,
                    params={"token": self.api_token}
                )
                
                if status_response.status_code != 200:
                    continue
                
                status_data = status_response.json().get("data", {})
                status = status_data.get("status")
                
                logger.debug(f"[Apify] Run status: {status} ({elapsed}s elapsed)")
                
                if status == "SUCCEEDED":
                    # Get dataset items
                    dataset_id = status_data.get("defaultDatasetId") or default_dataset_id
                    return self._get_dataset_items(dataset_id)
                
                elif status in ["FAILED", "ABORTED", "TIMED-OUT"]:
                    logger.error(f"[Apify] Run failed with status: {status}")
                    return []
            
            logger.error(f"[Apify] Run timed out after {timeout}s")
            return []
            
        except Exception as e:
            logger.error(f"[Apify] Async run error: {e}")
            return []
    
    def _get_dataset_items(self, dataset_id: str) -> List[ScrapedProperty]:
        """Fetch items from a dataset"""
        url = f"{APIFY_API_BASE}/datasets/{dataset_id}/items"
        
        try:
            response = self.client.get(
                url,
                params={"token": self.api_token, "format": "json"}
            )
            
            if response.status_code == 200:
                items = response.json()
                return [self._transform_item(item) for item in items if item]
            
            logger.error(f"[Apify] Failed to get dataset items: {response.status_code}")
            return []
            
        except Exception as e:
            logger.error(f"[Apify] Dataset fetch error: {e}")
            return []
    
    # =========================================================================
    # DATA TRANSFORMATION - Apify output → ScrapedProperty
    # =========================================================================
    
    def _transform_item(self, item: Dict[str, Any]) -> ScrapedProperty:
        """
        Transform Apify Actor output to our ScrapedProperty model.
        
        Handles the specific output format of epctex/apartments-scraper:
        - location object with address components
        - coordinates object
        - models array for unit/floor plan data
        - fees array containing property info (year built, units)
        - amenities as nested array
        """
        location = item.get("location", {})
        coordinates = item.get("coordinates", {})
        contact = item.get("contact", {})
        
        # Handle the API typo: "streedAddress" (missing 't')
        street = location.get("streedAddress") or location.get("streetAddress") or ""
        
        # Convert full state name to abbreviation
        state_full = location.get("state", "")
        state_abbrev = self._get_state_abbrev(state_full)
        
        # Parse year_built and units_count from fees structure
        year_built, units_count = self._parse_property_info(item.get("fees", []))
        
        # Flatten nested amenities
        amenities = self._flatten_amenities(item.get("amenities", []))
        
        # Transform models to ScrapedUnit list
        units = self._transform_models(item.get("models", []))
        
        # Get rent range from item or calculate from units
        rent_data = item.get("rent", {})
        
        return ScrapedProperty(
            name=item.get("propertyName", "Unknown Property"),
            address=street,
            city=location.get("city", ""),
            state=state_abbrev,
            zip_code=location.get("postalCode", ""),
            latitude=coordinates.get("latitude"),
            longitude=coordinates.get("longitude"),
            website_url=item.get("url"),
            phone=contact.get("phone"),
            units_count=units_count,
            year_built=year_built,
            property_type="multifamily",
            amenities=amenities,
            photos=item.get("photos", [])[:10],  # Limit photos
            units=units,
            source=self.source,
            source_url=item.get("url", "")
        )
    
    def _get_state_abbrev(self, state: str) -> str:
        """Convert full state name to 2-letter abbreviation"""
        if not state:
            return ""
        # Already an abbreviation
        if len(state) == 2:
            return state.upper()
        # Look up in mapping
        return STATE_ABBREV.get(state.lower(), state[:2].upper())
    
    def _parse_property_info(self, fees: List[Dict]) -> Tuple[Optional[int], Optional[int]]:
        """
        Extract year_built and units_count from the fees structure.
        
        The Apify output stores these in:
        fees[].title="Details" → policies[].header="Property Information" → values[]
        
        Example values:
        - {"key": "Built in 1936", "value": ""}
        - {"key": "16 units/2 stories", "value": ""}
        """
        year_built = None
        units_count = None
        
        for fee_section in fees:
            if fee_section.get("title") != "Details":
                continue
                
            for policy in fee_section.get("policies", []):
                if policy.get("header") != "Property Information":
                    continue
                    
                for value_item in policy.get("values", []):
                    key = value_item.get("key", "")
                    
                    # Parse "Built in 1936"
                    if not year_built:
                        year_match = re.search(r'Built in (\d{4})', key)
                        if year_match:
                            year_built = int(year_match.group(1))
                    
                    # Parse "16 units/2 stories" or "100 units"
                    if not units_count:
                        units_match = re.search(r'(\d+)\s*units?', key, re.IGNORECASE)
                        if units_match:
                            units_count = int(units_match.group(1))
        
        return year_built, units_count
    
    def _flatten_amenities(self, amenities: List[Dict]) -> List[str]:
        """
        Flatten the nested amenities structure.
        
        Input format:
        [
            {"title": "Community Amenities", "value": ["Pool", "Gym", ...]},
            {"title": "Apartment Features", "value": ["AC", "Dishwasher", ...]}
        ]
        
        Output: ["Pool", "Gym", "AC", "Dishwasher", ...]
        """
        flat = []
        for category in amenities:
            values = category.get("value", [])
            if isinstance(values, list):
                flat.extend(values)
            elif isinstance(values, str):
                flat.append(values)
        
        # Deduplicate while preserving order
        seen = set()
        unique = []
        for item in flat:
            if item and item not in seen:
                seen.add(item)
                unique.append(item)
        
        return unique
    
    def _transform_models(self, models: List[Dict]) -> List[ScrapedUnit]:
        """
        Transform Apify models array to ScrapedUnit list.
        
        Input format (from Apify):
        {
            "modelName": "1 Bed/1 Bath",
            "rentLabel": "$1,200 – $1,300",
            "details": ["1 bed", "1 bath", "685 – 875 sq ft", "12 Month Lease"],
            "leaseOptions": "12 Month Lease",
            "availability": "1 Available unit",
            "units": [{"type": "Unit 9", "price": "$1,300", "sqft": "700", "availability": "Soon"}]
        }
        """
        scraped_units = []
        
        for model in models:
            model_name = model.get("modelName", "")
            rent_label = model.get("rentLabel", "")
            details = model.get("details", [])
            available_units = model.get("units", [])
            lease_options = model.get("leaseOptions", "")
            
            # Parse bedroom count
            bedrooms = self._parse_bedrooms(model_name)
            
            # Parse bathroom count
            bathrooms = self._parse_bathrooms(model_name, details)
            
            # Parse rent range from rentLabel
            rent_min, rent_max = self._parse_rent_range(rent_label)
            
            # Parse sqft from details
            sqft_min, sqft_max = self._parse_sqft_from_details(details)
            
            # Count available units
            available_count = len(available_units)
            
            # Also check availability string
            if not available_count:
                avail_str = model.get("availability", "")
                avail_match = re.search(r'(\d+)\s*(?:Available|available)', avail_str)
                if avail_match:
                    available_count = int(avail_match.group(1))
            
            # Check for move-in specials
            specials = self._extract_specials(lease_options, details)
            
            scraped_units.append(ScrapedUnit(
                unit_type=self._normalize_unit_type(bedrooms),
                bedrooms=bedrooms,
                bathrooms=bathrooms,
                sqft_min=sqft_min,
                sqft_max=sqft_max,
                rent_min=rent_min,
                rent_max=rent_max,
                available_count=available_count,
                move_in_specials=specials
            ))
        
        return scraped_units
    
    def _parse_bedrooms(self, model_name: str) -> int:
        """Parse bedroom count from model name like '1 Bed/1 Bath' or 'Studio'"""
        name_lower = model_name.lower()
        
        if 'studio' in name_lower:
            return 0
        
        # Match patterns like "1 bed", "2 bd", "3 br", "4 bedroom"
        match = re.search(r'(\d+)\s*(?:bed|bd|br|bedroom)', name_lower)
        if match:
            return int(match.group(1))
        
        return 1  # Default to 1BR if unparseable
    
    def _parse_bathrooms(self, model_name: str, details: List[str]) -> float:
        """Parse bathroom count from model name or details"""
        # Try model name first: "1 Bed/1 Bath", "2 Bed/2.5 Bath"
        match = re.search(r'(\d+(?:\.\d+)?)\s*(?:bath|ba)', model_name.lower())
        if match:
            return float(match.group(1))
        
        # Try details array: ["1 bed", "1 bath", "500 sq ft"]
        for detail in details:
            match = re.search(r'(\d+(?:\.\d+)?)\s*(?:bath|ba)', detail.lower())
            if match:
                return float(match.group(1))
        
        return 1.0  # Default
    
    def _parse_rent_range(self, rent_label: str) -> Tuple[Optional[float], Optional[float]]:
        """
        Parse rent range from label like '$1,200 – $1,300' or '$1,500'
        """
        if not rent_label:
            return None, None
        
        # Remove currency symbols and find all numbers
        numbers = re.findall(r'[\d,]+', rent_label)
        numbers = [int(n.replace(',', '')) for n in numbers if n.replace(',', '').isdigit()]
        
        if len(numbers) >= 2:
            return float(min(numbers)), float(max(numbers))
        elif len(numbers) == 1:
            return float(numbers[0]), float(numbers[0])
        
        return None, None
    
    def _parse_sqft_from_details(self, details: List[str]) -> Tuple[Optional[int], Optional[int]]:
        """Parse square footage from details array"""
        for detail in details:
            detail_lower = detail.lower()
            if 'sq ft' in detail_lower or 'sqft' in detail_lower:
                numbers = re.findall(r'[\d,]+', detail)
                numbers = [int(n.replace(',', '')) for n in numbers if n.replace(',', '').isdigit()]
                
                if len(numbers) >= 2:
                    return min(numbers), max(numbers)
                elif len(numbers) == 1:
                    return numbers[0], numbers[0]
        
        return None, None
    
    def _extract_specials(self, lease_options: str, details: List[str]) -> Optional[str]:
        """Extract move-in specials from lease options or details"""
        special_keywords = ['special', 'free', 'discount', 'off', 'waived', 'reduced', 'concession']
        
        # Check lease options
        if lease_options:
            if any(kw in lease_options.lower() for kw in special_keywords):
                return lease_options
        
        # Check details
        for detail in details:
            if any(kw in detail.lower() for kw in special_keywords):
                return detail
        
        return None
    
    def _normalize_unit_type(self, bedrooms: int) -> str:
        """Convert bedroom count to standard unit type string"""
        if bedrooms == 0:
            return "Studio"
        elif bedrooms >= 4:
            return "4BR+"
        else:
            return f"{bedrooms}BR"


# =========================================================================
# UTILITY FUNCTION - Check if Apify is configured
# =========================================================================

def is_apify_configured() -> bool:
    """Check if Apify API token is available"""
    return bool(os.environ.get('APIFY_API_TOKEN'))


def get_apify_scraper() -> Optional[ApifyApartmentsScraper]:
    """Get Apify scraper instance if configured, None otherwise"""
    if is_apify_configured():
        try:
            return ApifyApartmentsScraper()
        except Exception as e:
            logger.error(f"Failed to initialize Apify scraper: {e}")
    return None


# =========================================================================
# CLI for testing
# =========================================================================

if __name__ == "__main__":
    import sys
    import json
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python apify_apartments.py <url_or_search>")
        print("Examples:")
        print("  python apify_apartments.py 'https://www.apartments.com/...'")
        print("  python apify_apartments.py 'dallas tx'")
        sys.exit(1)
    
    arg = sys.argv[1]
    
    try:
        scraper = ApifyApartmentsScraper()
        
        if arg.startswith('http'):
            # Scrape single property
            result = scraper.scrape_property(arg)
            if result:
                print(json.dumps(result.to_dict(), indent=2))
            else:
                print("Failed to scrape property")
        else:
            # Search by location
            parts = arg.split()
            if len(parts) >= 2:
                city = ' '.join(parts[:-1])
                state = parts[-1]
                results = scraper.search_by_location(city, state, max_results=5)
                print(f"Found {len(results)} properties:")
                for r in results:
                    print(f"  - {r.name}: {len(r.units)} unit types")
                    for u in r.units:
                        print(f"      {u.unit_type}: ${u.rent_min}-${u.rent_max}")
            else:
                print("For search, provide 'city state' (e.g., 'dallas tx')")
                
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

