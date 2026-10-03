import os
import requests
import time
from typing import List, Dict, Any

# Load environment from root .env before anything else
from utils.config import TARGET_PROPERTY_ID
from utils.normalization import normalize_meta_data
from utils.supabase_client import get_supabase

# Real production logic for Meta Graph API
class MetaAdsClient:
    def __init__(self, access_token: str, ad_account_id: str):
        self.base_url = "https://graph.facebook.com/v19.0"
        self.access_token = access_token
        self.ad_account_id = ad_account_id.removeprefix("act_")
        
    def get_insights(self, date_preset="yesterday") -> List[Dict[str, Any]]:
        """
        Fetches insights for the ad account.
        """
        url = f"{self.base_url}/act_{self.ad_account_id}/insights"
        params = {
            "access_token": self.access_token,
            "level": "campaign",
            "time_increment": 1,
            "fields": "account_id,account_currency,campaign_name,campaign_id,adset_name,ad_name,spend,impressions,clicks,actions,date_start,date_stop",
            "date_preset": date_preset,
            "limit": 100
        }
        
        all_data = []
        
        while True:
            response = requests.get(url, params=params)
            if response.status_code != 200:
                print(f"Error fetching Meta data: {response.text}")
                response.raise_for_status()
                
            data = response.json()
            rows = data.get('data')
            if not isinstance(rows, list):
                raise ValueError('Meta report page was not confirmed')
            for row in rows:
                if str(row.get('account_id')) != self.ad_account_id.removeprefix('act_') or row.get('account_currency') != 'USD':
                    raise ValueError('Meta report account or USD currency is not confirmed')
                if not row.get('date_start') or row.get('date_start') != row.get('date_stop'):
                    raise ValueError('Meta report must contain daily rows')
            all_data.extend(rows)
            
            # Handle Pagination
            if "paging" in data and "next" in data["paging"]:
                url = data["paging"]["next"]
                # Clear params for next url as it includes them
                params = {} 
                time.sleep(0.5) # Rate limiting
            else:
                break
                
        return all_data

def run_pipeline():
    print("Starting Real Meta Ads Pipeline...")
    
    # 1. Config
    # In production, these come from the 'properties' table in Supabase via a secure query
    # based on the job context. For MVP script, we read env.
    ACCESS_TOKEN = os.environ.get("META_ACCESS_TOKEN")
    AD_ACCOUNT_ID = os.environ.get("META_AD_ACCOUNT_ID")
    PROPERTY_ID = os.environ.get("TARGET_PROPERTY_ID") # To link data to a property
    
    if not ACCESS_TOKEN or not AD_ACCOUNT_ID:
        print("Skipping: META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set.")
        return

    client = MetaAdsClient(ACCESS_TOKEN, AD_ACCOUNT_ID)
    
    # 2. Fetch
    try:
        raw_data = client.get_insights(date_preset="last_3d") # Fetch last 3 days to catch delayed conversions
        print(f"Fetched {len(raw_data)} records from Meta Graph API.")
    except Exception as e:
        print(f"Failed to fetch data: {e}")
        return

    # 3. Normalize
    if not raw_data:
        print("No data returned.")
        return

    df = normalize_meta_data(raw_data)
    
    # Add Property ID context (critical for multi-tenant)
    if PROPERTY_ID:
        df['property_id'] = PROPERTY_ID
        
    print("Data normalized.")
    
    # 4. Load to Supabase
    supabase = get_supabase()
    records = df.to_dict(orient='records')
    
    # Using 'upsert' to handle idempotency (if we run script multiple times for same date)
    try:
        response = supabase.table('fact_marketing_performance').upsert(
            records, on_conflict="date,property_id,channel_id,source_account_id,campaign_id"
        ).execute()
        print(f"Successfully loaded {len(records)} rows to Supabase.")
    except Exception as e:
        print(f"Database Load Error: {e}")

if __name__ == "__main__":
    run_pipeline()
