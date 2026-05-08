"""
Base Scraper Class
Common functionality for all ILS scrapers
"""

import time
import random
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)


@dataclass
class ScrapedUnit:
    """Represents a scraped apartment unit/floor plan"""
    unit_type: str  # "Studio", "1BR", "2BR", etc.
    bedrooms: int
    bathrooms: float
    sqft_min: Optional[int] = None
    sqft_max: Optional[int] = None
    rent_min: Optional[float] = None
    rent_max: Optional[float] = None
    deposit: Optional[float] = None
    available_count: int = 0
    move_in_specials: Optional[str] = None


@dataclass
class ScrapedProperty:
    """Represents a scraped apartment property"""
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    website_url: Optional[str] = None
    phone: Optional[str] = None
    units_count: Optional[int] = None
    year_built: Optional[int] = None
    property_type: str = "multifamily"
    amenities: List[str] = field(default_factory=list)
    photos: List[str] = field(default_factory=list)
    units: List[ScrapedUnit] = field(default_factory=list)
    source: str = "unknown"
    source_url: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API/database"""
        return {
            "name": self.name,
            "address": f"{self.address}, {self.city}, {self.state} {self.zip_code}",
            "address_json": {
                "street": self.address,
                "city": self.city,
                "state": self.state,
                "zip": self.zip_code,
                "lat": self.latitude,
                "lng": self.longitude
            },
            "website_url": self.website_url,
            "phone": self.phone,
            "units_count": self.units_count,
            "year_built": self.year_built,
            "property_type": self.property_type,
            "amenities": self.amenities,
            "photos": self.photos[:10],  # Limit photos
            "ils_listings": {self.source: self.source_url},
            "units": [
                {
                    "unit_type": u.unit_type,
                    "bedrooms": u.bedrooms,
                    "bathrooms": u.bathrooms,
                    "sqft_min": u.sqft_min,
                    "sqft_max": u.sqft_max,
                    "rent_min": u.rent_min,
                    "rent_max": u.rent_max,
                    "deposit": u.deposit,
                    "available_count": u.available_count,
                    "move_in_specials": u.move_in_specials
                }
                for u in self.units
            ]
        }


class BaseScraper(ABC):
    """
    Base class for ILS scrapers
    Handles rate limiting, headers, retries, and common parsing
    """
    
    # Default rate limiting
    MIN_DELAY = 2.0  # Minimum seconds between requests
    MAX_DELAY = 5.0  # Maximum seconds between requests
    
    # Request timeout
    TIMEOUT = 30.0
    
    def __init__(self, proxy_url: Optional[str] = None):
        """
        Initialize scraper
        
        Args:
            proxy_url: Optional proxy URL (e.g., "http://user:pass@proxy:port")
        """
        self.proxy_url = proxy_url
        self.ua = UserAgent()
        self._last_request_time = 0
        
        # Configure HTTP client
        client_kwargs = {
            "timeout": self.TIMEOUT,
            "follow_redirects": True,
        }
        if proxy_url:
            client_kwargs["proxy"] = proxy_url
        self.client = httpx.Client(**client_kwargs)
    
    def __del__(self):
        """Cleanup HTTP client"""
        if hasattr(self, 'client'):
            self.client.close()
    
    def _get_headers(self) -> Dict[str, str]:
        """Generate realistic browser headers"""
        return {
            "User-Agent": self.ua.random,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0"
        }
    
    def _rate_limit(self):
        """Enforce rate limiting between requests"""
        elapsed = time.time() - self._last_request_time
        delay = random.uniform(self.MIN_DELAY, self.MAX_DELAY)
        
        if elapsed < delay:
            sleep_time = delay - elapsed
            logger.debug(f"Rate limiting: sleeping {sleep_time:.2f}s")
            time.sleep(sleep_time)
        
        self._last_request_time = time.time()
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException))
    )
    def _fetch(self, url: str) -> str:
        """
        Fetch a URL with rate limiting and retries
        
        Args:
            url: URL to fetch
            
        Returns:
            HTML content as string
        """
        self._rate_limit()
        
        logger.info(f"Fetching: {url}")
        response = self.client.get(url, headers=self._get_headers())
        response.raise_for_status()
        
        return response.text
    
    def _parse_html(self, html: str) -> BeautifulSoup:
        """Parse HTML into BeautifulSoup object"""
        return BeautifulSoup(html, 'lxml')
    
    def _clean_text(self, text: Optional[str]) -> Optional[str]:
        """Clean and normalize text"""
        if not text:
            return None
        return ' '.join(text.strip().split())
    
    def _parse_price(self, price_str: Optional[str]) -> Optional[float]:
        """Parse price string to float"""
        if not price_str:
            return None
        
        # Remove currency symbols, commas, and whitespace
        cleaned = ''.join(c for c in price_str if c.isdigit() or c == '.')
        
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    
    def _parse_sqft(self, sqft_str: Optional[str]) -> Optional[int]:
        """Parse square footage string to int"""
        if not sqft_str:
            return None
        
        # Remove commas, "sq ft", etc.
        cleaned = ''.join(c for c in sqft_str if c.isdigit())
        
        try:
            return int(cleaned) if cleaned else None
        except ValueError:
            return None
    
    def _normalize_unit_type(self, bedrooms: int) -> str:
        """Convert bedroom count to standard unit type"""
        if bedrooms == 0:
            return "Studio"
        elif bedrooms >= 4:
            return "4BR+"
        else:
            return f"{bedrooms}BR"
    
    @abstractmethod
    def search_by_location(
        self, 
        city: str, 
        state: str, 
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties near a location
        
        Args:
            city: City name
            state: State abbreviation (e.g., "TX")
            radius_miles: Search radius in miles
            max_results: Maximum number of results
            
        Returns:
            List of scraped properties
        """
        pass
    
    @abstractmethod
    def search_by_coordinates(
        self,
        lat: float,
        lng: float,
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties near coordinates
        
        Args:
            lat: Latitude
            lng: Longitude
            radius_miles: Search radius in miles
            max_results: Maximum number of results
            
        Returns:
            List of scraped properties
        """
        pass
    
    @abstractmethod
    def scrape_property(self, url: str) -> Optional[ScrapedProperty]:
        """
        Scrape details for a single property
        
        Args:
            url: Property listing URL
            
        Returns:
            Scraped property details or None if failed
        """
        pass

