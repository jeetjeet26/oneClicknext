"""
Google Calendar Token Health Monitor
Runs every 6 hours to ensure OAuth tokens stay fresh
Prevents tour booking failures due to expired tokens
"""

import asyncio
import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client, Client
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Environment variables
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


async def refresh_token_if_needed(calendar_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Proactively refresh access token if expiring within 24 hours
    Returns: {'status': str, 'access_token': str (optional), 'token_expires_at': str (optional), 'error': str (optional)}
    """
    try:
        credentials = Credentials(
            token=calendar_config['access_token'],
            refresh_token=calendar_config['refresh_token'],
            token_uri='https://oauth2.googleapis.com/token',
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET
        )
        
        # Check if token expires in < 24 hours
        expires_at_str = calendar_config.get('token_expires_at')
        if not expires_at_str:
            return {'status': 'error', 'error': 'No expiration time found'}
            
        expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        
        if expires_at < now + timedelta(hours=24):
            # Refresh proactively
            print(f"[CalendarHealth] Refreshing token for property {calendar_config['property_id']} (expires in <24h)")
            credentials.refresh(Request())
            
            return {
                'status': 'healthy',
                'access_token': credentials.token,
                'token_expires_at': credentials.expiry.isoformat() if credentials.expiry else None
            }
        
        # Token still valid, test with API call
        try:
            service = build('calendar', 'v3', credentials=credentials)
            service.calendarList().list(maxResults=1).execute()
            return {'status': 'healthy'}
        except HttpError as api_error:
            if api_error.resp.status == 401:
                # Token invalid, try to refresh
                credentials.refresh(Request())
                return {
                    'status': 'healthy',
                    'access_token': credentials.token,
                    'token_expires_at': credentials.expiry.isoformat() if credentials.expiry else None
                }
            raise
        
    except Exception as e:
        error_msg = str(e)
        
        if 'invalid_grant' in error_msg:
            return {'status': 'revoked', 'error': 'Refresh token revoked by user'}
        elif 'Token has been expired' in error_msg or 'expired' in error_msg.lower():
            return {'status': 'expired', 'error': 'Refresh token expired'}
        else:
            return {'status': 'error', 'error': error_msg}


async def send_reauth_alert(calendar_config: Dict[str, Any], status: str) -> None:
    """
    Alert property manager that calendar needs re-authorization
    Rate limited to 1 alert per 24 hours
    """
    property_name = calendar_config['properties']['name']
    pm_email = calendar_config['properties'].get('contact_email')
    
    if not pm_email:
        print(f"[Alert] No contact email for property {property_name}")
        return
    
    # Check if alert already sent in last 24 hours
    alert_sent_at = calendar_config.get('alert_sent_at')
    if alert_sent_at:
        last_alert = datetime.fromisoformat(alert_sent_at.replace('Z', '+00:00'))
        if datetime.now(timezone.utc) - last_alert < timedelta(hours=24):
            print(f"[Alert] Skipping alert for {property_name} (already sent in last 24h)")
            return
    
    subject = f"🔴 Action Required: Reconnect Google Calendar for {property_name}"
    
    body = f"""Hi there,

Your Google Calendar connection for {property_name}'s LumaLeasing widget has been disconnected.

Status: {status.upper()}

This means tour bookings are currently unavailable on your website.

TO FIX:
1. Log in to P11 Platform: {os.environ.get('NEXT_PUBLIC_APP_URL', 'https://p11platform.vercel.app')}
2. Go to Settings → LumaLeasing
3. Click "Reconnect Google Calendar"
4. Grant calendar access again

This takes 30 seconds and will restore tour booking functionality immediately.

Questions? Reply to this email or contact support.

P11 Platform Team
"""
    
    print(f"[Alert] Alert delivery not implemented; no email sent to {pm_email} for {property_name}")
    print(f"[Alert] Subject would have been: {subject}")
    print(body)


async def monitor_all_calendars() -> Dict[str, int]:
    """
    Main health check function - runs every 6 hours
    Returns: Summary of results (healthy, refreshed, expired, revoked, errors counts)
    """
    print(f"[CalendarHealth] Starting health check at {datetime.now(timezone.utc).isoformat()}")
    
    # Fetch all active calendar configs
    response = supabase.table('agent_calendars')\
        .select('*, properties(name, contact_email)')\
        .eq('sync_enabled', True)\
        .execute()
    
    calendars = response.data
    
    if not calendars:
        print("[CalendarHealth] No active calendar configurations found")
        return {'healthy': 0, 'refreshed': 0, 'expired': 0, 'revoked': 0, 'errors': 0}
    
    print(f"[CalendarHealth] Checking {len(calendars)} calendar configurations")
    
    results = {
        'healthy': 0,
        'refreshed': 0,
        'expired': 0,
        'revoked': 0,
        'errors': 0
    }
    
    for calendar in calendars:
        try:
            result = await refresh_token_if_needed(calendar)
            
            # Update database
            update_data = {
                'token_status': result['status'],
                'last_health_check_at': datetime.now(timezone.utc).isoformat(),
                'health_check_error': result.get('error'),
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }
            
            if 'access_token' in result:
                # Token was refreshed
                update_data['access_token'] = result['access_token']
                if result.get('token_expires_at'):
                    update_data['token_expires_at'] = result['token_expires_at']
                results['refreshed'] += 1
                print(f"[CalendarHealth] ✅ Refreshed token for property {calendar['property_id']}")
            
            supabase.table('agent_calendars')\
                .update(update_data)\
                .eq('id', calendar['id'])\
                .execute()
            
            # Send alert if token expired/revoked
            if result['status'] in ['expired', 'revoked']:
                await send_reauth_alert(calendar, result['status'])
                results[result['status']] += 1
                print(f"[CalendarHealth] ⚠️ Token {result['status']} for property {calendar['property_id']}")
            elif result['status'] == 'healthy':
                results['healthy'] += 1
            else:
                results['errors'] += 1
                print(f"[CalendarHealth] ❌ Error for property {calendar['property_id']}: {result.get('error')}")
        
        except Exception as e:
            print(f"[CalendarHealth] ❌ Exception processing calendar {calendar['id']}: {str(e)}")
            results['errors'] += 1
            
            # Update error in database
            supabase.table('agent_calendars')\
                .update({
                    'token_status': 'error',
                    'health_check_error': str(e),
                    'last_health_check_at': datetime.now(timezone.utc).isoformat(),
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                })\
                .eq('id', calendar['id'])\
                .execute()
    
    # Log summary
    print(f"[CalendarHealth] Results: {results}")
    print(f"[CalendarHealth] Completed at {datetime.now(timezone.utc).isoformat()}")
    
    return results


def main():
    """Entry point for cron job"""
    try:
        results = asyncio.run(monitor_all_calendars())
        print(f"\n[CalendarHealth] Final Results:")
        print(f"  ✅ Healthy: {results['healthy']}")
        print(f"  🔄 Refreshed: {results['refreshed']}")
        print(f"  ⚠️ Expired: {results['expired']}")
        print(f"  🔴 Revoked: {results['revoked']}")
        print(f"  ❌ Errors: {results['errors']}")
        
        # Exit with error code if there are failures
        if results['expired'] > 0 or results['revoked'] > 0:
            sys.exit(1)
        
        sys.exit(0)
        
    except Exception as e:
        print(f"[CalendarHealth] Fatal error: {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()
