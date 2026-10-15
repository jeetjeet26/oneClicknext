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
    from pipelines.outcome import PipelineOutcome, load_confirmed
    token, account, property_id = (os.environ.get(key) for key in ('META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'TARGET_PROPERTY_ID'))
    if not token or not account:
        return PipelineOutcome('skipped', 'not_requested', error='Meta credentials are missing')
    if not property_id:
        raise ValueError('A community is required before fetching Meta data')
    supabase = get_supabase()
    binding = supabase.table('ad_account_connections').select('property_id,account_id').eq('platform', 'meta_ads').eq('account_id', account).eq('property_id', property_id).eq('is_active', True).execute()
    if not binding.data:
        raise ValueError('The Meta account is not linked to the selected community')
    raw = MetaAdsClient(token, account).get_insights(date_preset='last_3d')
    records = []
    if raw:
        frame = normalize_meta_data(raw)
        frame['property_id'] = property_id
        records = frame.to_dict(orient='records')
    return load_confirmed(supabase, records, property_id)


if __name__ == '__main__':
    outcome = run_pipeline()
    print(outcome)
    raise SystemExit(1 if outcome.status == 'error' else 0)
