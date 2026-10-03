"""
WordPress Abilities API Integration
Discovers what WordPress can actually do (blocks, capabilities, theme features)
"""

import requests
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import json

from ..config import get_template_credentials, CACHE_DURATION_SECONDS
from shared.supabase_client import get_supabase as get_supabase_client

# In-memory cache (in production, use Redis)
_capabilities_cache: Dict[str, tuple[Dict[str, Any], datetime]] = {}

async def get_wordpress_abilities(
    instance_id: str,
    context: str = 'site_generation'
) -> Dict[str, Any]:
    """
    Query WordPress Abilities API to discover capabilities.
    Uses WordPress 6.9+ Abilities API for context-aware permissions.
    """
    
    # Check cache first
    cache_key = f"{instance_id}:{context}"
    if cache_key in _capabilities_cache:
        cached_data, cached_time = _capabilities_cache[cache_key]
        if datetime.now() - cached_time < timedelta(seconds=CACHE_DURATION_SECONDS):
            return cached_data
    
    # Get instance credentials
    if instance_id == 'template-collection-theme':
        creds = get_template_credentials()
        wp_url = creds['url']
        auth = (creds['username'], creds['password'])
    else:
        # Get from database
        instance = await get_instance_from_db(instance_id)
        wp_url = instance['url']
        auth = (instance['credentials']['username'], instance['credentials']['password'])
    
    # Call WordPress Abilities API
    try:
        response = requests.get(
            f"{wp_url}/wp-json/wp/v2/abilities",
            params={'context': context},
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        abilities = response.json()
    except Exception as e:
        # Fallback: Construct from standard WordPress queries
        abilities = await construct_abilities_fallback(wp_url, auth)
    
    # Enhance with ACF block discovery
    acf_blocks = await discover_acf_blocks(wp_url, auth)
    
    # Get theme info
    theme_info = await get_theme_info(wp_url, auth)
    
    # Get plugin list
    plugins = await get_active_plugins(wp_url, auth)
    
    # Construct capabilities response
    capabilities = {
        'available_blocks': abilities.get('available_blocks', []) + acf_blocks,
        'theme': {
            'name': theme_info.get('name', 'unknown'),
            'version': theme_info.get('version', '0.0.0'),
            'supports': theme_info.get('supports', {})
        },
        'plugins': plugins,
        'capabilities': {
            'can_create_pages': abilities.get('can_create_pages', True),
            'can_upload_media': abilities.get('can_upload_media', True),
            'can_modify_theme': abilities.get('can_modify_theme', False),
            'can_install_plugins': abilities.get('can_install_plugins', False),
            'max_upload_size_mb': abilities.get('max_upload_size', 100)
        },
        'timestamp': datetime.utcnow().isoformat()
    }
    
    # Cache result
    _capabilities_cache[cache_key] = (capabilities, datetime.now())
    
    return capabilities

async def get_acf_block_schemas(
    instance_id: str,
    block_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get detailed ACF block field schemas.
    Returns field definitions, variants, CSS classes, examples.
    """
    
    # Get instance credentials
    if instance_id == 'template-collection-theme':
        creds = get_template_credentials()
        wp_url = creds['url']
        auth = (creds['username'], creds['password'])
    else:
        instance = await get_instance_from_db(instance_id)
        wp_url = instance['url']
        auth = (instance['credentials']['username'], instance['credentials']['password'])
    
    # Try custom SiteForge endpoint (if Collection theme has it)
    try:
        response = requests.get(
            f"{wp_url}/wp-json/siteforge/v1/acf-schemas",
            params={'block': block_name} if block_name else {},
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        return response.json()
    except Exception:
        # Fallback: Return hardcoded Collection theme schemas
        # (In production, these would be extracted from theme files)
        return get_collection_theme_schemas(block_name)

async def get_theme_design_tokens(instance_id: str) -> Dict[str, Any]:
    """
    Extract design tokens from WordPress theme.
    Returns colors, typography, spacing that theme supports.
    """
    
    if instance_id == 'template-collection-theme':
        creds = get_template_credentials()
        wp_url = creds['url']
        auth = (creds['username'], creds['password'])
    else:
        instance = await get_instance_from_db(instance_id)
        wp_url = instance['url']
        auth = (instance['credentials']['username'], instance['credentials']['password'])
    
    # Try custom endpoint
    try:
        response = requests.get(
            f"{wp_url}/wp-json/siteforge/v1/design-tokens",
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        return response.json()
    except Exception:
        # Fallback: Return Collection theme defaults
        return get_collection_design_tokens()

# === HELPER FUNCTIONS ===

async def discover_acf_blocks(wp_url: str, auth: tuple) -> List[str]:
    """Discover ACF block types available in theme"""
    try:
        # Query block types endpoint
        response = requests.get(
            f"{wp_url}/wp-json/wp/v2/block-types",
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        block_types = response.json()
        
        # Filter for ACF blocks
        acf_blocks = [bt['name'] for bt in block_types if bt['name'].startswith('acf/')]
        return acf_blocks
    except Exception:
        # Return known Collection theme blocks
        return [
            'acf/menu',
            'acf/top-slides',
            'acf/text-section',
            'acf/feature-section',
            'acf/image',
            'acf/links',
            'acf/content-grid',
            'acf/form',
            'acf/map',
            'acf/html-section',
            'acf/gallery',
            'acf/accordion-section',
            'acf/plans-availability',
            'acf/poi'
        ]

async def get_theme_info(wp_url: str, auth: tuple) -> Dict[str, Any]:
    """Get active theme information"""
    try:
        response = requests.get(
            f"{wp_url}/wp-json/wp/v2/themes",
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        themes = response.json()
        
        # Find active theme
        active = next((t for t in themes if t.get('status') == 'active'), None)
        if active:
            return {
                'name': active['stylesheet'],
                'version': active.get('version', '0.0.0'),
                'supports': active.get('theme_supports', {})
            }
    except Exception:
        pass
    
    return {'name': 'collection', 'version': '2.1.0', 'supports': {}}

async def get_active_plugins(wp_url: str, auth: tuple) -> List[str]:
    """Get list of active plugins"""
    try:
        response = requests.get(
            f"{wp_url}/wp-json/wp/v2/plugins",
            auth=auth,
            timeout=10
        )
        response.raise_for_status()
        plugins = response.json()
        
        return [p['plugin'] for p in plugins if p.get('status') == 'active']
    except Exception:
        return ['advanced-custom-fields-pro', 'yoast-seo']

async def construct_abilities_fallback(wp_url: str, auth: tuple) -> Dict[str, Any]:
    """Construct abilities from standard WP API if Abilities API unavailable"""
    return {
        'available_blocks': [],  # Will be populated by discover_acf_blocks
        'can_create_pages': True,
        'can_upload_media': True,
        'max_upload_size': 100
    }

async def get_instance_from_db(instance_id: str) -> Dict[str, Any]:
    """Get WordPress instance details from Supabase"""
    supabase = get_supabase_client()
    
    result = supabase.table('property_websites') \
        .select('wp_url, wp_credentials, wp_instance_id') \
        .eq('wp_instance_id', instance_id) \
        .single() \
        .execute()
    
    if not result.data:
        raise ValueError(f"WordPress instance not found: {instance_id}")
    
    return {
        'url': result.data['wp_url'],
        'credentials': result.data['wp_credentials']
    }

def get_collection_theme_schemas(block_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Fallback: Collection theme block schemas
    In production, extract from theme files or template instance
    """
    
    schemas = {
        'acf/top-slides': {
            'label': 'Hero Carousel',
            'description': 'Full-width hero section with slides',
            'fields': {
                'slides': {
                    'type': 'repeater',
                    'sub_fields': {
                        'headline': {'type': 'text', 'required': True, 'max_length': 100},
                        'subheadline': {'type': 'text', 'max_length': 200},
                        'cta_text': {'type': 'text', 'max_length': 30},
                        'cta_link': {'type': 'url'},
                        'image': {'type': 'image', 'return_format': 'id'}
                    }
                },
                'autoplay': {'type': 'boolean', 'default': True},
                'overlay_style': {
                    'type': 'select',
                    'choices': ['none', 'light', 'dark', 'gradient'],
                    'default': 'dark'
                }
            },
            'variants': {
                'fullwidth': {
                    'css_class': 'hero-fullwidth',
                    'description': 'Full viewport hero',
                    'best_for': ['luxury', 'impact', 'resort']
                },
                'split': {
                    'css_class': 'hero-split',
                    'description': 'Two-column layout',
                    'best_for': ['lifestyle', 'storytelling', 'family']
                }
            }
        },
        'acf/content-grid': {
            'label': 'Content Grid',
            'description': 'Grid of items with icons/images',
            'fields': {
                'columns': {'type': 'select', 'choices': ['2', '3', '4'], 'default': '3'},
                'items': {
                    'type': 'repeater',
                    'sub_fields': {
                        'headline': {'type': 'text', 'required': True},
                        'description': {'type': 'textarea'},
                        'icon': {'type': 'text'},
                        'image': {'type': 'image'}
                    }
                }
            },
            'variants': {
                'elevated-cards': {
                    'css_class': 'grid-elevated',
                    'description': 'Cards with shadow',
                    'best_for': ['luxury', 'modern']
                },
                'minimal': {
                    'css_class': 'grid-minimal',
                    'description': 'Flat cards',
                    'best_for': ['minimalist', 'clean']
                }
            }
        }
        # More blocks would be added here
    }
    
    if block_name:
        return {block_name: schemas.get(block_name, {})}
    
    return schemas

def get_collection_design_tokens() -> Dict[str, Any]:
    """Fallback: Collection theme design tokens"""
    return {
        'colors': {
            'primary': '#4F46E5',
            'secondary': '#10B981',
            'available_variants': ['primary', 'secondary', 'accent', 'neutral']
        },
        'typography': {
            'available_fonts': ['Inter', 'Playfair Display', 'Montserrat', 'Open Sans'],
            'heading_scales': ['compact', 'balanced', 'luxury']
        },
        'spacing': {
            'available_scales': ['tight', 'balanced', 'luxury'],
            'presets': {
                'tight': {'section': '4rem', 'container': '1200px'},
                'balanced': {'section': '6rem', 'container': '1400px'},
                'luxury': {'section': '8rem', 'container': '1600px'}
            }
        }
    }










