"""Pinned, bounded provider requests. No redirects, retries or environment proxies."""
import http.client
import json
import socket
import ssl
import time
from urllib.parse import urlencode, urlsplit
import httpx
from utils.public_http import resolve_target, UnsafePublicURL
from utils.delivery_guard import require_delivery_enabled

def request(method, url, *, token, payload=None, params=None, timeout=20):
    parts=urlsplit(url)
    host=(parts.hostname or '').lower()
    if (parts.scheme!='https' or parts.username or parts.password or parts.port not in (None,443)
        or parts.fragment or not (host=='api.hubapi.com' or host.endswith(('.salesforce.com','.force.com')))):
        raise UnsafePublicURL('CRM provider destination is not supported')
    if method not in ('GET','POST','DELETE') or not isinstance(token,str) or not token or '\r' in token or '\n' in token:
        raise ValueError('Invalid CRM request')
    readonly=method=='GET' or (method=='POST' and host=='api.hubapi.com' and parts.path=='/crm/v3/objects/contacts/search')
    if not readonly:require_delivery_enabled()
    body=None if payload is None else json.dumps(payload,allow_nan=False,separators=(',',':')).encode()
    if body and len(body)>128000:raise ValueError('CRM payload exceeds limit')
    if method!='POST' and body is not None:raise ValueError('Unexpected CRM payload')
    deadline=time.monotonic()+min(max(float(timeout),1),20)
    parsed,hostname,target=resolve_target(url,deadline-time.monotonic())
    connection=http.client.HTTPConnection(hostname,port=443,timeout=max(.001,deadline-time.monotonic()));sock=None
    try:
        family,kind,proto,_,address=target
        sock=socket.socket(family,kind,proto);sock.settimeout(max(.001,deadline-time.monotonic()));sock.connect(address)
        sock=ssl.create_default_context().wrap_socket(sock,server_hostname=hostname);connection.sock=sock
        path=(parsed.path or '/')
        query='&'.join(x for x in (parsed.query,urlencode(params or {},doseq=True)) if x)
        if query:path+='?'+query
        headers={'Host':parsed.netloc,'Authorization':'Bearer '+token,'Accept':'application/json','Accept-Encoding':'identity','Connection':'close'}
        if body is not None:headers['Content-Type']='application/json'
        connection.request(method,path,body=body,headers=headers)
        response=connection.getresponse()
        if response.getheader('content-encoding','identity')!='identity' or int(response.getheader('content-length','0'))>2_000_000:
            raise httpx.RequestError('CRM response exceeds supported limits')
        chunks=[];size=0
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise httpx.TimeoutException('CRM request timed out')
            sock.settimeout(remaining);chunk=response.read1(min(65536,2_000_001-size))
            if not chunk:break
            size+=len(chunk)
            if size>2_000_000:raise httpx.RequestError('CRM response exceeds supported limits')
            chunks.append(chunk)
        return httpx.Response(response.status,headers=dict(response.getheaders()),content=b''.join(chunks),request=httpx.Request(method,url))
    except (OSError,http.client.HTTPException) as exc:
        raise httpx.RequestError('CRM provider request could not be confirmed') from exc
    finally:
        connection.close()
        if sock:sock.close()
