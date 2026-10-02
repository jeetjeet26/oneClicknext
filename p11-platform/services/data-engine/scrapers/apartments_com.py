from utils.public_http import guard_browser_context
"""
Apartments.com Scraper with Playwright Support
Scrapes apartment listings from Apartments.com with full JavaScript rendering
"""

import re
import json
import logging
import asyncio
from typing import List, Optional, Dict, Any
from urllib.parse import urlencode, quote

from scrapers.base import BaseScraper, ScrapedProperty, ScrapedUnit

# Playwright for JavaScript-rendered content
try:
    from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeout
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

logger = logging.getLogger(__name__)


class ApartmentsComScraper(BaseScraper):
    """
    Scraper for Apartments.com with Playwright support for full JS rendering.
    
    Apartments.com loads pricing grids and unit availability via JavaScript,
    so Playwright is essential for reliable data extraction.
    """
    
    BASE_URL = "https://www.apartments.com"
    
    # Increase delays for apartments.com to avoid detection
    MIN_DELAY = 3.0
    MAX_DELAY = 6.0
    
    def __init__(self, proxy_url: Optional[str] = None, use_playwright: bool = True):
        """
        Initialize scraper
        
        Args:
            proxy_url: Optional proxy URL for requests
            use_playwright: Use Playwright for JavaScript rendering (recommended)
        """
        super().__init__(proxy_url)
        self.source = "apartments_com"
        self.use_playwright = use_playwright and PLAYWRIGHT_AVAILABLE
        self._browser: Optional[Browser] = None
        
        if use_playwright and not PLAYWRIGHT_AVAILABLE:
            logger.warning("Playwright not available - falling back to httpx (limited functionality)")
    
    def _build_search_url(
        self, 
        location: str, 
        page: int = 1,
        sort: str = "default"
    ) -> str:
        """Build search URL for Apartments.com"""
        # Apartments.com uses slug-based URLs
        location_slug = location.lower().replace(' ', '-').replace(',', '')
        
        url = f"{self.BASE_URL}/{location_slug}/"
        
        if page > 1:
            url += f"{page}/"
        
        return url
    
    def _extract_json_ld(self, soup) -> List[Dict[str, Any]]:
        """Extract JSON-LD structured data from page"""
        json_ld_scripts = soup.find_all('script', type='application/ld+json')
        results = []
        
        for script in json_ld_scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    results.extend(data)
                else:
                    results.append(data)
            except (json.JSONDecodeError, TypeError):
                continue
        
        return results
    
    # =========================================================================
    # PLAYWRIGHT METHODS - Full JavaScript Rendering
    # =========================================================================
    
    async def _get_browser(self) -> Browser:
        """Get or create Playwright browser instance"""
        if self._browser is None or not self._browser.is_connected():
            playwright = await async_playwright().start()
            self._browser = await playwright.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                ]
            )
        return self._browser
    
    async def _create_stealth_context(self, browser: Browser):
        """Create a browser context with stealth settings"""
        context = await browser.new_context(service_workers='block',
            viewport={'width': 1920, 'height': 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale='en-US',
            timezone_id='America/New_York',
            geolocation={'latitude': 40.7128, 'longitude': -74.0060},
            permissions=['geolocation'],
        )
        
        # Anti-detection scripts
        await context.add_init_script("""
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            
            // Mock languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            
            // Mock chrome object
            window.chrome = {
                runtime: {}
            };
        """)
        
        return context
    
    async def _fetch_with_playwright(self, url: str, wait_for_pricing: bool = True) -> Optional[str]:
        """
        Fetch page using Playwright with full JavaScript rendering
        
        Args:
            url: URL to fetch
            wait_for_pricing: Wait for pricing grid to load
            
        Returns:
            HTML content or None if failed
        """
        if not PLAYWRIGHT_AVAILABLE:
            logger.error("Playwright not available")
            return None
        
        logger.info(f"[Playwright] Fetching: {url}")
        
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ]
                )
                
                context = await self._create_stealth_context(browser)
                await guard_browser_context(context)
                page = await context.new_page()
                
                # Navigate to page
                response = await page.goto(url, wait_until='domcontentloaded', timeout=30000)
                
                if response and response.status >= 400:
                    logger.warning(f"[Playwright] Got status {response.status} for {url}")
                    await browser.close()
                    return None
                
                # Wait for network to settle
                await page.wait_for_load_state('networkidle', timeout=15000)
                
                # Additional wait for JavaScript rendering
                await asyncio.sleep(2)
                
                # Wait for pricing grid if this is a property page
                if wait_for_pricing:
                    try:
                        # Try multiple selectors for pricing section
                        pricing_selectors = [
                            '#pricingView',
                            '.pricingGridContainer',
                            '[data-tab-content-id="all"]',
                            '.availabilityContainer',
                            '.priceGridModelWrapper',
                        ]
                        
                        for selector in pricing_selectors:
                            try:
                                await page.wait_for_selector(selector, timeout=5000)
                                logger.info(f"[Playwright] Found pricing section: {selector}")
                                break
                            except PlaywrightTimeout:
                                continue
                        
                        # Scroll to trigger lazy loading
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                        await asyncio.sleep(1)
                        
                        # Click "View All" if present to expand pricing
                        try:
                            view_all_btn = await page.query_selector('button:has-text("View All")')
                            if view_all_btn:
                                await view_all_btn.click()
                                await asyncio.sleep(1)
                        except Exception:
                            pass
                        
                    except Exception as e:
                        logger.debug(f"[Playwright] Pricing wait issue: {e}")
                
                # Get final HTML
                html = await page.content()
                
                await browser.close()
                
                return html
                
        except Exception as e:
            logger.error(f"[Playwright] Error fetching {url}: {e}")
            return None
    
    async def _search_with_playwright(self, location: str, max_results: int = 50) -> List[Dict[str, Any]]:
        """
        Search apartments.com using Playwright
        
        Args:
            location: City-state slug (e.g., "dallas-tx")
            max_results: Maximum results to return
            
        Returns:
            List of property info dicts with URLs
        """
        if not PLAYWRIGHT_AVAILABLE:
            return []
        
        results = []
        page_num = 1
        
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
                )
                
                context = await self._create_stealth_context(browser)
                await guard_browser_context(context)
                page = await context.new_page()
                
                while len(results) < max_results and page_num <= 5:
                    url = self._build_search_url(location, page_num)
                    logger.info(f"[Playwright] Searching page {page_num}: {url}")
                    
                    await page.goto(url, wait_until='networkidle', timeout=30000)
                    await asyncio.sleep(2)
                    
                    # Wait for property cards
                    try:
                        await page.wait_for_selector('article.placard', timeout=10000)
                    except PlaywrightTimeout:
                        logger.warning(f"No property cards found on page {page_num}")
                        break
                    
                    # Extract property cards
                    cards = await page.query_selector_all('article.placard')
                    
                    if not cards:
                        break
                    
                    for card in cards:
                        if len(results) >= max_results:
                            break
                        
                        try:
                            # Get link
                            link = await card.query_selector('a.property-link')
                            href = await link.get_attribute('href') if link else None
                            
                            if not href:
                                continue
                            
                            if not href.startswith('http'):
                                href = self.BASE_URL + href
                            
                            # Get name
                            name_elem = await card.query_selector('.js-placardTitle, .property-title')
                            name = await name_elem.inner_text() if name_elem else None
                            
                            # Get address
                            addr_elem = await card.query_selector('.property-address')
                            address = await addr_elem.inner_text() if addr_elem else None
                            
                            # Get price range
                            price_elem = await card.query_selector('.property-pricing')
                            price_text = await price_elem.inner_text() if price_elem else None
                            
                            results.append({
                                'url': href,
                                'name': self._clean_text(name),
                                'address': self._clean_text(address),
                                'price_text': self._clean_text(price_text)
                            })
                            
                        except Exception as e:
                            logger.debug(f"Error extracting card: {e}")
                            continue
                    
                    page_num += 1
                    await asyncio.sleep(self.MIN_DELAY)
                
                await browser.close()
                
        except Exception as e:
            logger.error(f"[Playwright] Search error: {e}")
        
        return results
    
    def _search_google_for_apartments_com(
        self, 
        property_name: str, 
        city: str, 
        state: str
    ) -> Optional[str]:
        """
        Search Google to find the apartments.com listing for a property.
        
        Args:
            property_name: Name of the property
            city: City name
            state: State abbreviation
            
        Returns:
            apartments.com URL if found, None otherwise
        """
        import httpx
        import time
        
        # Build search query
        query = f'{property_name} {city} {state} site:apartments.com'
        encoded_query = quote(query)
        
        # Google search URL
        search_url = f"https://www.google.com/search?q={encoded_query}&num=10"
        
        logger.info(f"[Google] Searching: {query}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        
        try:
            # Use a fresh client for Google
            with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                response = client.get(search_url, headers=headers)
                
                if response.status_code != 200:
                    logger.warning(f"[Google] Got status {response.status_code}")
                    return None
                
                html = response.text
                logger.info(f"[Google] Got response, length: {len(html)}")
                
                # Parse the HTML to find apartments.com links
                soup = self._parse_html(html)
                
                # Find all links in search results
                apartments_urls = []
                
                # Method 1: Look for direct links in search results
                for link in soup.find_all('a', href=True):
                    href = link.get('href', '')
                    
                    # Google wraps URLs in /url?q= format
                    if '/url?q=' in href:
                        # Extract the actual URL
                        actual_url = href.split('/url?q=')[1].split('&')[0]
                        if 'apartments.com' in actual_url and '/apartments/' not in actual_url:
                            # This is likely a property page, not a search page
                            apartments_urls.append(actual_url)
                    elif 'apartments.com' in href and href.startswith('http'):
                        apartments_urls.append(href)
                
                # Method 2: Look for apartments.com in cite elements (displayed URLs)
                for cite in soup.find_all('cite'):
                    text = cite.get_text()
                    if 'apartments.com' in text:
                        # Extract URL pattern from cite
                        url_match = re.search(r'(https?://www\.apartments\.com/[^\s<>"]+)', str(cite))
                        if url_match:
                            apartments_urls.append(url_match.group(1))
                
                # Method 3: Look in the raw HTML for apartments.com URLs
                url_pattern = r'https://www\.apartments\.com/([a-z0-9-]+)/([a-z0-9]+)/?'
                raw_matches = re.findall(url_pattern, html)
                for match in raw_matches:
                    url = f"https://www.apartments.com/{match[0]}/{match[1]}/"
                    apartments_urls.append(url)
                
                # Deduplicate and filter
                seen = set()
                unique_urls = []
                for url in apartments_urls:
                    # Clean URL
                    url = url.split('&')[0].split('%')[0]
                    if url not in seen and '/apartments/' not in url:
                        seen.add(url)
                        unique_urls.append(url)
                
                logger.info(f"[Google] Found {len(unique_urls)} apartments.com URLs")
                
                if unique_urls:
                    # Return the first (most relevant) result
                    best_url = unique_urls[0]
                    logger.info(f"[Google] Best match: {best_url}")
                    return best_url
                
                return None
                
        except Exception as e:
            logger.error(f"[Google] Search error: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"[Google] Traceback: {traceback.format_exc()}")
            return None
    
    async def _search_google_async(
        self, 
        property_name: str, 
        city: str, 
        state: str
    ) -> Optional[str]:
        """Async wrapper for Google search"""
        return await asyncio.to_thread(
            self._search_google_for_apartments_com,
            property_name,
            city,
            state
        )
    
    # =========================================================================
    # PARSING METHODS
    # =========================================================================
    
    def _parse_search_results(self, html: str) -> List[Dict[str, Any]]:
        """Parse search results page and extract property URLs"""
        soup = self._parse_html(html)
        results = []
        
        # Find property cards
        property_cards = soup.find_all('article', class_='placard')
        
        for card in property_cards:
            try:
                # Get listing URL
                link = card.find('a', class_='property-link')
                if not link or not link.get('href'):
                    continue
                
                url = link.get('href')
                if not url.startswith('http'):
                    url = self.BASE_URL + url
                
                # Get basic info from card
                name_elem = card.find('span', class_='js-placardTitle') or card.find(class_='property-title')
                name = self._clean_text(name_elem.text) if name_elem else None
                
                address_elem = card.find('div', class_='property-address')
                address = self._clean_text(address_elem.text) if address_elem else None
                
                # Get price range
                price_elem = card.find('p', class_='property-pricing')
                price_text = self._clean_text(price_elem.text) if price_elem else None
                
                # Get bed/bath info
                beds_elem = card.find('p', class_='property-beds')
                beds_text = self._clean_text(beds_elem.text) if beds_elem else None
                
                results.append({
                    'url': url,
                    'name': name,
                    'address': address,
                    'price_text': price_text,
                    'beds_text': beds_text
                })
                
            except Exception as e:
                logger.warning(f"Error parsing property card: {e}")
                continue
        
        return results
    
    def _parse_property_page(self, html: str, url: str) -> Optional[ScrapedProperty]:
        """Parse a single property page"""
        soup = self._parse_html(html)
        
        try:
            # Extract JSON-LD data (most reliable)
            json_ld_data = self._extract_json_ld(soup)
            apartment_data = None
            
            for item in json_ld_data:
                if item.get('@type') == 'ApartmentComplex':
                    apartment_data = item
                    break
            
            if not apartment_data:
                # Fallback to HTML parsing
                return self._parse_property_html(soup, url)
            
            # Parse from JSON-LD
            name = apartment_data.get('name', '')
            
            # Address
            address_data = apartment_data.get('address', {})
            street = address_data.get('streetAddress', '')
            city = address_data.get('addressLocality', '')
            state = address_data.get('addressRegion', '')
            zip_code = address_data.get('postalCode', '')
            
            # Coordinates
            geo = apartment_data.get('geo', {})
            lat = geo.get('latitude')
            lng = geo.get('longitude')
            
            # Contact
            phone = apartment_data.get('telephone')
            website = apartment_data.get('url')
            
            # Photos
            photos = []
            photo_data = apartment_data.get('photo', [])
            if isinstance(photo_data, list):
                for p in photo_data[:10]:
                    if isinstance(p, dict):
                        photos.append(p.get('contentUrl', ''))
                    elif isinstance(p, str):
                        photos.append(p)
            
            # Parse units from HTML (not usually in JSON-LD)
            units = self._parse_units(soup)
            
            # Parse amenities
            amenities = self._parse_amenities(soup)
            
            # Year built and unit count
            year_built = None
            units_count = None
            
            # Try multiple selectors for property details
            details_sections = [
                soup.find('div', class_='propertyFeatures'),
                soup.find('section', class_='aboutSection'),
                soup.find('div', class_='aboutSection'),
            ]
            
            for details_section in details_sections:
                if details_section:
                    text = details_section.text
                    
                    if not year_built:
                        year_match = re.search(r'Built in (\d{4})', text)
                        if year_match:
                            year_built = int(year_match.group(1))
                    
                    if not units_count:
                        units_match = re.search(r'(\d+)\s*(?:Units?|Apartments?)', text, re.I)
                        if units_match:
                            units_count = int(units_match.group(1))
            
            return ScrapedProperty(
                name=name,
                address=street,
                city=city,
                state=state,
                zip_code=zip_code,
                latitude=lat,
                longitude=lng,
                website_url=website,
                phone=phone,
                units_count=units_count,
                year_built=year_built,
                amenities=amenities,
                photos=photos,
                units=units,
                source=self.source,
                source_url=url
            )
            
        except Exception as e:
            logger.error(f"Error parsing property page {url}: {e}")
            return None
    
    def _parse_property_html(self, soup, url: str) -> Optional[ScrapedProperty]:
        """Fallback HTML parsing when JSON-LD is not available"""
        try:
            # Property name - try multiple selectors
            name_selectors = [
                ('h1', 'propertyName'),
                ('h1', 'js-propertyName'),
                ('h1', None),
            ]
            
            name = "Unknown Property"
            for tag, class_name in name_selectors:
                if class_name:
                    name_elem = soup.find(tag, class_=class_name)
                else:
                    name_elem = soup.find(tag)
                if name_elem:
                    name = self._clean_text(name_elem.text)
                    break
            
            # Address
            address_selectors = [
                ('div', 'propertyAddressContainer'),
                ('div', 'propertyAddress'),
                ('span', 'delivery-address'),
            ]
            
            full_address = ""
            for tag, class_name in address_selectors:
                addr_elem = soup.find(tag, class_=class_name)
                if addr_elem:
                    full_address = self._clean_text(addr_elem.text)
                    break
            
            # Parse address components
            address_parts = full_address.split(',')
            street = address_parts[0].strip() if len(address_parts) > 0 else ""
            city = address_parts[1].strip() if len(address_parts) > 1 else ""
            state_zip = address_parts[2].strip() if len(address_parts) > 2 else ""
            
            state = ""
            zip_code = ""
            state_zip_match = re.match(r'([A-Z]{2})\s*(\d{5})?', state_zip)
            if state_zip_match:
                state = state_zip_match.group(1)
                zip_code = state_zip_match.group(2) or ""
            
            # Phone
            phone_elem = soup.find('a', class_='phoneNumber') or soup.find('a', href=re.compile(r'^tel:'))
            phone = self._clean_text(phone_elem.text) if phone_elem else None
            
            # Units and amenities
            units = self._parse_units(soup)
            amenities = self._parse_amenities(soup)
            
            return ScrapedProperty(
                name=name,
                address=street,
                city=city,
                state=state,
                zip_code=zip_code,
                phone=phone,
                amenities=amenities,
                units=units,
                source=self.source,
                source_url=url
            )
            
        except Exception as e:
            logger.error(f"Error in HTML fallback parsing: {e}")
            return None
    
    def _parse_units(self, soup) -> List[ScrapedUnit]:
        """Parse unit/floor plan information from the pricing grid"""
        units = []
        
        # Look for pricing grid or floor plan section - multiple possible selectors
        pricing_sections = [
            soup.find('section', {'id': 'pricingView'}),
            soup.find('div', class_='pricingGridContainer'),
            soup.find('div', class_='priceGridModelWrapper'),
            soup.find('section', class_='availabilitySection'),
            soup.find('div', {'data-tab-content-id': 'all'}),
        ]
        
        pricing_section = None
        for section in pricing_sections:
            if section:
                pricing_section = section
                break
        
        if not pricing_section:
            logger.debug("No pricing section found")
            return units
        
        # Find all unit/model rows - multiple possible patterns
        unit_row_patterns = [
            re.compile(r'pricingGridItem'),
            re.compile(r'availableRow'),
            re.compile(r'modelContainer'),
            re.compile(r'pricingGridRow'),
            re.compile(r'priceGridModel'),
        ]
        
        unit_rows = []
        for pattern in unit_row_patterns:
            unit_rows = pricing_section.find_all(['div', 'li', 'tr', 'article'], class_=pattern)
            if unit_rows:
                break
        
        # Also try data attributes
        if not unit_rows:
            unit_rows = pricing_section.find_all(['div', 'li'], attrs={'data-beds': True})
        
        for row in unit_rows:
            try:
                # Bedrooms - try multiple approaches
                bedrooms = 1
                
                # From data attribute
                beds_data = row.get('data-beds')
                if beds_data and beds_data.isdigit():
                    bedrooms = int(beds_data)
                else:
                    # From text
                    bed_elem = row.find(class_=re.compile(r'bedRange|beds|modelBedroom'))
                    bed_text = self._clean_text(bed_elem.text) if bed_elem else ""
                    
                    if 'studio' in bed_text.lower():
                        bedrooms = 0
                    else:
                        bed_match = re.search(r'(\d+)', bed_text)
                        bedrooms = int(bed_match.group(1)) if bed_match else 1
                
                # Bathrooms
                bathrooms = 1.0
                bath_elem = row.find(class_=re.compile(r'bathRange|baths|modelBathroom'))
                if bath_elem:
                    bath_text = self._clean_text(bath_elem.text)
                    bath_match = re.search(r'(\d+(?:\.\d+)?)', bath_text)
                    bathrooms = float(bath_match.group(1)) if bath_match else 1.0
                
                # Square footage
                sqft_elem = row.find(class_=re.compile(r'sqftColumn|sqft|modelSqFt'))
                sqft_text = self._clean_text(sqft_elem.text) if sqft_elem else ""
                
                sqft_range = re.findall(r'(\d+,?\d*)', sqft_text.replace(',', ''))
                sqft_min = int(sqft_range[0]) if sqft_range else None
                sqft_max = int(sqft_range[-1]) if sqft_range else sqft_min
                
                # Price - try multiple selectors
                price_selectors = [
                    re.compile(r'pricingColumn'),
                    re.compile(r'rentLabel'),
                    re.compile(r'rent'),
                    re.compile(r'modelRent'),
                    re.compile(r'price'),
                ]
                
                price_text = ""
                for selector in price_selectors:
                    price_elem = row.find(class_=selector)
                    if price_elem:
                        price_text = self._clean_text(price_elem.text)
                        if '$' in price_text or any(c.isdigit() for c in price_text):
                            break
                
                price_range = re.findall(r'\$?([\d,]+)', price_text)
                rent_min = self._parse_price(price_range[0]) if price_range else None
                rent_max = self._parse_price(price_range[-1]) if len(price_range) > 1 else rent_min
                
                # Availability count
                avail_selectors = [
                    re.compile(r'availableNow'),
                    re.compile(r'available'),
                    re.compile(r'unitsAvailable'),
                ]
                
                available = 0
                for selector in avail_selectors:
                    avail_elem = row.find(class_=selector)
                    if avail_elem:
                        avail_text = self._clean_text(avail_elem.text)
                        avail_match = re.search(r'(\d+)', avail_text)
                        available = int(avail_match.group(1)) if avail_match else (1 if 'available' in avail_text.lower() else 0)
                        break
                
                # Specials/Promotions
                special_elem = row.find(class_=re.compile(r'special|promo|concession'))
                special = self._clean_text(special_elem.text) if special_elem else None
                
                # Only add if we have meaningful data
                if rent_min or sqft_min or available > 0:
                    units.append(ScrapedUnit(
                        unit_type=self._normalize_unit_type(bedrooms),
                        bedrooms=bedrooms,
                        bathrooms=bathrooms,
                        sqft_min=sqft_min,
                        sqft_max=sqft_max,
                        rent_min=rent_min,
                        rent_max=rent_max,
                        available_count=available,
                        move_in_specials=special
                    ))
                
            except Exception as e:
                logger.warning(f"Error parsing unit row: {e}")
                continue
        
        # Deduplicate units by type
        seen_types = {}
        unique_units = []
        for unit in units:
            key = f"{unit.bedrooms}_{unit.bathrooms}"
            if key not in seen_types:
                seen_types[key] = unit
                unique_units.append(unit)
            else:
                # Merge: keep the one with more data
                existing = seen_types[key]
                if unit.rent_min and not existing.rent_min:
                    seen_types[key] = unit
                    unique_units = [u for u in unique_units if f"{u.bedrooms}_{u.bathrooms}" != key]
                    unique_units.append(unit)
        
        logger.info(f"Parsed {len(unique_units)} unit types")
        return unique_units
    
    def _parse_amenities(self, soup) -> List[str]:
        """Parse amenities list"""
        amenities = []
        
        # Look for amenities section - multiple possible selectors
        amenities_sections = [
            soup.find('section', {'id': 'amenitiesSection'}),
            soup.find('div', class_='amenitiesSection'),
            soup.find('section', class_='amenities'),
            soup.find('div', {'data-section': 'amenities'}),
        ]
        
        amenities_section = None
        for section in amenities_sections:
            if section:
                amenities_section = section
                break
        
        if not amenities_section:
            return amenities
        
        # Find all amenity items
        amenity_selectors = [
            ('span', 'amenityLabel'),
            ('li', None),
            ('span', 'amenity'),
            ('div', 'amenityCard'),
        ]
        
        for tag, class_name in amenity_selectors:
            if class_name:
                items = amenities_section.find_all(tag, class_=class_name)
            else:
                items = amenities_section.find_all(tag)
            
            for item in items:
                text = self._clean_text(item.text)
                if text and 5 < len(text) < 50:  # Filter out junk
                    amenities.append(text)
        
        return list(set(amenities))[:30]  # Dedupe and limit
    
    # =========================================================================
    # STATE MAPPING
    # =========================================================================
    
    STATE_ABBREV = {
        'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar',
        'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de',
        'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id',
        'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks',
        'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
        'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms',
        'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv',
        'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
        'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok',
        'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
        'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut',
        'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv',
        'wisconsin': 'wi', 'wyoming': 'wy', 'district of columbia': 'dc'
    }
    
    def _normalize_state(self, state: str) -> str:
        """Convert full state name to abbreviation"""
        state_lower = state.lower().strip()
        if len(state_lower) == 2:
            return state_lower
        return self.STATE_ABBREV.get(state_lower, state_lower)
    
    # =========================================================================
    # PUBLIC METHODS
    # =========================================================================
    
    def search_by_location(
        self, 
        city: str, 
        state: str, 
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties by city/state
        
        Args:
            city: City name
            state: State name or abbreviation
            radius_miles: Search radius (not directly supported, uses city search)
            max_results: Maximum results to return
            
        Returns:
            List of scraped properties
        """
        city_slug = city.lower().strip().replace(' ', '-')
        state_abbrev = self._normalize_state(state)
        location = f"{city_slug}-{state_abbrev}"
        
        logger.info(f"Searching apartments.com for: {location}")
        
        if self.use_playwright:
            return self._search_by_location_playwright(location, max_results)
        else:
            return self._search_by_location_httpx(location, max_results)
    
    def _search_by_location_playwright(self, location: str, max_results: int) -> List[ScrapedProperty]:
        """Search using Playwright for full JS rendering"""
        # Run async search in sync context
        search_results = asyncio.run(self._search_with_playwright(location, max_results))
        
        if not search_results:
            logger.warning("No search results found")
            return []
        
        properties = []
        
        for result in search_results:
            if len(properties) >= max_results:
                break
            
            property_data = self.scrape_property(result['url'])
            if property_data:
                properties.append(property_data)
        
        return properties
    
    def _search_by_location_httpx(self, location: str, max_results: int) -> List[ScrapedProperty]:
        """Search using httpx (limited, may be blocked)"""
        properties = []
        page = 1
        
        while len(properties) < max_results:
            try:
                url = self._build_search_url(location, page)
                html = self._fetch(url)
                
                results = self._parse_search_results(html)
                
                if not results:
                    break
                
                for result in results:
                    if len(properties) >= max_results:
                        break
                    
                    property_data = self.scrape_property(result['url'])
                    if property_data:
                        properties.append(property_data)
                
                page += 1
                
                if page > 10:
                    break
                    
            except Exception as e:
                logger.error(f"Error in search page {page}: {e}")
                break
        
        return properties
    
    def search_by_coordinates(
        self,
        lat: float,
        lng: float,
        radius_miles: int = 5,
        max_results: int = 50
    ) -> List[ScrapedProperty]:
        """
        Search for properties near coordinates
        
        Note: Apartments.com doesn't directly support coordinate search,
        so this requires reverse geocoding to get city/state.
        """
        logger.warning("Coordinate search requires reverse geocoding - falling back to empty results")
        logger.info("Use search_by_location with city/state instead")
        return []
    
    def scrape_property(self, url: str) -> Optional[ScrapedProperty]:
        """
        Scrape a single property listing
        
        Args:
            url: Apartments.com property URL
            
        Returns:
            ScrapedProperty or None if failed
        """
        logger.info(f"Scraping property: {url}")
        
        html = None
        
        # Try Playwright first (preferred)
        if self.use_playwright:
            html = asyncio.run(self._fetch_with_playwright(url, wait_for_pricing=True))
        
        # Fallback to httpx if Playwright fails or unavailable
        if not html:
            try:
                html = self._fetch(url)
            except Exception as e:
                logger.error(f"httpx fetch failed: {e}")
                return None
        
        if not html:
            logger.error(f"Failed to fetch {url}")
            return None
        
        return self._parse_property_page(html, url)
    
    async def scrape_property_async(self, url: str) -> Optional[ScrapedProperty]:
        """
        Async version of scrape_property for use in async contexts
        
        Args:
            url: Apartments.com property URL
            
        Returns:
            ScrapedProperty or None if failed
        """
        logger.info(f"[Async] Scraping property: {url}")
        
        html = await self._fetch_with_playwright(url, wait_for_pricing=True)
        
        if not html:
            logger.error(f"Failed to fetch {url}")
            return None
        
        return self._parse_property_page(html, url)
    
    def refresh_pricing(self, competitor_url: str) -> Optional[Dict[str, Any]]:
        """
        Quick refresh of just pricing data for an existing competitor
        
        Args:
            competitor_url: Apartments.com listing URL
            
        Returns:
            Dict with units and specials data, or None if failed
        """
        property_data = self.scrape_property(competitor_url)
        
        if not property_data:
            return None
        
        return {
            'units': [
                {
                    'unit_type': u.unit_type,
                    'bedrooms': u.bedrooms,
                    'bathrooms': u.bathrooms,
                    'sqft_min': u.sqft_min,
                    'sqft_max': u.sqft_max,
                    'rent_min': u.rent_min,
                    'rent_max': u.rent_max,
                    'available_count': u.available_count,
                    'move_in_specials': u.move_in_specials
                }
                for u in property_data.units
            ],
            'amenities': property_data.amenities,
            'scraped_at': property_data.scraped_at
        }


    async def search_for_property(
        self,
        property_name: str,
        city: str,
        state: str,
        address: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Search for a property's apartments.com listing using Google search.
        This is more reliable than searching apartments.com directly.
        
        Args:
            property_name: Name of the property to find
            city: City name
            state: State name or abbreviation
            address: Optional street address for better matching
            
        Returns:
            Dict with url and match_score if found, None otherwise
        """
        state_abbrev = self._normalize_state(state)
        
        logger.info(f"Searching for apartments.com listing: {property_name} in {city}, {state_abbrev}")
        
        try:
            # Use Google search to find the apartments.com listing
            apartments_url = await self._search_google_async(
                property_name=property_name,
                city=city,
                state=state_abbrev
            )
            
            if apartments_url:
                logger.info(f"Found apartments.com URL via Google: {apartments_url}")
                return {
                    'url': apartments_url,
                    'name': property_name,
                    'address': address,
                    'match_score': 100.0  # High confidence since Google found it
                }
            
            # If exact name didn't work, try variations
            # Remove common suffixes like "Apartments", "Residences", etc.
            name_variations = [property_name]
            for suffix in [' Apartments', ' Apartment', ' Residences', ' Living', ' Homes']:
                if property_name.endswith(suffix):
                    name_variations.append(property_name[:-len(suffix)])
                elif not property_name.endswith(suffix):
                    name_variations.append(property_name + suffix)
            
            # Try first variation that's different from original
            for variant in name_variations[1:3]:  # Limit to 2 more tries
                logger.info(f"Trying variation: {variant}")
                apartments_url = await self._search_google_async(
                    property_name=variant,
                    city=city,
                    state=state_abbrev
                )
                
                if apartments_url:
                    logger.info(f"Found apartments.com URL via Google (variant): {apartments_url}")
                    return {
                        'url': apartments_url,
                        'name': property_name,
                        'address': address,
                        'match_score': 80.0  # Slightly lower confidence for variant match
                    }
            
            logger.info(f"No apartments.com listing found for '{property_name}'")
            return None
            
        except Exception as e:
            logger.error(f"Error searching for property: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None
    
    def search_for_property_sync(
        self,
        property_name: str,
        city: str,
        state: str,
        address: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Synchronous wrapper for search_for_property"""
        return asyncio.run(self.search_for_property(property_name, city, state, address))


# CLI for testing
if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python apartments_com.py <url_or_city_state>")
        print("Examples:")
        print("  python apartments_com.py 'https://www.apartments.com/...'")
        print("  python apartments_com.py 'dallas tx'")
        sys.exit(1)
    
    arg = sys.argv[1]
    scraper = ApartmentsComScraper(use_playwright=True)
    
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
