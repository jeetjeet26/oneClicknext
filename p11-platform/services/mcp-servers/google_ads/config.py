"""Configuration for Google Ads MCP Server."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load from multiple possible locations
env_paths = [
    Path(__file__).parent.parent.parent.parent / "apps" / "web" / ".env.local",
    Path(__file__).parent.parent.parent.parent.parent / ".env",
    Path(__file__).parent / ".env",
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

# Google Ads Configuration
GOOGLE_ADS_CUSTOMER_ID = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "").replace("-", "")
GOOGLE_ADS_DEVELOPER_TOKEN = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN")
GOOGLE_ADS_REFRESH_TOKEN = os.environ.get("GOOGLE_ADS_REFRESH_TOKEN")
GOOGLE_ADS_CLIENT_ID = os.environ.get("GOOGLE_ADS_CLIENT_ID")
GOOGLE_ADS_CLIENT_SECRET = os.environ.get("GOOGLE_ADS_CLIENT_SECRET")

# Supabase Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def get_google_ads_config() -> dict:
    """Get Google Ads client configuration dict."""
    if not all([GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, 
                GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET]):
        raise ValueError("Missing Google Ads credentials. Check environment variables.")
    
    return {
        "developer_token": GOOGLE_ADS_DEVELOPER_TOKEN,
        "refresh_token": GOOGLE_ADS_REFRESH_TOKEN,
        "client_id": GOOGLE_ADS_CLIENT_ID,
        "client_secret": GOOGLE_ADS_CLIENT_SECRET,
        "use_proto_plus": True,
        **({"login_customer_id": GOOGLE_ADS_CUSTOMER_ID} if GOOGLE_ADS_CUSTOMER_ID else {}),
    }

def is_configured() -> bool:
    """Check if Google Ads is properly configured."""
    return all([
        GOOGLE_ADS_CUSTOMER_ID,
        GOOGLE_ADS_DEVELOPER_TOKEN,
        GOOGLE_ADS_REFRESH_TOKEN,
        GOOGLE_ADS_CLIENT_ID,
        GOOGLE_ADS_CLIENT_SECRET,
    ])



















