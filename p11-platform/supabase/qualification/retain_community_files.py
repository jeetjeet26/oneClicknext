"""Retain reviewed originals using native upload decisions; no public publication.

Uses an explicitly supplied deployment credential file. Never logs credentials,
file contents, or authentication responses. Existing bytes are verified, never
overwritten. Extraction is optional and performed by the scoped worker queue.
"""
import argparse
import hashlib
import json
import mimetypes
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Credential-bearing requests cannot redirect')


def credentials(path):
    values={}
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith('#') or '=' not in line:
            continue
        key,value=line.split('=',1)
        values[key.strip()]=value.strip().strip('"').strip("'")
    return values


class DeploymentClient:
    def __init__(self,env_file,project_ref):
        env=credentials(env_file)
        self.url=(env.get('SUPABASE_URL')or env['NEXT_PUBLIC_SUPABASE_URL']).rstrip('/')
        if urlparse(self.url).hostname!=project_ref+'.supabase.co':
            raise ValueError('Credential file does not target the reviewed Supabase project')
        self.key=env['SUPABASE_SERVICE_ROLE_KEY']
        self.open=build_opener(NoRedirect).open

    def call(self,path,body=None,mime='application/json',method=None,limit=110*1024*1024):
        raw=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
        req=Request(self.url+path,data=raw,method=method,headers={'apikey':self.key,'Authorization':'Bearer '+self.key,'Content-Type':mime,'x-upsert':'false'})
        try:
            with self.open(req,timeout=90)as response:
                data=response.read(limit+1)
                if len(data)>limit:raise ValueError('Response exceeded bounded size')
                return data
        except HTTPError as error:
            # Only stable error codes; never echo auth responses or user content.
            error.safe_body=error.read(2048)
            raise

    def rpc(self,name,value):
        result=json.loads(self.call('/rest/v1/rpc/'+name,value))
        if isinstance(result,dict)and result.get('state')in {'forbidden','not_found','request_conflict','file_changed','source_changed','closed_request'}:
            raise ValueError(name+': '+result['state'])
        return result

    def retain_bytes(self,path,data,mime):
        url='/storage/v1/object/knowledge-originals/'+quote(path,safe='/')
        try:self.call(url,data,mime)
        except HTTPError as error:
            if error.code not in {400,409}:raise
        saved=self.call('/storage/v1/object/authenticated/knowledge-originals/'+quote(path,safe='/'),limit=len(data))
        if hashlib.sha256(saved).digest()!=hashlib.sha256(data).digest():
            raise ValueError('Stored original byte verification failed')


def retain(client,property_id,actor,entry,directory,extract):
    name=Path(entry['name']).name
    if name!=entry['name']:raise ValueError('Manifest must use local basenames')
    data=(directory/name).read_bytes();digest=hashlib.sha256(data).hexdigest()
    if digest!=entry['sha256'] or len(data)!=entry['size']:raise ValueError('Reviewed original changed')
    file_id=str(uuid.uuid5(uuid.UUID(property_id),'retained-original:'+digest))
    mime=entry.get('mimeType')or mimetypes.guess_type(name)[0]
    if not mime:raise ValueError('Explicit MIME type required')
    reason='Retained during authorized Community Brain adoption. Original source: '+entry['url']
    client.rpc('begin_knowledge_file',{'p_id':file_id,'p_property_id':property_id,'p_actor_id':actor,'p_input':{'title':entry.get('title',name),'fileName':name,'mimeType':mime,'size':len(data),'byteHash':digest,'reason':reason,'materialId':None}})
    def detail():return client.rpc('read_knowledge_files',{'p_property_id':property_id,'p_actor_id':actor,'p_input':{'kind':'file','fileId':file_id}})['file']
    file=detail()
    if file['state'] not in {'pending','stored'}:raise ValueError('Original is not available for retention')
    client.retain_bytes(file['storage_path'],data,mime)
    client.rpc('finish_knowledge_file_storage',{'p_id':file_id,'p_actor_id':actor,'p_byte_hash':digest,'p_size':len(data)})
    extraction=None
    if extract:
        file=detail();extraction=file.get('latest_extraction_id')
        if not extraction:
            extraction=str(uuid.uuid5(uuid.UUID(file_id),'community-file-v1'))
            result=client.rpc('decide_knowledge_file',{'p_id':extraction,'p_property_id':property_id,'p_actor_id':actor,'p_input':{'operation':'extract','fileId':file_id,'expectedRevision':file['revision'],'reason':'Verify every page and retain exact original renderings for reviewed community assets.'}})
            if result.get('extractionId')!=extraction:raise ValueError('Extraction decision was not confirmed')
        client.rpc('brain_enqueue_extraction',{'p_id':extraction})
    return {'name':name,'propertyId':property_id,'fileId':file_id,'storagePath':file['storage_path'],'sha256':digest,'size':len(data),'extractionId':extraction,'role':entry['role'],'sourceUrl':entry['url']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['env-file','manifest','directory','receipt']:parser.add_argument('--'+name,type=Path,required=True)
    for name in ['property','actor','project-ref']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--extract',action='store_true')
    args=parser.parse_args();client=DeploymentClient(args.env_file,args.project_ref)
    saved=[]
    for entry in json.loads(args.manifest.read_text()):
        saved.append(retain(client,args.property,args.actor,entry,args.directory,args.extract))
        args.receipt.write_text(json.dumps(saved,indent=2)+'\n');args.receipt.chmod(0o600)
        print(json.dumps({'name':entry['name'],'retained':True,'extractionQueued':args.extract}),flush=True)


if __name__=='__main__':main()
