"""
GA4 (Google Analytics 4) Pipeline
Fetches analytics data from GA4 properties and normalizes to fact_marketing_performance.

Required Environment Variables:
- GA4_PROPERTY_ID: The GA4 property ID (format: "properties/123456789")
- GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON file
  OR
- GA4_CREDENTIALS_JSON: JSON string of service account credentials

Setup:
1. Create a service account in Google Cloud Console
2. Enable the Google Analytics Data API
3. Add the service account email to your GA4 property (Admin > Property Access Management)
4. Download the JSON key file or set the credentials as an environment variable
"""

import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from utils.config import TARGET_PROPERTY_ID
from utils.normalization import normalize_ga4_data
from utils.supabase_client import get_supabase


class GA4Client:
    """Client for Google Analytics 4 Data API."""
    
    def __init__(self, property_id: str, credentials_path: Optional[str] = None, credentials_json: Optional[str] = None):
        """
        Initialize GA4 client.
        
        Args:
            property_id: GA4 property ID (e.g., "properties/123456789" or just "123456789")
            credentials_path: Path to service account JSON file
            credentials_json: JSON string of service account credentials (alternative to file)
        """
        # Ensure property_id is in correct format
        if not property_id.startswith("properties/"):
            property_id = f"properties/{property_id}"
        self.property_id = property_id
        
        # Import Google Analytics library
        try:
            from google.analytics.data_v1beta import BetaAnalyticsDataClient
            from google.analytics.data_v1beta.types import (
                DateRange,
                Dimension,
                Metric,
                RunReportRequest,
            )
            from google.oauth2 import service_account
        except ImportError:
            raise ImportError(
                "google-analytics-data library not installed. "
                "Run: pip install google-analytics-data"
            )
        
        self.DateRange = DateRange
        self.Dimension = Dimension
        self.Metric = Metric
        self.RunReportRequest = RunReportRequest
        
        # Initialize credentials
        if credentials_json:
            # Parse JSON string to dict
            creds_dict = json.loads(credentials_json)
            credentials = service_account.Credentials.from_service_account_info(creds_dict)
            self.client = BetaAnalyticsDataClient(credentials=credentials)
        elif credentials_path:
            credentials = service_account.Credentials.from_service_account_file(credentials_path)
            self.client = BetaAnalyticsDataClient(credentials=credentials)
        else:
            # Fallback to default credentials (GOOGLE_APPLICATION_CREDENTIALS env var)
            self.client = BetaAnalyticsDataClient()
    
    def get_traffic_data(
        self, 
        start_date: str = "7daysAgo", 
        end_date: str = "yesterday"
    ) -> List[Dict[str, Any]]:
        """
        Fetch traffic and acquisition data from GA4.
        
        Args:
            start_date: Start date (YYYY-MM-DD or relative like "7daysAgo", "yesterday")
            end_date: End date (YYYY-MM-DD or relative)
            
        Returns:
            List of dictionaries with normalized data
        """
        request = self.RunReportRequest(
            property=self.property_id,
            dimensions=[
                self.Dimension(name="date"),
                self.Dimension(name="sessionSource"),
                self.Dimension(name="sessionMedium"),
                self.Dimension(name="sessionCampaignName"),
            ],
            metrics=[
                self.Metric(name="sessions"),
                self.Metric(name="totalUsers"),
                self.Metric(name="newUsers"),
                self.Metric(name="screenPageViews"),
                self.Metric(name="bounceRate"),
                self.Metric(name="averageSessionDuration"),
                self.Metric(name="conversions"),
            ],
            date_ranges=[
                self.DateRange(start_date=start_date, end_date=end_date)
            ],
        )
        
        response = self.client.run_report(request)
        
        # Parse response into list of dicts
        data = []
        for row in response.rows:
            record = {
                "date": row.dimension_values[0].value,
                "source": row.dimension_values[1].value,
                "medium": row.dimension_values[2].value,
                "campaign": row.dimension_values[3].value,
                "sessions": int(row.metric_values[0].value),
                "users": int(row.metric_values[1].value),
                "new_users": int(row.metric_values[2].value),
                "pageviews": int(row.metric_values[3].value),
                "bounce_rate": float(row.metric_values[4].value),
                "avg_session_duration": float(row.metric_values[5].value),
                "conversions": float(row.metric_values[6].value),
            }
            data.append(record)
        
        return data
    
    def get_channel_performance(
        self,
        start_date: str = "7daysAgo",
        end_date: str = "yesterday"
    ) -> List[Dict[str, Any]]:
        """
        Fetch channel-level performance for marketing analysis.
        Groups by default channel grouping for easier analysis.
        """
        request = self.RunReportRequest(
            property=self.property_id,
            dimensions=[
                self.Dimension(name="date"),
                self.Dimension(name="sessionDefaultChannelGrouping"),
            ],
            metrics=[
                self.Metric(name="sessions"),
                self.Metric(name="totalUsers"),
                self.Metric(name="conversions"),
                self.Metric(name="engagedSessions"),
            ],
            date_ranges=[
                self.DateRange(start_date=start_date, end_date=end_date)
            ],
        )
        
        response = self.client.run_report(request)
        
        data = []
        for row in response.rows:
            record = {
                "date": row.dimension_values[0].value,
                "channel": row.dimension_values[1].value,
                "sessions": int(row.metric_values[0].value),
                "users": int(row.metric_values[1].value),
                "conversions": float(row.metric_values[2].value),
                "engaged_sessions": int(row.metric_values[3].value),
            }
            data.append(record)
        
        return data


def run_pipeline():
    """Execute the GA4 data pipeline."""
    print("=" * 60)
    print("Starting GA4 Analytics Pipeline...")
    print("=" * 60)
    
    # 1. Configuration
    GA4_PROPERTY_ID = os.environ.get("GA4_PROPERTY_ID")
    GA4_CREDENTIALS_PATH = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    GA4_CREDENTIALS_JSON = os.environ.get("GA4_CREDENTIALS_JSON")
    PROPERTY_ID = os.environ.get("TARGET_PROPERTY_ID")
    
    if not GA4_PROPERTY_ID:
        print("⚠ Skipping: GA4_PROPERTY_ID not set.")
        print("  Set this to your GA4 property ID (e.g., '123456789')")
        return
    
    if not GA4_CREDENTIALS_PATH and not GA4_CREDENTIALS_JSON:
        print("⚠ Skipping: No GA4 credentials found.")
        print("  Set GOOGLE_APPLICATION_CREDENTIALS (path) or GA4_CREDENTIALS_JSON (JSON string)")
        return
    
    # 2. Initialize client
    try:
        client = GA4Client(
            property_id=GA4_PROPERTY_ID,
            credentials_path=GA4_CREDENTIALS_PATH,
            credentials_json=GA4_CREDENTIALS_JSON
        )
        print(f"✓ Connected to GA4 property: {GA4_PROPERTY_ID}")
    except Exception as e:
        print(f"✗ Failed to initialize GA4 client: {e}")
        return
    
    # 3. Fetch data (last 3 days to catch delayed data)
    try:
        raw_data = client.get_traffic_data(
            start_date="3daysAgo",
            end_date="yesterday"
        )
        print(f"✓ Fetched {len(raw_data)} records from GA4 API.")
    except Exception as e:
        print(f"✗ Failed to fetch GA4 data: {e}")
        return
    
    if not raw_data:
        print("⚠ No data returned from GA4.")
        return
    
    # 4. Normalize data
    df = normalize_ga4_data(raw_data)
    df['source_account_id'] = GA4_PROPERTY_ID.removeprefix('properties/')
    df['currency_code'] = None
    
    # Add Property ID context (critical for multi-tenant)
    if PROPERTY_ID:
        df['property_id'] = PROPERTY_ID
    else:
        print("⚠ Warning: TARGET_PROPERTY_ID not set. Data won't be linked to a property.")
    
    print(f"✓ Data normalized: {len(df)} rows")
    
    # 5. Load to Supabase
    try:
        supabase = get_supabase()
        records = df.to_dict(orient='records')
        
        # Using 'upsert' for idempotency
        response = supabase.table('fact_marketing_performance').upsert(
            records, 
            on_conflict="date,property_id,channel_id,source_account_id,campaign_id"
        ).execute()
        
        print(f"✓ Successfully loaded {len(records)} rows to Supabase.")
    except Exception as e:
        print(f"✗ Database Load Error: {e}")
        return
    
    print("=" * 60)
    print("GA4 Pipeline completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    run_pipeline()

