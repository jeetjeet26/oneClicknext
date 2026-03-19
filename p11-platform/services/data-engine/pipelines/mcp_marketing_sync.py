"""
MCP Marketing Data Sync Pipeline
Pulls data from Google Ads and Meta Ads via MCP servers
and syncs to fact_marketing_performance table.
"""
import sys
import asyncio
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from utils.supabase_client import get_supabase_client

# Add MCP servers to path
mcp_path = Path(__file__).parent.parent.parent / "mcp-servers"
sys.path.append(str(mcp_path))

# Lazy imports - only import when needed to avoid failures if one channel isn't configured
def _get_google_ads_tools():
    """Lazy import Google Ads tools."""
    try:
        from google_ads.tools.performance import get_campaign_performance
        from google_ads.auth import clean_customer_id
        return get_campaign_performance, clean_customer_id
    except ImportError as e:
        print(f"Google Ads tools not available: {e}")
        return None, None

def _get_meta_ads_client():
    """Lazy import Meta Ads client."""
    try:
        from meta_ads.client import MetaAdsClient
        return MetaAdsClient
    except ImportError as e:
        print(f"Meta Ads client not available: {e}")
        return None


class MCPMarketingSync:
    """Sync marketing data from MCP tools to database."""
    
    def __init__(self, job_id: Optional[str] = None):
        self.supabase = get_supabase_client()
        self.job_id = job_id
    
    def _update_job_status(self, status: str, **kwargs):
        """Update import job status if job_id is set."""
        if not self.job_id:
            return
        
        update_data = {'status': status}
        if status == 'running' and 'started_at' not in kwargs:
            update_data['started_at'] = datetime.utcnow().isoformat()
        if status in ('complete', 'partial', 'failed') and 'completed_at' not in kwargs:
            update_data['completed_at'] = datetime.utcnow().isoformat()
        
        update_data.update(kwargs)
        
        try:
            self.supabase.table('import_jobs').update(update_data).eq('id', self.job_id).execute()
        except Exception as e:
            print(f"Warning: Failed to update job status: {e}")
    
    def _calculate_date_range(self, last_import: Optional[str]) -> str:
        """Calculate optimal date range based on last import."""
        if not last_import:
            return "MAXIMUM"  # First import - get all historical data
        
        last_import_dt = datetime.fromisoformat(last_import.replace('Z', '+00:00'))
        days_since = (datetime.now(last_import_dt.tzinfo) - last_import_dt).days
        
        if days_since <= 1:
            return "YESTERDAY"
        elif days_since <= 7:
            return "LAST_7_DAYS"
        elif days_since <= 14:
            return "LAST_14_DAYS"
        elif days_since <= 30:
            return "LAST_30_DAYS"
        else:
            return "LAST_30_DAYS"  # Cap at 30 days
    
    def _build_channel_result(self, platform: str, state: str, records: List[dict], detail: Optional[str] = None) -> Dict[str, Any]:
        return {
            'platform': platform,
            'state': state,
            'records': records,
            'record_count': len(records),
            'detail': detail
        }

    async def sync_property(
        self, 
        property_id: str,
        channels: List[str] = ["google_ads", "meta_ads"],
        date_range: Optional[str] = None,
        incremental: bool = True
    ):
        """
        Sync marketing data for a specific property.
        
        Args:
            property_id: UUID of the property
            channels: List of channels to sync
            date_range: GAQL date range preset (auto-calculated if None)
            incremental: If True, only pull data since last import
        """
        self._update_job_status('running', progress_pct=0, current_step='Initializing')
        print(f"Starting sync for property {property_id}")
        
        # Get ad account connections (using EXISTING schema)
        connections = self.supabase.table('ad_account_connections')\
            .select('*')\
            .eq('property_id', property_id)\
            .eq('is_active', True)\
            .execute()
        
        if not connections.data:
            print(f"No ad accounts linked for property {property_id}")
            self._update_job_status(
                'complete', 
                progress_pct=100, 
                current_step='No ad accounts configured',
                records_imported=0,
                campaigns_found=0,
                error_message='No ad accounts linked. Connect Google Ads or Meta Ads in Settings.'
            )
            return []
        
        results: List[dict] = []
        channel_results: List[Dict[str, Any]] = []
        total_platforms = len([c for c in connections.data if c['platform'] in channels])
        current_platform = 0
        
        # Sync each platform
        for conn in connections.data:
            platform = conn['platform']
            account_id = conn['account_id']
            
            # Calculate incremental date range if enabled
            sync_date_range = date_range
            if incremental and not date_range:
                last_import = conn.get('last_imported_at')
                sync_date_range = self._calculate_date_range(last_import)
                print(f"Calculated incremental range: {sync_date_range}")
            
            if platform == 'google_ads' and 'google_ads' in channels:
                current_platform += 1
                progress = int((current_platform / total_platforms) * 50)
                self._update_job_status('running', progress_pct=progress, current_step=f'Syncing Google Ads')
                
                print(f"Syncing Google Ads for account {account_id}")
                google_result = await self._sync_google_ads(
                    property_id,
                    account_id,
                    sync_date_range or "MAXIMUM"  # Use MAXIMUM as fallback for first import
                )
                results.extend(google_result['records'])
                channel_results.append(google_result)
                
                # Only update last import timestamp if we got records
                if google_result['records']:
                    self.supabase.table('ad_account_connections')\
                        .update({'last_imported_at': datetime.utcnow().isoformat()})\
                        .eq('property_id', property_id)\
                        .eq('platform', 'google_ads')\
                        .execute()
            
            elif platform == 'meta_ads' and 'meta_ads' in channels:
                current_platform += 1
                progress = int((current_platform / total_platforms) * 50)
                self._update_job_status('running', progress_pct=progress, current_step=f'Syncing Meta Ads')
                
                print(f"Syncing Meta Ads for account {account_id}")
                meta_result = await self._sync_meta_ads(
                    property_id,
                    account_id,
                    sync_date_range or "MAXIMUM"  # Use MAXIMUM as fallback for first import
                )
                results.extend(meta_result['records'])
                channel_results.append(meta_result)
                
                # Only update last import timestamp if we got records
                if meta_result['records']:
                    self.supabase.table('ad_account_connections')\
                        .update({'last_imported_at': datetime.utcnow().isoformat()})\
                        .eq('property_id', property_id)\
                        .eq('platform', 'meta_ads')\
                        .execute()
        
        if not channel_results and channels:
            self._update_job_status(
                'failed',
                progress_pct=100,
                current_step='No matching ad account connections',
                records_imported=0,
                campaigns_found=0,
                error_message=f"No active ad account connections matched requested channels: {', '.join(channels)}",
            )
            return []
        
        failed_channels = [r for r in channel_results if r['state'] == 'failed']
        warning_channels = [r for r in channel_results if r['state'] in ('failed', 'skipped')]
        succeeded_channels = [r for r in channel_results if r['state'] == 'succeeded']
        warning_summary = '; '.join(
            f"{r['platform']}: {r['state']}" + (f" ({r['detail']})" if r.get('detail') else '')
            for r in warning_channels
        )
        
        # Upsert to database
        if results:
            self._update_job_status('running', progress_pct=75, current_step='Storing data in database')
            print(f"Upserting {len(results)} records to fact_marketing_performance")
            
            self.supabase.table('fact_marketing_performance')\
                .upsert(results, on_conflict='date,property_id,campaign_id')\
                .execute()
            
            campaigns_found = len(set(r['campaign_id'] for r in results))
            final_status = 'partial' if warning_channels else 'complete'
            final_step = 'Complete with warnings' if warning_channels else 'Complete'
            self._update_job_status(
                final_status, 
                progress_pct=100, 
                current_step=final_step,
                records_imported=len(results),
                campaigns_found=campaigns_found,
                error_message=warning_summary if warning_channels else None
            )
            print(f"[SUCCESS] Sync {final_status}: {len(results)} records, {campaigns_found} campaigns")
        else:
            if failed_channels and not succeeded_channels:
                self._update_job_status(
                    'failed',
                    progress_pct=100,
                    current_step='All channel syncs failed',
                    records_imported=0,
                    campaigns_found=0,
                    error_message=warning_summary or 'All requested channel syncs failed',
                )
            elif warning_channels:
                self._update_job_status(
                    'partial',
                    progress_pct=100,
                    current_step='Completed with warnings (no records imported)',
                    records_imported=0,
                    campaigns_found=0,
                    error_message=warning_summary or 'Some channels were skipped or failed',
                )
            else:
                self._update_job_status(
                    'complete',
                    progress_pct=100,
                    current_step='Complete (no records imported)',
                    records_imported=0,
                    campaigns_found=0,
                    error_message=None,
                )
        
        return results
    
    async def _sync_google_ads(
        self,
        property_id: str,
        customer_id: str,
        date_range: str
    ) -> Dict[str, Any]:
        """Sync Google Ads data using MCP tools."""
        try:
            # Lazy import Google Ads tools
            get_campaign_performance, clean_customer_id = _get_google_ads_tools()
            if not get_campaign_performance or not clean_customer_id:
                print("Google Ads sync skipped - tools not available")
                return self._build_channel_result('google_ads', 'skipped', [], 'Google Ads tools not available')
            
            # Call MCP tool
            campaigns = await get_campaign_performance(
                customer_id=clean_customer_id(customer_id),
                date_range=date_range,
                limit=100
            )
            
            # Transform to fact table format
            records = []
            for campaign in campaigns:
                # Calculate date (use yesterday as default for aggregated data)
                date = (datetime.now() - timedelta(days=1)).date()
                
                records.append({
                    'date': date.isoformat(),
                    'property_id': property_id,
                    'channel_id': 'google_ads',
                    'campaign_id': campaign['id'],
                    'campaign_name': campaign['name'],
                    'spend': campaign['spend'] / 1_000_000,  # Convert micros to currency
                    'clicks': campaign['clicks'],
                    'impressions': campaign['impressions'],
                    'conversions': campaign['conversions'],
                    'raw_source': 'mcp',
                })
            
            return self._build_channel_result('google_ads', 'succeeded', records)
            
        except Exception as e:
            detail = str(e)
            print(f"Error syncing Google Ads: {detail}")
            return self._build_channel_result('google_ads', 'failed', [], detail)
    
    async def _sync_meta_ads(
        self,
        property_id: str,
        account_id: str,
        date_range: str
    ) -> Dict[str, Any]:
        """Sync Meta Ads data using MCP tools."""
        try:
            # Lazy import Meta Ads client
            MetaAdsClient = _get_meta_ads_client()
            if not MetaAdsClient:
                print("Meta Ads sync skipped - client not available")
                return self._build_channel_result('meta_ads', 'skipped', [], 'Meta Ads client not available')
            
            print(f"[DEBUG] Creating MetaAdsClient with account_id={account_id}")
            client = MetaAdsClient()
            print(f"[DEBUG] MetaAdsClient created, access_token present: {bool(client.access_token)}")
            
            # Convert GAQL date range to Meta preset
            meta_preset_map = {
                'TODAY': 'today',
                'YESTERDAY': 'yesterday',
                'LAST_7_DAYS': 'last_7d',
                'LAST_14_DAYS': 'last_14d',
                'LAST_30_DAYS': 'last_30d',
                'LAST_90_DAYS': 'last_90d',
                'THIS_MONTH': 'this_month',
                'LAST_MONTH': 'last_month',
                'MAXIMUM': 'maximum',  # All historical data
                'ALL_TIME': 'maximum',
            }
            # Use 'maximum' to get all historical data if recent data is empty
            meta_preset = meta_preset_map.get(date_range, 'maximum')
            print(f"[DEBUG] Using date preset: {meta_preset}")
            
            # Call MCP tool
            print(f"[DEBUG] Calling get_campaign_insights for account {account_id}")
            insights = await client.get_campaign_insights(
                account_id=account_id,
                date_preset=meta_preset,
                limit=100
            )
            print(f"[DEBUG] Got {len(insights)} insights from Meta API")
            if insights:
                print(f"[DEBUG] First insight sample: {insights[0]}")
            
            # Transform to fact table format
            records = []
            for insight in insights:
                # Use date_stop from API response, or fallback to yesterday
                date_str = insight.get('date_stop') or insight.get('date_start')
                if date_str:
                    date = datetime.strptime(date_str, '%Y-%m-%d').date()
                else:
                    date = (datetime.now() - timedelta(days=1)).date()
                
                # Parse conversions from actions array if present
                conversions = 0
                actions = insight.get('actions', [])
                if isinstance(actions, list):
                    for action in actions:
                        if action.get('action_type') in ['lead', 'complete_registration', 'purchase']:
                            conversions += int(action.get('value', 0))
                else:
                    conversions = int(insight.get('conversions', 0))
                
                records.append({
                    'date': date.isoformat(),
                    'property_id': property_id,
                    'channel_id': 'meta_ads',
                    'campaign_id': insight.get('campaign_id', ''),
                    'campaign_name': insight.get('campaign_name', 'Unknown'),
                    'spend': float(insight.get('spend', 0)),
                    'clicks': int(insight.get('clicks', 0)),
                    'impressions': int(insight.get('impressions', 0)),
                    'conversions': conversions,
                    'raw_source': 'mcp',
                })
            
            print(f"[DEBUG] Transformed {len(records)} records for database")
            return self._build_channel_result('meta_ads', 'succeeded', records)
            
        except Exception as e:
            import traceback
            detail = str(e)
            print(f"Error syncing Meta Ads: {detail}")
            print(f"[DEBUG] Full traceback: {traceback.format_exc()}")
            return self._build_channel_result('meta_ads', 'failed', [], detail)
    
    async def sync_all_properties(self):
        """Sync all properties that have ad accounts connected."""
        print("Starting sync for all properties")
        
        # Get all properties with ad accounts
        properties = self.supabase.table('ad_account_connections')\
            .select('property_id')\
            .execute()
        
        if not properties.data:
            print("No properties with ad accounts found")
            return
        
        for prop in properties.data:
            try:
                await self.sync_property(prop['property_id'])
            except Exception as e:
                print(f"Error syncing property {prop['property_id']}: {e}")
        
        print("Sync complete for all properties")


async def main():
    """CLI entry point for manual sync."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Sync marketing data from MCP tools')
    parser.add_argument('--property-id', help='Specific property ID to sync')
    parser.add_argument('--channels', default='google_ads,meta_ads', help='Comma-separated channels')
    parser.add_argument('--date-range', default='LAST_7_DAYS', help='Date range preset')
    parser.add_argument('--all', action='store_true', help='Sync all properties')
    
    args = parser.parse_args()
    
    syncer = MCPMarketingSync()
    
    if args.all:
        await syncer.sync_all_properties()
    elif args.property_id:
        channels = args.channels.split(',')
        await syncer.sync_property(args.property_id, channels, args.date_range)
    else:
        print("Please specify --property-id or --all")
        return


if __name__ == "__main__":
    asyncio.run(main())

