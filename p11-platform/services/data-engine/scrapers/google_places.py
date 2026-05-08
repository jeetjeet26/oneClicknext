"""
Google Places Competitor Discovery & Review Extraction
Uses Google Maps Places API to find nearby apartment communities
and extract reviews for ReviewFlow AI integration

Updated Dec 2025: Added review extraction capabilities
"""

import os
import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime

import googlemaps
from scrapers.base import ScrapedProperty, ScrapedUnit

logger = logging.getLogger(__name__)


@dataclass
class GoogleReview:
    """Parsed review from Google Places API"""
    platform_review_id: str
    reviewer_name: str
    reviewer_avatar_url: Optional[str]
    rating: int
    review_text: str
    review_date: str  # ISO format
    language: str = 'en'
    relative_time: Optional[str] = None  # e.g., "2 weeks ago"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'platform_review_id': self.platform_review_id,
            'reviewer_name': self.reviewer_name,
            'reviewer_avatar_url': self.reviewer_avatar_url,
            'rating': self.rating,
            'review_text': self.review_text,
            'review_date': self.review_date,
            'language': self.language,
            'relative_time': self.relative_time,
            'platform': 'google'
        }


@dataclass
class PlaceResult:
    """Raw result from Google Places API"""
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    rating: Optional[float] = None
    user_ratings_total: Optional[int] = None
    price_level: Optional[int] = None  # 0-4, higher = more expensive
    types: List[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    photos: List[str] = None
    
    def __post_init__(self):
        if self.types is None:
            self.types = []
        if self.photos is None:
            self.photos = []


class GooglePlacesScraper:
    """
    Discovers competitor properties using Google Maps Places API
    
    Searches for apartment complexes, real estate agencies, and lodging
    near a given location to find potential competitors.
    
    Supports property type filtering to only return relevant competitors.
    """
    
    # Place types to search for apartment communities
    SEARCH_TYPES = [
        'real_estate_agency',  # Property management offices
        'lodging',             # Extended stay / apartments
    ]
    
    # Keywords to include in text search (targeting actual apartment communities)
    SEARCH_KEYWORDS = [
        'apartment community',
        'apartments for rent',
        'luxury apartment homes',
        'apartment living',
        'multifamily',
    ]

    FOR_SALE_SEARCH_KEYWORDS = {
        'townhome': ['new townhomes', 'townhomes for sale', 'townhome community', 'new home builder'],
        'condo': ['new condos', 'condos for sale', 'condo residences', 'new home builder'],
        'single_family': ['new homes for sale', 'single family homes', 'home builder', 'new home community'],
        'master_planned': ['master planned community', 'new homes community', 'planned community', 'home builder'],
    }
    
    # Keywords that indicate non-competitor (filter out)
    # These are filtered regardless of property type
    EXCLUDE_KEYWORDS = [
        'senior living',
        'assisted living',
        '55+',
        'student housing',
        'storage',
        'office',
        'commercial',
        'hotel',
        'motel',
        'hostel',
        'property management',
        'management company',
        'management group',
        'brokerage',
        'broker',
        'realty group',
        'realty company',
        'real estate agent',
        'real estate group',
        'real estate company',
        'realtor',
        'investment',
        'investments',
        'consulting',
        'leasing office',
        'corporate office',
        'headquarters',
        'hq',
        'properties llc',
        'properties inc',
        'property group',
        'asset management',
        'capital',
        'holdings',
        'ventures',
        'development',
        'developers',
        'construction',
        'builder',
    ]
    
    # Property type specific exclude keywords
    # When searching for "multifamily" properties, also exclude these
    MULTIFAMILY_EXCLUDE = [
        'single family',
        'townhome',
        'townhouse',
        'condo',
        'condominium',
        'mobile home',
        'manufactured',
    ]

    FOR_SALE_PROPERTY_TYPES = {'townhome', 'condo', 'single_family', 'master_planned'}
    FOR_SALE_ALLOWED_EXCLUDE_KEYWORDS = {'development', 'developers', 'construction', 'builder'}

    def _search_keywords_for_type(self, property_type: Optional[str]) -> List[str]:
        if not property_type:
            return self.SEARCH_KEYWORDS

        property_type_lower = property_type.lower()
        for key, keywords in self.FOR_SALE_SEARCH_KEYWORDS.items():
            if key in property_type_lower:
                return keywords

        return self.SEARCH_KEYWORDS

    def _is_for_sale_property_type(self, property_type: Optional[str]) -> bool:
        if not property_type:
            return False
        property_type_lower = property_type.lower()
        return any(key in property_type_lower for key in self.FOR_SALE_PROPERTY_TYPES)
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Google Places scraper
        
        Args:
            api_key: Google Maps API key (defaults to GOOGLE_MAPS_API_KEY env var)
        """
        self.api_key = api_key or os.environ.get('GOOGLE_MAPS_API_KEY')
        if not self.api_key:
            raise ValueError("Google Maps API key required. Set GOOGLE_MAPS_API_KEY env var.")
        
        self.client = googlemaps.Client(key=self.api_key)
        self.source = "google_places"
    
    def search_nearby(
        self,
        lat: float,
        lng: float,
        radius_meters: int = 5000,
        max_results: int = 20,
        property_type: Optional[str] = None
    ) -> List[PlaceResult]:
        """
        Search for apartment communities near coordinates
        
        Args:
            lat: Latitude
            lng: Longitude  
            radius_meters: Search radius in meters (max 50000)
            max_results: Maximum results to return
            property_type: Subject property type for filtering (e.g., "multifamily")
            
        Returns:
            List of PlaceResult objects
        """
        location = (lat, lng)
        all_results = []
        seen_place_ids = set()
        
        # Search using text search with apartment keywords (more effective)
        search_keywords = self._search_keywords_for_type(property_type)
        for keyword in search_keywords[:2]:  # Limit to avoid quota
            if len(all_results) >= max_results:
                break
                
            try:
                logger.info(f"Searching Google Places for: {keyword}")
                
                # Text search is better for finding apartments
                results = self.client.places_nearby(
                    location=location,
                    radius=radius_meters,
                    keyword=keyword,
                    type='real_estate_agency'
                )
                
                for place in results.get('results', []):
                    place_id = place.get('place_id')
                    if place_id and place_id not in seen_place_ids:
                        seen_place_ids.add(place_id)
                        
                        result = self._parse_place(place)
                        if result and self._is_valid_competitor(result, property_type):
                            all_results.append(result)
                            
                            if len(all_results) >= max_results:
                                break
                
                # Also try text search for better results
                text_results = self.client.places(
                    query=f"{keyword} near {lat},{lng}",
                    location=location,
                    radius=radius_meters
                )
                
                for place in text_results.get('results', []):
                    place_id = place.get('place_id')
                    if place_id and place_id not in seen_place_ids:
                        seen_place_ids.add(place_id)
                        
                        result = self._parse_place(place)
                        if result and self._is_valid_competitor(result, property_type):
                            all_results.append(result)
                            
                            if len(all_results) >= max_results:
                                break
                                
            except Exception as e:
                logger.error(f"Error in Google Places search: {e}")
                continue
        
        logger.info(f"Found {len(all_results)} potential competitors from Google Places (property_type filter: {property_type})")
        return all_results[:max_results]
    
    def get_place_details(self, place_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a place
        
        Args:
            place_id: Google Place ID
            
        Returns:
            Place details dict or None
        """
        try:
            result = self.client.place(
                place_id=place_id,
                fields=[
                    'name',
                    'formatted_address',
                    'formatted_phone_number',
                    'website',
                    'rating',
                    'user_ratings_total',
                    'price_level',
                    'photo',  # singular, not 'photos'
                    'geometry',
                    'type',   # singular, not 'types'
                    'review',
                    'opening_hours',
                    'url',    # Google Maps URL
                ]
            )
            return result.get('result')
        except Exception as e:
            logger.error(f"Error getting place details for {place_id}: {e}")
            return None
    
    def _parse_place(self, place: Dict[str, Any]) -> Optional[PlaceResult]:
        """Parse Google Places API result into PlaceResult"""
        try:
            geometry = place.get('geometry', {})
            location = geometry.get('location', {})
            
            # Extract photo references (we'll need to build URLs later)
            photos = []
            for photo in place.get('photos', [])[:5]:
                photo_ref = photo.get('photo_reference')
                if photo_ref:
                    # Build photo URL
                    photo_url = (
                        f"https://maps.googleapis.com/maps/api/place/photo"
                        f"?maxwidth=800&photo_reference={photo_ref}&key={self.api_key}"
                    )
                    photos.append(photo_url)
            
            return PlaceResult(
                place_id=place.get('place_id', ''),
                name=place.get('name', ''),
                address=place.get('vicinity') or place.get('formatted_address', ''),
                lat=location.get('lat', 0),
                lng=location.get('lng', 0),
                rating=place.get('rating'),
                user_ratings_total=place.get('user_ratings_total'),
                price_level=place.get('price_level'),
                types=place.get('types', []),
                photos=photos,
            )
        except Exception as e:
            logger.error(f"Error parsing place: {e}")
            return None
    
    def _is_valid_competitor(
        self, 
        result: PlaceResult,
        property_type: Optional[str] = None
    ) -> bool:
        """
        Check if a place result is a valid apartment competitor
        
        Filters out non-apartment businesses like hotels, storage, etc.
        Also applies property type specific filtering.
        
        Args:
            result: PlaceResult to validate
            property_type: Subject property type for smarter filtering
                          (e.g., "multifamily", "apartment", "student_housing")
        """
        name_lower = result.name.lower()
        address_lower = result.address.lower()
        types_str = ' '.join(result.types or []).lower()
        combined_text = f"{name_lower} {types_str}"
        
        # Check for general exclude keywords
        is_for_sale_type = self._is_for_sale_property_type(property_type)
        for keyword in self.EXCLUDE_KEYWORDS:
            if is_for_sale_type and keyword in self.FOR_SALE_ALLOWED_EXCLUDE_KEYWORDS:
                continue
            if keyword in combined_text:
                logger.debug(f"Excluding {result.name} - matches exclude keyword: {keyword}")
                return False
        
        # Apply property type specific filtering
        if property_type:
            property_type_lower = property_type.lower()
            
            # For multifamily/apartment properties, exclude non-apartment types
            if any(t in property_type_lower for t in ['multifamily', 'apartment', 'multi-family']):
                for keyword in self.MULTIFAMILY_EXCLUDE:
                    if keyword in combined_text:
                        logger.debug(f"Excluding {result.name} - multifamily filter: {keyword}")
                        return False
        
        # Must have a name with reasonable length
        if not result.name or len(result.name) < 3:
            return False
        
        # Additional heuristics to filter management companies
        # Names ending with common corporate suffixes without apartment indicators
        corp_suffixes = ['llc', 'inc', 'corp', 'company', 'co.', 'group']
        apartment_indicators = ['apartment', 'living', 'residences', 'lofts', 'flats', 'place', 'commons', 'park', 'village', 'gardens', 'terrace', 'heights', 'plaza', 'square', 'court', 'pointe', 'crossing', 'landing', 'station']
        
        has_corp_suffix = any(name_lower.endswith(s) or f' {s} ' in name_lower for s in corp_suffixes)
        has_apartment_indicator = any(ind in name_lower for ind in apartment_indicators)
        
        # If it has corporate suffix but no apartment indicator, likely a company not a property
        if has_corp_suffix and not has_apartment_indicator:
            # Check if it's clearly "X Properties" pattern without apartment context
            if name_lower.endswith('properties') and not has_apartment_indicator:
                logger.debug(f"Excluding {result.name} - appears to be management company")
                return False
        
        return True
    
    def to_scraped_property(
        self, 
        result: PlaceResult,
        include_details: bool = True
    ) -> ScrapedProperty:
        """
        Convert PlaceResult to ScrapedProperty format
        
        Args:
            result: PlaceResult from search
            include_details: Whether to fetch additional details (uses API quota)
            
        Returns:
            ScrapedProperty object
        """
        website = result.website
        phone = result.phone
        
        # Optionally get more details
        if include_details:
            details = self.get_place_details(result.place_id)
            if details:
                website = details.get('website') or website
                phone = details.get('formatted_phone_number') or phone
                
                logger.debug(f"Got details for {result.name}: website={website}, phone={phone}")
                
                # Get more photos (API returns as 'photo' not 'photos')
                photos_data = details.get('photo') or details.get('photos') or []
                if photos_data:
                    for photo in photos_data[:5]:
                        photo_ref = photo.get('photo_reference')
                        if photo_ref:
                            photo_url = (
                                f"https://maps.googleapis.com/maps/api/place/photo"
                                f"?maxwidth=800&photo_reference={photo_ref}&key={self.api_key}"
                            )
                            if photo_url not in result.photos:
                                result.photos.append(photo_url)
        
        # Parse address components
        address_parts = result.address.split(',')
        street = address_parts[0].strip() if address_parts else result.address
        city = address_parts[1].strip() if len(address_parts) > 1 else ""
        state_zip = address_parts[2].strip() if len(address_parts) > 2 else ""
        
        # Parse state and zip
        state = ""
        zip_code = ""
        if state_zip:
            parts = state_zip.split()
            if parts:
                state = parts[0] if len(parts[0]) == 2 else ""
                zip_code = parts[1] if len(parts) > 1 else ""
        
        return ScrapedProperty(
            name=result.name,
            address=street,
            city=city,
            state=state,
            zip_code=zip_code,
            latitude=result.lat,
            longitude=result.lng,
            website_url=website,
            phone=phone,
            amenities=[],  # Not available from Places API
            photos=result.photos[:10],
            units=[],  # Not available from Places API
            source=self.source,
            source_url=f"https://www.google.com/maps/place/?q=place_id:{result.place_id}"
        )
    
    def discover_competitors(
        self,
        lat: float,
        lng: float,
        radius_miles: float = 3.0,
        max_results: int = 20,
        include_details: bool = True,
        property_type: Optional[str] = None
    ) -> List[ScrapedProperty]:
        """
        Main method: Discover competitor apartments near a location
        
        Args:
            lat: Latitude of subject property
            lng: Longitude of subject property
            radius_miles: Search radius in miles
            max_results: Maximum competitors to return
            include_details: Fetch detailed info (uses more API quota)
            property_type: Subject property type for intelligent filtering
                          (e.g., "multifamily", "apartment", "student_housing")
            
        Returns:
            List of ScrapedProperty objects
        """
        # Convert miles to meters
        radius_meters = int(radius_miles * 1609.34)
        
        # Cap at Google's limit
        radius_meters = min(radius_meters, 50000)
        
        logger.info(f"Discovering competitors with property_type filter: {property_type}")
        
        # Search for places
        results = self.search_nearby(
            lat=lat,
            lng=lng,
            radius_meters=radius_meters,
            max_results=max_results,
            property_type=property_type
        )
        
        # Convert to ScrapedProperty format
        properties = []
        for result in results:
            try:
                prop = self.to_scraped_property(result, include_details=include_details)
                properties.append(prop)
            except Exception as e:
                logger.error(f"Error converting place {result.name}: {e}")
                continue
        
        return properties

    # =========================================================================
    # REVIEWFLOW AI - Review Extraction Methods
    # =========================================================================
    
    def get_place_reviews(
        self,
        place_id: str,
        max_reviews: int = 100
    ) -> List[GoogleReview]:
        """
        Fetch reviews for a Google Place
        
        Uses Places API (New) which returns up to 5 reviews per request.
        For more reviews, multiple API calls may be needed (pagination not 
        available in standard API - requires Places API advanced tier).
        
        Args:
            place_id: Google Place ID (e.g., ChIJ...)
            max_reviews: Maximum reviews to return (limited by API)
            
        Returns:
            List of GoogleReview objects
        """
        try:
            logger.info(f"Fetching reviews for place: {place_id}")
            
            # Use the place details endpoint with reviews field
            result = self.client.place(
                place_id=place_id,
                fields=[
                    'name',
                    'reviews',  # This is the key field
                    'user_ratings_total',
                    'rating'
                ]
            )
            
            place_data = result.get('result', {})
            raw_reviews = place_data.get('reviews', [])
            
            if not raw_reviews:
                logger.info(f"No reviews found for place {place_id}")
                return []
            
            reviews = []
            for review in raw_reviews[:max_reviews]:
                try:
                    parsed = self._parse_review(review, place_id)
                    if parsed:
                        reviews.append(parsed)
                except Exception as e:
                    logger.error(f"Error parsing review: {e}")
                    continue
            
            logger.info(f"Fetched {len(reviews)} reviews for place {place_id}")
            return reviews
            
        except Exception as e:
            logger.error(f"Error fetching reviews for {place_id}: {e}")
            return []
    
    def _parse_review(self, review: Dict[str, Any], place_id: str) -> Optional[GoogleReview]:
        """
        Parse a raw review from Google Places API
        
        API Response structure:
        {
            "author_name": "John Doe",
            "author_url": "https://...",
            "profile_photo_url": "https://...",
            "rating": 5,
            "relative_time_description": "2 weeks ago",
            "text": "Great place!",
            "time": 1701234567  # Unix timestamp
            "language": "en"
        }
        """
        try:
            # Generate unique ID from place_id + author + timestamp
            timestamp = review.get('time', 0)
            author = review.get('author_name', 'Anonymous')
            review_id = f"google-{place_id}-{timestamp}-{hash(author) % 10000}"
            
            # Convert Unix timestamp to ISO date
            review_date = datetime.utcfromtimestamp(timestamp).isoformat() if timestamp else datetime.utcnow().isoformat()
            
            return GoogleReview(
                platform_review_id=review_id,
                reviewer_name=author,
                reviewer_avatar_url=review.get('profile_photo_url'),
                rating=review.get('rating', 0),
                review_text=review.get('text', ''),
                review_date=review_date,
                language=review.get('language', 'en'),
                relative_time=review.get('relative_time_description')
            )
        except Exception as e:
            logger.error(f"Error parsing review data: {e}")
            return None
    
    def get_reviews_for_property(
        self,
        property_name: str,
        address: str,
        lat: Optional[float] = None,
        lng: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Find a property on Google and fetch its reviews
        
        Searches for the property by name/address, finds the Place ID,
        then fetches reviews.
        
        Args:
            property_name: Name of the property/business
            address: Street address
            lat: Optional latitude for better matching
            lng: Optional longitude for better matching
            
        Returns:
            Dict with place info and reviews
        """
        try:
            # Search for the place
            search_query = f"{property_name} {address}"
            logger.info(f"Searching for property: {search_query}")
            
            if lat and lng:
                results = self.client.places(
                    query=search_query,
                    location=(lat, lng),
                    radius=1000
                )
            else:
                results = self.client.places(query=search_query)
            
            places = results.get('results', [])
            
            if not places:
                return {
                    'success': False,
                    'error': 'Property not found on Google',
                    'reviews': []
                }
            
            # Use the first (best) match
            best_match = places[0]
            place_id = best_match.get('place_id')
            
            if not place_id:
                return {
                    'success': False,
                    'error': 'Could not get Place ID',
                    'reviews': []
                }
            
            # Fetch reviews
            reviews = self.get_place_reviews(place_id)
            
            return {
                'success': True,
                'place_id': place_id,
                'place_name': best_match.get('name'),
                'place_address': best_match.get('formatted_address') or best_match.get('vicinity'),
                'place_rating': best_match.get('rating'),
                'total_reviews': best_match.get('user_ratings_total', 0),
                'reviews': [r.to_dict() for r in reviews],
                'reviews_fetched': len(reviews),
                'note': 'Google Places API returns up to 5 reviews. Use scrape_all_reviews() for more.'
            }
            
        except Exception as e:
            logger.error(f"Error getting reviews for property: {e}")
            return {
                'success': False,
                'error': str(e),
                'reviews': []
            }


# =============================================================================
# PLAYWRIGHT-BASED GOOGLE MAPS REVIEW SCRAPER
# Gets ALL reviews by scrolling through the Google Maps reviews panel
# =============================================================================

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    logger.warning("Playwright not available for Google Maps scraping")

import re
import hashlib
import concurrent.futures


class GoogleMapsReviewScraper:
    """
    Scrapes ALL reviews from Google Maps using Playwright browser automation.
    
    The Google Places API only returns 5 reviews max. This scraper can get
    all reviews by loading the Google Maps page and scrolling through the
    reviews panel.
    """
    
    def __init__(self, headless: bool = True):
        self.headless = headless
        if not PLAYWRIGHT_AVAILABLE:
            raise ImportError("Playwright required. Install: pip install playwright && playwright install chromium")
    
    def _scrape_reviews_sync(
        self, 
        place_id: str, 
        max_reviews: int = 100,
        scroll_pause: float = 1.5
    ) -> Dict[str, Any]:
        """
        Scrape reviews from Google Maps for a given Place ID (synchronous)
        
        Args:
            place_id: Google Place ID (e.g., ChIJN1t_tDeuEmsRUsoyG83frY4)
            max_reviews: Maximum number of reviews to fetch
            scroll_pause: Seconds to wait between scrolls
            
        Returns:
            Dict with reviews and metadata
        """
        # Use the correct Google Maps URL format for place ID
        url = f"https://www.google.com/maps/search/?api=1&query=Google&query_place_id={place_id}"
        
        reviews = []
        place_name = None
        
        logger.info(f"[Playwright] Scraping Google Maps reviews for place: {place_id}")
        
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self.headless)
                context = browser.new_context(
                    viewport={'width': 1280, 'height': 900},
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                )
                page = context.new_page()
                
                # Navigate to Google Maps place - use domcontentloaded (networkidle never fires on Maps)
                logger.info(f"[Playwright] Navigating to: {url}")
                page.goto(url, wait_until='domcontentloaded', timeout=60000)
                
                # Wait for the page to actually load content
                logger.info("[Playwright] Waiting for page content...")
                page.wait_for_timeout(5000)
                
                # Try to wait for reviews section to appear
                try:
                    page.wait_for_selector('div[role="feed"], .jftiEf, [data-review-id]', timeout=15000)
                    logger.info("[Playwright] Reviews section found!")
                except:
                    logger.warning("[Playwright] Reviews section not found immediately, continuing...")
                
                # Get place name
                try:
                    place_name_el = page.query_selector('h1')
                    if place_name_el:
                        place_name = place_name_el.inner_text()
                except:
                    pass
                
                # Click on reviews tab/button to open reviews panel
                try:
                    logger.info("[Playwright] Looking for reviews button...")
                    
                    # Try multiple selectors for the reviews tab
                    selectors_to_try = [
                        'button[aria-label*="Reviews"]',
                        'button[aria-label*="reviews"]', 
                        'button[data-tab-index="1"]',
                        '[role="tab"]:has-text("Reviews")',
                        'button:has-text("reviews")',
                        '.Gpq6kf.fontTitleSmall:has-text("Reviews")',  # Reviews tab text
                    ]
                    
                    reviews_button = None
                    for selector in selectors_to_try:
                        try:
                            reviews_button = page.query_selector(selector)
                            if reviews_button:
                                logger.info(f"[Playwright] Found reviews button with: {selector}")
                                break
                        except:
                            continue
                    
                    if reviews_button:
                        reviews_button.click()
                        logger.info("[Playwright] Clicked reviews button, waiting for reviews to load...")
                        page.wait_for_timeout(3000)
                    else:
                        logger.warning("[Playwright] Could not find reviews button, trying to find reviews directly")
                except Exception as e:
                    logger.warning(f"Could not click reviews button: {e}")
                
                # Find the scrollable reviews container
                logger.info("[Playwright] Looking for scrollable reviews container...")
                scroll_container = page.query_selector('div[role="feed"]')
                if not scroll_container:
                    scroll_container = page.query_selector('.m6QErb.DxyBCb.kA9KIf.dS8AEf')
                if not scroll_container:
                    scroll_container = page.query_selector('.m6QErb')
                
                if scroll_container:
                    logger.info("[Playwright] Found scroll container")
                else:
                    logger.warning("[Playwright] No scroll container found, will use page scroll")
                
                # Scroll and collect reviews
                last_count = 0
                no_new_reviews_count = 0
                
                while len(reviews) < max_reviews and no_new_reviews_count < 5:
                    # Get all review elements - try multiple selectors
                    review_elements = page.query_selector_all('[data-review-id], div.jftiEf, div.jJc9Ad')
                    logger.info(f"[Playwright] Found {len(review_elements)} review elements on page")
                    
                    for review_el in review_elements:
                        try:
                            review_data = self._extract_review_data_sync(review_el, place_id)
                            if review_data and review_data['platform_review_id'] not in [r['platform_review_id'] for r in reviews]:
                                reviews.append(review_data)
                                
                                if len(reviews) >= max_reviews:
                                    break
                        except Exception as e:
                            logger.debug(f"Error extracting review: {e}")
                            continue
                    
                    # Check if we got new reviews
                    if len(reviews) == last_count:
                        no_new_reviews_count += 1
                    else:
                        no_new_reviews_count = 0
                    last_count = len(reviews)
                    
                    # Scroll down
                    if scroll_container:
                        scroll_container.evaluate('el => el.scrollTop = el.scrollHeight')
                    else:
                        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                    
                    page.wait_for_timeout(int(scroll_pause * 1000))
                    
                    logger.info(f"[Playwright] Collected {len(reviews)} reviews so far...")
                
                browser.close()
                
        except PlaywrightTimeout as e:
            logger.error(f"[Playwright] Timeout scraping Google Maps: {e}")
        except Exception as e:
            logger.error(f"[Playwright] Error scraping Google Maps: {e}")
        
        return {
            'success': len(reviews) > 0,
            'place_id': place_id,
            'place_name': place_name,
            'reviews': reviews,
            'reviews_fetched': len(reviews),
            'method': 'playwright_scraper',
            'note': f'Scraped {len(reviews)} reviews via Google Maps web interface'
        }
    
    def _extract_review_data_sync(self, review_el, place_id: str) -> Optional[Dict[str, Any]]:
        """Extract review data from a review element (synchronous)"""
        try:
            # Try to get review ID from data attribute
            review_id = review_el.get_attribute('data-review-id')
            
            # Get reviewer name
            name_el = review_el.query_selector('.d4r55, span.d4r55')
            reviewer_name = name_el.inner_text() if name_el else 'Anonymous'
            
            # Get avatar
            avatar_el = review_el.query_selector('img.NBa7we')
            avatar_url = avatar_el.get_attribute('src') if avatar_el else None
            
            # Get rating (count filled stars)
            rating = 0
            stars_container = review_el.query_selector('.kvMYJc')
            if stars_container:
                aria_label = stars_container.get_attribute('aria-label')
                if aria_label:
                    match = re.search(r'(\d+)', aria_label)
                    if match:
                        rating = int(match.group(1))
            
            # Get review text
            text_el = review_el.query_selector('.wiI7pd, span.wiI7pd')
            review_text = text_el.inner_text() if text_el else ''
            
            # Expand "More" if present
            try:
                more_btn = review_el.query_selector('button.w8nwRe')
                if more_btn:
                    more_btn.click()
                    review_el.page.wait_for_timeout(300)
                    text_el = review_el.query_selector('.wiI7pd, span.wiI7pd')
                    review_text = text_el.inner_text() if text_el else review_text
            except:
                pass
            
            # Get relative time
            time_el = review_el.query_selector('.rsqaWe')
            relative_time = time_el.inner_text() if time_el else None
            
            # Generate unique ID if not found
            if not review_id:
                unique_str = f"{place_id}-{reviewer_name}-{review_text[:50]}"
                review_id = f"google-{hashlib.md5(unique_str.encode()).hexdigest()[:12]}"
            
            return {
                'platform_review_id': review_id,
                'reviewer_name': reviewer_name,
                'reviewer_avatar_url': avatar_url,
                'rating': rating,
                'review_text': review_text,
                'review_date': datetime.utcnow().isoformat(),
                'relative_time': relative_time,
                'platform': 'google'
            }
        except Exception as e:
            logger.debug(f"Error extracting review data: {e}")
            return None
    
    async def scrape_reviews_async(self, place_id: str, max_reviews: int = 100) -> Dict[str, Any]:
        """
        Async wrapper that runs Playwright in a thread pool to avoid Windows asyncio issues
        """
        loop = None
        try:
            import asyncio
            loop = asyncio.get_event_loop()
        except:
            pass
        
        # Run sync Playwright in a thread pool to avoid Windows asyncio subprocess issues
        with concurrent.futures.ThreadPoolExecutor() as executor:
            if loop:
                result = await loop.run_in_executor(
                    executor,
                    self._scrape_reviews_sync,
                    place_id,
                    max_reviews
                )
            else:
                result = executor.submit(self._scrape_reviews_sync, place_id, max_reviews).result()
        
        return result
    
    def scrape_reviews(self, place_id: str, max_reviews: int = 100) -> Dict[str, Any]:
        """Synchronous entry point"""
        return self._scrape_reviews_sync(place_id, max_reviews)
