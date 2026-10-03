import socket
import json
from unittest.mock import Mock
import pytest
import httpx
from fastapi import HTTPException
from utils import crm_transport as t
from utils import public_http as h
class Socket:
 connected=[]
 def __init__(self,*args):pass
 def settimeout(self,*args):pass
 def connect(self,target):self.connected.append(target)
 def close(self):pass
class Response:
 def __init__(self,status=200,headers=None,body=b'{}'):self.status=status;self.headers=headers or {};self.body=body
 def getheaders(self):return list(self.headers.items())
 def getheader(self,key,default=None):return self.headers.get(key,default)
 def read1(self,n):chunk=self.body[:n];self.body=self.body[n:];return chunk
class Connection:
 responses=[];calls=[]
 def __init__(self,*args,**kwargs):self.sock=None
 def request(self,*args,**kwargs):self.calls.append((args,kwargs))
 def getresponse(self):return self.responses.pop(0)
 def close(self):pass
@pytest.fixture
def pinned(monkeypatch):
 Socket.connected=[];Connection.responses=[];Connection.calls=[]
 monkeypatch.setenv('OUTBOUND_DELIVERY_PAUSED','false');monkeypatch.setattr(h.socket,'getaddrinfo',lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('1.1.1.1',443))]);monkeypatch.setattr(t.socket,'socket',Socket);monkeypatch.setattr(t.http.client,'HTTPConnection',Connection)
 tls=Mock();tls.wrap_socket.side_effect=lambda sock,**kwargs:sock;monkeypatch.setattr(t.ssl,'create_default_context',lambda:tls)
@pytest.mark.parametrize('url',['http://api.hubapi.com/crm','https://evil.invalid/crm','https://api.hubapi.com.evil.invalid/crm','https://user:pass@api.hubapi.com/crm','https://api.hubapi.com:8080/crm'])
def test_unsupported_destination_never_resolves(url,monkeypatch):
 monkeypatch.setattr(t,'resolve_target',lambda *args:pytest.fail('resolved unsupported URL'))
 with pytest.raises(h.UnsafePublicURL):t.request('GET',url,token='private')
def test_private_dns_rejected_before_socket(pinned,monkeypatch):
 monkeypatch.setattr(h.socket,'getaddrinfo',lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443))])
 with pytest.raises(h.UnsafePublicURL):t.request('GET','https://api.hubapi.com/crm',token='private')
 assert Socket.connected==[]
def test_write_preserves_exact_body_and_never_follows_redirect(pinned):
 Connection.responses=[Response(307,{'location':'https://evil.invalid'})];body={'properties':{'email':'test@example.invalid','hs_lead_status':'OPEN'}}
 r=t.request('POST','https://api.hubapi.com/crm/v3/objects/contacts',token='private',payload=body)
 assert r.status_code==307 and len(Socket.connected)==1
 assert json.loads(Connection.calls[0][1]['body'])==body
 assert Connection.calls[0][1]['headers']['Authorization']=='Bearer private'
@pytest.mark.parametrize('method,path',[('POST','/crm/v3/objects/contacts'),('DELETE','/crm/v3/objects/contacts/123')])
def test_pause_blocks_mutation_before_network(pinned,monkeypatch,method,path):
 monkeypatch.setenv('OUTBOUND_DELIVERY_PAUSED','true')
 with pytest.raises(HTTPException):t.request(method,'https://api.hubapi.com'+path,token='private')
 assert Socket.connected==[]
def test_search_is_read_only_during_pause(pinned,monkeypatch):
 monkeypatch.setenv('OUTBOUND_DELIVERY_PAUSED','true');Connection.responses=[Response()]
 assert t.request('POST','https://api.hubapi.com/crm/v3/objects/contacts/search',token='private',payload={}).status_code==200
 assert Socket.connected==[('1.1.1.1',443)]
def test_response_bound_and_compression_are_enforced(pinned):
 for response in [Response(body=b'x'*2_000_001),Response(headers={'content-encoding':'gzip'})]:
  Connection.responses=[response]
  with pytest.raises(httpx.RequestError):t.request('GET','https://api.hubapi.com/crm',token='private')
def test_crlf_token_and_oversized_body_rejected_before_network(pinned):
 with pytest.raises(ValueError):t.request('GET','https://api.hubapi.com/crm',token='private\r\nX-Header: bad')
 with pytest.raises(ValueError):t.request('POST','https://api.hubapi.com/crm',token='private',payload={'value':'x'*128000})
 assert Socket.connected==[]
