"""Performance reporting tools."""
from typing import Any, Literal, Optional
from pathlib import Path
import sys

# Add shared to path
sys.path.append(str(Path(__file__).parent.parent.parent))
from shared.formatters import format_currency, format_number

from ..auth import get_client, get_mcc_id, clean_customer_id

DateRange = Literal[
    "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS", 
    "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"
]

async def get_campaign_performance(
    customer_id: str,
    date_range: DateRange = "LAST_30_DAYS",
    limit: int = 20,
    order_by: str = "metrics.cost_micros DESC",
    campaign_id: Optional[str] = None,
    campaign_name_filter: Optional[str] = None
) -> list[dict[str, Any]]:
    """
    Get campaign performance metrics.
    
    Args:
        customer_id: Google Ads customer ID (format: 123-456-7890)
        date_range: GAQL date preset (LAST_7_DAYS, LAST_30_DAYS, etc.)
        limit: Maximum campaigns to return
        order_by: Sort order (default: by spend descending)
        campaign_id: Optional - filter by specific campaign ID
        campaign_name_filter: Optional - filter by campaign name substring
    
    Returns:
        List of campaigns with performance metrics.
    """
    client = get_client()
    mcc_id = get_mcc_id()
    clean_id = clean_customer_id(customer_id)
    
    # Build WHERE clause
    where_clauses = [f"segments.date DURING {date_range}"]
    if campaign_id:
        where_clauses.append(f"campaign.id = {campaign_id}")
    if campaign_name_filter:
        where_clauses.append(f"campaign.name LIKE '%{campaign_name_filter}%'")
    
    where_clause = " AND ".join(where_clauses)
    
    query = f"""
        SELECT 
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign_budget.amount_micros,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.ctr,
            metrics.average_cpc
        FROM campaign
        WHERE {where_clause}
        ORDER BY {order_by}
        LIMIT {limit}
    """
    
    ga_service = client.get_service("GoogleAdsService")
    response = ga_service.search(
        customer_id=clean_id,
        query=query,
        login_customer_id=mcc_id
    )
    
    campaigns = []
    for row in response:
        ctr = row.metrics.ctr * 100 if row.metrics.ctr else 0
        campaigns.append({
            "id": str(row.campaign.id),
            "name": row.campaign.name,
            "status": row.campaign.status.name,
            "channel": row.campaign.advertising_channel_type.name,
            "budget": row.campaign_budget.amount_micros,
            "budget_formatted": format_currency(row.campaign_budget.amount_micros),
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "spend": row.metrics.cost_micros,
            "spend_formatted": format_currency(row.metrics.cost_micros),
            "conversions": row.metrics.conversions,
            "conversion_value": row.metrics.conversions_value,
            "ctr": round(ctr, 2),
            "avg_cpc": row.metrics.average_cpc,
            "avg_cpc_formatted": format_currency(row.metrics.average_cpc),
        })
    
    return campaigns

async def get_daily_campaign_performance(customer_id: str, date_range: DateRange, reference_time=None) -> dict[str, Any]:
    """Read every campaign/day using the SDK pager, without a campaign limit."""
    import asyncio
    from decimal import Decimal
    from shared.daily_reports import ReportValidationError, DATE_RANGES, account_id, reporting_window

    clean_id = account_id(customer_id, 'google_ads')
    if date_range not in DATE_RANGES:
        raise ReportValidationError('Unsupported date range')

    def fetch():
        client = get_client()
        service = client.get_service('GoogleAdsService')
        # login_customer_id is configured on the client, not a search() argument.
        accounts = list(service.search(customer_id=clean_id, query="""
            SELECT customer.id, customer.currency_code, customer.time_zone
            FROM customer
        """, timeout=60))
        if len(accounts) != 1 or str(accounts[0].customer.id) != clean_id:
            raise ReportValidationError('Google Ads returned an unexpected account')
        account = accounts[0].customer
        start, end = reporting_window(date_range, account.time_zone, reference_time)
        query = f"""
            SELECT customer.id, customer.currency_code, campaign.id, campaign.name,
                   segments.date, metrics.impressions, metrics.clicks,
                   metrics.cost_micros, metrics.conversions
            FROM campaign
            WHERE segments.date BETWEEN '{start}' AND '{end}'
            ORDER BY segments.date ASC, campaign.id ASC
        """
        rows = []
        # Iterating the SearchPager consumes subsequent pages as well.
        for row in service.search(customer_id=clean_id, query=query, timeout=60):
            rows.append({
                'account_id': str(row.customer.id), 'currency': row.customer.currency_code,
                'date': row.segments.date, 'date_stop': row.segments.date,
                'campaign_id': str(row.campaign.id), 'campaign_name': row.campaign.name,
                'spend': str(Decimal(row.metrics.cost_micros) / Decimal(1_000_000)),
                'impressions': row.metrics.impressions, 'clicks': row.metrics.clicks,
                'conversions': row.metrics.conversions,
            })
        return {'account_id': clean_id, 'currency': account.currency_code,
                'timezone': account.time_zone, 'start_date': start, 'end_date': end, 'rows': rows}

    # The official Google Ads client is synchronous; keep status requests responsive.
    return await asyncio.to_thread(fetch)


async def get_ad_performance(
    customer_id: str,
    campaign_id: Optional[str] = None,
    date_range: DateRange = "LAST_30_DAYS",
    limit: int = 50
) -> list[dict[str, Any]]:
    """
    Get ad-level performance metrics.
    
    Args:
        customer_id: Google Ads customer ID
        campaign_id: Optional campaign ID to filter by
        date_range: GAQL date preset
        limit: Maximum ads to return
    
    Returns:
        List of ads with performance metrics.
    """
    client = get_client()
    mcc_id = get_mcc_id()
    clean_id = clean_customer_id(customer_id)
    
    where_clause = f"WHERE segments.date DURING {date_range}"
    if campaign_id:
        where_clause += f" AND campaign.id = {campaign_id}"
    
    query = f"""
        SELECT 
            ad_group_ad.ad.id,
            ad_group_ad.ad.name,
            ad_group_ad.ad.type,
            ad_group_ad.status,
            ad_group.name,
            campaign.name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.ctr
        FROM ad_group_ad
        {where_clause}
        ORDER BY metrics.cost_micros DESC
        LIMIT {limit}
    """
    
    ga_service = client.get_service("GoogleAdsService")
    response = ga_service.search(
        customer_id=clean_id,
        query=query,
        login_customer_id=mcc_id
    )
    
    ads = []
    for row in response:
        ads.append({
            "ad_id": str(row.ad_group_ad.ad.id),
            "ad_name": row.ad_group_ad.ad.name or "Unnamed Ad",
            "ad_type": row.ad_group_ad.ad.type_.name,
            "status": row.ad_group_ad.status.name,
            "ad_group": row.ad_group.name,
            "campaign": row.campaign.name,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "spend": format_currency(row.metrics.cost_micros),
            "conversions": row.metrics.conversions,
            "ctr": round(row.metrics.ctr * 100, 2),
        })
    
    return ads

async def get_keywords(
    customer_id: str,
    campaign_id: Optional[str] = None,
    date_range: DateRange = "LAST_30_DAYS",
    limit: int = 100
) -> list[dict[str, Any]]:
    """
    Get keyword performance with quality scores.
    
    Args:
        customer_id: Google Ads customer ID
        campaign_id: Optional campaign ID to filter by
        date_range: GAQL date preset
        limit: Maximum keywords to return
    
    Returns:
        List of keywords with metrics and quality scores.
    """
    client = get_client()
    mcc_id = get_mcc_id()
    clean_id = clean_customer_id(customer_id)
    
    where_clause = f"WHERE segments.date DURING {date_range}"
    if campaign_id:
        where_clause += f" AND campaign.id = {campaign_id}"
    
    query = f"""
        SELECT 
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.status,
            ad_group.name,
            campaign.name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.average_cpc
        FROM keyword_view
        {where_clause}
        ORDER BY metrics.cost_micros DESC
        LIMIT {limit}
    """
    
    ga_service = client.get_service("GoogleAdsService")
    response = ga_service.search(
        customer_id=clean_id,
        query=query,
        login_customer_id=mcc_id
    )
    
    keywords = []
    for row in response:
        keywords.append({
            "keyword": row.ad_group_criterion.keyword.text,
            "match_type": row.ad_group_criterion.keyword.match_type.name,
            "quality_score": row.ad_group_criterion.quality_info.quality_score,
            "status": row.ad_group_criterion.status.name,
            "ad_group": row.ad_group.name,
            "campaign": row.campaign.name,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "spend": format_currency(row.metrics.cost_micros),
            "conversions": row.metrics.conversions,
            "avg_cpc": format_currency(row.metrics.average_cpc),
        })
    
    return keywords



















