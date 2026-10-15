"""Pulls leased, community-bound jobs. SIGTERM stops claims and drains the current bounded job."""
from __future__ import annotations
import base64
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import threading
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise ValueError('Worker credential requests cannot follow redirects')


urlopen = build_opener(NoRedirect).open

STOP = False
WORKER = ''
ROOT = Path(__file__).resolve().parents[1]


class Database:
    def __init__(self):
        self.url = os.environ['SUPABASE_URL'].rstrip('/')
        if urlparse(self.url).scheme != 'https' and urlparse(self.url).hostname not in {'localhost', '127.0.0.1', 'host.docker.internal'}:
            raise ValueError('Use a secure Supabase endpoint')
        self.api_key = os.environ['SUPABASE_ANON_KEY']
        self.auth_lock = threading.Lock()
        self.refresh_token = None
        self.principal = None
        self.instance = str(uuid.uuid4())
        key = os.environ.get('COMMUNITY_BRAIN_WORKER_KEY')
        if key:
            self.accept_token(key)
        else:
            self.authenticate('password', {'email': os.environ['COMMUNITY_BRAIN_WORKER_EMAIL'],
                                         'password': os.environ['COMMUNITY_BRAIN_WORKER_PASSWORD']})

    def accept_token(self, key):
        # Supabase verifies the signature. Shape checks prevent a project-wide key
        # or an ordinary authenticated account from being deployed as a worker.
        try:
            claims = json.loads(base64.urlsafe_b64decode(key.split('.')[1] + '==='))
            principal = str(uuid.UUID(claims['sub']))
        except (ValueError, KeyError, IndexError) as error:
            raise ValueError('Use a signed, expiring community worker identity') from error
        if claims.get('role') != 'community_brain_worker' or not time.time() < claims.get('exp', 0) <= time.time()+86400:
            raise ValueError('Worker credentials must be scoped and expire within 24 hours')
        if self.principal and principal != self.principal:
            raise ValueError('Worker identity changed during renewal')
        self.key, self.principal, self.expires_at = key, principal, claims['exp']
        global WORKER
        WORKER = principal + '/' + self.instance

    def authenticate(self, grant, body):
        request = Request(self.url+'/auth/v1/token?grant_type='+grant,
                          data=json.dumps(body).encode(), headers={'apikey': self.api_key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response:
            data = response.read(32769)
        if len(data)>32768:
            raise ValueError('Worker authentication response exceeded its limit')
        tokens = json.loads(data)
        self.accept_token(tokens['access_token'])
        self.refresh_token = tokens['refresh_token']

    def renew(self):
        with self.auth_lock:
            if time.time() < self.expires_at - 600:
                return
            if not self.refresh_token:
                raise RuntimeError('Worker credential rotation required')
            self.authenticate('refresh_token', {'refresh_token': self.refresh_token})

    def request(self, path, body=None, content_type='application/json', limit=8 * 1024 * 1024, method=None):
        request = Request(self.url + path, data=body, method=method,
                          headers={'apikey': self.api_key, 'Authorization': 'Bearer ' + self.key, 'Content-Type': content_type, 'x-upsert': 'false'})
        with urlopen(request, timeout=60) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('Remote response exceeded its limit')
            return data

    def rpc(self, name, value):
        return json.loads(self.request('/rest/v1/rpc/' + name, json.dumps(value).encode()))

    def original(self, file):
        path = file['storage_path']
        if not path.startswith(file['property_id'] + '/'):
            raise ValueError('Original path ownership mismatch')
        data = self.request('/storage/v1/object/authenticated/knowledge-originals/' + quote(path, safe='/'), limit=int(file['input']['size']))
        if len(data) != file['input']['size'] or hashlib.sha256(data).hexdigest() != file['input']['byteHash']:
            raise ValueError('Retained original bytes changed')
        return data

    def rendition(self, path, data, mime):
        try:
            self.request('/storage/v1/object/knowledge-originals/' + quote(path, safe='/'), data, mime)
        except HTTPError as error:
            if error.code not in {400, 409}:
                raise
        # Read back even after a successful upload; a lost acknowledgement must not create a replacement.
        saved = self.request('/storage/v1/object/authenticated/knowledge-originals/' + quote(path, safe='/'), limit=len(data))
        if hashlib.sha256(saved).digest() != hashlib.sha256(data).digest():
            raise ValueError('Rendition storage was not confirmed')


def parse_in_process(data: bytes, file: dict, directory: Path):
    (directory / 'original').write_bytes(data)
    (directory / 'request.json').write_text(json.dumps(file['input']))
    # Deliberately omit database/provider credentials and user-supplied environment variables.
    env = {'PATH': os.environ.get('PATH', os.defpath), 'LANG': 'C.UTF-8', 'OMP_THREAD_LIMIT': '1',
           'BRAIN_PARSER_SANDBOX_REQUIRED': os.environ.get('BRAIN_PARSER_SANDBOX_REQUIRED', 'true')}
    subprocess.run([sys.executable, '-m', 'community_brain.parser_process', str(directory)], cwd=ROOT, env=env, timeout=240, capture_output=True, check=True)
    receipt = json.loads((directory / 'receipt.json').read_text())
    if receipt.get('fileHash') != file['input']['byteHash']:
        raise ValueError('Parser receipt ownership mismatch')
    return receipt


def process_job(db: Database, item: dict):
    job, claim = item['job'], item.get('claim')
    if job['domain'] != 'community_brain' or not job['property_id'] or job['lease_owner'] != WORKER:
        raise ValueError('Job ownership mismatch')
    if job['subject_type'] == 'memory_projection':
        return db.rpc('brain_project_memory', {'p_job_id': job['id'], 'p_worker': WORKER})
    if job['subject_type'] != 'file_extraction' or not claim or claim.get('state') != 'invoke_once':
        raise ValueError('Unsupported or unclaimed job')
    file = claim['file']
    if file['property_id'] != job['property_id'] or file['org_id'] != job['org_id'] or file['id'] != job['payload']['fileId']:
        raise ValueError('Extraction ownership mismatch')
    renditions = []
    with tempfile.TemporaryDirectory(prefix='community-original-') as temp:
        directory = Path(temp)
        try:
            receipt = parse_in_process(db.original(file), file, directory)
            if receipt['complete']:
                for rendition in receipt.get('artifacts', []):
                    name = rendition['name']
                    if Path(name).name != name:
                        raise ValueError('Unsafe rendition name')
                    data = (directory / 'output' / name).read_bytes()
                    if hashlib.sha256(data).hexdigest() != rendition['contentHash']:
                        raise ValueError('Rendition checksum mismatch')
                    path = f"{job['property_id']}/{file['id']}/{receipt['recipe']}/{name}"
                    db.rendition(path, data, rendition['mimeType'])
                    renditions.append({**rendition, 'id': str(uuid.uuid5(uuid.NAMESPACE_URL, path)), 'recipe': receipt['recipe'], 'storagePath': path, 'originalHash': file['input']['byteHash']})
        except (ValueError, OSError, subprocess.SubprocessError):
            receipt = {'recipe': 'community-file-v1', 'fileHash': file['input']['byteHash'], 'complete': False, 'totalPages': None, 'pages': [], 'text': '', 'errorCode': 'processing_failed', 'blankPages': [], 'limitations': []}
            renditions = []
        return db.rpc('brain_finish_extraction', {'p_job_id': job['id'], 'p_worker': WORKER, 'p_claim_token': claim['claimToken'], 'p_receipt': receipt, 'p_renditions': renditions})


def run_job(db: Database, item: dict):
    finished = threading.Event()
    lease_lost = threading.Event()
    def heartbeat():
        while not finished.wait(30):
            try:
                if not db.rpc('brain_heartbeat', {'p_job_id': item['job']['id'], 'p_worker': WORKER}):
                    lease_lost.set(); return
            except Exception:
                lease_lost.set(); return
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        result = process_job(db, item)
        if lease_lost.is_set():
            raise ValueError('Processing lease was not confirmed')
        return result
    finally:
        finished.set(); thread.join(timeout=1)


def stop(_signum, _frame):
    global STOP
    STOP = True


def main():
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    db = Database()
    while not STOP:
        db.renew()
        try:
            db.rpc('brain_reconcile_work', {})
            # Claim one at a time: leases must not expire while another file is being processed.
            jobs = db.rpc('brain_claim_work', {'p_worker': WORKER, 'p_limit': 1})['jobs']
            for item in jobs:
                start = time.monotonic()
                try:
                    result = run_job(db, item)
                    print(json.dumps({'event': 'community_job_finished', 'jobId': item['job']['id'], 'propertyId': item['job']['property_id'], 'state': result.get('state'), 'durationSeconds': round(time.monotonic()-start, 3)}), flush=True)
                except Exception:
                    # No source text, provider payload or credential is logged. Reconciliation owns uncertain completion.
                    print(json.dumps({'event': 'community_job_unconfirmed', 'jobId': item['job']['id']}), flush=True)
            if not jobs:
                time.sleep(2)
        except Exception:
            print(json.dumps({'event': 'community_queue_unavailable'}), flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
