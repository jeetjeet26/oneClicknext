"""Bounded public HTTP reads; DNS addresses are validated and pinned to the socket.

Never falls back to ordinary HTTP, proxy environment variables or browser networking.
"""
import asyncio
import concurrent.futures
import http.client
import ipaddress
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urljoin
import httpx

_DNS_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="public-dns")
_DNS_SLOTS = threading.BoundedSemaphore(8)

class UnsafePublicURL(httpx.RequestError):
    pass

def public_address(value):
    ip = ipaddress.ip_address(value)
    return ip.is_global and not (ip.is_multicast or ip.is_reserved or
        getattr(ip, 'ipv4_mapped', None) or getattr(ip, 'sixtofour', None) or getattr(ip, 'teredo', None))

def resolve_target(url, timeout=15):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').rstrip('.').lower()
    if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or
        not host or host == 'localhost' or host.endswith('.localhost') or
        ('.' not in host and ':' not in host) or parsed.port not in (None, 80, 443)):
        raise UnsafePublicURL('Destination must be a public HTTP(S) website')
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not _DNS_SLOTS.acquire(blocking=False):
        raise httpx.TimeoutException('Public DNS capacity reached')
    future = _DNS_POOL.submit(socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM)
    future.add_done_callback(lambda _: _DNS_SLOTS.release())
    try:
        addresses = future.result(timeout=max(.001, timeout))
    except OSError as exc:
        raise httpx.RequestError('Public DNS lookup failed') from exc
    except concurrent.futures.TimeoutError as exc:
        raise httpx.TimeoutException('Public DNS timed out') from exc
    if not addresses or any(not public_address(row[4][0]) for row in addresses):
        raise UnsafePublicURL('Destination resolves to a non-public address')
    return parsed, host, addresses[0]

def public_request(url, *, method='GET', headers=None, timeout=15, max_bytes=2_000_000, follow_redirects=True, credential_headers=None):
    if method not in ('GET', 'HEAD'):
        raise UnsafePublicURL('Only read-only public requests are permitted')
    if credential_headers and (follow_redirects or urlsplit(str(url)).scheme != "https" or any(k.lower() not in ("authorization", "x-realpage-site") for k in credential_headers)):
        raise UnsafePublicURL("Credentialed reads require HTTPS, allowed headers and no redirects")
    deadline = time.monotonic() + min(float(timeout), 30)
    current = str(url)
    for hop in range(6):
        parsed, host, target = resolve_target(current, deadline-time.monotonic())
        conn = http.client.HTTPConnection(host, port=parsed.port, timeout=max(.001, deadline-time.monotonic()))
        sock = None
        try:
            family, kind, proto, _, sockaddr = target
            sock = socket.socket(family, kind, proto)
            sock.settimeout(max(.001, deadline-time.monotonic()))
            sock.connect(sockaddr)
            if parsed.scheme == 'https':
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            conn.sock = sock
            safe_headers = {k:v for k,v in (headers or {}).items() if k.lower() in ('user-agent','accept','accept-language')}
            safe_headers.update(credential_headers or {})
            safe_headers.update({'Host': parsed.netloc, 'Accept-Encoding': 'identity', 'Connection': 'close'})
            conn.request(method, (parsed.path or '/') + ('?' + parsed.query if parsed.query else ''), headers=safe_headers)
            response = conn.getresponse()
            response_headers = dict(response.getheaders())
            status = response.status
            location = response.getheader('location')
            if follow_redirects and status in (301,302,303,307,308) and location:
                current = urljoin(current, location)
                continue
            if response.getheader('content-encoding', 'identity') != 'identity':
                raise httpx.RequestError('Unsupported compressed website response')
            if int(response.getheader('content-length', '0')) > max_bytes:
                raise httpx.RequestError('Website response exceeds byte limit')
            chunks, total = [], 0
            while method != 'HEAD':
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise httpx.TimeoutException('Website request timed out')
                sock.settimeout(remaining)
                chunk = response.read1(min(65536, max_bytes-total+1))
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise httpx.RequestError('Website response exceeds byte limit')
                chunks.append(chunk)
            return httpx.Response(status, headers=response_headers, content=b''.join(chunks), request=httpx.Request(method, current))
        except (OSError, http.client.HTTPException) as exc:
            raise httpx.RequestError('Public website connection failed') from exc
        finally:
            conn.close()
            if sock: sock.close()
    raise httpx.TooManyRedirects('Website exceeded redirect limit')

async def async_public_request(url, **kwargs):
    return await asyncio.to_thread(public_request, url, **kwargs)

class PublicAsyncClient:
    def __init__(self, *, headers=None, follow_redirects=False, **kwargs):
        self.headers = headers or {}
        self.follow_redirects = follow_redirects
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def get(self, url, **kwargs):
        return await async_public_request(url, headers=kwargs.get('headers',self.headers), follow_redirects=kwargs.get('follow_redirects',self.follow_redirects))
    async def head(self, url, **kwargs):
        return await async_public_request(url, method='HEAD', headers=self.headers, follow_redirects=kwargs.get('follow_redirects',self.follow_redirects))

async def guard_browser_context(context):
    """Fulfill each read with the pinned transport; never allow a network fallback."""
    async def handle(route):
        request = route.request
        if request.method not in ('GET', 'HEAD') or request.resource_type in ('media', 'font', 'image'):
            await route.abort(); return
        try:
            response = await async_public_request(request.url, method=request.method, follow_redirects=False)
            headers = {k:v for k,v in response.headers.items() if k not in ('transfer-encoding','content-encoding','content-length','set-cookie')}
            await route.fulfill(status=response.status_code, headers=headers, body=response.content)
        except Exception:
            await route.abort()
    await context.route('**/*', handle)
    await context.route_web_socket('**/*', lambda ws: ws.close())
    await context.add_init_script("""for (const key of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport','Worker','SharedWorker']) {
      Object.defineProperty(globalThis, key, { value: undefined, configurable: false });
    }""")
