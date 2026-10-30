import socket
import pytest
import httpx
from utils import public_http as h

@pytest.mark.parametrize('address',['127.0.0.1','169.254.169.254','100.64.0.1','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','2002:7f00:1::','2001:db8::1'])
def test_private_and_transition_addresses(address):
    assert not h.public_address(address)

def test_mixed_dns_never_opens_a_socket(monkeypatch):
    monkeypatch.setattr(h.socket,'getaddrinfo',lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('1.1.1.1',80)),(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',80))])
    monkeypatch.setattr(h.socket,'socket',lambda *args:pytest.fail('socket opened for unsafe destination'))
    with pytest.raises(h.UnsafePublicURL): h.public_request('http://example.com')

class Socket:
    connected=[]
    def __init__(self,*args): pass
    def fileno(self): return 1
    def settimeout(self,*args): pass
    def connect(self,target): self.connected.append(target)
    def close(self): pass
class Response:
    def __init__(self,status=200,headers=None,body=b'public page'):
        self.status=status;self.headers=headers or {};self.body=body
    def getheaders(self): return list(self.headers.items())
    def getheader(self,k,default=None): return self.headers.get(k,default)
    def read1(self,n): chunk=self.body[:n];self.body=self.body[n:];return chunk
class Connection:
    responses=[]
    def __init__(self,*args,**kwargs): self.sock=None
    def request(self,*args,**kwargs): pass
    def getresponse(self): return self.responses.pop(0)
    def close(self): pass
@pytest.fixture
def pinned(monkeypatch):
    Socket.connected=[];Connection.responses=[]
    monkeypatch.setattr(h.socket,'getaddrinfo',lambda *args:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('1.1.1.1',80))])
    monkeypatch.setattr(h.socket,'socket',Socket)
    monkeypatch.setattr(h.http.client,'HTTPConnection',Connection)

def test_uses_validated_ip_without_second_lookup(pinned):
    Connection.responses=[Response()]
    assert h.public_request('http://example.com').text=='public page'
    assert Socket.connected==[('1.1.1.1',80)]

def test_redirect_checks_new_dns(pinned,monkeypatch):
    Connection.responses=[Response(302,{'location':'http://internal.example.com'})]
    monkeypatch.setattr(h.socket,'getaddrinfo',lambda host,*args:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1' if host.startswith('internal') else '1.1.1.1',80))])
    with pytest.raises(h.UnsafePublicURL): h.public_request('http://example.com')
    assert len(Socket.connected)==1

def test_byte_limit_is_enforced_while_streaming(pinned):
    Connection.responses=[Response(body=b'x'*100)]
    with pytest.raises(httpx.RequestError,match='byte limit'):h.public_request('http://example.com',max_bytes=20)

def test_compressed_bodies_fail_closed(pinned):
    Connection.responses=[Response(headers={'content-encoding':'gzip'})]
    with pytest.raises(httpx.RequestError,match='compressed'):h.public_request('http://example.com')

@pytest.mark.parametrize('url,redirects,headers',[('http://example.com',False,{'Authorization':'secret'}),('https://example.com',True,{'Authorization':'secret'}),('https://example.com',False,{'Host':'internal.invalid'})])
def test_credentialed_reads_reject_unsafe_options(url,redirects,headers):
    with pytest.raises(h.UnsafePublicURL):h.public_request(url,follow_redirects=redirects,credential_headers=headers)

def test_credentialed_read_pins_host_and_never_follows_redirect(pinned,monkeypatch):
    from unittest.mock import Mock
    tls=Mock();tls.wrap_socket.side_effect=lambda sock,**kwargs:sock
    monkeypatch.setattr(h.ssl,'create_default_context',lambda:tls)
    request=Mock();monkeypatch.setattr(Connection,'request',request)
    Connection.responses=[Response(302,{'location':'https://different.example.com'})]
    response=h.public_request('https://example.com',follow_redirects=False,credential_headers={'Authorization':'secret'})
    assert response.status_code==302
    assert len(Socket.connected)==1
    assert request.call_args.kwargs['headers']['Authorization']=='secret'
    tls.wrap_socket.assert_called_once()


def test_connection_close_at_body_eof_keeps_successful_response(pinned, monkeypatch):
    """HTTPResponse can close the original socket after the last body chunk."""
    class ClosingSocket(Socket):
        def __init__(self, *args): self.closed = False
        def fileno(self): return -1 if self.closed else 1
        def settimeout(self, *args):
            if self.closed: raise OSError(9, 'Bad file descriptor')
        def close(self): self.closed = True
    sock = ClosingSocket()
    class ClosingResponse(Response):
        def read1(self, n):
            chunk = super().read1(n)
            if not self.body: sock.close()
            return chunk
    monkeypatch.setattr(h.socket, 'socket', lambda *args: sock)
    Connection.responses = [ClosingResponse(body=b'{"questions":[]}')]
    assert h.public_request('http://example.com').json() == {'questions': []}


def test_closed_socket_does_not_skip_response_size_limit(pinned, monkeypatch):
    class ClosedSocket(Socket):
        def fileno(self): return -1
    monkeypatch.setattr(h.socket, 'socket', ClosedSocket)
    Connection.responses = [Response(body=b'x' * 100)]
    with pytest.raises(httpx.RequestError, match='byte limit'):
        h.public_request('http://example.com', max_bytes=20)
