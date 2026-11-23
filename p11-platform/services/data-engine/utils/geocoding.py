"""
Geocoding Utilities
Convert addresses to coordinates and vice versa
"""

import logging
from typing import Optional, Tuple, Dict, Any
from dataclasses import dataclass

from geopy.geocoders import Nominatim
from geopy.distance import geodesic
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable

logger = logging.getLogger(__name__)


@dataclass
class GeocodedLocation:
    """Represents a geocoded location"""
    latitude: float
    longitude: float
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: str = "US"
    is_street_level: bool = False


class GeocodingService:
    """
    Service for geocoding addresses and calculating distances
    Uses OpenStreetMap's Nominatim (free, no API key required)
    """
    
    def __init__(self, user_agent: str = "P11-MarketVision/1.0"):
        """
        Initialize geocoding service
        
        Args:
            user_agent: User agent string for Nominatim API
        """
        self.geolocator = Nominatim(user_agent=user_agent)
    
    def geocode_address(self, address: str) -> Optional[GeocodedLocation]:
        """
        Convert address to coordinates
        
        Args:
            address: Full address string
            
        Returns:
            GeocodedLocation or None if not found
        """
        try:
            location = self.geolocator.geocode(
                address,
                addressdetails=True,
                country_codes=['us'],
                timeout=10
            )
            
            if not location:
                logger.warning(f"Could not geocode address: {address}")
                return None
            
            # Extract address components
            raw = location.raw.get('address', {})
            
            city = (
                raw.get('city') or 
                raw.get('town') or 
                raw.get('village') or 
                raw.get('municipality')
            )
            
            state = raw.get('state')
            zip_code = raw.get('postcode')
            
            return GeocodedLocation(
                latitude=location.latitude,
                longitude=location.longitude,
                address=location.address,
                city=city,
                state=state,
                zip_code=zip_code,
                is_street_level=bool(raw.get('road') or raw.get('house_number'))
            )
            
        except GeocoderTimedOut:
            logger.error(f"Geocoding timed out for: {address}")
            return None
        except GeocoderUnavailable as e:
            logger.error(f"Geocoder unavailable: {e}")
            return None
        except Exception as e:
            logger.error(f"Geocoding error for {address}: {e}")
            return None
    
    def reverse_geocode(self, lat: float, lng: float) -> Optional[GeocodedLocation]:
        """
        Convert coordinates to address
        
        Args:
            lat: Latitude
            lng: Longitude
            
        Returns:
            GeocodedLocation or None if not found
        """
        try:
            location = self.geolocator.reverse(
                (lat, lng),
                addressdetails=True,
                timeout=10
            )
            
            if not location:
                return None
            
            raw = location.raw.get('address', {})
            
            city = (
                raw.get('city') or 
                raw.get('town') or 
                raw.get('village')
            )
            
            return GeocodedLocation(
                latitude=lat,
                longitude=lng,
                address=location.address,
                city=city,
                state=raw.get('state'),
                zip_code=raw.get('postcode')
            )
            
        except Exception as e:
            logger.error(f"Reverse geocoding error: {e}")
            return None
    
    def calculate_distance_miles(
        self, 
        lat1: float, 
        lng1: float, 
        lat2: float, 
        lng2: float
    ) -> float:
        """
        Calculate distance between two points in miles
        
        Args:
            lat1, lng1: First point coordinates
            lat2, lng2: Second point coordinates
            
        Returns:
            Distance in miles
        """
        return geodesic((lat1, lng1), (lat2, lng2)).miles
    
    def get_bounding_box(
        self, 
        lat: float, 
        lng: float, 
        radius_miles: float
    ) -> Tuple[float, float, float, float]:
        """
        Calculate bounding box for a radius around a point
        
        Args:
            lat: Center latitude
            lng: Center longitude
            radius_miles: Radius in miles
            
        Returns:
            Tuple of (min_lat, max_lat, min_lng, max_lng)
        """
        # Approximate degrees per mile
        lat_delta = radius_miles / 69.0
        lng_delta = radius_miles / (69.0 * abs(lat) / 90.0 + 1)
        
        return (
            lat - lat_delta,  # min_lat
            lat + lat_delta,  # max_lat
            lng - lng_delta,  # min_lng
            lng + lng_delta   # max_lng
        )
    
    def is_within_radius(
        self,
        center_lat: float,
        center_lng: float,
        point_lat: float,
        point_lng: float,
        radius_miles: float
    ) -> bool:
        """
        Check if a point is within a radius of the center
        
        Args:
            center_lat, center_lng: Center point
            point_lat, point_lng: Point to check
            radius_miles: Radius in miles
            
        Returns:
            True if within radius
        """
        distance = self.calculate_distance_miles(
            center_lat, center_lng,
            point_lat, point_lng
        )
        return distance <= radius_miles

