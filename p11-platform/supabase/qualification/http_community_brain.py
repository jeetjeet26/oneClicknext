"""Local HTTP qualification: real JWT, PostgREST, Auth and private Storage.

Clones only local service configuration, uses a synthetic disposable database,
keeps credentials in memory/0600 temporary files, and removes its own containers.
No live Supabase endpoint or provider is contacted.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

A='bc000000-0000-4000-8000-000000000001'
B='bc000000-0000-4000-8000-000000000002'
ACTOR='bb000000-0000-4000-8000-000000000002'
WORKER='bb000000-0000-4000-8000-000000000004'
FILE='bd000000-0000-4000-8000-000000000030'
EXTRACTION='bd000000-0000-4000-8000-000000000031'


def shell(args, **kwargs):
    r=subprocess.run(args,text=True,capture_output=True,**kwargs)
    if r.returncode: raise RuntimeError(r.stderr[:1000])
    return r.stdout


def inspect(name):
    return json.loads(shell(['docker','inspect',name]))[0]


def env_of(config):
    return dict(v.split('=',1) for v in config['Config']['Env'])


def jwt(secret, role, sub=None):
    def encoded(value): return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    claims={'role':role,'aud':'authenticated','iat':int(time.time()),'exp':int(time.time())+1800}
    if sub: claims['sub']=sub
    value=encoded({'alg':'HS256','typ':'JWT'})+'.'+encoded(claims)
    return value+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),value.encode(),hashlib.sha256).digest()).decode().rstrip('=')


def http(base,path,token=None,value=None,method=None,content_type='application/json'):
    data=value if isinstance(value,bytes) else json.dumps(value).encode() if value is not None else None
    headers={'Content-Type':content_type}
    if token: headers['Authorization']='Bearer '+token
    try:
        with urlopen(Request(base+path,data=data,headers=headers,method=method),timeout=30) as r: return r.status,r.read()
    except HTTPError as e: return e.code,e.read()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--database',required=True);parser.add_argument('--web',action='store_true');parser.add_argument('--restore',action='store_true');args=parser.parse_args()
    if not args.database.startswith('community_brain_replay_') or not args.database.replace('_','').isalnum(): raise ValueError('Synthetic replay database required')
    psql=['docker','exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d',args.database,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1']
    bootstrap=psql.copy();bootstrap[bootstrap.index('-U')+1]='supabase_admin'
    source=bootstrap.copy();source[source.index('-d')+1]='postgres'
    # The original schema-only system export omitted owners/ACLs. Restore the
    # local runtime's actual Auth/Storage ownership and explicit table grants;
    # never substitute a service/admin role for a user's request in these tests.
    owners=shell(source,input="""select format('alter %s %I.%I owner to %I;',case when c.relkind='S'then'sequence'else'table'end,n.nspname,c.relname,r.rolname)from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname in('auth','storage')and c.relkind in('r','p','v');
    select format('grant %s on %s %I.%I to %s;',a.privilege_type,case when c.relkind='S'then'sequence'else'table'end,n.nspname,c.relname,case when a.grantee=0 then'public'else quote_ident(pg_get_userbyid(a.grantee))end)from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl)a where n.nspname in('auth','storage')and c.relkind in('r','p','S','v');
    select format('alter schema %I owner to %I;',n.nspname,r.rolname)from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname in('auth','storage');""")
    shell(bootstrap,input=owners)
    root=Path(__file__).resolve().parents[1]
    fixture=(root/'tests/community_brain_execution.test.sql').read_text().split("insert into st values('scope'")[0]+'commit;'
    shell(psql,input=fixture)
    # Migration ledgers contain versions, never customer rows. Restore them for
    # the cloned local Auth/Storage binaries to recognize their installed schema.
    for table in ['auth.schema_migrations','storage.migrations']:
        source=bootstrap.copy();source[source.index('-d')+1]='postgres'
        rows=shell(source,input=f"select coalesce(jsonb_agg(to_jsonb(m)),'[]')from {table} m;").strip()
        shell(bootstrap,input=f"insert into {table} select *from jsonb_populate_recordset(null::{table},$versions${rows}$versions$)on conflict do nothing;")
    shell(psql,input=f"insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)values('{WORKER}','brain-worker@example.invalid',now(),'{{\"community_worker\":true}}');insert into public.community_worker_grants(principal_id,property_id,expires_at)values('{WORKER}','{A}',now()+interval '1 hour');")
    shell(bootstrap,input="""update auth.users set instance_id='00000000-0000-0000-0000-000000000000',aud='authenticated',role='authenticated',confirmation_token='',recovery_token='',email_change_token_new='',email_change='',email_change_token_current='',reauthentication_token='',phone_change='',phone_change_token='',raw_app_meta_data=coalesce(raw_app_meta_data,'{}'),raw_user_meta_data='{}',created_at=now(),updated_at=now();""")
    configs={key:inspect('supabase_'+key+'_p11-platform') for key in ['rest','storage','auth']}
    secret=env_of(configs['auth'])['GOTRUE_JWT_SECRET']
    tokens={role:jwt(secret,role,sub) for role,sub in [('service_role',None),('authenticated',ACTOR),('community_brain_worker',WORKER),('anon',None)]}
    services={};names=[]
    def start(key,port,restored=None):
        config=configs[key];env=env_of(config)
        db_key={'rest':'PGRST_DB_URI','storage':'DATABASE_URL','auth':'GOTRUE_DB_DATABASE_URL'}[key]
        url=urlsplit(env[db_key]);env[db_key]=urlunsplit(url._replace(path='/'+(restored or args.database)))
        if key=='storage':
            env.update(STORAGE_BACKEND='file',FILE_STORAGE_BACKEND_PATH='/tmp/brain-storage',TENANT_ID='community-brain-qualification')
        if key=='auth':
            env.update(GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED='true',GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI='pg-functions://postgres/public/community_brain_access_token_hook')
        name=f'oneclick-brain-qualification-{key}-{os.getpid()}'+('-restore'if restored else '');names.append(name)
        with tempfile.NamedTemporaryFile(mode='w',prefix='brain-local-env-',delete=True)as f:
            os.chmod(f.name,0o600);f.write('\n'.join(k+'='+v for k,v in env.items()));f.flush()
            shell(['docker','run','-d','--name',name,'--network','supabase_network_p11-platform','-p',f'127.0.0.1::{port}','--env-file',f.name,config['Config']['Image']])
        services[key]='http://127.0.0.1:'+inspect(name)['NetworkSettings']['Ports'][str(port)+'/tcp'][0]['HostPort']
        path='/health' if key=='auth' else '/status' if key=='storage' else '/'
        for _ in range(40):
            try:
                status,_body=http(services[key],path,tokens['service_role'])
                if status<500:return
            except(URLError,ConnectionError):pass
            time.sleep(.25)
        logs=shell(['docker','logs','--tail','25',name])
        for k,v in env.items():
            if any(word in k for word in ['KEY','SECRET','TOKEN','DATABASE','URI']) and v:logs=logs.replace(v,'[redacted]')
        print(logs[-1600:],flush=True)
        raise RuntimeError(key+' qualification service did not become ready')
    checks=[]
    def check(condition,name):
        if not condition:raise AssertionError(name)
        checks.append(name);print(json.dumps({'check':name,'state':'passed'}),flush=True)
    try:
        for key,port in [('rest',3000),('storage',5000),('auth',9999)]:start(key,port)
        rest=services['rest'];storage=services['storage'];auth=services['auth']
        def rpc(name,value,token='service_role'):
            code,body=http(rest,'/rpc/'+name,tokens[token],value)
            if code>=300:raise RuntimeError(f'{name} returned {code}: '+str(json.loads(body).get('message','RPC unavailable')))
            return json.loads(body)
        code,body=http(rest,'/documents?select=property_id,content',tokens['authenticated'])
        rows=json.loads(body);check(code==200 and len(rows)==1 and rows[0]['property_id']==A,'HTTP RLS A-only, same-org B and foreign C withheld')
        code,body=http(rest,'/rpc/brain_resolve_scope',tokens['authenticated'],{'p_actor_id':ACTOR,'p_property_ids':[B],'p_purpose':'research'})
        check(code in(401,403),'JWT client cannot call privileged scope factory')
        code,body=http(rest,'/documents?select=content',tokens['anon']);check(code in(401,403)or body==b'[]','Anonymous JWT has no private knowledge')
        code,body=http(auth,'/user',tokens['authenticated'])
        if code!=200:
            error=json.loads(body);print(json.dumps({'authStatus':code,'code':error.get('code'),'message':error.get('msg')or error.get('message')}),flush=True)
        check(code==200 and json.loads(body)['id']==ACTOR,'Auth validates the fixture actor JWT')
        # The actual Auth hook must turn trusted app metadata + a current grant
        # into the narrow worker role, without granting that role to a normal user.
        code,body=http(auth,'/admin/users/'+WORKER,tokens['service_role'],{'password':'Local-brain-fixture-only-726!'},method='PUT')
        check(code==200,'Dedicated worker password configured in synthetic Auth only')
        code,body=http(auth,'/token?grant_type=password',value={'email':'brain-worker@example.invalid','password':'Local-brain-fixture-only-726!'})
        if code!=200:
            error=json.loads(body);print(json.dumps({'workerAuthStatus':code,'code':error.get('error_code'),'message':error.get('msg')or error.get('message')or error.get('error_description')}),flush=True)
            diagnostic=shell(['docker','logs','--tail','8',names[-1]])
            for v in env_of(configs['auth']).values():
                if len(v)>20:diagnostic=diagnostic.replace(v,'[redacted]')
            print(diagnostic[-1600:],flush=True)
        check(code==200,'Actual worker password exchange succeeds')
        worker_session=json.loads(body);claims=json.loads(base64.urlsafe_b64decode(worker_session['access_token'].split('.')[1]+'==='))
        check(claims['role']=='community_brain_worker' and claims['exp']-time.time()<=3601,'Actual Auth hook issues a short-lived worker role')
        tokens['community_brain_worker']=worker_session['access_token']
        # A valid synthetic PNG exercises byte storage and actual raster parsing.
        import struct,zlib
        def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
        pixels=b''.join(b'\x00'+b''.join(bytes((40,90,140))if x in(4,59)or y in(4,59)else bytes((245,245,245))for x in range(64))for y in range(64))
        data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,64,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')
        digest=hashlib.sha256(data).hexdigest();path=A+'/'+FILE+'/original'

        rpc('begin_knowledge_file',{'p_id':FILE,'p_property_id':A,'p_actor_id':ACTOR,'p_input':{'title':'Exact drawing','fileName':'drawing.png','mimeType':'image/png','size':len(data),'byteHash':digest,'materialId':None,'reason':'Synthetic Storage boundary test'}})
        code,_=http(storage,'/object/knowledge-originals/'+path,tokens['service_role'],data,content_type='image/png');check(code in(200,201),'Exact original written to private Storage')
        code,body=http(storage,'/object/public/knowledge-originals/'+path);check(code>=400,'Private original has no public URL access')
        rpc('finish_knowledge_file_storage',{'p_id':FILE,'p_actor_id':ACTOR,'p_byte_hash':digest,'p_size':len(data)})
        file=rpc('read_knowledge_files',{'p_property_id':A,'p_actor_id':ACTOR,'p_input':{'kind':'file','fileId':FILE}})['file']
        rpc('decide_knowledge_file',{'p_id':EXTRACTION,'p_property_id':A,'p_actor_id':ACTOR,'p_input':{'fileId':FILE,'operation':'extract','expectedRevision':file['revision'],'reason':'Extract retained original'}})
        rpc('brain_enqueue_extraction',{'p_id':EXTRACTION})
        worker=WORKER+'/http-fixture'
        claimed=rpc('brain_claim_work',{'p_worker':worker,'p_limit':1},'community_brain_worker')
        check(len(claimed['jobs'])==1,'Worker claims its assigned original through HTTP')
        code,body=http(storage,'/object/authenticated/knowledge-originals/'+path,tokens['community_brain_worker']);check(code==200 and body==data,'Leased worker downloads exact original bytes')
        code,_=http(storage,'/object/knowledge-originals/'+A+'/'+FILE+'/community-file-v1/prefix-check.png',tokens['community_brain_worker'],b'page fixture',content_type='image/png');check(code in(200,201),'Leased worker writes only its own rendition prefix')
        code,_=http(storage,'/object/knowledge-originals/'+B+'/'+FILE+'/community-file-v1/page-1.png',tokens['community_brain_worker'],b'foreign',content_type='image/png');check(code>=400,'Storage denies cross-community worker writes')
        # Process the exact downloaded PNG in the production Linux parser sandbox.
        import uuid
        with tempfile.TemporaryDirectory(prefix='brain-media-fixture-')as fixture_dir:
            folder=Path(fixture_dir);os.chmod(folder,0o777)
            (folder/'original').write_bytes(data)
            (folder/'request.json').write_text(json.dumps(claimed['jobs'][0]['claim']['file']['input']))
            worker_source=root.parent/'services/data-engine/community_brain'
            shell(['docker','run','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=512m','--memory','2g','--cpus','2',
                   '-v',str(worker_source)+':/app/community_brain:ro','-v',str(folder)+':/fixture:rw','oneclick-community-brain:20261013',
                   'python','-m','community_brain.parser_process','/fixture'])
            receipt=json.loads((folder/'receipt.json').read_text())
            check(receipt['complete'] and receipt['fileHash']==digest,'Actual sandbox parser retains exact image hash and page rendition')
            renditions=[]
            for artifact in receipt['artifacts']:
                rendition_path=A+'/'+FILE+'/'+receipt['recipe']+'/'+artifact['name']
                rendition_bytes=(folder/'output'/artifact['name']).read_bytes()
                code,_=http(storage,'/object/knowledge-originals/'+rendition_path,tokens['community_brain_worker'],rendition_bytes,content_type=artifact['mimeType'])
                check(code in(200,201),'Leased worker stores checked '+artifact['kind']+' rendition')
                renditions.append({**artifact,'id':str(uuid.uuid5(uuid.NAMESPACE_URL,rendition_path)),'recipe':receipt['recipe'],'storagePath':rendition_path,'originalHash':digest})
            job=claimed['jobs'][0]
            result=rpc('brain_finish_extraction',{'p_job_id':job['job']['id'],'p_worker':worker,'p_claim_token':job['claim']['claimToken'],'p_receipt':receipt,'p_renditions':renditions},'community_brain_worker')
            check(result['state']=='ready','Real extraction commits through its scoped worker lease')
        scope=rpc('brain_resolve_scope',{'p_actor_id':ACTOR,'p_property_ids':[A],'p_purpose':'manage'})
        unit='bd000000-0000-4000-8000-000000000040';asset='bd000000-0000-4000-8000-000000000041'
        shell(psql,input=f"insert into public.property_units(id,property_id,org_id,unit_type,canonical_key,bedrooms,bathrooms,sqft_min,sqft_max)values('{unit}','{A}','ba000000-0000-4000-8000-000000000001','Exact fixture plan','fixture-1',1,1,700,700);")
        detail=rpc('brain_file_detail',{'p_scope_id':scope['id'],'p_file_id':FILE})
        page=next(r for r in renditions if r['kind']=='page')
        review={'fileId':FILE,'originalHash':digest,'renditionId':page['id'],'role':'floorplan','name':'Exact fixture drawing','description':'Synthetic drawing for file identity qualification','rights':'owned','isGenerated':False,'confirmed':True,'reason':'Review this exact retained synthetic page','unitId':unit,'unitHash':next(u['hash']for u in detail['units']if u['id']==unit)}
        result=rpc('brain_review_asset',{'p_scope_id':scope['id'],'p_id':asset,'p_input':review})
        check(result['state']=='saved' and result['unitId']==unit,'Review binds exact retained page to exact community floorplan')
        current=rpc('brain_read_asset',{'p_scope_id':scope['id'],'p_asset_id':asset})
        check(current['id']==asset and current['hash']==page['contentHash'],'Exact asset resolver preserves approved drawing checksum')
        portfolio=rpc('brain_resolve_scope',{'p_actor_id':'bb000000-0000-4000-8000-000000000003','p_property_ids':[A,B],'p_purpose':'portfolio'})
        cards=rpc('brain_portfolio_assets',{'p_scope_id':portfolio['id'],'p_property_id':A,'p_plans':True,'p_offset':0})
        check(len(cards['items'])==1 and cards['items'][0]['asset_id']==asset,'Selected-community portfolio retrieves the exact reviewed drawing')
        if args.web:
            from web_community_brain import qualify
            portfolio_actor='bb000000-0000-4000-8000-000000000003'
            rpc('brain_set_access',{'p_actor_id':'bb000000-0000-4000-8000-000000000001','p_property_id':A,'p_target_actor_id':portfolio_actor,'p_capabilities':['read','portfolio','manage','download'],'p_expires_at':None,'p_revoke':False,'p_reason':'Authorize synthetic local browser qualification'})
            code,_=http(auth,'/admin/users/'+portfolio_actor,tokens['service_role'],{'password':'Local-brain-fixture-only-726!'},method='PUT')
            check(code==200,'Synthetic browser actor configured')
            code,body=http(auth,'/token?grant_type=password',value={'email':'brain-portfolio@example.invalid','password':'Local-brain-fixture-only-726!'})
            check(code==200,'Synthetic browser actor obtains actual Auth session')
            qualify(services,tokens,json.loads(body),root)
            portfolio=rpc('brain_resolve_scope',{'p_actor_id':portfolio_actor,'p_property_ids':[A,B],'p_purpose':'portfolio'})
        # Direct PostgreSQL mutation represents the trusted native rights review,
        # then the actual serving API must reject it without waiting for indexing.
        shell(psql,input=f"update public.content_assets set expires_at=now()-interval '1 second'where id='{asset}';")
        code,_=http(rest,'/rpc/brain_read_asset',tokens['service_role'],{'p_scope_id':scope['id'],'p_asset_id':asset})
        check(code>=400,'Rights expiry immediately denies the exact asset resolver')
        cards=rpc('brain_portfolio_assets',{'p_scope_id':portfolio['id'],'p_property_id':A,'p_plans':True,'p_offset':0})
        check(cards['items'][0]['asset_id']is None,'Portfolio reports missing eligible drawing after rights expiry')
        shell(psql,input=f"update public.community_worker_grants set revoked_at=now()where principal_id='{WORKER}';")
        code,_=http(storage,'/object/authenticated/knowledge-originals/'+path,tokens['community_brain_worker']);check(code>=400,'Revocation blocks original access with an unchanged worker JWT')
        code,_=http(auth,'/token?grant_type=refresh_token',value={'refresh_token':worker_session['refresh_token']});check(code>=400,'Revoked worker cannot renew its credential')
        if args.restore:
            restored=args.database+'_restore'
            # This database was explicitly created by the qualification harness;
            # an existing restore destination is an error, never reset or dropped.
            shell(['docker','exec','supabase_db_p11-platform','createdb','-U','postgres',restored])
            dump=subprocess.run(['docker','exec','supabase_db_p11-platform','pg_dump','-U','supabase_admin','-Fc',args.database],capture_output=True,check=True).stdout
            restored_result=subprocess.run(['docker','exec','-i','supabase_db_p11-platform','pg_restore','-U','supabase_admin','-d',restored,'--clean','--if-exists','--exit-on-error'],input=dump,capture_output=True)
            if restored_result.returncode:raise RuntimeError(restored_result.stderr.decode()[-1800:])
            check(True,'Database metadata, policies and synthetic access history restored from pg_dump')
            start('storage',5000,restored);start('rest',3000,restored)
            restored_storage=services['storage'];rest=services['rest']
            # Restore a retained original into an independent object store; its
            # metadata backup alone cannot restore any of these file bytes.
            code,body=http(restored_storage,'/object/authenticated/knowledge-originals/'+path,tokens['service_role'])
            check(code>=400,'Database-only restore does not falsely report stored original bytes')
            # Restore via the supported Storage API, preserving immutable keys.
            restore_request=Request(restored_storage+'/object/knowledge-originals/'+path,data=data,headers={'Content-Type':'image/png','Authorization':'Bearer '+tokens['service_role'],'x-upsert':'true'},method='POST')
            with urlopen(restore_request,timeout=30)as response:check(response.status in(200,201),'Exact original bytes restored to independent private Storage')
            code,body=http(restored_storage,'/object/authenticated/knowledge-originals/'+path,tokens['service_role'])
            check(code==200 and hashlib.sha256(body).hexdigest()==digest,'Restored original checksum matches its retained database identity')
            code,_=http(restored_storage,'/object/public/knowledge-originals/'+path)
            check(code>=400,'Restored originals remain private')
            code,_=http(restored_storage,'/object/authenticated/knowledge-originals/'+path,tokens['community_brain_worker'])
            check(code>=400,'Restored worker revocation still denies the original')
            fresh_scope=rpc('brain_resolve_scope',{'p_actor_id':ACTOR,'p_property_ids':[A],'p_purpose':'manage'})
            code,_=http(rest,'/rpc/brain_read_asset',tokens['service_role'],{'p_scope_id':fresh_scope['id'],'p_asset_id':asset})
            check(code>=400,'Restored rights expiry prevents obsolete asset release')
        print(json.dumps({'state':'passed','checks':len(checks),'database':args.database,'liveEndpointsContacted':False}),flush=True)
    finally:
        for name in names:subprocess.run(['docker','rm','-f',name],capture_output=True,text=True)


if __name__=='__main__':main()
