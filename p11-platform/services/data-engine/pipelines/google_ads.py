import os
import sys
from typing import List, Dict, Any, Optional

# Load environment from root .env before anything else
from utils.config import TARGET_PROPERTY_ID
from utils.google_normalization import normalize_google_data
from utils.supabase_client import get_supabase

# Try importing official library, usually installed via `pip install google-ads`
# If not present, we will fallback or fail.
try:
    from google.ads.googleads.client import GoogleAdsClient
except ImportError:
    print("Error: 'google-ads' library not found. Install it via `pip install google-ads`")
    sys.exit(1)


def fetch_google_data(customer_id: str, client_config: Dict, login_customer_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetches Campaign performance via GAQL.
    
    Args:
        customer_id: The Google Ads customer ID (without dashes)
        client_config: Configuration dict for GoogleAdsClient
        login_customer_id: Optional MCC/manager account ID for accessing sub-accounts
    """
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
    """
    Fetch all active Google Ads account connections from the database.
    Returns list of dicts with property_id, account_id, account_name, manager_account_id.
    """
    try:
        response = supabase.table('ad_account_connections').select(
            'property_id, account_id, account_name, manager_account_id'
        ).eq('platform', 'google_ads').eq('is_active', True).execute()
        
        return response.data or []
    except Exception as e:
        print(f"Error fetching linked accounts: {e}")
        return []


def update_sync_status(supabase, account_id: str, status: str, error: Optional[str] = None, property_id: Optional[str] = None):
    """Update the sync status for an ad account connection."""
    if not property_id:
        raise ValueError('Property identity is required for account status')
    try:
        update_data = {
            'last_sync_at': 'now()',
            'last_sync_status': status,
            'last_sync_error': error,
            'updated_at': 'now()'
        }
        supabase.table('ad_account_connections').update(update_data).eq(
            'platform', 'google_ads'
        ).eq('account_id', account_id).eq('property_id', property_id).execute()
    except Exception as e:
        print(f"Warning: Could not update sync status: {e}")


def run_pipeline_for_account(
    customer_id: str, 
    property_id: str, 
    account_name: str,
    manager_id: Optional[str],
    config: Dict,
    supabase
) -> bool:
    """
    Run the pipeline for a single Google Ads account.
    Returns True if successful, False otherwise.
    """
    print(f"\n--- Processing: {account_name} ({customer_id}) → Property {property_id[:8]}...")
    
    # Remove dashes from customer ID for API
    clean_customer_id = customer_id.replace("-", "")
    clean_manager_id = manager_id.replace("-", "") if manager_id else None
    
    try:
        # Fetch data
        raw_data = fetch_google_data(clean_customer_id, config, clean_manager_id)
        print(f"    Fetched {len(raw_data)} records")
        
        if not raw_data:
            print(f"    No data returned for this account")
            update_sync_status(supabase, customer_id, 'success', property_id=property_id)
            return True
        
        # Normalize
        df = normalize_google_data(raw_data)
        df['property_id'] = property_id
        
        # Load to Supabase
        records = df.to_dict(orient='records')
        
        response = supabase.table('fact_marketing_performance').upsert(
            records, on_conflict="date,property_id,channel_id,source_account_id,campaign_id"
        ).execute()
        
        print(f"    ✓ Loaded {len(records)} rows")
        update_sync_status(supabase, customer_id, 'success', property_id=property_id)
        return True
        
    except Exception as e:
        error_msg = str(e)
        print(f"    ✗ Error: {error_msg}")
        update_sync_status(supabase, customer_id, 'failed', error_msg, property_id=property_id)
        return False


def run_pipeline():
    """
    Main pipeline entry point.
    
    Behavior:
    1. If linked accounts exist in the database, process each one
    2. If no linked accounts, fall back to legacy env var behavior (single account)
    """
    print("=" * 60)
    print("Starting Google Ads Pipeline...")
    print("=" * 60)
    
    # 1. Check credentials
    MCC_ID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID")  # MCC account ID
    DEVELOPER_TOKEN = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN")
    REFRESH_TOKEN = os.environ.get("GOOGLE_ADS_REFRESH_TOKEN")
    CLIENT_ID = os.environ.get("GOOGLE_ADS_CLIENT_ID")
    CLIENT_SECRET = os.environ.get("GOOGLE_ADS_CLIENT_SECRET")

    if not all([MCC_ID, DEVELOPER_TOKEN, REFRESH_TOKEN, CLIENT_ID, CLIENT_SECRET]):
        print("⚠ Skipping: Missing Google Ads credentials in env.")
        print("  Required: GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN,")
        print("            GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET")
        return

    # Client config for the library
    config = {
        "developer_token": DEVELOPER_TOKEN,
        "refresh_token": REFRESH_TOKEN,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "use_proto_plus": True
    }
    
    supabase = get_supabase()
    
    # 2. Check for linked accounts in database
    linked_accounts = get_linked_accounts(supabase)
    
    if linked_accounts:
        # Multi-tenant mode: Process each linked account
        print(f"\n✓ Found {len(linked_accounts)} linked Google Ads account(s)")
        
        success_count = 0
        fail_count = 0
        
        for account in linked_accounts:
            success = run_pipeline_for_account(
                customer_id=account['account_id'],
                property_id=account['property_id'],
                account_name=account.get('account_name', account['account_id']),
                manager_id=account.get('manager_account_id') or MCC_ID,
                config=config,
                supabase=supabase
            )
            if success:
                success_count += 1
            else:
                fail_count += 1
        
        logger.info(f"\n" + "=" * 60)
        logger.info(f"Pipeline Complete: {success_count} succeeded, {fail_count} failed")
        logger.info("=" * 60)
        
    else:
        # Legacy mode: Single account from env var
        print("\n⚠ No linked accounts found in database.")
        print("  Using legacy mode with TARGET_PROPERTY_ID env var.")
        
        LEGACY_PROPERTY_ID = os.environ.get("TARGET_PROPERTY_ID")
        
        if not LEGACY_PROPERTY_ID:
            print("  ⚠ TARGET_PROPERTY_ID not set. Data will not be linked to any property.")
        
        try:
            raw_data = fetch_google_data(
                MCC_ID.replace("-", ""), 
                config,
                MCC_ID.replace("-", "")  # Login as MCC
            )
            print(f"Fetched {len(raw_data)} records from Google Ads API.")
        except Exception as e:
            print(f"Failed to fetch data: {e}")
            return

        if not raw_data:
            print("No data returned.")
            return

        df = normalize_google_data(raw_data)
        
        if LEGACY_PROPERTY_ID:
            df['property_id'] = LEGACY_PROPERTY_ID
            
        print("Data normalized.")
        
        records = df.to_dict(orient='records')
        
        try:
            response = supabase.table('fact_marketing_performance').upsert(
                records, on_conflict="date,property_id,channel_id,source_account_id,campaign_id"
            ).execute()
            print(f"✓ Successfully loaded {len(records)} rows to Supabase.")
        except Exception as e:
            print(f"Database Load Error: {e}")


if __name__ == "__main__":
    run_pipeline()
