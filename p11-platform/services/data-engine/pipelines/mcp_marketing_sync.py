"""
MCP Marketing Data Sync Pipeline
Pulls data from Google Ads and Meta Ads via MCP servers
and syncs to fact_marketing_performance table.
"""
import sys
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from utils.supabase_client import get_supabase_client

# Add MCP servers to path
mcp_path = Path(__file__).parent.parent.parent / "mcp-servers"
sys.path.append(str(mcp_path))

# Lazy imports - only import when needed to avoid failures if one channel isn't configured
def _get_google_ads_tools():
    """Lazy import Google Ads tools."""
    try:
        from google_ads.tools.performance import get_daily_campaign_performance
        from google_ads.auth import clean_customer_id
        return get_daily_campaign_performance, clean_customer_id
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
        self.records_imported = 0
        self._started_at = None
        self.reference_time = None
    
    def _update_job_status(self, status: str, **kwargs):
        """Do not continue a tracked import after losing status persistence."""
        if not self.job_id:
            return
        update_data = {'status': status}
        if status == 'running':
            if self._started_at is None:
                self._started_at = datetime.now(timezone.utc).isoformat()
            update_data['started_at'] = self._started_at
        if status in ('complete', 'partial', 'failed'):
            update_data['completed_at'] = datetime.now(timezone.utc).isoformat()
        update_data.update(kwargs)
        result = self.supabase.table('import_jobs').update(update_data).eq('id', self.job_id).execute()
        if not result.data:
            raise RuntimeError('Import status persistence was not confirmed')

    def _calculate_date_range(self, last_import: Optional[str]) -> str:
        """Calculate optimal date range based on last import."""
        if not last_import:
            return "LAST_30_DAYS"  # Bounded first import; historical backfills require a separate plan
        
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
        self, property_id: str, channels: Optional[List[str]] = None,
        date_range: Optional[str] = None, incremental: bool = True,
    ):
        """Import each connected account; count only confirmed stored records."""
        channels = list(dict.fromkeys(channels if channels is not None else ['google_ads', 'meta_ads']))
        self.records_imported = 0
        self._update_job_status('running', progress_pct=0, current_step='Initializing', records_imported=0)
        connections = self.supabase.table('ad_account_connections').select(
            'id,platform,account_id,last_imported_at'
        ).eq('property_id', property_id).eq('is_active', True).execute()
        if not isinstance(connections.data, list):
            raise RuntimeError('Ad account lookup was not confirmed')
        matching = [connection for connection in connections.data if connection.get('platform') in channels]
        if not matching:
            self._update_job_status(
                'failed', progress_pct=100, current_step='No matching active ad accounts',
                records_imported=0, campaigns_found=0,
                error_message='No active accounts match the requested channels. Connect an ad account in Settings.',
            )
            return []

        stored = []
        outcomes = []
        configured = {connection['platform'] for connection in matching}
        for missing in set(channels) - configured:
            outcomes.append(self._build_channel_result(missing, 'skipped', [], 'No active account connected'))
        for index, connection in enumerate(matching):
            platform = connection['platform']
            self._update_job_status(
                'running', progress_pct=int(index / len(matching) * 90),
                current_step=f'Importing {platform} account {index + 1} of {len(matching)}',
                records_imported=self.records_imported,
            )
            try:
                if not connection.get('id') or not connection.get('account_id'):
                    raise ValueError('Account identity is missing')
                sync_range = date_range
                if not sync_range and incremental:
                    sync_range = self._calculate_date_range(connection.get('last_imported_at'))
                if platform == 'google_ads':
                    outcome = await self._sync_google_ads(property_id, connection['account_id'], sync_range or 'LAST_7_DAYS')
                elif platform == 'meta_ads':
                    outcome = await self._sync_meta_ads(property_id, connection['account_id'], sync_range or 'LAST_7_DAYS')
                else:
                    outcome = self._build_channel_result(platform, 'skipped', [], 'Unsupported channel')
            except Exception as error:
                outcome = self._build_channel_result(platform, 'failed', [], str(error))

            records = outcome['records'] if outcome['state'] == 'succeeded' else []
            if records:
                try:
                    # Daily reports can contain many more rows than campaign summaries.
                    # Keep each acknowledgement below the standard Data API row limit.
                    for offset in range(0, len(records), 250):
                        batch = records[offset:offset + 250]
                        persisted = self.supabase.table('fact_marketing_performance').upsert(
                            batch, on_conflict='date,property_id,channel_id,source_account_id,campaign_id'
                        ).execute()
                        if not isinstance(persisted.data, list) or len(persisted.data) != len(batch):
                            raise RuntimeError('Stored row count was not confirmed')
                        stored.extend(batch)
                        self.records_imported += len(persisted.data)
                    # Update only this account, and only after the data write succeeds.
                    freshness = self.supabase.table('ad_account_connections').update({
                        'last_imported_at': datetime.now(timezone.utc).isoformat()
                    }).eq('id', connection['id']).eq('property_id', property_id).execute()
                    if not freshness.data:
                        raise RuntimeError('Account freshness update was not confirmed')
                except Exception as error:
                    detail = 'Storage or freshness confirmation failed. Review this account before retrying.'
                    if getattr(error, 'code', None) == '23514' and 'Historical campaign rows need account reconciliation' in str(error):
                        detail = 'Historical campaign rows need account reconciliation before importing these dates.'
                    outcome = self._build_channel_result(platform, 'failed', [], detail)
            outcomes.append(outcome)
            self._update_job_status('running', records_imported=self.records_imported,
                                    progress_pct=int((index + 1) / len(matching) * 90),
                                    current_step=f'Processed {index + 1} of {len(matching)} accounts')

        warnings = [result for result in outcomes if result['state'] != 'succeeded']
        succeeded = [result for result in outcomes if result['state'] == 'succeeded']
        status = ('partial' if self.records_imported or succeeded else 'failed') if warnings else 'complete'
        detail = '; '.join(f"{result['platform']}: {result.get('detail') or result['state']}" for result in warnings)
        self._update_job_status(
            status, progress_pct=100, current_step='Complete' if status == 'complete' else 'Import requires review',
            records_imported=self.records_imported, campaigns_found=len({(record.get('channel_id'), record.get('source_account_id'), record['campaign_id']) for record in stored}),
            error_message=detail or None,
        )
        return stored

    async def _sync_google_ads(self, property_id: str, customer_id: str, date_range: str) -> Dict[str, Any]:
        """Read and validate the complete account report before writing any rows."""
        from pipelines.marketing_report import report_records
        from shared.daily_reports import ReportValidationError
        try:
            daily_report, clean_customer_id = _get_google_ads_tools()
            if not daily_report or not clean_customer_id:
                return self._build_channel_result('google_ads', 'skipped', [], 'Google Ads tools not available')
            report = await daily_report(customer_id=clean_customer_id(customer_id), date_range=date_range, **({'reference_time': self.reference_time} if self.reference_time is not None else {}))
            records = report_records(report, property_id, 'google_ads', customer_id)
            return self._build_channel_result('google_ads', 'succeeded', records)
        except ReportValidationError as error:
            return self._build_channel_result('google_ads', 'failed', [], str(error))
        except Exception:
            # Provider exceptions can contain URLs/credentials; keep saved job text safe.
            return self._build_channel_result('google_ads', 'failed', [],
                'Google Ads daily report could not be verified. Check account access, dates, pagination, USD currency and report values before retrying.')

    async def _sync_meta_ads(self, property_id: str, account_id: str, date_range: str) -> Dict[str, Any]:
        """Read all Meta pages at daily grain; never substitute a period-end date."""
        from pipelines.marketing_report import report_records
        from shared.daily_reports import ReportValidationError
        try:
            MetaAdsClient = _get_meta_ads_client()
            if not MetaAdsClient:
                return self._build_channel_result('meta_ads', 'skipped', [], 'Meta Ads client not available')
            report = await MetaAdsClient().get_daily_campaign_insights(account_id=account_id, date_range=date_range, **({'reference_time': self.reference_time} if self.reference_time is not None else {}))
            records = report_records(report, property_id, 'meta_ads', account_id)
            return self._build_channel_result('meta_ads', 'succeeded', records)
        except ReportValidationError as error:
            return self._build_channel_result('meta_ads', 'failed', [], str(error))
        except Exception:
            return self._build_channel_result('meta_ads', 'failed', [],
                'Meta Ads daily report could not be verified. Check account access, dates, pagination, USD currency and report values before retrying.')

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

