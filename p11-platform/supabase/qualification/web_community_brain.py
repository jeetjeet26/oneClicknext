"""Temporary local gateway and dev server for real application qualification."""
import json,os,re,socket,subprocess,tempfile,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit


def local_environment(web, tokens, gateway_url, web_url, inherited=None):
    """Keep the local harness independent of developer/provider credentials.

    Next also reads .env.development[.local], and next.config loads the
    monorepo .env files. Reserve every declared name before those loaders run;
    inherit only the operating-system settings required to launch the tools.
    """
    for value in (gateway_url, web_url):
        target = urlsplit(value)
        if (target.scheme != 'http' or target.hostname not in {'127.0.0.1', 'localhost'}
                or not target.port or target.username or target.password
                or target.path not in {'', '/'} or target.query or target.fragment):
            raise ValueError('Qualification requires explicit localhost origins')
    source = os.environ if inherited is None else inherited
    allowed = {'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT'}
    env = {key: value for key, value in source.items() if key in allowed}
    for folder in (web, web.parents[1], web.parents[2]):
        for file in folder.glob('.env*'):
            if not file.is_file():
                continue
            for line in file.read_text().splitlines():
                match = re.match(r'\s*(?:export\s+)?([\w.-]+)\s*=', line)
                if match:
                    env[match[1]] = ''
    env.update(
        NEXT_PUBLIC_SUPABASE_URL=gateway_url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=tokens['anon'],
        NEXT_PUBLIC_SUPABASE_ANON_KEY=tokens['anon'],
        SUPABASE_SERVICE_ROLE_KEY=tokens['service_role'],
        NEXT_PUBLIC_SITE_URL=web_url,
        NEXT_TELEMETRY_DISABLED='1',
        P11_QUALIFICATION_DIST_DIR=f'.next/community-brain-qualification/run-{os.getpid()}-{time.time_ns()}',
        NODE_ENV='development', OPENAI_API_KEY='', OPENAI_PROJECT_ID='',
    )
    return env


def qualify(services,tokens,session,root):
    class Proxy(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_OPTIONS(self):
            self.send_response(204);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','*');self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');self.end_headers()
        def forward(self):
            match=next(((prefix,key)for prefix,key in [('/auth/v1','auth'),('/rest/v1','rest'),('/storage/v1','storage')]if self.path.startswith(prefix)),None)
            if not match:self.send_error(404);return
            prefix,key=match
            data=self.rfile.read(int(self.headers.get('Content-Length','0')))or None
            headers={k:v for k,v in self.headers.items()if k.lower()not in ['host','content-length','connection','accept-encoding']}
            try:r=urlopen(Request(services[key]+self.path[len(prefix):],data=data,headers=headers,method=self.command),timeout=30)
            except HTTPError as e:r=e
            payload=r.read();self.send_response(r.code)
            for k,v in r.headers.items():
                if k.lower()not in ['content-length','connection','transfer-encoding','content-encoding','access-control-allow-origin']:self.send_header(k,v)
            self.send_header('Content-Length',str(len(payload)));self.send_header('Access-Control-Allow-Origin','*');self.end_headers();self.wfile.write(payload)
        do_GET=forward;do_POST=forward;do_PUT=forward;do_PATCH=forward;do_DELETE=forward
    gateway=ThreadingHTTPServer(('127.0.0.1',0),Proxy);thread=threading.Thread(target=gateway.serve_forever,daemon=True);thread.start()
    web=root.parent/'apps/web'
    with socket.socket()as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    base='http://127.0.0.1:'+str(gateway.server_port);web_url='http://127.0.0.1:'+str(port)
    env=local_environment(web,tokens,base,web_url)
    config_path=web/'tsconfig.json';original_config=config_path.read_text()
    log=open('/private/tmp/community_brain_web_server.txt','w')
    process=subprocess.Popen(['node','node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',str(port)],cwd=web,env=env,stdout=log,stderr=log,start_new_session=True)
    worker_name='oneclick-brain-browser-worker-'+str(os.getpid())
    worker_started=False
    try:
        # Exercise the actual queue loop and baked parser image against the
        # disposable services. It receives no project service or provider key.
        with tempfile.NamedTemporaryFile(mode='w',prefix='brain-browser-worker-',delete=True) as worker_env:
            os.chmod(worker_env.name,0o600)
            worker_env.write('\n'.join([
                'SUPABASE_URL=http://host.docker.internal:'+str(gateway.server_port),
                'SUPABASE_ANON_KEY='+tokens['anon'],
                'COMMUNITY_BRAIN_WORKER_KEY='+tokens['community_brain_worker'],
                'BRAIN_PARSER_SANDBOX_REQUIRED=true',
            ]));worker_env.flush()
            subprocess.run(['docker','run','-d','--name',worker_name,'--read-only',
                '--tmpfs','/tmp:rw,nosuid,size=512m','--memory','2g','--cpus','2',
                '--cap-drop','ALL','--security-opt','no-new-privileges:true',
                '--env-file',worker_env.name,'oneclick-community-brain:20261013'],
                check=True,capture_output=True,text=True)
            worker_started=True
        for _ in range(240):
            if process.poll()is not None:raise RuntimeError('Qualification dev server exited; inspect its sanitized local log')
            try:
                with urlopen(web_url+'/api/community-brain/communities',timeout=1):
                    raise RuntimeError('Qualification protected route unexpectedly accepted an anonymous request')
            except HTTPError as error:
                if error.code==401 and json.loads(error.read()).get('error')=='Sign in to use community knowledge.':break
                if error.code>=500:raise RuntimeError('Qualification application route failed during startup')
                time.sleep(.5)
            except(URLError,TimeoutError):time.sleep(.5)
        else:raise RuntimeError('Qualification web server did not become ready')
        with tempfile.NamedTemporaryFile(mode='w',prefix='brain-browser-session-',delete=True)as config:
            os.chmod(config.name,0o600);json.dump({'gateway':base,'webUrl':web_url,'anon':tokens['anon'],'session':session},config);config.flush()
            result=subprocess.run(['node',str(root/'qualification/browser_community_brain.mjs'),config.name],cwd=web,env=env,text=True,capture_output=True,timeout=300)
            print(result.stdout,flush=True)
            if result.returncode:raise RuntimeError(result.stderr[-2200:])
    finally:
        import signal
        if worker_started:
            worker_log=subprocess.run(['docker','logs',worker_name],capture_output=True,text=True)
            # Only emit the worker's bounded structured operational events.
            for line in worker_log.stdout.splitlines():
                try:event=json.loads(line)
                except ValueError:continue
                if event.get('event') in {'community_job_finished','community_job_unconfirmed','community_queue_unavailable'}:
                    print(json.dumps({'worker':{key:event[key]for key in ['event','jobId','propertyId','state','durationSeconds']if key in event}}),flush=True)
            subprocess.run(['docker','rm','-f',worker_name],capture_output=True,text=True)
        try:os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=15)
        except(ProcessLookupError,subprocess.TimeoutExpired):
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        gateway.shutdown();gateway.server_close();log.close()
        import shutil
        shutil.rmtree(web/env['P11_QUALIFICATION_DIST_DIR'],ignore_errors=True)
        # Next adds its temporary generated-type paths. Preserve any concurrent
        # developer edits and remove only this qualification server's additions.
        current=json.loads(config_path.read_text());before=json.loads(original_config)
        current['include']=[v for v in current['include']if not v.startswith('.next/community-brain-qualification/')]
        before['include']=[v for v in before['include']if not v.startswith('.next/community-brain-qualification/')]
        config_path.write_text(original_config if current==before and not any('community-brain-qualification'in v for v in json.loads(original_config)['include'])else json.dumps(current,indent=2)+'\n')
