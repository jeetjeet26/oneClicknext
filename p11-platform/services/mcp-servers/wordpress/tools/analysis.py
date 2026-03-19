"""
WordPress Site Analysis
Analyzes existing WordPress sites to learn structure and design patterns
"""

import requests
from bs4 import BeautifulSoup, Comment
from typing import Dict, Any, List
from urllib.parse import urljoin
import re

async def analyze_existing_site(url: str) -> Dict[str, Any]:
    """
    Analyze existing WordPress site structure and design.
    Agents use this to learn from optional reference sites.
    """
    
    # Fetch site HTML
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        html = response.text
    except Exception as e:
        return {'error': f'Failed to fetch site: {str(e)}'}
    
    # Parse HTML
    soup = BeautifulSoup(html, 'html.parser')
    
    # Detect WordPress and theme
    theme_info = detect_theme(soup)
    
    # Extract Gutenberg blocks
    blocks_used = extract_blocks(html, soup)
    
    # Analyze design patterns
    design_analysis = {
        'hero_style': analyze_hero_section(soup),
        'color_palette': extract_colors(soup, html),
        'typography': extract_typography(soup),
        'layout_patterns': detect_layout_patterns(soup),
        'cta_strategy': analyze_ctas(soup),
        'photo_strategy': analyze_photos(soup)
    }
    
    # Architectural patterns
    architectural_patterns = {
        'sections_count': len(soup.find_all(['section', 'div[class*="section"]'])),
        'navigation_style': analyze_navigation(soup),
        'cta_prominence': rate_cta_prominence(soup),
        'content_density': calculate_content_density(soup),
        'mobile_approach': detect_mobile_strategy(soup)
    }
    
    # Generate insights for agents
    insights_for_agents = generate_agent_insights(
        design_analysis,
        architectural_patterns,
        blocks_used
    )
    
    return {
        'url': url,
        'detected_theme': theme_info['name'],
        'detected_version': theme_info['version'],
        'blocks_used': blocks_used,
        'design_analysis': design_analysis,
        'architectural_patterns': architectural_patterns,
        'insights_for_agents': insights_for_agents,
        'analyzed_at': datetime.utcnow().isoformat()
    }

# === ANALYSIS FUNCTIONS ===

def detect_theme(soup: BeautifulSoup) -> Dict[str, str]:
    """Detect WordPress theme from HTML"""
    
    # Check for theme stylesheet link
    theme_link = soup.find('link', {'rel': 'stylesheet', 'id': 'theme-css'})
    if theme_link and theme_link.get('href'):
        href = theme_link['href']
        match = re.search(r'/themes/([^/]+)/', href)
        if match:
            return {'name': match.group(1), 'version': 'unknown'}
    
    # Check for Collection theme specific classes
    if soup.find(class_=re.compile(r'collection-')):
        return {'name': 'collection', 'version': '2.x'}
    
    return {'name': 'unknown', 'version': 'unknown'}

def extract_blocks(html: str, soup: BeautifulSoup) -> List[Dict[str, Any]]:
    """Extract Gutenberg/ACF blocks from HTML comments"""
    
    blocks = []
    block_comments = re.findall(r'<!-- wp:(\S+)(.*?)-->', html)
    
    for i, (block_name, block_attrs) in enumerate(block_comments):
        block_info = {
            'block': block_name,
            'order': i + 1
        }
        
        # Try to extract variant from attrs
        if 'className' in block_attrs:
            class_match = re.search(r'"className":"([^"]+)"', block_attrs)
            if class_match:
                block_info['classes'] = class_match.group(1).split()
        
        blocks.append(block_info)
    
    return blocks

def analyze_hero_section(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze hero section characteristics"""
    
    # Find hero (usually first section or class containing 'hero')
    hero = soup.find(['section', 'div'], class_=re.compile(r'hero|top-slides|banner'))
    
    if not hero:
        return {'style': 'unknown'}
    
    # Analyze characteristics
    has_overlay = bool(hero.find(class_=re.compile(r'overlay|gradient')))
    is_fullwidth = 'full' in str(hero.get('class', [])).lower()
    has_video = bool(hero.find('video'))
    
    # Get text content
    heading = hero.find(['h1', 'h2'])
    heading_text = heading.get_text(strip=True) if heading else ''
    
    return {
        'style': 'fullwidth' if is_fullwidth else 'contained',
        'has_overlay': has_overlay,
        'has_video': has_video,
        'heading': heading_text,
        'heading_style': 'poetic' if len(heading_text.split()) > 5 else 'direct'
    }

def extract_colors(soup: BeautifulSoup, html: str) -> Dict[str, str]:
    """Extract color palette from inline styles and CSS"""
    
    colors = {}
    
    # Find inline styles
    style_tags = soup.find_all('style')
    for style in style_tags:
        # Extract hex colors
        hex_colors = re.findall(r'#([0-9A-Fa-f]{6})', style.string or '')
        for color in hex_colors[:3]:  # Top 3
            colors[f'color_{len(colors)}'] = f'#{color}'
    
    # Extract from CSS variables
    css_var_match = re.search(r'--primary[^:]*:\s*([^;]+)', html)
    if css_var_match:
        colors['primary'] = css_var_match.group(1).strip()
    
    return colors or {'primary': '#4F46E5', 'secondary': '#10B981'}

def extract_typography(soup: BeautifulSoup) -> Dict[str, Any]:
    """Extract typography patterns"""
    
    # Find font families used
    fonts = set()
    
    # Check link tags for Google Fonts
    font_links = soup.find_all('link', href=re.compile(r'fonts\.googleapis'))
    for link in font_links:
        href = link.get('href', '')
        font_match = re.search(r'family=([^:&]+)', href)
        if font_match:
            fonts.add(font_match.group(1).replace('+', ' '))
    
    # Analyze heading sizes
    h1 = soup.find('h1')
    h1_style = h1.get('style', '') if h1 else ''
    
    return {
        'fonts': list(fonts) or ['Inter', 'System'],
        'heading_scale': 'luxury' if 'rem' in h1_style and '3rem' in h1_style else 'balanced'
    }

def detect_layout_patterns(soup: BeautifulSoup) -> List[str]:
    """Detect common layout patterns"""
    
    patterns = []
    
    # Grid layouts
    if soup.find(class_=re.compile(r'grid|columns')):
        patterns.append('grid-layout')
    
    # Masonry
    if soup.find(class_=re.compile(r'masonry')):
        patterns.append('masonry')
    
    # Full-width sections
    if soup.find(class_=re.compile(r'full-width|full-screen')):
        patterns.append('full-width-sections')
    
    # Two-column
    if soup.find(class_=re.compile(r'two-col|split')):
        patterns.append('split-sections')
    
    return patterns

def analyze_ctas(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze call-to-action strategy"""
    
    # Find all CTAs
    ctas = soup.find_all(['a', 'button'], class_=re.compile(r'cta|button|btn'))
    
    # Analyze prominence
    above_fold_ctas = []
    sticky_ctas = []
    
    for cta in ctas:
        text = cta.get_text(strip=True)
        if not text:
            continue
        
        # Check if sticky
        style = cta.get('style', '')
        classes = cta.get('class', [])
        if 'fixed' in style or 'sticky' in style or any('sticky' in c for c in classes):
            sticky_ctas.append(text)
        
        # Check if in first 1000 chars (rough above-fold check)
        if len(str(soup)[:soup.__str__().find(str(cta))]) < 2000:
            above_fold_ctas.append(text)
    
    return {
        'total_ctas': len(ctas),
        'above_fold': above_fold_ctas[:3],
        'sticky_ctas': sticky_ctas,
        'primary_cta': above_fold_ctas[0] if above_fold_ctas else None,
        'strategy': 'aggressive' if len(sticky_ctas) > 0 else 'balanced'
    }

def analyze_photos(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze photography approach"""
    
    images = soup.find_all('img')
    
    # Count images by location
    hero_images = len(soup.find_all('img', class_=re.compile(r'hero|banner')))
    gallery_images = len(soup.find_all('img', class_=re.compile(r'gallery')))
    
    # Check for people in alt text (rough lifestyle indicator)
    lifestyle_indicators = ['people', 'resident', 'enjoying', 'lifestyle', 'community']
    lifestyle_count = sum(
        1 for img in images 
        if any(word in img.get('alt', '').lower() for word in lifestyle_indicators)
    )
    
    return {
        'total_images': len(images),
        'hero_images': hero_images,
        'gallery_images': gallery_images,
        'lifestyle_focus': lifestyle_count > len(images) * 0.3,
        'lifestyle_ratio': lifestyle_count / len(images) if images else 0
    }

def analyze_navigation(soup: BeautifulSoup) -> str:
    """Analyze navigation style"""
    
    nav = soup.find('nav')
    if not nav:
        return 'unknown'
    
    nav_items = nav.find_all(['a', 'li'])
    
    if len(nav_items) > 8:
        return 'mega-menu'
    elif len(nav_items) < 5:
        return 'minimal'
    else:
        return 'primary'

def rate_cta_prominence(soup: BeautifulSoup) -> str:
    """Rate how prominent CTAs are"""
    
    ctas = soup.find_all(class_=re.compile(r'cta|button'))
    
    # Check size, position, color contrast
    prominent = sum(
        1 for cta in ctas 
        if 'large' in str(cta.get('class', [])) or 'primary' in str(cta.get('class', []))
    )
    
    if prominent > len(ctas) * 0.6:
        return 'high'
    elif prominent > len(ctas) * 0.3:
        return 'medium'
    else:
        return 'low'

def calculate_content_density(soup: BeautifulSoup) -> str:
    """Calculate content density (whitespace vs content)"""
    
    # Rough calculation: text length vs HTML length
    text_length = len(soup.get_text())
    html_length = len(str(soup))
    
    ratio = text_length / html_length if html_length > 0 else 0
    
    if ratio < 0.1:
        return 'luxury'  # Lots of whitespace
    elif ratio < 0.2:
        return 'balanced'
    else:
        return 'dense'

def detect_mobile_strategy(soup: BeautifulSoup) -> str:
    """Detect mobile responsiveness approach"""
    
    # Check for mobile-specific classes
    if soup.find(class_=re.compile(r'mobile-hide|desktop-only')):
        return 'adaptive'
    
    # Check viewport meta
    viewport = soup.find('meta', {'name': 'viewport'})
    if viewport:
        return 'responsive'
    
    return 'unknown'

def generate_agent_insights(
    design_analysis: Dict[str, Any],
    architectural_patterns: Dict[str, Any],
    blocks_used: List[Dict[str, Any]]
) -> Dict[str, str]:
    """Generate actionable insights for each agent"""
    
    insights = {}
    
    # Architecture Agent insights
    blocks_summary = ', '.join([b['block'] for b in blocks_used[:5]])
    insights['architecture_agent'] = (
        f"Use {architectural_patterns.get('sections_count', 0)} sections. "
        f"Common blocks: {blocks_summary}. "
        f"Navigation: {architectural_patterns.get('navigation_style', 'unknown')}."
    )
    
    # Design Agent insights
    insights['design_agent'] = (
        f"Spacing: {architectural_patterns.get('content_density', 'balanced')}. "
        f"Hero: {design_analysis['hero_style'].get('style', 'unknown')}. "
        f"Color palette: {', '.join(design_analysis['color_palette'].values())}."
    )
    
    # Photo Agent insights
    photo_strat = design_analysis['photo_strategy']
    insights['photo_agent'] = (
        f"Lifestyle ratio: {photo_strat.get('lifestyle_ratio', 0):.0%}. "
        f"Focus on {'lifestyle shots' if photo_strat.get('lifestyle_focus') else 'amenity shots'}."
    )
    
    # Content Agent insights
    cta_strat = design_analysis['cta_strategy']
    insights['content_agent'] = (
        f"CTA strategy: {cta_strat.get('strategy', 'balanced')}. "
        f"Primary CTA: '{cta_strat.get('primary_cta', 'unknown')}'."
    )
    
    return insights










