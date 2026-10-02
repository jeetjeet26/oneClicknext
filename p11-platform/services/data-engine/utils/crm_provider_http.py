"""Authenticated, bounded CRM reads: public DNS pinning and no credentialed redirects."""
from urllib.parse import urlencode, urlsplit, urlunsplit
from utils.public_http import public_request

def get(url, *, headers=None, params=None, timeout=20):
    parts = urlsplit(url)
    if params:
        query = "&".join(v for v in (parts.query, urlencode(params, doseq=True)) if v)
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))
    headers = headers or {}
    credentials = {k:v for k,v in headers.items() if k.lower() in ("authorization", "x-realpage-site")}
    return public_request(url, headers=headers, credential_headers=credentials, timeout=min(float(timeout),20), max_bytes=2_000_000, follow_redirects=False)
