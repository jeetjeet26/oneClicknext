"""
WordPress MCP Server
Provides WordPress discovery and deployment capabilities to SiteForge agents
"""

import asyncio
import json
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .config import is_configured
from .tools.abilities import get_wordpress_abilities, get_acf_block_schemas, get_theme_design_tokens
from .tools.analysis import analyze_existing_site
from .tools.deployment import deploy_siteforge_blueprint, create_wordpress_instance

# Create server instance
server = Server("wordpress-mcp")

@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available WordPress tools for agents"""
    return [
        # === DISCOVERY TOOLS (Agents query these) ===
        
        Tool(
            name="get_wordpress_abilities",
            description="""
            Query WordPress Abilities API (WP 6.9+) to discover what's possible.
            Returns: available blocks, theme capabilities, plugin status.
            Architecture Agent uses this to plan within actual WordPress constraints.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "instance_id": {
                        "type": "string",
                        "description": "WordPress instance ID or 'template-collection-theme' for staging template"
                    },
                    "context": {
                        "type": "string",
                        "description": "Context: 'site_generation', 'page_edit', 'block_usage'",
                        "default": "site_generation"
                    }
                },
                "required": ["instance_id"]
            }
        ),
        
        Tool(
            name="get_acf_block_schemas",
            description="""
            Get detailed field schemas for all ACF blocks in active theme.
            Returns: field types, variants, CSS classes, usage examples.
            Architecture Agent uses this to know how to configure blocks correctly.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "instance_id": {
                        "type": "string",
                        "description": "WordPress instance ID"
                    },
                    "block_name": {
                        "type": "string",
                        "description": "Optional: Get schema for specific block only"
                    }
                },
                "required": ["instance_id"]
            }
        ),
        
        Tool(
            name="get_theme_design_tokens",
            description="""
            Extract design system from active WordPress theme.
            Returns: colors, typography, spacing options, CSS variables.
            Design Agent uses this to align generated design with theme capabilities.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "instance_id": {"type": "string"}
                },
                "required": ["instance_id"]
            }
        ),
        
        Tool(
            name="analyze_existing_site",
            description="""
            Analyze an existing WordPress site's structure and design.
            Returns: blocks used, design patterns, architectural insights.
            Agents use this to learn from optional reference sites.
            Example: analyze_existing_site("https://cadencecreekmissionranch.com/")
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Full URL of WordPress site to analyze"
                    }
                },
                "required": ["url"]
            }
        ),
        
        # === DEPLOYMENT TOOLS ===
        
        Tool(
            name="create_wordpress_instance",
            description="""
            Provision new WordPress instance via Cloudways API.
            Installs WordPress, Collection theme, and required plugins.
            Returns instance details and credentials.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "property_name": {"type": "string"},
                    "property_id": {"type": "string"}
                },
                "required": ["property_name", "property_id"]
            }
        ),
        
        Tool(
            name="deploy_siteforge_blueprint",
            description="""
            Deploy complete SiteForge blueprint to WordPress instance.
            Creates all pages, uploads media, configures settings.
            Returns deployment result with URLs.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "instance_id": {"type": "string"},
                    "blueprint": {"type": "object", "description": "Complete SiteBlueprint JSON"}
                },
                "required": ["instance_id", "blueprint"]
            }
        ),
        
        # === UTILITY TOOLS ===
        
        Tool(
            name="get_property_wordpress_status",
            description="""
            Get WordPress deployment status for a property by name or ID.
            Returns: instance details, deployment status, URLs.
            """,
            inputSchema={
                "type": "object",
                "properties": {
                    "property_identifier": {
                        "type": "string",
                        "description": "Property name or UUID"
                    }
                },
                "required": ["property_identifier"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle tool calls from agents"""
    
    if not is_configured():
        return [TextContent(
            type="text",
            text="❌ WordPress MCP not configured. Set environment variables:\n"
                 "- CLOUDWAYS_API_KEY\n"
                 "- CLOUDWAYS_EMAIL\n"
                 "- WP_TEMPLATE_URL\n"
                 "- WP_TEMPLATE_PASSWORD"
        )]
    
    try:
        if name == "get_wordpress_abilities":
            result = await get_wordpress_abilities(
                instance_id=arguments["instance_id"],
                context=arguments.get("context", "site_generation")
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "get_acf_block_schemas":
            result = await get_acf_block_schemas(
                instance_id=arguments["instance_id"],
                block_name=arguments.get("block_name")
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "get_theme_design_tokens":
            result = await get_theme_design_tokens(
                instance_id=arguments["instance_id"]
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "analyze_existing_site":
            result = await analyze_existing_site(
                url=arguments["url"]
            )
            
            # Format for readability
            output = f"📊 **Site Analysis: {arguments['url']}**\n\n"
            output += f"**Theme:** {result['detected_theme']}\n"
            output += f"**Blocks Used:** {len(result['blocks_used'])} total\n\n"
            output += "**Design Patterns:**\n"
            for pattern, value in result['architectural_patterns'].items():
                output += f"  • {pattern}: {value}\n"
            output += f"\n**Full JSON:**\n```json\n{json.dumps(result, indent=2)}\n```"
            
            return [TextContent(type="text", text=output)]
        
        elif name == "create_wordpress_instance":
            result = await create_wordpress_instance(
                property_name=arguments["property_name"],
                property_id=arguments["property_id"]
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "deploy_siteforge_blueprint":
            result = await deploy_siteforge_blueprint(
                instance_id=arguments["instance_id"],
                blueprint=arguments["blueprint"]
            )
            
            output = f"✅ **Deployment Complete**\n\n"
            output += f"🌐 **Live URL:** {result['url']}\n"
            output += f"🔧 **Admin:** {result['admin_url']}\n"
            output += f"📄 **Pages Created:** {result['pages_created']}\n"
            output += f"📸 **Media Uploaded:** {result['media_uploaded']}\n"
            
            return [TextContent(type="text", text=output)]
        
        elif name == "get_property_wordpress_status":
            # Query Supabase for property's WordPress instances
            from ..shared.property_service import find_property_by_identifier
            from ..shared.supabase_client import get_supabase_client
            
            supabase = get_supabase_client()
            property_id = await find_property_by_identifier(arguments["property_identifier"])
            
            result = supabase.table('property_websites') \
                .select('*') \
                .eq('property_id', property_id) \
                .order('created_at', desc=True) \
                .execute()
            
            if not result.data:
                return [TextContent(type="text", text="No WordPress sites found for this property.")]
            
            output = f"🏢 **{arguments['property_identifier']} - WordPress Status**\n\n"
            for site in result.data:
                output += f"📅 {site['created_at'][:10]} | "
                output += f"Status: {site['generation_status']} | "
                output += f"🌐 {site.get('wp_url', 'Not deployed')}\n"
            
            return [TextContent(type="text", text=output)]
        
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    
    except Exception as e:
        return [TextContent(type="text", text=f"❌ Error: {str(e)}")]

async def main():
    """Run the MCP server"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())










