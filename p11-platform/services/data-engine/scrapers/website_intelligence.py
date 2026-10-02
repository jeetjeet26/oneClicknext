"""
Community Website Intelligence Scraper
Crawls community websites and extracts structured knowledge for AI training

Uses a hybrid approach:
- Playwright for JavaScript-heavy sites
- LLM (GPT-4o-mini) for intelligent pricing extraction
- Regex patterns as fallback
"""

import os
import re
import json
import logging
import asyncio
from typing import List, Optional, Dict, Any, Set
from urllib.parse import urljoin, urlparse
from dataclasses import dataclass, field
from datetime import datetime

import httpx
from utils.public_http import PublicAsyncClient, guard_browser_context
from bs4 import BeautifulSoup
from fake_useragent import UserAgent

# OpenAI for intelligent extraction
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

# Playwright for fallback on bot-protected sites
try:
    from playwright.async_api import async_playwright, Browser, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    logger.warning("Playwright not available - some websites may be inaccessible")

logger = logging.getLogger(__name__)


@dataclass
class ExtractedContent:
    """Content extracted from a single page"""
    url: str
    title: str
    content: str
    page_type: str  # 'home', 'amenities', 'floor_plans', 'contact', 'pet_policy', etc.
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FloorPlanUnit:
    """A single floor plan/unit type extracted from website"""
    unit_type: str  # "Studio", "1BR", "2BR", etc.
    bedrooms: int
    bathrooms: float = 1.0
    sqft_min: Optional[int] = None
    sqft_max: Optional[int] = None
    rent_min: Optional[float] = None
    rent_max: Optional[float] = None
    deposit: Optional[float] = None
    available_count: int = 0
    move_in_specials: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "unit_type": self.unit_type,
            "bedrooms": self.bedrooms,
            "bathrooms": self.bathrooms,
            "sqft_min": self.sqft_min,
            "sqft_max": self.sqft_max,
            "rent_min": self.rent_min,
            "rent_max": self.rent_max,
            "deposit": self.deposit,
            "available_count": self.available_count,
            "move_in_specials": self.move_in_specials
        }


@dataclass
class CommunityKnowledge:
    """Structured knowledge extracted from a community website"""
    website_url: str
    property_name: Optional[str] = None
    amenities: List[str] = field(default_factory=list)
    pet_policy: Optional[Dict[str, Any]] = None
    parking_info: Optional[Dict[str, Any]] = None
    unit_types: List[str] = field(default_factory=list)
    floor_plans: List[FloorPlanUnit] = field(default_factory=list)  # Extracted pricing data
    specials: List[str] = field(default_factory=list)
    contact_info: Optional[Dict[str, Any]] = None
    office_hours: Optional[str] = None
    neighborhood_info: Optional[str] = None
    brand_voice: Optional[str] = None
    target_audience: Optional[str] = None
    raw_chunks: List[str] = field(default_factory=list)
    pages_scraped: int = 0
    scraped_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "website_url": self.website_url,
            "property_name": self.property_name,
            "amenities": self.amenities,
            "pet_policy": self.pet_policy,
            "parking_info": self.parking_info,
            "unit_types": self.unit_types,
            "floor_plans": [fp.to_dict() for fp in self.floor_plans],
            "specials": self.specials,
            "contact_info": self.contact_info,
            "office_hours": self.office_hours,
            "neighborhood_info": self.neighborhood_info,
            "brand_voice": self.brand_voice,
            "target_audience": self.target_audience,
            "raw_chunks": self.raw_chunks,
            "pages_scraped": self.pages_scraped,
            "scraped_at": self.scraped_at,
        }


class CommunityWebsiteScraper:
    """
    Crawls community websites and extracts structured knowledge
    for use in AI training and RAG systems.
    """
    
    # Common paths to check on apartment websites
    PAGES_TO_SCRAPE = [
        '/',
        '/amenities',
        '/amenities/',
        '/floor-plans',
        '/floor-plans/',
        '/floorplans',
        '/floorplans/',
        '/gallery',
        '/gallery/',
        '/photos',
        '/photos/',
        '/contact',
        '/contact/',
        '/contact-us',
        '/contact-us/',
        '/pet-policy',
        '/pet-policy/',
        '/pets',
        '/pets/',
        '/neighborhood',
        '/neighborhood/',
        '/location',
        '/location/',
        '/about',
        '/about/',
        '/about-us',
        '/about-us/',
        '/specials',
        '/specials/',
        '/deals',
        '/deals/',
        '/virtual-tour',
        '/virtual-tour/',
        '/faqs',
        '/faqs/',
        '/faq',
        '/faq/',
        '/residents',
        '/residents/',
        '/resident-resources',
        '/resident-resources/',
    ]
    
    # Keywords to identify page types
    PAGE_TYPE_KEYWORDS = {
        'amenities': ['amenity', 'amenities', 'feature', 'community features'],
        'floor_plans': ['floor plan', 'floorplan', 'apartment', 'unit', 'bedroom', 'studio'],
        'contact': ['contact', 'get in touch', 'reach us', 'office hours'],
        'pet_policy': ['pet', 'dog', 'cat', 'animal'],
        'specials': ['special', 'deal', 'promotion', 'offer', 'discount', 'move-in'],
        'neighborhood': ['neighborhood', 'location', 'nearby', 'area', 'community'],
        'about': ['about', 'our story', 'history', 'welcome'],
        'gallery': ['gallery', 'photo', 'image', 'tour', 'view'],
        'faq': ['faq', 'frequently asked', 'question'],
    }
    
    # Rate limiting
    MIN_DELAY = 1.0
    MAX_DELAY = 2.0
    TIMEOUT = 20.0
    MAX_PAGES = 15  # Maximum pages to scrape per site
    
    # Track failed domains for playwright fallback
    _blocked_domains: Set[str] = set()
    
    def __init__(
        self, 
        openai_api_key: Optional[str] = None, 
        use_playwright_fallback: bool = True,
        prefer_playwright: bool = True,
        use_llm_extraction: bool = True
    ):
        """
        Initialize scraper with optional OpenAI key for AI-powered extraction.
        
        Args:
            openai_api_key: Optional OpenAI API key for structured extraction
            use_playwright_fallback: Use Playwright browser for bot-protected sites
            prefer_playwright: If True, try Playwright FIRST before httpx (recommended
                              for apartment websites which often have bot protection)
            use_llm_extraction: If True, use GPT-4o-mini for intelligent floor plan/pricing
                               extraction (more accurate but has API cost)
        """
        self.openai_api_key = openai_api_key or os.environ.get('OPENAI_API_KEY')
        self.use_playwright_fallback = use_playwright_fallback and PLAYWRIGHT_AVAILABLE
        self.prefer_playwright = prefer_playwright and PLAYWRIGHT_AVAILABLE
        self.use_llm_extraction = use_llm_extraction and OPENAI_AVAILABLE and bool(self.openai_api_key)
        self.ua = UserAgent()
        self._scraped_urls: Set[str] = set()
        self._failed_httpx_count: int = 0
        
        # Initialize OpenAI client if available
        if self.use_llm_extraction:
            self.openai_client = OpenAI(api_key=self.openai_api_key)
            logger.info("LLM extraction enabled (GPT-4o-mini)")
        else:
            self.openai_client = None
            if use_llm_extraction and not OPENAI_AVAILABLE:
                logger.warning("LLM extraction requested but openai package not installed")
            elif use_llm_extraction and not self.openai_api_key:
                logger.warning("LLM extraction requested but OPENAI_API_KEY not set")
    
    def _get_headers(self, referer: Optional[str] = None) -> Dict[str, str]:
        """Generate realistic browser headers that bypass bot detection"""
        # Use a consistent Chrome user agent for the session
        chrome_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
        headers = {
            "User-Agent": chrome_ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            # Modern Chrome security headers
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none" if not referer else "same-origin",
            "Sec-Fetch-User": "?1",
        }
        
        if referer:
            headers["Referer"] = referer
            headers["Sec-Fetch-Site"] = "same-origin"
        
        return headers
    
    def _normalize_url(self, base_url: str, path: str) -> str:
        """Normalize and join URL components"""
        if path.startswith('http'):
            return path
        return urljoin(base_url, path)
    
    def _clean_text(self, text: Optional[str]) -> str:
        """Clean and normalize extracted text"""
        if not text:
            return ""
        # Remove extra whitespace
        text = ' '.join(text.split())
        # Remove common junk
        text = re.sub(r'\s*\|\s*', ' ', text)
        return text.strip()
    
    def _extract_text_from_html(self, soup: BeautifulSoup) -> str:
        """Extract readable text from HTML, excluding scripts and styles"""
        # Remove script and style elements
        for element in soup(['script', 'style', 'nav', 'header', 'footer', 'noscript']):
            element.decompose()
        
        # Get text
        text = soup.get_text(separator='\n')
        
        # Clean up
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\n'.join(chunk for chunk in chunks if chunk and len(chunk) > 3)
        
        return text
    
    def _identify_page_type(self, url: str, title: str, content: str) -> str:
        """Identify the type of page based on URL and content"""
        url_lower = url.lower()
        title_lower = title.lower()
        content_lower = content[:2000].lower()  # Check first 2000 chars
        
        for page_type, keywords in self.PAGE_TYPE_KEYWORDS.items():
            for keyword in keywords:
                if keyword in url_lower or keyword in title_lower:
                    return page_type
                if keyword in content_lower:
                    return page_type
        
        return 'general'
    
    def _extract_amenities(self, soup: BeautifulSoup, content: str) -> List[str]:
        """Extract amenities list from page content"""
        amenities = set()
        
        # Common amenity keywords
        amenity_keywords = [
            'pool', 'fitness', 'gym', 'dog park', 'pet park', 'clubhouse', 
            'business center', 'playground', 'tennis', 'basketball', 'volleyball',
            'bbq', 'grill', 'fire pit', 'rooftop', 'parking garage', 'ev charging',
            'package locker', 'concierge', 'theater', 'movie', 'game room',
            'spa', 'sauna', 'yoga', 'co-working', 'coworking', 'pet spa',
            'bike storage', 'storage unit', 'maintenance', 'gated', 'security',
            'laundry', 'washer', 'dryer', 'dishwasher', 'granite', 'stainless',
            'balcony', 'patio', 'view', 'fireplace', 'hardwood', 'carpet',
            'walk-in closet', 'ceiling fan', 'air conditioning', 'central heat'
        ]
        
        content_lower = content.lower()
        
        for keyword in amenity_keywords:
            if keyword in content_lower:
                # Capitalize nicely
                amenity = keyword.replace('-', ' ').title()
                amenities.add(amenity)
        
        # Also look for list items in amenity sections
        for section in soup.find_all(['ul', 'div'], class_=re.compile(r'amenity|feature', re.I)):
            for item in section.find_all(['li', 'span', 'p']):
                text = self._clean_text(item.get_text())
                if text and 3 < len(text) < 50:
                    amenities.add(text)
        
        return list(amenities)[:30]  # Limit to 30 amenities
    
    def _extract_pet_policy(self, content: str) -> Optional[Dict[str, Any]]:
        """Extract pet policy information from content"""
        content_lower = content.lower()
        
        if 'pet' not in content_lower and 'dog' not in content_lower:
            return None
        
        policy = {
            "pets_allowed": True,
            "details": []
        }
        
        # Check if pets are not allowed
        no_pet_phrases = ['no pets', 'pets not allowed', 'pet-free', 'no animals']
        for phrase in no_pet_phrases:
            if phrase in content_lower:
                policy["pets_allowed"] = False
                return policy
        
        # Extract deposit amounts
        deposit_match = re.search(r'\$(\d+)\s*(?:pet\s*)?deposit', content_lower)
        if deposit_match:
            policy["deposit"] = int(deposit_match.group(1))
        
        # Extract monthly pet rent
        rent_match = re.search(r'\$(\d+)\s*(?:monthly|month|/mo)?\s*pet\s*rent', content_lower)
        if rent_match:
            policy["monthly_rent"] = int(rent_match.group(1))
        
        # Extract weight limits
        weight_match = re.search(r'(\d+)\s*(?:lb|pound)s?\s*(?:limit|max|weight)', content_lower)
        if weight_match:
            policy["weight_limit_lbs"] = int(weight_match.group(1))
        
        # Extract pet limit
        limit_match = re.search(r'(\d+)\s*pet(?:s)?\s*(?:max|maximum|limit|allowed)', content_lower)
        if limit_match:
            policy["max_pets"] = int(limit_match.group(1))
        
        # Check for breed restrictions
        if 'breed restriction' in content_lower or 'restricted breed' in content_lower:
            policy["breed_restrictions"] = True
        
        return policy
    
    def _extract_contact_info(self, soup: BeautifulSoup, content: str) -> Optional[Dict[str, Any]]:
        """Extract contact information from page"""
        contact = {}
        
        # Phone numbers
        phone_match = re.search(r'(?:phone|tel|call)[:\s]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})', content, re.I)
        if phone_match:
            contact["phone"] = phone_match.group(1)
        else:
            # Try to find any phone number
            phone_match = re.search(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', content)
            if phone_match:
                contact["phone"] = phone_match.group(0)
        
        # Email
        email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', content)
        if email_match:
            email = email_match.group(0)
            if not any(x in email.lower() for x in ['example', 'test', 'sample']):
                contact["email"] = email
        
        # Address
        address_match = re.search(
            r'(\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Circle|Cir)[,.\s]+[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})',
            content
        )
        if address_match:
            contact["address"] = self._clean_text(address_match.group(1))
        
        # Office hours
        hours_match = re.search(
            r'(?:office\s*hours|hours)[:\s]*([^\n]{10,100})',
            content,
            re.I
        )
        if hours_match:
            contact["office_hours"] = self._clean_text(hours_match.group(1))
        
        return contact if contact else None
    
    def _extract_specials(self, content: str) -> List[str]:
        """Extract move-in specials and promotions"""
        specials = []
        
        # Common special patterns
        patterns = [
            r'(\$\d+\s*off[^.!]*[.!])',
            r'(\d+\s*(?:month|week)s?\s*free[^.!]*[.!])',
            r'(free\s*(?:month|rent|application)[^.!]*[.!])',
            r'(waived?\s*(?:fee|deposit|application)[^.!]*[.!])',
            r'(move.?in\s*special[^.!]*[.!])',
            r'(limited\s*time\s*offer[^.!]*[.!])',
        ]
        
        content_lower = content.lower()
        
        for pattern in patterns:
            matches = re.findall(pattern, content_lower, re.I)
            for match in matches:
                cleaned = self._clean_text(match)
                if cleaned and len(cleaned) > 10:
                    specials.append(cleaned.capitalize())
        
        return list(set(specials))[:5]  # Limit to 5 specials
    
    def _extract_unit_types(self, content: str) -> List[str]:
        """Extract available unit types"""
        unit_types = set()
        
        # Common unit type patterns
        patterns = [
            r'(studio)',
            r'(\d+)\s*(?:bed|br|bedroom)',
            r'(one|two|three|four)\s*bedroom',
        ]
        
        content_lower = content.lower()
        
        for pattern in patterns:
            matches = re.findall(pattern, content_lower, re.I)
            for match in matches:
                if match.lower() == 'studio':
                    unit_types.add('Studio')
                elif match.isdigit():
                    unit_types.add(f'{match} Bedroom')
                elif match.lower() in ['one', 'two', 'three', 'four']:
                    nums = {'one': '1', 'two': '2', 'three': '3', 'four': '4'}
                    unit_types.add(f'{nums[match.lower()]} Bedroom')
        
        return sorted(list(unit_types))
    
    def _extract_floor_plans(self, soup: BeautifulSoup, content: str) -> List[FloorPlanUnit]:
        """
        Extract floor plans with pricing data from website content.
        
        Uses a hybrid approach:
        1. Try LLM extraction first (if enabled) - most accurate
        2. Fall back to regex patterns if LLM fails or is disabled
        """
        floor_plans: List[FloorPlanUnit] = []
        
        # Track what we've found to avoid duplicates
        found_units = set()
        
        # Log content length for debugging
        logger.debug(f"[FloorPlans] Processing content: {len(content)} chars")
        
        # HYBRID APPROACH: Try LLM extraction first (more accurate)
        if self.use_llm_extraction and self.openai_client:
            logger.info("[FloorPlans] Using LLM extraction (GPT-4o-mini)")
            llm_floor_plans = self._extract_floor_plans_with_llm(content)
            
            if llm_floor_plans:
                logger.info(f"[FloorPlans] LLM extracted {len(llm_floor_plans)} floor plans")
                return llm_floor_plans
            else:
                logger.warning("[FloorPlans] LLM extraction returned no results, falling back to regex")
        
        # FALLBACK: Pattern-based extraction
        logger.info("[FloorPlans] Using regex-based extraction")
        
        # Pattern 1: Look for structured floor plan sections
        sections_found = soup.find_all(['section', 'div', 'article'], 
                                       class_=re.compile(r'floor.?plan|pricing|availability|unit|apartment', re.I))
        logger.debug(f"[FloorPlans] Found {len(sections_found)} structured sections")
        
        for section in sections_found:
            self._extract_floor_plans_from_section(section, floor_plans, found_units)
        
        # Pattern 2: Look for tables with pricing data
        tables_found = soup.find_all('table')
        logger.debug(f"[FloorPlans] Found {len(tables_found)} tables")
        
        for table in tables_found:
            self._extract_floor_plans_from_table(table, floor_plans, found_units)
        
        logger.debug(f"[FloorPlans] After structured extraction: {len(floor_plans)} floor plans")
        
        # Pattern 3: Text-based extraction for simpler sites (and RentCafe/Yardi)
        self._extract_floor_plans_from_text(content, floor_plans, found_units)
        
        logger.debug(f"[FloorPlans] After text extraction: {len(floor_plans)} floor plans")
        
        return floor_plans
    
    def _extract_floor_plans_with_llm(self, content: str) -> List[FloorPlanUnit]:
        """
        Use GPT-4o-mini to intelligently extract floor plan and pricing data.
        
        This is more accurate than regex patterns because:
        - Understands context (distinguishes rent from deposit from fees)
        - Handles any page format/layout
        - Can extract data even when it's scattered across the page
        """
        if not self.openai_client:
            return []
        
        # Normalize and truncate content to fit token limits
        normalized_content = ' '.join(content.split())
        # GPT-4o-mini has 128k context, but we'll limit to ~15k chars for cost efficiency
        max_chars = 15000
        if len(normalized_content) > max_chars:
            normalized_content = normalized_content[:max_chars]
        
        # Prompt for structured extraction
        prompt = """You are an expert at extracting apartment pricing data from website content.

Analyze the following apartment website content and extract ALL floor plan/pricing information you can find.

For each unique floor plan type, extract:
- unit_type: The floor plan name (e.g., "Studio", "1BR", "2BR", "A1", "B2", etc.)
- bedrooms: Number of bedrooms (0 for studio)
- bathrooms: Number of bathrooms (default 1.0 if not specified)
- sqft_min: Minimum square footage (null if not found)
- sqft_max: Maximum square footage (null if not found, same as sqft_min if only one value)
- rent_min: Minimum rent price in dollars (null if not found or "Call for pricing")
- rent_max: Maximum rent price (null if not found, same as rent_min if only one value)
- deposit: Security deposit amount (null if not found)
- available_count: Number of units available (0 if not specified)
- move_in_specials: Any move-in specials or promotions mentioned (null if none)

IMPORTANT:
- Extract ACTUAL prices found, not fees or deposits mixed with rent
- "Base Rent" is the rent price
- If a unit says "Call for details" or "Inquire", set rent to null
- Group similar units (e.g., all "1 Bed" units into "1BR" unless they have distinct names like "A1", "A2")
- Return an empty array [] if no pricing data is found

Website Content:
---
{content}
---

Return ONLY valid JSON in this exact format:
{{
  "floor_plans": [
    {{
      "unit_type": "Studio",
      "bedrooms": 0,
      "bathrooms": 1.0,
      "sqft_min": 399,
      "sqft_max": 399,
      "rent_min": 2233,
      "rent_max": 2233,
      "deposit": 500,
      "available_count": 4,
      "move_in_specials": null
    }}
  ]
}}"""

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a precise data extraction assistant. Extract apartment pricing data and return valid JSON only."
                    },
                    {
                        "role": "user",
                        "content": prompt.format(content=normalized_content)
                    }
                ],
                response_format={"type": "json_object"},
                max_tokens=4000,
                temperature=0.1  # Low temperature for consistent extraction
            )
            
            result = json.loads(response.choices[0].message.content)
            floor_plans_data = result.get('floor_plans', [])
            
            # Convert to FloorPlanUnit objects
            floor_plans = []
            for fp in floor_plans_data:
                try:
                    floor_plan = FloorPlanUnit(
                        unit_type=fp.get('unit_type', 'Unknown'),
                        bedrooms=fp.get('bedrooms', 0),
                        bathrooms=fp.get('bathrooms', 1.0),
                        sqft_min=fp.get('sqft_min'),
                        sqft_max=fp.get('sqft_max'),
                        rent_min=fp.get('rent_min'),
                        rent_max=fp.get('rent_max'),
                        deposit=fp.get('deposit'),
                        available_count=fp.get('available_count', 0),
                        move_in_specials=fp.get('move_in_specials')
                    )
                    
                    # Only include if we have either rent or sqft data
                    if floor_plan.rent_min or floor_plan.sqft_min:
                        floor_plans.append(floor_plan)
                        logger.info(f"[LLM] Extracted: {floor_plan.unit_type} - ${floor_plan.rent_min}, {floor_plan.sqft_min} sqft, {floor_plan.available_count} available")
                        
                except Exception as e:
                    logger.warning(f"[LLM] Error parsing floor plan: {e}")
                    continue
            
            return floor_plans
            
        except Exception as e:
            logger.error(f"[LLM] Floor plan extraction failed: {e}")
            return []
    
    def _extract_floor_plans_from_section(
        self, 
        section: Any, 
        floor_plans: List[FloorPlanUnit], 
        found_units: set
    ) -> None:
        """Extract floor plan data from a structured section element"""
        # Look for individual floor plan cards
        cards = section.find_all(['div', 'article', 'li'], 
                                  class_=re.compile(r'card|item|plan|unit', re.I))
        
        if not cards:
            cards = [section]  # Treat section itself as a card
        
        for card in cards:
            card_text = card.get_text(separator=' ', strip=True)
            # Normalize whitespace
            card_text = ' '.join(card_text.split())
            
            # Extract bedroom count
            bedrooms = self._parse_bedroom_count(card_text)
            if bedrooms is None:
                continue
            
            unit_type = "Studio" if bedrooms == 0 else f"{bedrooms}BR"
            
            # Skip if already found this unit type
            if unit_type in found_units:
                continue
            
            # Extract bathrooms
            bathrooms = self._parse_bathroom_count(card_text)
            
            # Extract rent
            rent_min, rent_max = self._parse_rent_range(card_text)
            
            # Extract sqft
            sqft_min, sqft_max = self._parse_sqft_range(card_text)
            
            # Only add if we found pricing or sqft
            if rent_min or sqft_min:
                found_units.add(unit_type)
                floor_plans.append(FloorPlanUnit(
                    unit_type=unit_type,
                    bedrooms=bedrooms,
                    bathrooms=bathrooms,
                    sqft_min=sqft_min,
                    sqft_max=sqft_max,
                    rent_min=rent_min,
                    rent_max=rent_max
                ))
                logger.debug(f"[Section] Extracted: {unit_type} ${rent_min}, {sqft_min} sqft")
    
    def _extract_floor_plans_from_table(
        self, 
        table: Any, 
        floor_plans: List[FloorPlanUnit], 
        found_units: set
    ) -> None:
        """Extract floor plan data from HTML tables"""
        rows = table.find_all('tr')
        
        # Try to find header row to identify columns
        headers = []
        header_row = table.find('thead')
        if header_row:
            headers = [th.get_text(strip=True).lower() for th in header_row.find_all(['th', 'td'])]
        
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) < 2:
                continue
            
            row_text = row.get_text(separator=' ', strip=True)
            
            # Extract bedroom count
            bedrooms = self._parse_bedroom_count(row_text)
            if bedrooms is None:
                continue
            
            unit_type = "Studio" if bedrooms == 0 else f"{bedrooms}BR"
            
            if unit_type in found_units:
                continue
            
            # Extract other data
            bathrooms = self._parse_bathroom_count(row_text)
            rent_min, rent_max = self._parse_rent_range(row_text)
            sqft_min, sqft_max = self._parse_sqft_range(row_text)
            
            if rent_min or sqft_min:
                found_units.add(unit_type)
                floor_plans.append(FloorPlanUnit(
                    unit_type=unit_type,
                    bedrooms=bedrooms,
                    bathrooms=bathrooms,
                    sqft_min=sqft_min,
                    sqft_max=sqft_max,
                    rent_min=rent_min,
                    rent_max=rent_max
                ))
    
    def _extract_floor_plans_from_text(
        self, 
        content: str, 
        floor_plans: List[FloorPlanUnit], 
        found_units: set
    ) -> None:
        """Extract floor plan data from unstructured text"""
        # Normalize whitespace - replace multiple spaces/newlines with single space
        normalized = ' '.join(content.split())
        content_lower = normalized.lower()
        
        # Try block-based extraction first (for RentCafe/Yardi style pages)
        self._extract_rentcafe_style(content_lower, floor_plans, found_units)
        
        # Pattern: "Studio $1,200" or "Studio from $1,200" or "Studio: $1,200 - $1,400"
        patterns = [
            # Studio patterns
            r'studio[s]?\s*(?:from\s*)?\$?([\d,]+)(?:\s*[-–to]+\s*\$?([\d,]+))?',
            # 1-4 bedroom patterns with $ and numbers
            r'(\d)\s*(?:bed(?:room)?s?|br|beds?)\s*(?:from\s*)?\$?([\d,]+)(?:\s*[-–to]+\s*\$?([\d,]+))?',
            # "One Bedroom $X" style
            r'(one|two|three|four)\s*bed(?:room)?[s]?\s*(?:from\s*)?\$?([\d,]+)(?:\s*[-–to]+\s*\$?([\d,]+))?',
        ]
        
        word_to_num = {'one': 1, 'two': 2, 'three': 3, 'four': 4}
        
        for pattern in patterns:
            matches = re.finditer(pattern, content_lower, re.I)
            for match in matches:
                groups = match.groups()
                
                if 'studio' in pattern:
                    bedrooms = 0
                    rent_min_str = groups[0]
                    rent_max_str = groups[1] if len(groups) > 1 else None
                elif groups[0] in word_to_num:
                    bedrooms = word_to_num[groups[0]]
                    rent_min_str = groups[1]
                    rent_max_str = groups[2] if len(groups) > 2 else None
                else:
                    bedrooms = int(groups[0])
                    rent_min_str = groups[1]
                    rent_max_str = groups[2] if len(groups) > 2 else None
                
                unit_type = "Studio" if bedrooms == 0 else f"{bedrooms}BR"
                
                if unit_type in found_units:
                    continue
                
                rent_min = self._parse_price_str(rent_min_str)
                rent_max = self._parse_price_str(rent_max_str)
                
                # Only accept reasonable rent values
                if rent_min and 500 <= rent_min <= 15000:
                    found_units.add(unit_type)
                    floor_plans.append(FloorPlanUnit(
                        unit_type=unit_type,
                        bedrooms=bedrooms,
                        bathrooms=1.0 if bedrooms == 0 else float(bedrooms),
                        rent_min=rent_min,
                        rent_max=rent_max
                    ))
    
    def _extract_rentcafe_style(
        self,
        content: str,
        floor_plans: List[FloorPlanUnit],
        found_units: set
    ) -> None:
        """
        Extract floor plans from RentCafe/Yardi style pages.
        
        These pages have patterns like:
        - "Studio 1 Bath 399 Sq. Ft. 4 Available Base Rent $2,233"
        - "1 Bed 1 Bath 700 Sq. Ft. 2 Available Base Rent $2,720"
        - "2 Bed 2 Bath 1,089 Sq. Ft. 3 Available Base Rent $3,447"
        """
        # Pattern for "Base Rent $X,XXX" or "rent $X,XXX" or "starting at $X,XXX"
        rent_patterns = [
            r'base\s*rent\s*\$\s*([\d,]+)',
            r'rent\s*(?:from|starting\s*at)?\s*\$\s*([\d,]+)',
            r'starting\s*(?:at|from)\s*\$\s*([\d,]+)',
            r'\$\s*([\d,]+)\s*/?\s*(?:mo|month)',
        ]
        
        # Find all rent amounts in the content
        rent_matches = []
        for pattern in rent_patterns:
            for match in re.finditer(pattern, content, re.I):
                rent_val = self._parse_price_str(match.group(1))
                if rent_val and 500 <= rent_val <= 20000:
                    rent_matches.append((match.start(), rent_val))
                    logger.debug(f"[RentCafe] Found rent: ${rent_val} at position {match.start()}")
        
        if not rent_matches:
            logger.debug("[RentCafe] No rent patterns found in content")
            return
        
        logger.info(f"[RentCafe] Found {len(rent_matches)} rent values to process")
        
        # For each rent match, look backwards to find bedroom/bath/sqft info
        for rent_pos, rent_val in rent_matches:
            # Get the text chunk before this rent (up to 200 chars)
            chunk_start = max(0, rent_pos - 200)
            chunk = content[chunk_start:rent_pos]
            
            # Parse bedroom count
            bedrooms = None
            
            # Check for studio
            if re.search(r'\bstudio\b', chunk, re.I):
                bedrooms = 0
            else:
                # Look for "X Bed" or "X bedroom" pattern
                bed_match = re.search(r'(\d)\s*bed(?:room)?s?\b', chunk, re.I)
                if bed_match:
                    bedrooms = int(bed_match.group(1))
            
            if bedrooms is None:
                continue
            
            unit_type = "Studio" if bedrooms == 0 else f"{bedrooms}BR"
            
            if unit_type in found_units:
                continue
            
            # Parse bathroom count
            bath_match = re.search(r'([\d.]+)\s*bath(?:room)?s?\b', chunk, re.I)
            bathrooms = float(bath_match.group(1)) if bath_match else 1.0
            
            # Parse square footage
            sqft_match = re.search(r'([\d,]+)\s*(?:sq\.?\s*ft\.?|square\s*feet|sqft)', chunk, re.I)
            sqft = self._parse_sqft_str(sqft_match.group(1)) if sqft_match else None
            
            # Parse availability
            avail_match = re.search(r'(\d+)\s*available', chunk, re.I)
            available = int(avail_match.group(1)) if avail_match else 0
            
            # Parse deposit
            deposit_match = re.search(r'deposit[:\s]*\$?\s*([\d,]+)', chunk, re.I)
            deposit = self._parse_price_str(deposit_match.group(1)) if deposit_match else None
            
            found_units.add(unit_type)
            floor_plans.append(FloorPlanUnit(
                unit_type=unit_type,
                bedrooms=bedrooms,
                bathrooms=bathrooms,
                sqft_min=sqft,
                sqft_max=sqft,
                rent_min=rent_val,
                rent_max=rent_val,
                deposit=deposit,
                available_count=available
            ))
            
            logger.info(f"[RentCafe] Found: {unit_type} - ${rent_val}, {sqft} sqft, {bathrooms} bath, {available} available")
    
    def _parse_bedroom_count(self, text: str) -> Optional[int]:
        """Parse bedroom count from text"""
        # Normalize whitespace
        text = ' '.join(text.split())
        text_lower = text.lower()
        
        # Check for studio
        if re.search(r'\bstudio\b', text_lower):
            return 0
        
        # Check for numbered bedrooms - various formats
        # "1 Bed", "1 bed", "1 bedroom", "1BR", "1 BR", "1-bed", "1-bedroom"
        patterns = [
            r'(\d)\s*[-]?\s*bed(?:room)?s?\b',
            r'(\d)\s*[-]?\s*br\b',
            r'(\d)\s*beds?\b',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text_lower)
            if match:
                return int(match.group(1))
        
        # Check for word bedrooms
        word_patterns = [
            r'(one|two|three|four)\s*[-]?\s*bed(?:room)?s?',
            r'(one|two|three|four)\s*[-]?\s*br\b',
        ]
        
        word_to_num = {'one': 1, 'two': 2, 'three': 3, 'four': 4}
        
        for pattern in word_patterns:
            match = re.search(pattern, text_lower)
            if match:
                return word_to_num.get(match.group(1).lower())
        
        return None
    
    def _parse_bathroom_count(self, text: str) -> float:
        """Parse bathroom count from text"""
        text_lower = text.lower()
        
        match = re.search(r'(\d+(?:\.\d+)?)\s*(?:bath(?:room)?|ba)\b', text_lower)
        if match:
            return float(match.group(1))
        
        return 1.0  # Default to 1 bathroom
    
    def _parse_rent_range(self, text: str) -> tuple[Optional[float], Optional[float]]:
        """Parse rent range from text, returns (min, max)"""
        # Normalize whitespace
        text = ' '.join(text.split())
        
        # Try multiple patterns in order of specificity
        patterns = [
            # "Base Rent $1,200" or "Rent $1,200"
            r'(?:base\s*)?rent\s*\$\s*([\d,]+)(?:\s*[-–to]+\s*\$?\s*([\d,]+))?',
            # "Starting at $1,200" or "From $1,200"
            r'(?:starting\s*(?:at|from)|from)\s*\$\s*([\d,]+)(?:\s*[-–to]+\s*\$?\s*([\d,]+))?',
            # "$1,200/mo" or "$1,200 per month"
            r'\$\s*([\d,]+)\s*(?:/|\s*per\s*)\s*(?:mo|month)',
            # Standard: $1,200 - $1,500 or $1,200-$1,500
            r'\$\s*([\d,]+)(?:\s*[-–to]+\s*\$?\s*([\d,]+))?',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                rent_min = self._parse_price_str(match.group(1))
                rent_max = self._parse_price_str(match.group(2)) if len(match.groups()) > 1 else None
                
                # Validate rent is reasonable (between $200 and $50,000)
                if rent_min and (rent_min < 200 or rent_min > 50000):
                    continue  # Try next pattern
                if rent_max and (rent_max < 200 or rent_max > 50000):
                    rent_max = None
                
                if rent_min:
                    return rent_min, rent_max
        
        return None, None
    
    def _parse_sqft_range(self, text: str) -> tuple[Optional[int], Optional[int]]:
        """Parse square footage range from text"""
        # Normalize whitespace
        text = ' '.join(text.split())
        
        # Multiple patterns for square footage
        # "399 Sq. Ft.", "750 sq ft", "750-900 sqft", "1,089 Sq. Ft."
        patterns = [
            # "X,XXX Sq. Ft." or "XXX Sq. Ft." (common in RentCafe)
            r'([\d,]+)\s*sq\.?\s*ft\.?',
            # Range: "750-900 sq ft"
            r'([\d,]+)\s*[-–to]+\s*([\d,]+)\s*(?:sq\.?\s*(?:ft\.?|feet)|sqft)',
            # "sqft" suffix
            r'([\d,]+)\s*sqft',
            # "square feet"
            r'([\d,]+)\s*square\s*feet',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                sqft_min = self._parse_sqft_str(match.group(1))
                sqft_max = self._parse_sqft_str(match.group(2)) if len(match.groups()) > 1 and match.group(2) else None
                
                # Validate sqft is reasonable
                if sqft_min and (sqft_min < 100 or sqft_min > 10000):
                    continue  # Try next pattern
                if sqft_max and (sqft_max < 100 or sqft_max > 10000):
                    sqft_max = None
                
                if sqft_min:
                    return sqft_min, sqft_max
        
        return None, None
    
    def _parse_price_str(self, price_str: Optional[str]) -> Optional[float]:
        """Parse price string to float"""
        if not price_str:
            return None
        cleaned = ''.join(c for c in price_str if c.isdigit() or c == '.')
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    
    def _parse_sqft_str(self, sqft_str: Optional[str]) -> Optional[int]:
        """Parse sqft string to int"""
        if not sqft_str:
            return None
        cleaned = ''.join(c for c in sqft_str if c.isdigit())
        try:
            return int(cleaned) if cleaned else None
        except ValueError:
            return None
    
    def _chunk_content(self, content: str, max_size: int = 800, overlap: int = 100) -> List[str]:
        """Split content into chunks for RAG embedding"""
        chunks = []
        sentences = re.split(r'(?<=[.!?])\s+', content)
        
        current_chunk = ''
        
        for sentence in sentences:
            if len(current_chunk) + len(sentence) > max_size and current_chunk:
                chunks.append(current_chunk.strip())
                # Keep overlap
                words = current_chunk.split()
                overlap_words = words[-overlap // 5:] if len(words) > overlap // 5 else []
                current_chunk = ' '.join(overlap_words) + ' ' + sentence
            else:
                current_chunk += (' ' if current_chunk else '') + sentence
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return [chunk for chunk in chunks if len(chunk) > 50]
    
    async def _fetch_page(self, client: httpx.AsyncClient, url: str, referer: Optional[str] = None, retry_count: int = 0) -> Optional[str]:
        """Fetch a single page with error handling and retry logic"""
        max_retries = 2
        
        try:
            headers = self._get_headers(referer=referer)
            response = await client.get(url, headers=headers, follow_redirects=True)
            
            if response.status_code == 200:
                return response.text
            elif response.status_code in [403, 521, 522, 523, 524]:
                # Bot detection or Cloudflare - try alternative approach
                if retry_count < max_retries:
                    # Wait longer and retry with different headers
                    await asyncio.sleep(2 + retry_count * 2)
                    
                    # Try with a simpler, mobile user agent
                    mobile_headers = {
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Accept-Encoding": "gzip, deflate, br",
                    }
                    
                    response = await client.get(url, headers=mobile_headers, follow_redirects=True)
                    if response.status_code == 200:
                        return response.text
                
                logger.warning(f"Got status {response.status_code} for {url} (bot protection likely)")
                return None
            else:
                logger.warning(f"Got status {response.status_code} for {url}")
                return None
        except Exception as e:
            logger.warning(f"Error fetching {url}: {e}")
            return None

    async def _scrape_with_httpx(self, base_url: str) -> List[ExtractedContent]:
        """
        Scrape website using httpx (lightweight but often blocked by bot protection)
        """
        all_content: List[ExtractedContent] = []
        
        # Use cookies and HTTP/2 for better compatibility
        async with PublicAsyncClient(
            timeout=httpx.Timeout(self.TIMEOUT, connect=10.0),
            http2=True,
            cookies=httpx.Cookies(),
            follow_redirects=True,
        ) as client:
            # Discover pages
            pages = await self._discover_pages(client, base_url)
            logger.info(f"[httpx] Discovered {len(pages)} pages to scrape")
            
            # Scrape pages with delay and referer chain
            last_url = None
            for url in pages:
                # Random delay between requests to appear more human-like
                delay = self.MIN_DELAY + (hash(url) % 100) / 100 * (self.MAX_DELAY - self.MIN_DELAY)
                await asyncio.sleep(delay)
                
                content = await self._scrape_page(client, url, referer=last_url)
                if content:
                    all_content.append(content)
                    last_url = url
                    logger.info(f"[httpx] Scraped: {url} ({content.page_type})")
        
        return all_content

    async def _scrape_with_playwright(self, base_url: str) -> List[ExtractedContent]:
        """
        PREFERRED scraper using Playwright for apartment websites.
        Uses a real browser to bypass Cloudflare and other bot protections.
        
        Most apartment community websites use bot protection that blocks httpx,
        so Playwright is the recommended approach.
        """
        if not PLAYWRIGHT_AVAILABLE:
            logger.warning("Playwright not available - install with: pip install playwright && playwright install chromium")
            return []
        
        logger.info(f"[Playwright] Scraping: {base_url}")
        all_content: List[ExtractedContent] = []
        
        try:
            async with async_playwright() as p:
                # Launch headless browser with stealth settings
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ]
                )
                
                context = await browser.new_context(service_workers='block',
                    viewport={'width': 1920, 'height': 1080},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    locale='en-US',
                )
                
                # Remove webdriver property to avoid detection
                await context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });
                """)
                
                await guard_browser_context(context)
                page = await context.new_page()
                
                # Pages to scrape
                paths_to_try = [''] + [p.strip('/') for p in self.PAGES_TO_SCRAPE[:8]]
                scraped_paths: Set[str] = set()
                
                for path in paths_to_try:
                    if path in scraped_paths:
                        continue
                    
                    url = f"{base_url.rstrip('/')}/{path}" if path else base_url
                    
                    try:
                        # Navigate with wait for network idle
                        await page.goto(url, wait_until='networkidle', timeout=30000)  # 30s for slow apartment sites
                        await asyncio.sleep(1)  # Extra wait for JS rendering
                        
                        # Get page content
                        html = await page.content()
                        
                        if html and len(html) > 1000:
                            soup = BeautifulSoup(html, 'lxml')
                            
                            # Get title
                            title = ''
                            title_tag = soup.find('title')
                            if title_tag:
                                title = self._clean_text(title_tag.get_text())
                            
                            # Extract content
                            content = self._extract_text_from_html(soup)
                            
                            if len(content) > 100:
                                page_type = self._identify_page_type(url, title, content)
                                
                                extracted = ExtractedContent(
                                    url=url,
                                    title=title,
                                    content=content,
                                    page_type=page_type,
                                    metadata={
                                        'amenities': self._extract_amenities(soup, content),
                                        'pet_policy': self._extract_pet_policy(content),
                                        'contact': self._extract_contact_info(soup, content),
                                        'specials': self._extract_specials(content),
                                        'unit_types': self._extract_unit_types(content),
                                        'floor_plans': self._extract_floor_plans(soup, content),
                                    }
                                )
                                all_content.append(extracted)
                                logger.info(f"[Playwright] Scraped: {url} ({page_type})")
                        
                        scraped_paths.add(path)
                        await asyncio.sleep(self.MIN_DELAY)
                        
                    except Exception as e:
                        logger.warning(f"Playwright error for {url}: {e}")
                        continue
                
                await browser.close()
                
        except Exception as e:
            logger.error(f"Playwright fallback failed: {e}")
        
        return all_content

    async def _discover_pages(self, client: httpx.AsyncClient, base_url: str) -> List[str]:
        """Discover pages to scrape from the website"""
        discovered = [base_url]
        
        # Try common paths
        for path in self.PAGES_TO_SCRAPE:
            full_url = self._normalize_url(base_url, path)
            if full_url not in discovered:
                discovered.append(full_url)
        
        # Also extract links from home page
        html = await self._fetch_page(client, base_url)
        if html:
            soup = BeautifulSoup(html, 'lxml')
            for link in soup.find_all('a', href=True):
                href = link['href']
                full_url = self._normalize_url(base_url, href)
                
                # Only include links from same domain
                if urlparse(full_url).netloc == urlparse(base_url).netloc:
                    if full_url not in discovered:
                        discovered.append(full_url)
        
        return discovered[:self.MAX_PAGES]
    
    async def _scrape_page(self, client: httpx.AsyncClient, url: str, referer: Optional[str] = None) -> Optional[ExtractedContent]:
        """Scrape content from a single page"""
        if url in self._scraped_urls:
            return None
        
        self._scraped_urls.add(url)
        
        html = await self._fetch_page(client, url, referer=referer)
        if not html:
            return None
        
        soup = BeautifulSoup(html, 'lxml')
        
        # Get title
        title = ''
        title_tag = soup.find('title')
        if title_tag:
            title = self._clean_text(title_tag.get_text())
        
        # Extract main content
        content = self._extract_text_from_html(soup)
        
        if len(content) < 100:
            return None
        
        # Identify page type
        page_type = self._identify_page_type(url, title, content)
        
        return ExtractedContent(
            url=url,
            title=title,
            content=content,
            page_type=page_type,
            metadata={
                'amenities': self._extract_amenities(soup, content),
                'pet_policy': self._extract_pet_policy(content),
                'contact': self._extract_contact_info(soup, content),
                'specials': self._extract_specials(content),
                'unit_types': self._extract_unit_types(content),
                'floor_plans': self._extract_floor_plans(soup, content),
            }
        )
    
    async def extract_community_knowledge(self, website_url: str) -> CommunityKnowledge:
        """
        Main entry point: scrapes website and returns structured knowledge
        
        Args:
            website_url: The community website URL to scrape
            
        Returns:
            CommunityKnowledge object with extracted data
        """
        # Normalize URL
        if not website_url.startswith('http'):
            website_url = 'https://' + website_url
        
        parsed = urlparse(website_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        
        logger.info(f"Starting website intelligence extraction for: {base_url}")
        
        self._scraped_urls = set()  # Reset for new scrape
        
        knowledge = CommunityKnowledge(website_url=base_url)
        all_content: List[ExtractedContent] = []
        
        # PRIORITIZE PLAYWRIGHT for apartment websites (they often have bot protection)
        if self.prefer_playwright:
            logger.info(f"Using Playwright (preferred) for: {base_url}")
            all_content = await self._scrape_with_playwright(base_url)
            knowledge.pages_scraped = len(all_content)
            
            # Fall back to httpx only if Playwright failed or didn't get enough content
            if len(all_content) < 2:
                logger.info(f"Playwright got {len(all_content)} pages, trying httpx as fallback...")
                httpx_content = await self._scrape_with_httpx(base_url)
                if len(httpx_content) > len(all_content):
                    all_content = httpx_content
                    knowledge.pages_scraped = len(all_content)
        else:
            # Legacy behavior: httpx first, Playwright as fallback
            all_content = await self._scrape_with_httpx(base_url)
            knowledge.pages_scraped = len(all_content)
            
            # If httpx failed (likely bot protection), try Playwright fallback
            if not all_content and self.use_playwright_fallback:
                logger.info(f"httpx failed for {base_url}, trying Playwright fallback...")
                all_content = await self._scrape_with_playwright(base_url)
                knowledge.pages_scraped = len(all_content)
        
        if not all_content:
            logger.warning(f"No content extracted from {base_url}")
            return knowledge
        
        # Aggregate extracted data
        all_amenities: Set[str] = set()
        all_specials: List[str] = []
        all_unit_types: Set[str] = set()
        all_floor_plans: List[FloorPlanUnit] = []
        floor_plan_types_found: Set[str] = set()
        
        for content in all_content:
            # Extract property name from home page title
            if content.page_type == 'general' and content.url == base_url:
                # Try to extract property name from title
                title = content.title
                # Remove common suffixes
                for suffix in ['| Apartments', '- Apartments', 'Apartments', '| Home', '- Home']:
                    title = title.replace(suffix, '')
                knowledge.property_name = self._clean_text(title)
            
            # Aggregate amenities
            if content.metadata.get('amenities'):
                all_amenities.update(content.metadata['amenities'])
            
            # Get pet policy (prefer dedicated pet page)
            if content.page_type == 'pet_policy' and content.metadata.get('pet_policy'):
                knowledge.pet_policy = content.metadata['pet_policy']
            elif not knowledge.pet_policy and content.metadata.get('pet_policy'):
                knowledge.pet_policy = content.metadata['pet_policy']
            
            # Get contact info
            if content.metadata.get('contact'):
                if not knowledge.contact_info:
                    knowledge.contact_info = content.metadata['contact']
                else:
                    # Merge contact info
                    for key, value in content.metadata['contact'].items():
                        if value and not knowledge.contact_info.get(key):
                            knowledge.contact_info[key] = value
            
            # Aggregate specials
            if content.metadata.get('specials'):
                all_specials.extend(content.metadata['specials'])
            
            # Aggregate unit types
            if content.metadata.get('unit_types'):
                all_unit_types.update(content.metadata['unit_types'])
            
            # Aggregate floor plans (prefer floor_plans page content)
            if content.metadata.get('floor_plans'):
                for fp in content.metadata['floor_plans']:
                    if fp.unit_type not in floor_plan_types_found:
                        floor_plan_types_found.add(fp.unit_type)
                        all_floor_plans.append(fp)
            
            # Create chunks for RAG
            chunks = self._chunk_content(content.content)
            for chunk in chunks:
                # Add context to chunk
                chunk_with_context = f"[Source: {content.page_type} page]\n{chunk}"
                knowledge.raw_chunks.append(chunk_with_context)
        
        knowledge.amenities = list(all_amenities)
        knowledge.specials = list(set(all_specials))
        knowledge.unit_types = sorted(list(all_unit_types))
        
        # HYBRID LLM EXTRACTION: If regex found nothing, try LLM on aggregated content
        if not all_floor_plans and self.use_llm_extraction and self.openai_client:
            logger.info("[FloorPlans] Regex extraction found nothing, trying LLM on aggregated content...")
            
            # Combine all scraped content for LLM analysis
            # all_content contains ExtractedContent dataclass objects
            combined_content = "\n\n---PAGE BREAK---\n\n".join([
                c.content for c in all_content if c.content
            ])
            
            if combined_content:
                all_floor_plans = self._extract_floor_plans_with_llm(combined_content)
        
        knowledge.floor_plans = all_floor_plans
        
        if all_floor_plans:
            logger.info(f"✅ Extracted {len(all_floor_plans)} floor plans with pricing:")
            for fp in all_floor_plans:
                logger.info(f"   - {fp.unit_type}: ${fp.rent_min} - ${fp.rent_max}, {fp.sqft_min} sqft")
        else:
            logger.warning(f"⚠️ No floor plans with pricing found. Pages scraped: {len(all_content)}")
        
        # Extract office hours from contact info if present
        if knowledge.contact_info and knowledge.contact_info.get('office_hours'):
            knowledge.office_hours = knowledge.contact_info.pop('office_hours')
        
        logger.info(f"Extraction complete: {len(knowledge.raw_chunks)} chunks, {len(knowledge.amenities)} amenities")
        
        return knowledge
    
    async def extract_with_ai(self, website_url: str) -> CommunityKnowledge:
        """
        Enhanced extraction using AI to structure and summarize content.
        Requires OpenAI API key to be set.
        
        Args:
            website_url: The community website URL
            
        Returns:
            CommunityKnowledge with AI-enhanced extraction
        """
        if not self.openai_api_key:
            logger.warning("No OpenAI API key - falling back to basic extraction")
            return await self.extract_community_knowledge(website_url)
        
        try:
            import openai
        except ImportError:
            logger.warning("OpenAI package not installed - falling back to basic extraction")
            return await self.extract_community_knowledge(website_url)
        
        # First get basic extraction
        knowledge = await self.extract_community_knowledge(website_url)
        
        if not knowledge.raw_chunks:
            return knowledge
        
        # Use AI to enhance extraction
        client = openai.OpenAI(api_key=self.openai_api_key)
        
        # Combine some content for AI analysis
        sample_content = '\n\n'.join(knowledge.raw_chunks[:10])  # First 10 chunks
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """You are an expert at analyzing apartment community websites.
                        Extract structured information from the content provided.
                        Return a JSON object with these fields (use null if not found):
                        - property_name: The name of the apartment community
                        - brand_voice: A brief description of the community's tone/personality (friendly, luxury, modern, etc.)
                        - target_audience: Who the community seems to target (young professionals, families, seniors, students, etc.)
                        - neighborhood_summary: A brief summary of the neighborhood/location benefits
                        - key_selling_points: Array of 3-5 main selling points
                        """
                    },
                    {
                        "role": "user",
                        "content": f"Analyze this apartment community website content:\n\n{sample_content[:8000]}"
                    }
                ],
                response_format={"type": "json_object"},
                max_tokens=1000
            )
            
            ai_data = json.loads(response.choices[0].message.content)
            
            # Enhance knowledge with AI extraction
            if ai_data.get('property_name') and not knowledge.property_name:
                knowledge.property_name = ai_data['property_name']
            
            knowledge.brand_voice = ai_data.get('brand_voice')
            knowledge.target_audience = ai_data.get('target_audience')
            knowledge.neighborhood_info = ai_data.get('neighborhood_summary')
            
            logger.info("AI enhancement completed successfully")
            
        except Exception as e:
            logger.error(f"AI enhancement failed: {e}")
        
        return knowledge


# Synchronous wrapper for non-async contexts
def scrape_community_website(
    website_url: str, 
    openai_api_key: Optional[str] = None,
    prefer_playwright: bool = True,
    use_llm_extraction: bool = True
) -> Dict[str, Any]:
    """
    Synchronous wrapper to scrape a community website.
    
    Args:
        website_url: The community website URL
        openai_api_key: Optional OpenAI API key for AI-enhanced extraction
        prefer_playwright: If True (default), use Playwright first for better
                          compatibility with bot-protected apartment websites
        use_llm_extraction: If True (default), use GPT-4o-mini for intelligent
                           floor plan/pricing extraction
        
    Returns:
        Dictionary with extracted community knowledge
    """
    scraper = CommunityWebsiteScraper(
        openai_api_key=openai_api_key,
        prefer_playwright=prefer_playwright,
        use_llm_extraction=use_llm_extraction
    )
    
    if openai_api_key:
        knowledge = asyncio.run(scraper.extract_with_ai(website_url))
    else:
        knowledge = asyncio.run(scraper.extract_community_knowledge(website_url))
    
    return knowledge.to_dict()


# CLI for testing
if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python website_intelligence.py <website_url>")
        sys.exit(1)
    
    url = sys.argv[1]
    result = scrape_community_website(url)
    
    print(json.dumps(result, indent=2))


