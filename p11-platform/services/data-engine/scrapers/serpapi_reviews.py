"""
SerpAPI Google Maps Reviews Integration

Gets ALL reviews from Google Maps using SerpAPI's reliable API.
Unlike the native Google Places API (5 reviews max), SerpAPI can fetch
all reviews with proper pagination.

Documentation: https://serpapi.com/google-maps-reviews-api
"""

import os
import logging
import requests
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


logger = logging.getLogger(__name__)

SERPAPI_BASE_URL = "https://serpapi.com/search.json"


@dataclass
class SerpApiReview:
    """Review from SerpAPI"""
    platform_review_id: str
    reviewer_name: str
    reviewer_avatar_url: Optional[str]
    rating: int
    review_text: str
    review_date: Optional[str]
    relative_time: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'platform_review_id': self.platform_review_id,
            'reviewer_name': self.reviewer_name,
            'reviewer_avatar_url': self.reviewer_avatar_url,
            'rating': self.rating,
            'review_text': self.review_text,
            'review_date': self.review_date,
            'relative_time': self.relative_time,
            'platform': 'google'
        }


class SerpApiReviewsScraper:
    """
    Fetches ALL Google Maps reviews using SerpAPI.
    
    SerpAPI provides:
    - All reviews (not just 5)
    - Proper pagination
    - Reliable uptime
    - Structured data
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('SERPAPI_API_KEY')
        if not self.api_key:
            raise ValueError("SerpAPI key required. Set SERPAPI_API_KEY env var.")
    
    def get_reviews(
        self, 
        place_id: str, 
        max_reviews: int = 100,
        sort_by: str = "newestFirst"
    ) -> Dict[str, Any]:
        """
        Fetch all reviews for a Google Place ID
        
        Args:
            place_id: Google Place ID (e.g., ChIJN1t_tDeuEmsRUsoyG83frY4)
            max_reviews: Maximum number of reviews to fetch
            sort_by: Sort order - "newestFirst", "highestRating", "lowestRating", "mostRelevant"
            
        Returns:
            Dict with reviews and metadata
        """
        reviews = []
        seen_ids = set()
        seen_tokens = set()
        place_info = {}
        params = {
            "engine": "google_maps_reviews", "place_id": place_id,
            "api_key": self.api_key, "hl": "en", "sort_by": sort_by, "num": 20,
        }
        next_token = None
        try:
            while len(reviews) < max_reviews:
                response = requests.get(SERPAPI_BASE_URL, params=params, timeout=25)
                response.raise_for_status()
                data = response.json()
                if data.get("error") or not isinstance(data.get("reviews"), list):
                    raise ValueError("Invalid reviews response")
                if not place_info:
                    place_info = data.get("place_info") or {}
                previous_count = len(reviews)
                for item in data["reviews"]:
                    review = self._parse_review(item, place_id)
                    if not review:
                        raise ValueError("Missing review identity")
                    if review.platform_review_id not in seen_ids:
                        seen_ids.add(review.platform_review_id)
                        reviews.append(review)
                    if len(reviews) == max_reviews:
                        break
                next_token = (data.get("serpapi_pagination") or {}).get("next_page_token")
                if not next_token:
                    break
                if next_token in seen_tokens or previous_count == len(reviews):
                    raise ValueError("Pagination stalled")
                seen_tokens.add(next_token)
                params["next_page_token"] = next_token
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            # Request exceptions can contain the private API key in their URL.
            return {"success": False, "error": "SerpAPI could not retrieve the review pages.", "reviews": []}

        total = place_info.get("reviews")
        complete = total == len(reviews) and not next_token
        coverage = f"{len(reviews)} of {total}" if isinstance(total, int) else str(len(reviews))
        return {
            'success': True,
            'place_id': place_id,
            'place_name': place_info.get('title'),
            'place_address': place_info.get('address'),
            'place_rating': place_info.get('rating'),
            'total_reviews_on_google': place_info.get('reviews', 0),
            'reviews': [r.to_dict() for r in reviews],
            'reviews_fetched': len(reviews),
            'method': 'serpapi',
            'completeness': 'complete' if complete else 'degraded',
            'note': f'SerpAPI returned {coverage} Google reviews.'
        }
    
    def _parse_review(self, data: Dict[str, Any], place_id: str) -> Optional[SerpApiReview]:
        """Parse a review from SerpAPI response"""
        try:
            # Generate unique ID
            review_id = data.get('review_id')
            if not review_id:
                return None
            
            # Get user info
            user = data.get('user', {})
            reviewer_name = user.get('name', 'Anonymous')
            avatar_url = user.get('thumbnail')
            
            # Get rating
            rating = data.get('rating')
            
            # Get review text (snippet or full)
            review_text = (data.get('extracted_snippet') or {}).get('original') or data.get('snippet') or ''
            
            # Get date
            review_date = data.get('iso_date')
            
            relative_time = data.get('date')  # e.g., "2 weeks ago"
            
            return SerpApiReview(
                platform_review_id=str(review_id),
                reviewer_name=reviewer_name,
                reviewer_avatar_url=avatar_url,
                rating=rating,
                review_text=review_text,
                review_date=review_date,
                relative_time=relative_time
            )
        except Exception as e:
            logger.debug(f"[SerpAPI] Error parsing review: {e}")
            return None


def is_serpapi_configured() -> bool:
    """Check if SerpAPI is configured"""
    return bool(os.environ.get('SERPAPI_API_KEY'))
