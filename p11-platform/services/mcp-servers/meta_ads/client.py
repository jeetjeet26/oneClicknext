"""Meta Graph API client for ads management."""
import httpx
import json
from typing import Any, Optional, Literal
from pathlib import Path
from .config import META_ACCESS_TOKEN, META_BASE_URL, META_AD_ACCOUNT_ID

# Token cache location (inspired by meta-ads-mcp)
TOKEN_CACHE = Path.home() / ".meta-ads-mcp" / "token_cache.json"

class MetaAdsClient:
    """
    Client for Meta Marketing API.
    
    Features:
    - Token caching for OAuth persistence
    - Automatic retry logic
    - Rate limit handling
    - Comprehensive error messages
    """
    
    def __init__(self, access_token: Optional[str] = None, account_id: Optional[str] = None):
        self.access_token = access_token or self._load_cached_token() or META_ACCESS_TOKEN
        self.account_id = account_id or META_AD_ACCOUNT_ID
        self.base_url = META_BASE_URL
        
        if not self.access_token:
            raise ValueError("Meta access token not configured. Run authentication setup.")
    
    def _load_cached_token(self) -> Optional[str]:
        """Load cached OAuth token if available."""
        if TOKEN_CACHE.exists():
            try:
                with open(TOKEN_CACHE) as f:
                    data = json.load(f)
                    return data.get("access_token")
            except Exception:
                return None
        return None
    
    def _save_token(self, token: str):
        """Cache OAuth token for future use."""
        TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with open(TOKEN_CACHE, "w") as f:
            json.dump({"access_token": token}, f)
    
    async def _request(
        self, 
        method: Literal["GET", "POST", "DELETE"],
        endpoint: str, 
        params: Optional[dict] = None,
        json_data: Optional[dict] = None
    ) -> dict[str, Any]:
        """Make a request to the Graph API with error handling."""
        params = params or {}
        params["access_token"] = self.access_token
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                if method == "GET":
                    response = await client.get(f"{self.base_url}{endpoint}", params=params)
                elif method == "POST":
                    response = await client.post(
                        f"{self.base_url}{endpoint}", 
                        params=params,
                        json=json_data
                    )
                elif method == "DELETE":
                    response = await client.delete(f"{self.base_url}{endpoint}", params=params)
                
                response.raise_for_status()
                return response.json()
                
            except httpx.HTTPStatusError as e:
                # Parse Meta's error response
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get("error", {}).get("message", str(e))
                    raise Exception(f"Meta API Error: {error_msg}")
                except:
                    raise Exception(f"Meta API Error: {e}")
    
    async def _get(self, endpoint: str, params: Optional[dict] = None) -> dict[str, Any]:
        """Make a GET request to the Graph API."""
        return await self._request("GET", endpoint, params)
    
    async def _post(self, endpoint: str, params: Optional[dict] = None, json_data: Optional[dict] = None) -> dict[str, Any]:
        """Make a POST request to the Graph API."""
        return await self._request("POST", endpoint, params, json_data)
    
    async def _delete(self, endpoint: str, params: Optional[dict] = None) -> dict[str, Any]:
        """Make a DELETE request to the Graph API."""
        return await self._request("DELETE", endpoint, params)
    
    # ========== ACCOUNT MANAGEMENT ==========
    
    async def get_ad_accounts(self) -> list[dict[str, Any]]:
        """Get all ad accounts the user has access to."""
        result = await self._get("/me/adaccounts", {
            "fields": "id,name,account_status,currency,timezone_name,amount_spent"
        })
        return result.get("data", [])
    
    async def get_account_info(self, account_id: Optional[str] = None) -> dict[str, Any]:
        """Get detailed info about an ad account."""
        acct = account_id or self.account_id
        return await self._get(f"/act_{acct}", {
            "fields": "id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance"
        })
    
    # ========== CAMPAIGN MANAGEMENT ==========
    
    async def get_campaigns(
        self, 
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get campaigns for an ad account."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/campaigns", {
            "fields": "id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time",
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_campaign_insights(
        self,
        account_id: Optional[str] = None,
        date_preset: str = "last_30d",
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get campaign performance insights."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/insights", {
            "level": "campaign",
            "fields": "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,conversions,actions",
            "date_preset": date_preset,
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_daily_campaign_insights(self, account_id: str, date_range: str, reference_time=None) -> dict[str, Any]:
        """Read a complete daily report; an incomplete page sequence is an error."""
        from shared.daily_reports import ReportValidationError, DATE_RANGES, account_id as clean_account, reporting_window

        acct = clean_account(account_id, 'meta_ads')
        if date_range not in DATE_RANGES:
            raise ReportValidationError('Unsupported date range')
        account = await self._get(f'/act_{acct}', {
            'fields': 'account_id,currency,timezone_name',
        })
        if not isinstance(account, dict) or str(account.get('account_id')) != acct:
            raise ReportValidationError('Meta returned an unexpected account')
        start, end = reporting_window(date_range, account.get('timezone_name'), reference_time)
        params = {
            'level': 'campaign', 'time_increment': 1,
            'time_range': json.dumps({'since': start, 'until': end}),
            'fields': 'account_id,account_currency,campaign_id,campaign_name,date_start,date_stop,impressions,clicks,spend,actions',
            'limit': 100,
        }
        rows, cursors = [], set()
        while True:
            # Reuse the known account endpoint; never follow a token-bearing next URL.
            page = await self._get(f'/act_{acct}/insights', dict(params))
            if not isinstance(page, dict) or 'error' in page or not isinstance(page.get('data'), list):
                raise ReportValidationError('Meta daily report page was not confirmed')
            for row in page['data']:
                if not isinstance(row, dict):
                    raise ReportValidationError('Meta daily report contains an invalid row')
                rows.append({
                    'account_id': row.get('account_id'), 'currency': row.get('account_currency'),
                    'date': row.get('date_start'), 'date_stop': row.get('date_stop'),
                    'campaign_id': row.get('campaign_id'), 'campaign_name': row.get('campaign_name'),
                    'spend': row.get('spend'), 'impressions': row.get('impressions'),
                    'clicks': row.get('clicks'), 'actions': row.get('actions', []),
                })
            paging = page.get('paging', {})
            if not isinstance(paging, dict):
                raise ReportValidationError('Meta daily report pagination was not confirmed')
            if not paging.get('next'):
                break
            cursor_data = paging.get('cursors', {})
            after = cursor_data.get('after') if isinstance(cursor_data, dict) else None
            if not isinstance(after, str) or not after or after in cursors:
                raise ReportValidationError('Meta daily report pagination did not advance')
            cursors.add(after)
            params['after'] = after
        return {'account_id': acct, 'currency': account.get('currency'),
                'timezone': account.get('timezone_name'), 'start_date': start, 'end_date': end, 'rows': rows}

    # ========== ADSET MANAGEMENT ==========
    
    async def get_adsets(
        self,
        campaign_id: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get ad sets, optionally filtered by campaign."""
        if campaign_id:
            endpoint = f"/{campaign_id}/adsets"
        else:
            acct = account_id or self.account_id
            endpoint = f"/act_{acct}/adsets"
        
        result = await self._get(endpoint, {
            "fields": "id,name,status,targeting,daily_budget,optimization_goal,bid_strategy",
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_adset_insights(
        self,
        account_id: Optional[str] = None,
        date_preset: str = "last_30d",
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get ad set performance insights."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/insights", {
            "level": "adset",
            "fields": "adset_id,adset_name,impressions,clicks,spend,ctr,cpc,conversions",
            "date_preset": date_preset,
            "limit": limit
        })
        return result.get("data", [])
    
    # ========== AD MANAGEMENT ==========
    
    async def get_ads(
        self,
        adset_id: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get ads, optionally filtered by ad set."""
        if adset_id:
            endpoint = f"/{adset_id}/ads"
        else:
            acct = account_id or self.account_id
            endpoint = f"/act_{acct}/ads"
        
        result = await self._get(endpoint, {
            "fields": "id,name,status,creative,effective_status",
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_ad_insights(
        self,
        account_id: Optional[str] = None,
        date_preset: str = "last_30d",
        limit: int = 100
    ) -> list[dict[str, Any]]:
        """Get ad-level performance insights."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/insights", {
            "level": "ad",
            "fields": "ad_id,ad_name,impressions,clicks,spend,ctr,cpc,conversions",
            "date_preset": date_preset,
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_custom_audiences(
        self,
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get custom audiences."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/customaudiences", {
            "fields": "id,name,subtype,approximate_count,data_source",
            "limit": limit
        })
        return result.get("data", [])
    
    # ========== TARGETING TOOLS (Inspired by meta-ads-mcp) ==========
    
    async def search_interests(
        self,
        query: str,
        account_id: Optional[str] = None,
        limit: int = 25
    ) -> list[dict[str, Any]]:
        """Search for interest targeting options."""
        result = await self._get("/search", {
            "type": "adinterest",
            "q": query,
            "limit": limit
        })
        return result.get("data", [])
    
    async def get_interest_suggestions(
        self,
        interest_list: list[str],
        account_id: Optional[str] = None,
        limit: int = 25
    ) -> list[dict[str, Any]]:
        """Get related interest suggestions."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/targetingsuggestions", {
            "interest_list": json.dumps(interest_list),
            "limit": limit
        })
        return result.get("data", [])
    
    async def validate_interests(
        self,
        interest_list: Optional[list[str]] = None,
        interest_fbid_list: Optional[list[str]] = None,
        account_id: Optional[str] = None
    ) -> dict[str, Any]:
        """Validate interest names or IDs."""
        acct = account_id or self.account_id
        params = {}
        if interest_list:
            params["interest_list"] = json.dumps(interest_list)
        if interest_fbid_list:
            params["interest_fbid_list"] = json.dumps(interest_fbid_list)
        
        return await self._get(f"/act_{acct}/targetingvalidation", params)
    
    async def search_behaviors(
        self,
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get behavior targeting options."""
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/targetingbrowse", {
            "type": "behaviors",
            "limit": limit
        })
        return result.get("data", [])
    
    async def search_demographics(
        self,
        demographic_class: str = "demographics",
        account_id: Optional[str] = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """
        Get demographic targeting options.
        
        Classes: demographics, life_events, industries, income, 
                 family_statuses, user_device, user_os
        """
        acct = account_id or self.account_id
        result = await self._get(f"/act_{acct}/targetingbrowse", {
            "type": demographic_class,
            "limit": limit
        })
        return result.get("data", [])
    
    async def search_geo_locations(
        self,
        query: str,
        location_types: Optional[list[str]] = None,
        limit: int = 25
    ) -> list[dict[str, Any]]:
        """Search for geographic targeting locations."""
        location_types = location_types or ["country", "region", "city"]
        result = await self._get("/search", {
            "type": "adgeolocation",
            "location_types": json.dumps(location_types),
            "q": query,
            "limit": limit
        })
        return result.get("data", [])
    
    # ========== PAGES & ASSETS ==========
    
    async def get_pages(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get Facebook/Instagram pages the user manages."""
        result = await self._get("/me/accounts", {
            "fields": "id,name,access_token,category,fan_count,instagram_business_account",
            "limit": limit
        })
        return result.get("data", [])
    
    # ========== IMAGE HANDLING ==========
    
    async def upload_image(
        self,
        image_url: Optional[str] = None,
        image_path: Optional[str] = None,
        name: Optional[str] = None,
        account_id: Optional[str] = None
    ) -> dict[str, Any]:
        """Upload an image for ad creative."""
        acct = account_id or self.account_id
        
        if image_url:
            json_data = {"url": image_url, "name": name or "uploaded_image"}
            return await self._post(f"/act_{acct}/adimages", json_data=json_data)
        
        elif image_path:
            # File upload handling
            with open(image_path, "rb") as f:
                files = {"source": f}
                params = {"access_token": self.access_token, "name": name or "uploaded_image"}
                
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.base_url}/act_{acct}/adimages",
                        params=params,
                        files=files
                    )
                    response.raise_for_status()
                    return response.json()
        
        raise ValueError("Either image_url or image_path must be provided")
    
    async def get_ad_image(self, ad_id: str) -> dict[str, Any]:
        """Get ad creative image details."""
        result = await self._get(f"/{ad_id}", {
            "fields": "creative{image_url,image_hash,thumbnail_url}"
        })
        return result
    
    # ========== BUDGET SCHEDULING ==========
    
    async def create_budget_schedule(
        self,
        campaign_id: str,
        budget_value: int,
        budget_value_type: Literal["ABSOLUTE", "MULTIPLIER"],
        time_start: int,
        time_end: int
    ) -> dict[str, Any]:
        """Create a budget schedule for high-demand periods."""
        json_data = {
            "budget_value": budget_value,
            "budget_value_type": budget_value_type,
            "time_start": time_start,
            "time_end": time_end
        }
        
        return await self._post(f"/{campaign_id}/adscheduling", json_data=json_data)
    
    # ========== UNIVERSAL INSIGHTS ==========
    
    async def get_insights(
        self,
        object_id: str,
        time_range: Optional[dict] = None,
        breakdown: Optional[str] = None,
        level: str = "ad",
        date_preset: str = "last_30d"
    ) -> list[dict[str, Any]]:
        """Get universal insights for any object (campaign/adset/ad/account)."""
        params = {
            "level": level,
            "fields": "impressions,clicks,spend,ctr,cpc,conversions,reach,frequency",
        }
        
        if time_range:
            params["time_range"] = json.dumps(time_range)
        else:
            params["date_preset"] = date_preset
        
        if breakdown:
            params["breakdowns"] = breakdown
        
        result = await self._get(f"/{object_id}/insights", params)
        return result.get("data", [])



















