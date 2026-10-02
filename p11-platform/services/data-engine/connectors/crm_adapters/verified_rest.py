"""Explicit provider contracts for exact saved lead values and read evidence."""
import re
from .base import BaseCRMAdapter,CRMSchema,CRMField,FieldType,SearchResult,CreateResult,ConnectionResult
from utils.crm_transport import request

SAFE_ID=re.compile(r'^[A-Za-z0-9_-]{1,256}$')

def canonical(field,value):
    if not isinstance(value,str):return ''
    return value.strip().casefold() if field=='email' else re.sub(r'[^0-9]','',value)

def candidate_result(records,total,field,expected,id_field,value_field):
    if not isinstance(records,list) or not isinstance(total,int) or isinstance(total,bool) or total<0 or total!=len(records):
        return SearchResult(False,error='search_incomplete')
    if total==0:return SearchResult(False)
    if total!=1:return SearchResult(False,error='multiple_destinations')
    record=records[0]
    if not isinstance(record,dict):return SearchResult(False,error='record_unconfirmed')
    destination=str(record.get(id_field) or '')
    values=record.get('properties',{}) if value_field=='properties' else record
    key=field if value_field=='properties' else ('Email' if field=='email' else 'Phone')
    if not SAFE_ID.fullmatch(destination) or not canonical(field,expected) or canonical(field,values.get(key))!=canonical(field,expected):
        return SearchResult(False,error='contact_unconfirmed')
    return SearchResult(True,external_id=destination,match_type=field,existing_data=values)

class VerifiedRESTAdapter(BaseCRMAdapter):
    contract_version='crm-exact-v1'
    def _read(self,path,params=None):
        r=self._request('GET',path,params=params)
        if r.status_code!=200:raise ValueError('provider_read_unconfirmed')
        return r.json()
    def search_lead(self,email,phone=None):
        matches=[]
        try:
            for field,value in [('email',email),('phone',phone)]:
                if not canonical(field,value):continue
                result=self._search(field,value)
                if result.error:return result
                if result.found:matches.append(result)
            if not canonical('email',email) and not canonical('phone',phone):return SearchResult(False,error='contact_required')
            if len({m.external_id for m in matches})>1:return SearchResult(False,error='conflicting_destinations')
            if not matches:return SearchResult(False)
            match=matches[0]
            if len(matches)>1:match.match_type='both'
            return match
        except Exception:return SearchResult(False,error='provider_search_unconfirmed')
    def test_connection(self):
        try:
            identity=self.account_identity()
            if not identity.get('id'):raise ValueError('identity_missing')
            return ConnectionResult(True,api_version=self.api_version)
        except Exception:return ConnectionResult(False,error='provider_account_unconfirmed')
    def validate_values(self,values,mapping=None):
        schema=self.get_schema();fields={f.name:f for f in schema.fields}
        if schema.evidence_source!='provider_response':raise ValueError('schema_unconfirmed')
        if set(values)-set(fields) or (mapping and set(mapping.values())-set(fields)):raise ValueError('unwritable_mapping')
        if any(f.required and (f.name not in values or values[f.name] in (None,'')) for f in fields.values()):raise ValueError('required_values_missing')
        if any(fields[k].picklist_values and v not in fields[k].picklist_values for k,v in values.items() if v is not None):raise ValueError('picklist_value_invalid')
        return True
    def record_absent(self,external_id):
        if not isinstance(external_id,str) or not SAFE_ID.fullmatch(external_id):return False
        return self._request('GET',self.record_path+'/'+external_id).status_code==404
    def create_lead(self,mapped_data):
        try:
            # No defaults, value rewriting or secondary provider writes after approval.
            r=self._request('POST',self.record_path,payload=self._create_payload(dict(mapped_data)))
            if r.status_code!=201:return CreateResult(False,error='provider_create_unconfirmed')
            data=r.json();identity=str(data.get('id') or '')
            if not SAFE_ID.fullmatch(identity) or not self._valid_create(data):return CreateResult(False,error='provider_receipt_unconfirmed')
            return CreateResult(True,external_id=identity,confirmation='confirmed')
        except Exception:return CreateResult(False,error='provider_create_unconfirmed')
    def get_lead(self,external_id):
        if not isinstance(external_id,str) or not SAFE_ID.fullmatch(external_id):raise ValueError('invalid_record_id')
        data=self._read(self.record_path+'/'+external_id,self._record_params())
        return self._record(data)
    def delete_lead(self,external_id):
        if not isinstance(external_id,str) or not SAFE_ID.fullmatch(external_id):return False
        return self._request('DELETE',self.record_path+'/'+external_id).status_code==204
    def _record_params(self):return None
    def _valid_create(self,data):return True
    def _record(self,data):return data
    def _create_payload(self,data):return data

class HubSpotAdapter(VerifiedRESTAdapter):
    api_version='v3';record_path='/crm/v3/objects/contacts'
    def _validate_credentials(self):
        self.token=self.credentials.get('access_token') or self.credentials.get('api_key')
        if not self.token:raise ValueError('HubSpot access token required')
    def _request(self,method,path,**kwargs):return request(method,'https://api.hubapi.com'+path,token=self.token,**kwargs)
    def account_identity(self):
        data=self._read('/account-info/v3/details')
        return {'id':str(data.get('portalId') or ''),'type':str(data.get('accountType') or 'unknown')}
    def get_schema(self):
        data=self._read('/crm/v3/properties/contacts');fields=[]
        for field in data['results']:
            if field.get('modificationMetadata',{}).get('readOnlyValue') or field.get('calculated'):continue
            kind=FieldType.EMAIL if field['name']=='email' else FieldType.PHONE if field['name']=='phone' else FieldType.STRING
            fields.append(CRMField(field['name'],field.get('label',field['name']),kind,required=False,picklist_values=[o['value'] for o in field.get('options',[]) if not o.get('hidden')]))
        return CRMSchema('hubspot',self.api_version,'Contact','Contact',fields,evidence_source='provider_response')
    def _search(self,field,value):
        # Exact filters and a complete bounded result set; never accept a partial phone match.
        data=self._request('POST',self.record_path+'/search',payload={'filterGroups':[{'filters':[{'propertyName':field,'operator':'EQ','value':value.strip()}]}],'properties':['firstname','lastname','email','phone'],'limit':2})
        if data.status_code!=200:return SearchResult(False,error='provider_search_unconfirmed')
        body=data.json()
        return candidate_result(body.get('results'),body.get('total'),field,value,'id','properties')
    def _create_payload(self,data):return {'properties':data}
    def _record_params(self):
        fields=set(['firstname','lastname','email','phone','company'])|set(getattr(self,'read_fields',[]))
        if any(not isinstance(field,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,255}',field) for field in fields):raise ValueError('invalid_read_fields')
        return {'properties':','.join(sorted(fields))}
    def _record(self,data):
        if data.get('archived') is True:raise ValueError('record_archived')
        return {**data['properties'],'id':str(data['id'])}

class SalesforceAdapter(VerifiedRESTAdapter):
    api_version='v61.0';record_path='/services/data/v61.0/sobjects/Lead'
    def _validate_credentials(self):
        from urllib.parse import urlsplit
        url=self.credentials.get('instance_url','');p=urlsplit(url);host=(p.hostname or '').lower()
        if p.scheme!='https' or p.username or p.password or p.port not in (None,443) or p.path not in ('','/') or p.query or p.fragment or not host.endswith(('.salesforce.com','.force.com')) or not self.credentials.get('access_token'):
            raise ValueError('Official Salesforce instance and access token required')
        self.base=url.rstrip('/');self.token=self.credentials['access_token']
    def _request(self,method,path,**kwargs):return request(method,self.base+path,token=self.token,**kwargs)
    def account_identity(self):
        data=self._read('/services/data/v61.0/query',{'q':'SELECT Id, IsSandbox FROM Organization LIMIT 1'})
        if data.get('totalSize')!=1 or len(data.get('records',[]))!=1:raise ValueError('account_unconfirmed')
        record=data['records'][0];return {'id':str(record['Id']),'type':'sandbox' if record.get('IsSandbox') is True else 'production'}
    def get_schema(self):
        data=self._read(self.record_path+'/describe');fields=[]
        if data.get('createable') is not True:raise ValueError('lead_creation_not_permitted')
        for field in data['fields']:
            if field.get('createable') is not True:continue
            kind=FieldType.EMAIL if field['name']=='Email' else FieldType.PHONE if field['name']=='Phone' else FieldType.STRING
            required=not field.get('nillable',True) and not field.get('defaultedOnCreate',False)
            fields.append(CRMField(field['name'],field.get('label',field['name']),kind,required=required,picklist_values=[o['value'] for o in field.get('picklistValues',[]) if o.get('active')]))
        return CRMSchema('salesforce',self.api_version,'Lead','Lead',fields,evidence_source='provider_response')
    def _search(self,field,value):
        column='Email' if field=='email' else 'Phone'
        # Escape SOQL string literals; the query is sent as an encoded parameter.
        escaped=value.strip().replace('\\','\\\\').replace("'","\\'")
        if any(ord(c)<32 for c in escaped):return SearchResult(False,error='invalid_contact')
        body=self._read('/services/data/v61.0/query',{'q':f"SELECT Id, Email, Phone FROM Lead WHERE {column} = '{escaped}' LIMIT 2"})
        if body.get('done') is not True:return SearchResult(False,error='search_incomplete')
        return candidate_result(body.get('records'),body.get('totalSize'),field,value,'Id','record')
    def _valid_create(self,data):return data.get('success') is True and data.get('errors')==[]
