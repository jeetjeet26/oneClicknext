import pandas as pd
from typing import List, Dict, Any
import hashlib


def normalize_meta_data(raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Normalizes raw Meta Ads insights data into a unified schema.
    """
    if not raw_data:
        return pd.DataFrame()

    df = pd.DataFrame(raw_data)
    
    # Rename columns to match fact_marketing_performance schema
    # Expected Meta fields: 'campaign_name', 'spend', 'impressions', 'clicks', 'date_start'
    
    normalized = pd.DataFrame()
    normalized['date'] = pd.to_datetime(df.get('date_start', '')).dt.strftime('%Y-%m-%d')
    normalized['channel_id'] = 'meta_ads'
    normalized['source_account_id'] = df['account_id'].astype(str)
    normalized['currency_code'] = df['account_currency']
    normalized['campaign_name'] = df.get('campaign_name', 'Unknown')
    normalized['campaign_id'] = df.get('campaign_id', '')
    normalized['impressions'] = pd.to_numeric(df.get('impressions', 0))
    normalized['clicks'] = pd.to_numeric(df.get('clicks', 0))
    normalized['spend'] = pd.to_numeric(df.get('spend', 0.0))
    
    # Calculate conversions if actions exist (simplified)
    # In production, we'd parse the 'actions' list column
    normalized['conversions'] = df['actions'].apply(lambda actions: sum(float(a['value']) for a in actions if a.get('action_type') in {'lead', 'purchase', 'complete_registration'})) if 'actions' in df else 0
    
    return normalized


def normalize_ga4_data(raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Normalizes raw GA4 analytics data into a unified schema for fact_marketing_performance.
    
    GA4 data is slightly different from ad platform data:
    - No direct 'spend' (GA4 doesn't track ad spend)
    - Uses sessions/users instead of impressions
    - Campaign data comes from UTM parameters
    
    Args:
        raw_data: List of dictionaries from GA4 API response
        
    Returns:
        DataFrame matching fact_marketing_performance schema
    """
    if not raw_data:
        return pd.DataFrame()
    
    df = pd.DataFrame(raw_data)
    
    normalized = pd.DataFrame()
    
    # Date handling - GA4 returns YYYYMMDD format
    normalized['date'] = pd.to_datetime(df['date'], format='%Y%m%d').dt.strftime('%Y-%m-%d')
    
    # Channel identification
    normalized['channel_id'] = 'ga4'
    
    # Campaign name from UTM or source/medium combo
    if 'campaign' in df.columns:
        normalized['campaign_name'] = df['campaign'].replace('(not set)', 'Organic / Direct')
    else:
        # Create campaign name from source/medium
        normalized['campaign_name'] = df.apply(
            lambda x: f"{x.get('source', 'unknown')} / {x.get('medium', 'none')}", 
            axis=1
        )
    
    # Generate unique campaign_id from source/medium/campaign combo
    def generate_campaign_id(row):
        key = f"ga4_{row.get('source', '')}_{row.get('medium', '')}_{row.get('campaign', '')}"
        return hashlib.md5(key.encode()).hexdigest()[:16]
    
    normalized['campaign_id'] = df.apply(generate_campaign_id, axis=1)
    
    # Map GA4 metrics to marketing performance schema
    # sessions = impressions (not exact but closest analogy)
    normalized['impressions'] = pd.to_numeric(df.get('sessions', df.get('pageviews', 0)), errors='coerce').fillna(0).astype(int)
    
    # engaged_sessions or users = clicks (engagement proxy)
    if 'engaged_sessions' in df.columns:
        normalized['clicks'] = pd.to_numeric(df['engaged_sessions'], errors='coerce').fillna(0).astype(int)
    else:
        normalized['clicks'] = pd.to_numeric(df.get('users', 0), errors='coerce').fillna(0).astype(int)
    
    # GA4 doesn't have spend data - set to 0
    normalized['spend'] = 0.0
    
    # Conversions
    normalized['conversions'] = pd.to_numeric(df.get('conversions', 0), errors='raise').fillna(0)
    
    return normalized


def normalize_google_ads_data(raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Normalizes raw Google Ads data into a unified schema.
    
    Args:
        raw_data: List of dictionaries from Google Ads API
        
    Returns:
        DataFrame matching fact_marketing_performance schema
    """
    if not raw_data:
        return pd.DataFrame()
    
    df = pd.DataFrame(raw_data)
    
    normalized = pd.DataFrame()
    normalized['date'] = pd.to_datetime(df.get('date', df.get('segments.date', '')))
    normalized['channel_id'] = 'google_ads'
    normalized['campaign_name'] = df.get('campaign_name', df.get('campaign.name', 'Unknown'))
    normalized['campaign_id'] = df.get('campaign_id', df.get('campaign.id', '')).astype(str)
    normalized['impressions'] = pd.to_numeric(df.get('impressions', df.get('metrics.impressions', 0)), errors='coerce').fillna(0).astype(int)
    normalized['clicks'] = pd.to_numeric(df.get('clicks', df.get('metrics.clicks', 0)), errors='coerce').fillna(0).astype(int)
    
    # Google Ads returns cost in micros (divide by 1,000,000)
    cost_col = df.get('cost', df.get('cost_micros', df.get('metrics.cost_micros', 0)))
    normalized['spend'] = pd.to_numeric(cost_col, errors='coerce').fillna(0) / 1_000_000
    
    normalized['conversions'] = pd.to_numeric(df.get('conversions', df.get('metrics.conversions', 0)), errors='raise').fillna(0)
    
    return normalized

