#!/usr/bin/env python3
"""
P11 Data Engine - Pipeline Runner
==================================
Standalone script for running all ETL pipelines.
Can be triggered via CLI, GitHub Actions, or CRON.

Usage:
    python run_pipelines.py              # Run all pipelines
    python run_pipelines.py --meta       # Run Meta Ads only
    python run_pipelines.py --google     # Run Google Ads only
    python run_pipelines.py --ga4        # Run GA4 only
    python run_pipelines.py --dry-run    # Check config without running
"""

import os
import sys
import argparse
import json
from datetime import datetime
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables from .env files
from utils.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

# ANSI color codes for terminal output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def log(message: str, level: str = "info"):
    """Colored logging with timestamps."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    colors = {
        "info": Colors.CYAN,
        "success": Colors.GREEN,
        "warning": Colors.YELLOW,
        "error": Colors.RED,
        "header": Colors.HEADER + Colors.BOLD,
    }
    color = colors.get(level, Colors.ENDC)
    print(f"{color}[{timestamp}] {message}{Colors.ENDC}")


def check_config() -> dict:
    """Check which pipelines are properly configured."""
    config_status = {
        "supabase": {
            "configured": bool(SUPABASE_URL and SUPABASE_SERVICE_KEY),
            "missing": []
        },
        "meta_ads": {
            "configured": bool(
                os.environ.get("META_ACCESS_TOKEN") and 
                os.environ.get("META_AD_ACCOUNT_ID")
            ),
            "missing": []
        },
        "google_ads": {
            "configured": bool(
                os.environ.get("GOOGLE_ADS_CUSTOMER_ID") and 
                os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN")
            ),
            "missing": []
        },
        "ga4": {
            "configured": bool(
                os.environ.get("GA4_PROPERTY_ID") and
                (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or 
                 os.environ.get("GA4_CREDENTIALS_JSON"))
            ),
            "missing": []
        }
    }
    
    # Check for missing variables
    if not SUPABASE_URL:
        config_status["supabase"]["missing"].append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        config_status["supabase"]["missing"].append("SUPABASE_SERVICE_ROLE_KEY")
    
    if not os.environ.get("META_ACCESS_TOKEN"):
        config_status["meta_ads"]["missing"].append("META_ACCESS_TOKEN")
    if not os.environ.get("META_AD_ACCOUNT_ID"):
        config_status["meta_ads"]["missing"].append("META_AD_ACCOUNT_ID")
    
    if not os.environ.get("GOOGLE_ADS_CUSTOMER_ID"):
        config_status["google_ads"]["missing"].append("GOOGLE_ADS_CUSTOMER_ID")
    if not os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN"):
        config_status["google_ads"]["missing"].append("GOOGLE_ADS_DEVELOPER_TOKEN")
    
    if not os.environ.get("GA4_PROPERTY_ID"):
        config_status["ga4"]["missing"].append("GA4_PROPERTY_ID")
    if not (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("GA4_CREDENTIALS_JSON")):
        config_status["ga4"]["missing"].append("GOOGLE_APPLICATION_CREDENTIALS or GA4_CREDENTIALS_JSON")
    
    return config_status


def run_confirmed_pipeline(name: str) -> dict:
    from importlib import import_module
    from pipelines.outcome import PipelineOutcome
    try:
        outcome = import_module(f'pipelines.{name}').run_pipeline()
        if not isinstance(outcome, PipelineOutcome):
            raise RuntimeError('Pipeline returned no confirmed outcome')
        return outcome.result(name)
    except Exception as error:
        return PipelineOutcome('error', 'failed', error=str(error)).result(name)


def run_meta_pipeline() -> dict:
    return run_confirmed_pipeline('meta_ads')


def run_google_pipeline() -> dict:
    return run_confirmed_pipeline('google_ads')


def run_ga4_pipeline() -> dict:
    return run_confirmed_pipeline('ga4')


def print_summary(results: list, start_time: datetime):
    """Print a summary of pipeline execution."""
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    log("=" * 60, "header")
    log("PIPELINE EXECUTION SUMMARY", "header")
    log("=" * 60, "header")
    
    successful = sum(1 for r in results if r["status"] == "success")
    failed = sum(1 for r in results if r["status"] == "error")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    
    for result in results:
        status_icon = "✅" if result["status"] == "success" else "❌" if result["status"] == "error" else "⏭️"
        log(f"  {status_icon} {result['pipeline']}: {result['status']}", 
            "success" if result["status"] == "success" else "error" if result["status"] == "error" else "warning")
        if result["error"]:
            log(f"     Error: {result['error']}", "error")
    
    log("-" * 60, "info")
    log(f"Total: {len(results)} pipelines | ✅ {successful} success | ❌ {failed} failed | ⏭️ {skipped} skipped", "info")
    log(f"Duration: {duration:.2f} seconds", "info")
    log("=" * 60, "header")
    
    # Return exit code based on results
    return 0 if failed == 0 else 1


def main():
    parser = argparse.ArgumentParser(
        description="P11 Data Engine Pipeline Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_pipelines.py              # Run all configured pipelines
  python run_pipelines.py --meta       # Run Meta Ads only
  python run_pipelines.py --dry-run    # Check configuration only
  python run_pipelines.py --json       # Output results as JSON
        """
    )
    
    parser.add_argument("--meta", action="store_true", help="Run Meta Ads pipeline only")
    parser.add_argument("--google", action="store_true", help="Run Google Ads pipeline only")
    parser.add_argument("--ga4", action="store_true", help="Run GA4 pipeline only")
    parser.add_argument("--dry-run", action="store_true", help="Check configuration without running")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    
    args = parser.parse_args()
    
    start_time = datetime.now()
    
    # Header
    if not args.json:
        log("=" * 60, "header")
        log("P11 DATA ENGINE - PIPELINE RUNNER", "header")
        log(f"Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}", "header")
        log("=" * 60, "header")
    
    # Check configuration
    config = check_config()
    
    if args.dry_run:
        if not args.json:
            log("DRY RUN - Configuration Check", "warning")
            log("-" * 40, "info")
            
            for name, status in config.items():
                icon = "✅" if status["configured"] else "❌"
                level = "success" if status["configured"] else "error"
                log(f"  {icon} {name}: {'Configured' if status['configured'] else 'Not Configured'}", level)
                if status["missing"]:
                    for var in status["missing"]:
                        log(f"     Missing: {var}", "warning")
        else:
            print(json.dumps({"dry_run": True, "config": config}, indent=2))
        return 0
    
    # Check if Supabase is configured (required for all pipelines)
    if not config["supabase"]["configured"]:
        log("ERROR: Supabase is not configured. Cannot run pipelines.", "error")
        log("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.", "warning")
        return 1
    
    # Determine which pipelines to run
    run_all = not (args.meta or args.google or args.ga4)
    results = []
    
    # Run selected pipelines
    if args.meta or run_all:
        if config["meta_ads"]["configured"]:
            results.append(run_meta_pipeline())
        else:
            if not args.json:
                log("Skipping Meta Ads: Not configured", "warning")
            results.append({"pipeline": "meta_ads", "status": "skipped", "records": 0, "error": "Not configured"})
    
    if args.google or run_all:
        if config["google_ads"]["configured"]:
            results.append(run_google_pipeline())
        else:
            if not args.json:
                log("Skipping Google Ads: Not configured", "warning")
            results.append({"pipeline": "google_ads", "status": "skipped", "records": 0, "error": "Not configured"})
    
    if args.ga4 or run_all:
        if config["ga4"]["configured"]:
            results.append(run_ga4_pipeline())
        else:
            if not args.json:
                log("Skipping GA4: Not configured", "warning")
            results.append({"pipeline": "ga4", "status": "skipped", "records": 0, "error": "Not configured"})
    
    # Output results
    if args.json:
        output = {
            "start_time": start_time.isoformat(),
            "end_time": datetime.now().isoformat(),
            "duration_seconds": (datetime.now() - start_time).total_seconds(),
            "results": results
        }
        print(json.dumps(output, indent=2))
    else:
        exit_code = print_summary(results, start_time)
        return exit_code
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

