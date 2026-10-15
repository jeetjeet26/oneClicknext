import os
import sys
from typing import List, Dict, Any, Optional

# Load environment from root .env before anything else
from utils.config import TARGET_PROPERTY_ID
from utils.google_normalization import normalize_google_data
from utils.supabase_client import get_supabase

# Try importing official library, usually installed via `pip install google-ads`
# If not present, we will fallback or fail.

def fetch_google_data(customer_id: str, client_config: Dict, login_customer_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetches Campaign performance via GAQL.
    
    Args:
        customer_id: The Google Ads customer ID (without dashes)
        client_config: Configuration dict for GoogleAdsClient
        login_customer_id: Optional MCC/manager account ID for accessing sub-accounts
    """
    from google.ads.googleads.client import GoogleAdsClient
    config = client_config.copy()
    if login_customer_id:
        config["login_customer_id"] = login_customer_id
        
    client = GoogleAdsClient.load_from_dict(config)
    ga_service = client.get_service("GoogleAdsService")

    # GAQL Query - Last 3 days to catch delayed conversions
    query = """
        SELECT 
            customer.id, customer.currency_code,
            segments.date,
            campaign.id, 
            campaign.name, 
            metrics.impressions, 
            metrics.clicks, 
            metrics.cost_micros, 
            metrics.conversions 
        FROM campaign 
        WHERE segments.date DURING LAST_7_DAYS
    """
    
    stream = ga_service.search_stream(customer_id=customer_id, query=query)
    
    results = []
    for batch in stream:
        for row in batch.results:
            if str(row.customer.id) != customer_id or row.customer.currency_code != 'USD':
                raise ValueError('Google report account or USD currency is not confirmed')
            # Flatten protobuf object to dict
            item = {
                "date": row.segments.date,
                "source_account_id": str(row.customer.id),
                "currency_code": row.customer.currency_code,
                "campaign.id": str(row.campaign.id),
                "campaign.name": row.campaign.name,
                "metrics.impressions": row.metrics.impressions,
                "metrics.clicks": row.metrics.clicks,
                "metrics.cost_micros": row.metrics.cost_micros,
                "metrics.conversions": row.metrics.conversions
            }
            results.append(item)
            
    return results


def get_linked_accounts(supabase) -> List[Dict[str, Any]]:
    # A lookup failure must propagate; it is not evidence that there are no accounts.
    response = supabase.table('ad_account_connections').select(
        'property_id,account_id,account_name,manager_account_id'
    ).eq('platform', 'google_ads').eq('is_active', True).execute()
    if not isinstance(response.data, list):
        raise RuntimeError('Linked account lookup was not confirmed')
    return response.data


def update_sync_status(supabase, account_id, status, error=None, property_id=None):
    if not property_id:
        raise ValueError('Property identity is required for account status')
    supabase.table('ad_account_connections').update({
        'last_sync_at': 'now()', 'last_sync_status': status,
        'last_sync_error': error, 'updated_at': 'now()'
    }).eq('platform', 'google_ads').eq('account_id', account_id).eq('property_id', property_id).execute()


def run_pipeline_for_account(customer_id, property_id, account_name, manager_id, config, supabase):
    from pipelines.outcome import PipelineOutcome, load_confirmed
    if not property_id:
        raise ValueError('A linked community is required')
    try:
        raw = fetch_google_data(customer_id.replace('-', ''), config, manager_id.replace('-', '') if manager_id else None)
        records = []
        if raw:
            frame = normalize_google_data(raw)
            frame['property_id'] = property_id
            records = frame.to_dict(orient='records')
        outcome = load_confirmed(supabase, records, property_id)
        update_sync_status(supabase, customer_id, 'success' if outcome.status == 'success' else 'failed', outcome.error, property_id)
        return outcome
    except Exception as error:
        # Never turn an unknown write/status acknowledgement into a successful report.
        return PipelineOutcome('error', 'failed', error=str(error))


def run_pipeline():
    from pipelines.outcome import PipelineOutcome, combine
    values = [os.environ.get(key) for key in ('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET')]
    if not all(values):
        return PipelineOutcome('skipped', 'not_requested', error='Google Ads credentials are missing')
    config = dict(zip(('developer_token', 'refresh_token', 'client_id', 'client_secret'), values))
    config['use_proto_plus'] = True
    supabase = get_supabase()
    accounts = get_linked_accounts(supabase)
    # Environment defaults cannot authorize an account/community mapping.
    return combine([run_pipeline_for_account(
        account['account_id'], account['property_id'], account.get('account_name'),
        account.get('manager_account_id') or os.environ.get('GOOGLE_ADS_CUSTOMER_ID'), config, supabase
    ) for account in accounts])


if __name__ == '__main__':
    outcome = run_pipeline()
    print(outcome)
    raise SystemExit(1 if outcome.status == 'error' else 0)
