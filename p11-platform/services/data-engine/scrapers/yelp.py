"""
Yelp Fusion API Integration for ReviewFlow AI
Fetches business information and reviews from Yelp

IMPORTANT LIMITATIONS:
- Yelp API returns only 3 MOST RECENT reviews per business
- No pagination available for reviews
- Full review history requires Yelp Business Owner access

API Documentation: https://docs.developer.yelp.com/docs/fusion-intro
"""

import os
import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import requests

logger = logging.getLogger(__name__)


@dataclass
class YelpReview:
    """Parsed review from Yelp Fusion API"""
    platform_review_id: str
    reviewer_name: str
    reviewer_avatar_url: Optional[str]
    rating: int
    review_text: str
    review_date: str  # ISO format
    review_url: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'platform_review_id': self.platform_review_id,
            'reviewer_name': self.reviewer_name,
            'reviewer_avatar_url': self.reviewer_avatar_url,
            'rating': self.rating,
            'review_text': self.review_text,
            'review_date': self.review_date,
            'review_url': self.review_url,
            'platform': 'yelp'
        }


@dataclass
class YelpBusiness:
    """Business information from Yelp"""
    business_id: str
    name: str
    url: str
    rating: float
    review_count: int
    address: str
    city: str
    state: str
    zip_code: str
    phone: Optional[str]
    categories: List[str]
    image_url: Optional[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'business_id': self.business_id,
            'name': self.name,
            'url': self.url,
            'rating': self.rating,
            'review_count': self.review_count,
            'address': self.address,
            'city': self.city,
            'state': self.state,
            'zip_code': self.zip_code,
            'phone': self.phone,
            'categories': self.categories,
            'image_url': self.image_url
        }


class YelpFusionClient:
    """
    Client for Yelp Fusion API
    
    IMPORTANT: Yelp only returns 3 reviews per business via their API.
    This is a hard limitation - there's no way to get more reviews.
    """
    
    BASE_URL = "https://api.yelp.com/v3"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Yelp Fusion client
        
        Args:
            api_key: Yelp Fusion API key (defaults to YELP_FUSION_API_KEY env var)
        """
        self.api_key = api_key or os.environ.get('YELP_FUSION_API_KEY')
        if not self.api_key:
            raise ValueError("Yelp API key required. Set YELP_FUSION_API_KEY env var.")
        
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json'
        }
    
    def _make_request(self, endpoint: str, params: Optional[Dict] = None) -> Optional[Dict]:
        """Make authenticated request to Yelp API"""
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Yelp API request failed: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return None
    
    def search_business(
        self,
        name: str,
        location: str,
        categories: str = "apartments",
        limit: int = 5
    ) -> List[YelpBusiness]:
        """
        Search for a business on Yelp
        
        Args:
            name: Business name
            location: City, address, or zip code
            categories: Yelp category filter (default: apartments)
            limit: Max results to return
            
        Returns:
            List of matching businesses
        """
        params = {
            'term': name,
            'location': location,
            'categories': categories,
            'limit': limit
        }
        
        data = self._make_request('/businesses/search', params)
        
        if not data or 'businesses' not in data:
            return []
        
        businesses = []
        for biz in data['businesses']:
            try:
                business = self._parse_business(biz)
                if business:
                    businesses.append(business)
            except Exception as e:
                logger.error(f"Error parsing business: {e}")
                continue
        
        return businesses
    
    def get_business(self, business_id: str) -> Optional[YelpBusiness]:
        """
        Get business details by Yelp business ID
        
        Args:
            business_id: Yelp business ID (e.g., "the-domain-at-wills-crossing-austin")
            
        Returns:
            YelpBusiness or None
        """
        data = self._make_request(f'/businesses/{business_id}')
        
        if not data:
            return None
        
        return self._parse_business(data)
    
    def get_business_reviews(self, business_id: str) -> List[YelpReview]:
        """
        Get reviews for a business
        
        ⚠️ IMPORTANT: Yelp API returns ONLY 3 reviews per business.
        This is an API limitation, not a bug.
        
        Args:
            business_id: Yelp business ID
            
        Returns:
            List of up to 3 reviews
        """
        data = self._make_request(f'/businesses/{business_id}/reviews')
        
        if not data or 'reviews' not in data:
            return []
        
        reviews = []
        for review in data['reviews']:
            try:
                parsed = self._parse_review(review, business_id)
                if parsed:
                    reviews.append(parsed)
            except Exception as e:
                logger.error(f"Error parsing Yelp review: {e}")
                continue
        
        logger.info(f"Fetched {len(reviews)} reviews for Yelp business {business_id} (max 3 available via API)")
        return reviews
    
    def _parse_business(self, data: Dict[str, Any]) -> Optional[YelpBusiness]:
        """Parse business data from API response"""
        try:
            location = data.get('location', {})
            categories = [cat.get('title', '') for cat in data.get('categories', [])]
            
            return YelpBusiness(
                business_id=data.get('id', ''),
                name=data.get('name', ''),
                url=data.get('url', ''),
                rating=data.get('rating', 0),
                review_count=data.get('review_count', 0),
                address=' '.join(location.get('display_address', [])),
                city=location.get('city', ''),
                state=location.get('state', ''),
                zip_code=location.get('zip_code', ''),
                phone=data.get('display_phone'),
                categories=categories,
                image_url=data.get('image_url')
            )
        except Exception as e:
            logger.error(f"Error parsing business data: {e}")
            return None
    
    def _parse_review(self, review: Dict[str, Any], business_id: str) -> Optional[YelpReview]:
        """
        Parse review from Yelp API response
        
        API Response structure:
        {
            "id": "review_id",
            "url": "https://...",
            "text": "Review text...",
            "rating": 5,
            "time_created": "2024-01-15 10:30:00",
            "user": {
                "id": "user_id",
                "profile_url": "https://...",
                "image_url": "https://...",
                "name": "John D."
            }
        }
        """
        try:
            user = review.get('user', {})
            
            # Parse date
            time_created = review.get('time_created', '')
            try:
                review_date = datetime.strptime(time_created, '%Y-%m-%d %H:%M:%S').isoformat()
            except:
                review_date = datetime.utcnow().isoformat()
            
            import hashlib as _hashlib
            fallback_id = "yelp-{}-{}".format(
                business_id,
                _hashlib.sha256(
                    f"{business_id}|{time_created}|{(review.get('text') or '')[:80]}".encode('utf-8')
                ).hexdigest()[:16],
            )
            return YelpReview(
                platform_review_id=review.get('id') or fallback_id,
                reviewer_name=user.get('name', 'Anonymous'),
                reviewer_avatar_url=user.get('image_url'),
                rating=review.get('rating', 0),
                review_text=review.get('text', ''),
                review_date=review_date,
                review_url=review.get('url')
            )
        except Exception as e:
            logger.error(f"Error parsing Yelp review: {e}")
            return None
    
    def get_reviews_for_property(
        self,
        property_name: str,
        city: str,
        state: str = ""
    ) -> Dict[str, Any]:
        """
        Search for a property on Yelp and fetch its reviews
        
        Args:
            property_name: Name of the property
            city: City name
            state: State (optional)
            
        Returns:
            Dict with business info and reviews
        """
        try:
            location = f"{city}, {state}".strip(', ')
            
            # Search for the business
            businesses = self.search_business(
                name=property_name,
                location=location,
                categories="apartments,realestate",
                limit=3
            )
            
            if not businesses:
                return {
                    'success': False,
                    'error': 'Property not found on Yelp',
                    'reviews': []
                }
            
            # Use the first (best) match
            business = businesses[0]
            
            # Fetch reviews
            reviews = self.get_business_reviews(business.business_id)
            
            return {
                'success': True,
                'business_id': business.business_id,
                'business_name': business.name,
                'business_url': business.url,
                'business_rating': business.rating,
                'total_reviews': business.review_count,
                'reviews': [r.to_dict() for r in reviews],
                'reviews_fetched': len(reviews),
                'note': 'Yelp API returns only 3 most recent reviews. Total review count may be higher.'
            }
            
        except Exception as e:
            logger.error(f"Error getting Yelp reviews for property: {e}")
            return {
                'success': False,
                'error': str(e),
                'reviews': []
            }
    
    def extract_business_id_from_url(self, url: str) -> Optional[str]:
        """
        Extract business ID from a Yelp URL
        
        Examples:
            https://www.yelp.com/biz/the-domain-at-wills-crossing-austin
            -> the-domain-at-wills-crossing-austin
        """
        try:
            # Handle both formats:
            # yelp.com/biz/business-name
            # yelp.com/biz/business-name?param=value
            if '/biz/' in url:
                business_part = url.split('/biz/')[-1]
                business_id = business_part.split('?')[0].strip('/')
                return business_id
            return None
        except:
            return None


def is_yelp_configured() -> bool:
    """Check if Yelp API is configured"""
    return bool(os.environ.get('YELP_FUSION_API_KEY'))


def get_yelp_client() -> Optional[YelpFusionClient]:
    """Get configured Yelp client or None"""
    if is_yelp_configured():
        return YelpFusionClient()
    return None

