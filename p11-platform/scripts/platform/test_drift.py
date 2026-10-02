import copy,json,tempfile,unittest
from pathlib import Path
import drift

def snapshot(**changes):
 s={'formatVersion':2,'source':'production','projectRef':'a'*20,'capturedAt':'2026-09-24T12:00:00Z','catalogQueryHash':'a'*64,'serverVersion':'17.6','objects':[{'kind':'relation','identity':'public.example','value':{'rls':True,'acl':'authenticated=r/postgres'}}],'migrations':[{'version':'20260101000000','name':'original','sqlHash':drift.sql_digest('select 1;'),'statementCount':1}]}
 s.update(changes);s['contentHash']=drift.digest({k:v for k,v in s.items()if k!='contentHash'});return s

class DriftTests(unittest.TestCase):
 def test_timestamp_is_provenance_not_drift(self):
  self.assertFalse(drift.compare(snapshot(),snapshot(capturedAt='2026-09-25T12:00:00Z'))['hasDrift'])
 def test_missing_and_null_differ(self):
  s=snapshot();s['objects'][0]['value']['owner']=None;s=snapshot(**s)
  self.assertEqual(drift.compare(snapshot(),s)['schema'][0]['fields'],['owner'])
 def test_rls_acl_definition_changes_are_detected(self):
  for key,value in [('rls',False),('acl','PUBLIC=arwd'),('bodyHash','changed'),('usingHash','changed'),('securityDefiner',True)]:
   with self.subTest(key=key):
    s=snapshot();s['objects'][0]['value'][key]=value;s=snapshot(**s);self.assertTrue(drift.compare(snapshot(),s)['hasDrift'])
 def test_added_and_removed_objects(self):
  a=snapshot();b=snapshot(objects=[{'kind':'function','identity':'public.f(uuid)','value':{}}])
  self.assertEqual({x['change']for x in drift.compare(a,b)['schema']},{'added','removed'})
 def test_overloads_are_distinct(self):
  s=snapshot(objects=[{'kind':'function','identity':'f(uuid)','value':{}},{'kind':'function','identity':'f(text)','value':{}}]);drift.validate(s)
 def test_exact_history_versions_and_hashes(self):
  s=snapshot();s['migrations'][0]['sqlHash']='b'*32;s=snapshot(**s);self.assertTrue(drift.compare(snapshot(),s)['history'])
 def test_tamper_rejected(self):
  s=snapshot();s['objects'][0]['value']['rls']=False
  with self.assertRaises(ValueError):drift.validate(s)
 def test_duplicates_rejected(self):
  for field in ['objects','migrations']:
   s=snapshot();s[field]*=2;s=snapshot(**s)
   with self.assertRaises(ValueError):drift.validate(s)
 def test_wrong_project_or_query_rejected(self):
  for changes in [{'projectRef':'b'*20},{'catalogQueryHash':'b'*64}]:
   with self.assertRaises(ValueError):drift.compare(snapshot(),snapshot(**changes))
 def test_local_is_never_production_certificate(self):
  r=drift.compare(snapshot(),snapshot(source='local',projectRef='local:p11-platform:postgres'));self.assertEqual(r['status'],'matching_structure_different_environment')
 def test_malformed_provenance(self):
  for changes in [{'source':'unknown'},{'capturedAt':'2026-09-24T00:00:00'},{'objects':[None]},{'migrations':[{'version':'yesterday'}]}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):drift.validate(snapshot(**changes))
 def test_cli_response_shapes(self):
  for value in [snapshot(),[{'snapshot':snapshot()}],{'result':json.dumps([{'snapshot':snapshot()}])}]:self.assertEqual(drift.unwrap(value),snapshot())
 def test_bundle_verifies_exact_sql_and_cli_terminator(self):
  for suffix in ['', ';\n']:
   with tempfile.TemporaryDirectory()as d:
    root=Path(d);h=root/'history';h.mkdir();p=root/'pending';p.mkdir()
    (h/'20260101000000_original.sql').write_text('select 1;'+suffix)
    name='20260201000000_new.sql';(p/name).write_text('select 2;');manifest=[{'file':name,'sha256':drift.hashlib.sha256((p/name).read_bytes()).hexdigest()}]
    result=drift.bundle(snapshot(),h,p,manifest,root/'bundle');self.assertEqual(result['status'],'prepared_not_deployed');self.assertEqual(result['historyFiles'],1)
    with self.assertRaises(ValueError):drift.bundle(snapshot(),h,p,manifest,root/'bundle')
 def test_bundle_rejects_tamper_order_and_traversal_before_writing(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);h=root/'history';h.mkdir();p=root/'pending';p.mkdir();(h/'20260101000000_original.sql').write_text('select 1;')
   for name,sha in [('20260201000000_new.sql','wrong'),('20260101000000_original.sql','x'),('../escape.sql','x')]:
    if '/'not in name:(p/name).write_text('select 2;')
    with self.assertRaises(ValueError):drift.bundle(snapshot(),h,p,[{'file':name,'sha256':sha}],root/'bundle')
    self.assertFalse((root/'bundle').exists())
   (h/'20260101000000_original.sql').write_text('select 9;')
   with self.assertRaises(ValueError):drift.bundle(snapshot(),h,p,[{'file':'20260201000000_new.sql','sha256':'x'}],root/'bundle')
if __name__=='__main__':unittest.main()
