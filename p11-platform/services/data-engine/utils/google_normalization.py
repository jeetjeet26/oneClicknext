import pandas as pd
from typing import List, Dict, Any

def normalize_google_data(raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Normalizes raw Google Ads data.
    """
    if not raw_data:
        return pd.DataFrame()

    df = pd.DataFrame(raw_data)
    
    normalized = pd.DataFrame()
    normalized['date'] = pd.to_datetime(df.get('date', '')).dt.strftime('%Y-%m-%d')
    normalized['channel_id'] = 'google_ads'
    normalized['source_account_id'] = df['source_account_id']
    normalized['currency_code'] = df['currency_code']
    normalized['campaign_name'] = df.get('campaign.name', 'Unknown')
    normalized['campaign_id'] = df.get('campaign.id', '')
    
    # Google Metrics are often strings or micros
    normalized['impressions'] = pd.to_numeric(df.get('metrics.impressions', 0))
    normalized['clicks'] = pd.to_numeric(df.get('metrics.clicks', 0))
    
    # Micros to currency (divide by 1,000,000)
    cost_micros = pd.to_numeric(df.get('metrics.cost_micros', 0))
    normalized['spend'] = cost_micros / 1_000_000
    
    normalized['conversions'] = pd.to_numeric(df.get('metrics.conversions', 0))
    
    return normalized



























