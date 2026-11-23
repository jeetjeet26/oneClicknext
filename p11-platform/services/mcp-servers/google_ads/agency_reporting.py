"""Read Google Ads reports with a delegated Google Cloud OAuth grant."""
import json
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
from google.ads.googleads.v25.services.types.google_ads_service import GoogleAdsRow

from shared.daily_reports import ReportValidationError, account_id


@dataclass(frozen=True, repr=False)
class AgencyGrant:
    manager_id: str
    client_id: str
    client_secret: str
    refresh_token: str


class AgencyReporting:
    def __init__(self, client: httpx.Client, grant: AgencyGrant, advertiser_id: str):
        self.client = client
        self.manager_id = account_id(grant.manager_id, 'google_ads')
        self.advertiser_id = account_id(advertiser_id, 'google_ads')
        if self.manager_id == self.advertiser_id:
            raise ReportValidationError('Link an advertiser account to this community')
        response = client.post('https://oauth2.googleapis.com/token', data={
            'grant_type': 'refresh_token',
            'client_id': grant.client_id,
            'client_secret': grant.client_secret,
            'refresh_token': grant.refresh_token,
        })
        if response.status_code == 400 or response.status_code == 401:
            raise ReportValidationError('Reauthorize Google Ads in Agency advertising settings')
        response.raise_for_status()
        self.access_token = response.json().get('access_token')
        if not isinstance(self.access_token, str) or not self.access_token:
            raise ReportValidationError('Google Ads agency authorization could not be verified')

    def search(self, query: str) -> Iterator[GoogleAdsRow]:
        page_token = None
        seen = set()
        for _ in range(100):
            response = self.client.post(
                f'https://googleads.googleapis.com/v25/customers/{self.advertiser_id}/googleAds:search',
                headers={'Authorization': f'Bearer {self.access_token}', 'login-customer-id': self.manager_id},
                json={'query': query, **({'pageToken': page_token} if page_token else {})},
            )
            response.raise_for_status()
            page = response.json()
            rows = page.get('results', [])
            page_token = page.get('nextPageToken')
            if not isinstance(rows, list) or (page_token and (
                not isinstance(page_token, str) or not rows or page_token in seen
            )):
                raise ReportValidationError('Google Ads report pagination is invalid')
            for row in rows:
                yield GoogleAdsRow.from_json(json.dumps(row))
            if not page_token:
                return
            seen.add(page_token)
        raise ReportValidationError('Google Ads report pagination did not complete')
