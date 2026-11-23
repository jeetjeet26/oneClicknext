"""Configuration for Meta Ads MCP Server."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment
env_paths = [
    Path(__file__).parent.parent.parent.parent / "apps" / "web" / ".env.local",
    Path(__file__).parent.parent.parent.parent.parent / ".env",
    Path(__file__).parent / ".env",
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

# Meta Ads Configuration
META_ACCESS_TOKEN = os.environ.get("META_ACCESS_TOKEN")
META_AD_ACCOUNT_ID = os.environ.get("META_AD_ACCOUNT_ID")
META_APP_ID = os.environ.get("META_APP_ID")
META_APP_SECRET = os.environ.get("META_APP_SECRET")

# API Version
META_API_VERSION = "v26.0"
META_BASE_URL = f"https://graph.facebook.com/{META_API_VERSION}"

# Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def is_configured() -> bool:
    """Check if Meta Ads is properly configured."""
    return bool(META_ACCESS_TOKEN and META_AD_ACCOUNT_ID)



















