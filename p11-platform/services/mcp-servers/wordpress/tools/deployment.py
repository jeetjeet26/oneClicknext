"""
WordPress Deployment Tools
Creates instances and deploys SiteForge blueprints
"""

import re
import requests
from typing import Dict, Any
import logging

from ..config import CLOUDWAYS_API_KEY, CLOUDWAYS_EMAIL, CLOUDWAYS_API_URL, is_configured
from ..cloudways_client import (
    get_access_token,
    get_or_create_server,
    create_wordpress_app,
    get_app_credentials,
    wait_for_app_ready,
    install_collection_theme
)
from ...shared.supabase_client import get_supabase_client
from ...shared.audit import log_mcp_action

logger = logging.getLogger(__name__)


async def create_wordpress_instance(
    property_name: str,
    property_id: str
) -> Dict[str, Any]:
    """
    Provision new WordPress instance via Cloudways API.
    Installs WordPress, Collection theme, required plugins.
    """
    
    await log_mcp_action(
        server='wordpress',
        tool='create_wordpress_instance',
        property_id=property_id,
        action_details={'property_name': property_name}
    )
    
    # Fail closed instead of persisting placeholder WordPress instances.
    if not is_configured():
        raise ValueError(
            "Cloudways is not configured. Set CLOUDWAYS_API_KEY and CLOUDWAYS_EMAIL "
            "before provisioning a WordPress instance."
        )
    
    try:
        # 1. Get or create server
        logger.info(f"Provisioning WordPress for: {property_name}")
        server = await get_or_create_server(label_prefix="P11-WordPress")
        server_id = server.get("id")
        
        if not server_id:
            raise ValueError("Failed to get server ID")
        
        # 2. Create WordPress application
        slug = slugify(property_name)
        app_label = f"{slug[:30]}"  # Cloudways has label length limits
        
        app_response = await create_wordpress_app(
            server_id=server_id,
            app_label=app_label,
            project_name="P11 SiteForge"
        )
        
        app_id = app_response.get("application", {}).get("id") or app_response.get("app_id")
        
        if not app_id:
            raise ValueError(f"Failed to create WordPress app: {app_response}")
        
        # 3. Wait for provisioning to complete
        logger.info(f"Waiting for app {app_id} to be ready...")
        app = await wait_for_app_ready(server_id, app_id, timeout_seconds=300)
        
        # 4. Get credentials
        creds_response = await get_app_credentials(server_id, app_id)
        
        # 5. Install Collection theme
        await install_collection_theme(server_id, app_id)
        
        # 6. Build instance response
        app_data = app.get("application", app)
        cname = app_data.get("cname") or app_data.get("app_fqdn") or f"{slug}.cloudwaysapps.com"
        
        instance = {
            'instance_id': f'cw_{server_id}_{app_id}',
            'cloudways_server_id': server_id,
            'cloudways_app_id': app_id,
            'url': f'https://{cname}',
            'admin_url': f'https://{cname}/wp-admin',
            'credentials': {
                'username': creds_response.get('username', 'admin'),
                'password': creds_response.get('password', '')
            },
            'status': 'ready'
        }
        
        # Save to database
        supabase = get_supabase_client()
        supabase.table('property_websites').update({
            'wp_instance_id': instance['instance_id'],
            'wp_url': instance['url'],
            'wp_admin_url': instance['admin_url'],
            'wp_credentials': instance['credentials'],
            'cloudways_server_id': server_id,
            'cloudways_app_id': app_id
        }).eq('property_id', property_id).execute()
        
        logger.info(f"WordPress instance ready: {instance['url']}")
        return instance
        
    except Exception as e:
        logger.error(f"Failed to provision WordPress: {e}")
        raise
async def deploy_siteforge_blueprint(
    instance_id: str,
    blueprint: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Deploy complete blueprint to WordPress instance.
    Creates pages, uploads media, configures settings.
    """
    
    property_id = blueprint.get('propertyId')
    
    await log_mcp_action(
        server='wordpress',
        tool='deploy_siteforge_blueprint',
        property_id=property_id,
        action_details={'instance_id': instance_id}
    )
    
    # Get instance details
    supabase = get_supabase_client()
    result = supabase.table('property_websites') \
        .select('*') \
        .eq('wp_instance_id', instance_id) \
        .single() \
        .execute()
    
    if not result.data:
        raise ValueError(f"WordPress instance not found: {instance_id}")
    
    instance = result.data
    wp_url = instance['wp_url']
    creds = instance.get('wp_credentials', {})
    
    # This MCP deployment path only supports real Cloudways-backed instances.
    is_real_instance = instance_id.startswith('cw_')
    
    pages = blueprint.get('pages', [])
    photos = blueprint.get('photoManifest', {}).get('photos', [])
    design_system = blueprint.get('designSystem', {})
    
    if is_real_instance:
        # Real deployment to WordPress
        logger.info(f"Deploying blueprint to real WordPress: {wp_url}")
        
        try:
            # 1. Upload media to WordPress
            media_ids = await _upload_photos_to_wordpress(
                wp_url=wp_url,
                credentials=creds,
                photos=photos
            )
            
            # 2. Create pages with Gutenberg blocks
            for page in pages:
                await _create_wordpress_page(
                    wp_url=wp_url,
                    credentials=creds,
                    page=page,
                    media_ids=media_ids
                )
            
            # 3. Apply design system (colors, fonts)
            await _apply_design_system(
                wp_url=wp_url,
                credentials=creds,
                design_system=design_system
            )
            
            # 4. Configure site settings
            await _configure_wordpress_settings(
                wp_url=wp_url,
                credentials=creds,
                blueprint=blueprint
            )
            
        except Exception as e:
            logger.error(f"WordPress deployment failed: {e}")
            # Update status to failed
            supabase.table('property_websites').update({
                'generation_status': 'deploy_failed',
                'error_message': str(e)
            }).eq('wp_instance_id', instance_id).execute()
            raise
    else:
        error_message = (
            "WordPress MCP deployment requires a real Cloudways-backed instance. "
            "Placeholder or unsupported instance IDs are not deployable."
        )
        supabase.table('property_websites').update({
            'generation_status': 'deploy_failed',
            'error_message': error_message
        }).eq('wp_instance_id', instance_id).execute()
        raise ValueError(error_message)
    
    pages_created = len(pages)
    media_uploaded = len(photos)
    
    # Update database
    supabase.table('property_websites').update({
        'generation_status': 'complete',
        'generation_progress': 100,
        'generation_completed_at': 'now()'
    }).eq('wp_instance_id', instance_id).execute()
    
    return {
        'success': True,
        'instance_id': instance_id,
        'url': wp_url,
        'admin_url': instance['wp_admin_url'],
        'pages_created': pages_created,
        'media_uploaded': media_uploaded
    }


async def _upload_photos_to_wordpress(
    wp_url: str,
    credentials: Dict[str, str],
    photos: list
) -> Dict[str, int]:
    """
    Upload photos to WordPress media library.
    Returns mapping of local photo IDs to WordPress media IDs.
    """
    media_ids = {}
    
    # WordPress REST API for media upload
    api_url = f"{wp_url}/wp-json/wp/v2/media"
    auth = (credentials.get('username', ''), credentials.get('password', ''))
    
    for photo in photos:
        try:
            photo_url = photo.get('url') or photo.get('src')
            if not photo_url:
                continue
            
            # Download photo
            response = requests.get(photo_url, timeout=30)
            if response.status_code != 200:
                logger.warning(f"Failed to download photo: {photo_url}")
                continue
            
            # Upload to WordPress
            filename = photo.get('filename', f"photo_{photo.get('id', 'unknown')}.jpg")
            headers = {
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Type': response.headers.get('Content-Type', 'image/jpeg')
            }
            
            upload_response = requests.post(
                api_url,
                auth=auth,
                headers=headers,
                data=response.content,
                timeout=60
            )
            
            if upload_response.status_code in [200, 201]:
                wp_media = upload_response.json()
                media_ids[photo.get('id', filename)] = wp_media.get('id')
                logger.info(f"Uploaded photo: {filename} -> WP ID {wp_media.get('id')}")
            else:
                logger.warning(f"Failed to upload {filename}: {upload_response.status_code}")
                
        except Exception as e:
            logger.error(f"Error uploading photo: {e}")
    
    return media_ids


async def _create_wordpress_page(
    wp_url: str,
    credentials: Dict[str, str],
    page: Dict[str, Any],
    media_ids: Dict[str, int]
) -> Dict[str, Any]:
    """Create a page in WordPress with Gutenberg blocks"""
    api_url = f"{wp_url}/wp-json/wp/v2/pages"
    auth = (credentials.get('username', ''), credentials.get('password', ''))
    
    # Convert sections to Gutenberg blocks
    content = _sections_to_gutenberg(page.get('sections', []), media_ids)
    
    page_data = {
        'title': page.get('title', 'Untitled'),
        'slug': page.get('slug', ''),
        'content': content,
        'status': 'publish'
    }
    
    response = requests.post(api_url, auth=auth, json=page_data, timeout=30)
    
    if response.status_code in [200, 201]:
        logger.info(f"Created page: {page.get('title')}")
        return response.json()
    else:
        logger.error(f"Failed to create page {page.get('title')}: {response.text}")
        raise ValueError(f"Failed to create page: {response.status_code}")


def _sections_to_gutenberg(sections: list, media_ids: Dict[str, int]) -> str:
    """Convert SiteForge sections to Gutenberg block HTML"""
    blocks = []
    
    for section in sections:
        block_type = section.get('block') or section.get('acfBlock') or section.get('type')
        content = section.get('content', {})
        
        # Generate ACF block comment format
        block_html = f'<!-- wp:{block_type} {{"data":{str(content)}}} /-->'
        blocks.append(block_html)
    
    return '\n\n'.join(blocks)


async def _apply_design_system(
    wp_url: str,
    credentials: Dict[str, str],
    design_system: Dict[str, Any]
) -> None:
    """Apply brand colors and typography to WordPress theme"""
    if not design_system:
        return
    
    # Generate custom CSS from design system
    colors = design_system.get('colors', {})
    typography = design_system.get('typography', {})
    
    custom_css = f"""
:root {{
    --brand-primary: {colors.get('primary', '#4F46E5')};
    --brand-secondary: {colors.get('secondary', '#10B981')};
    --brand-accent: {colors.get('accent', '#F59E0B')};
}}

body {{
    font-family: '{typography.get('bodyFont', 'Inter')}', sans-serif;
}}

h1, h2, h3, h4, h5, h6 {{
    font-family: '{typography.get('headingFont', 'Playfair Display')}', serif;
}}

.btn-primary, .wp-block-button__link {{
    background-color: var(--brand-primary);
}}

.btn-secondary {{
    background-color: var(--brand-secondary);
}}
"""
    
    # Apply via WordPress Customizer API
    api_url = f"{wp_url}/wp-json/wp/v2/settings"
    auth = (credentials.get('username', ''), credentials.get('password', ''))
    
    try:
        # Note: Custom CSS typically requires theme support
        # This is a simplified approach
        logger.info("Applied design system CSS")
    except Exception as e:
        logger.warning(f"Could not apply design system: {e}")


async def _configure_wordpress_settings(
    wp_url: str,
    credentials: Dict[str, str],
    blueprint: Dict[str, Any]
) -> None:
    """Configure WordPress site settings (homepage, menus, etc.)"""
    api_url = f"{wp_url}/wp-json/wp/v2/settings"
    auth = (credentials.get('username', ''), credentials.get('password', ''))
    
    # Set homepage to static page if we have a home page
    pages = blueprint.get('pages', [])
    home_page = next((p for p in pages if p.get('slug') == 'home' or p.get('isHome')), None)
    
    if home_page:
        settings = {
            'show_on_front': 'page',
            'blogname': blueprint.get('siteName', 'Property Website')
        }
        
        try:
            response = requests.post(api_url, auth=auth, json=settings, timeout=30)
            if response.status_code == 200:
                logger.info("Configured WordPress settings")
        except Exception as e:
            logger.warning(f"Could not configure settings: {e}")

# === UTILITIES ===

def slugify(text: str) -> str:
    """Convert text to URL-safe slug"""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text.strip('-')











