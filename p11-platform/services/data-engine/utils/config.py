"""
Shared configuration loader for the data-engine.
Loads environment variables from shared root overlays and service-local files.
More specific local files override broader shared files.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment files in order:
# 1) p11-platform/.env
# 2) services/data-engine/.env
# 3) p11-platform/.env.local
# 4) services/data-engine/.env.local
ROOT_DIR = Path(__file__).resolve().parents[3]
ROOT_ENV = ROOT_DIR / ".env"
ROOT_ENV_LOCAL = ROOT_DIR / ".env.local"
LOCAL_DIR = Path(__file__).resolve().parents[1]
LOCAL_ENV = LOCAL_DIR / ".env"
LOCAL_ENV_LOCAL = LOCAL_DIR / ".env.local"

loaded_files = []

# Load root .env if it exists
if ROOT_ENV.exists():
    load_dotenv(ROOT_ENV, override=False)
    loaded_files.append(str(ROOT_ENV))

# Load service-local .env if it exists (overrides root defaults)
if LOCAL_ENV.exists():
    load_dotenv(LOCAL_ENV, override=True)
    loaded_files.append(str(LOCAL_ENV))

# Load shared root .env.local if it exists (overrides non-local defaults)
if ROOT_ENV_LOCAL.exists():
    load_dotenv(ROOT_ENV_LOCAL, override=True)
    loaded_files.append(str(ROOT_ENV_LOCAL))

# Load service-local .env.local if it exists (highest priority)
if LOCAL_ENV_LOCAL.exists():
    load_dotenv(LOCAL_ENV_LOCAL, override=True)
    loaded_files.append(str(LOCAL_ENV_LOCAL))

if loaded_files:
    print(f"[OK] Loaded environment from: {', '.join(loaded_files)}")
else:
    print("[WARN] No .env file found. Using system environment variables.")

# Export commonly used config values
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
TARGET_PROPERTY_ID = os.environ.get("TARGET_PROPERTY_ID")

# Apify configuration for apartments.com scraping
APIFY_API_TOKEN = os.environ.get("APIFY_API_TOKEN")

# Apify proxy configuration
# Proxy types: "residential" (recommended for apartments.com), "datacenter" (cheaper but may be blocked)
APIFY_PROXY_TYPE = os.environ.get("APIFY_PROXY_TYPE", "residential")
# Country code for geo-targeting (US recommended for apartments.com)
APIFY_PROXY_COUNTRY = os.environ.get("APIFY_PROXY_COUNTRY", "US")

# Google Maps for competitor discovery
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")


