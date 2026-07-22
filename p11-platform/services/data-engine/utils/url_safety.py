"""
Shared SSRF-safe URL validation for scraping targets.

All user-supplied or database-stored URLs that the data engine will fetch
must pass these checks before any network request is made.
"""

import ipaddress
from typing import Optional
from urllib.parse import urlparse

ALLOWED_SCHEMES = ("http", "https")

APARTMENTS_COM_HOSTS = frozenset({
    "apartments.com",
    "www.apartments.com",
})


def is_safe_public_url(url: Optional[str]) -> bool:
    """
    Return True only for http(s) URLs pointing at public hostnames.

    Rejects:
    - non-http(s) schemes (file://, gopher://, ftp://, etc.)
    - localhost and *.localhost
    - IP literals that are private, loopback, link-local, or reserved
    - URLs with embedded credentials (user:pass@host)
    """
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False
    if parsed.scheme not in ALLOWED_SCHEMES:
        return False
    if parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        return False
    if "." not in host:
        # Bare single-label hostnames (internal service names) are not allowed.
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True  # Hostname, not an IP literal.
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def is_apartments_com_url(url: Optional[str]) -> bool:
    """
    Strict hostname validation for apartments.com listing URLs.

    The hostname must be exactly apartments.com or www.apartments.com;
    substring checks like ``'apartments.com' in url`` are not safe because
    they match hosts such as evil.com/apartments.com or apartments.com.evil.com.
    """
    if not is_safe_public_url(url):
        return False
    host = (urlparse(url.strip()).hostname or "").lower()
    return host in APARTMENTS_COM_HOSTS
