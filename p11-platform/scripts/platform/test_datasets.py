import copy,tempfile,unittest
from pathlib import Path
import datasets as d

def episode(number=1,**changes):
 h=lambda s:d.hashlib.sha256(s.encode()).hexdigest();client=h('client-'+str(number));r={'episodeId':h('episode-'+str(number)),'taskId':h('task-'+str(number)),'clientId':client,'source':'synthetic','actorKind':'human','decisionAt':'2026-09-01T12:00:00Z','context':[{'id':h('context-'+str(number)),'clientId':client,'sha256':h('context'),'availableAt':'2026-09-01T11:00:00Z'}],'action':'tour.booked','allowedActions':['tour.booked'],'permission':'allowed','resultStatus':'succeeded','receiptHash':h('receipt'),'trainingEligible':False};r.update(changes);return r
CUTOFF='2026-09-03T00:00:00Z'
class DatasetTests(unittest.TestCase):
 def test_metadata_manifest_is_deterministic(self):
  a,b=episode(),episode(2);self.assertEqual(d.manifest([a,b],CUTOFF),d.manifest([b,a],CUTOFF))
 def test_client_stays_in_one_split(self):
  a=episode();b=episode(2,clientId=a['clientId'],taskId=a['taskId']);b['context'][0]['clientId']=a['clientId'];m=d.manifest([a,b],CUTOFF);self.assertEqual(len({x['split']for x in m['episodes']}),1)
 def test_private_and_unrecognized_fields_rejected(self):
  for field in ['password','email','prompt','apiKey','rawOriginal']:
   with self.subTest(field=field),self.assertRaises(ValueError):d.validate_episode(episode(**{field:'private'}))
 def test_production_and_training_rejected(self):
  for values in [{'source':'production'},{'trainingEligible':True},{'trainingEligible':0}]:
   with self.assertRaises(ValueError):d.validate_episode(episode(**values))
 def test_future_and_cross_client_context_rejected(self):
  for key,value in [('availableAt','2026-09-02T12:00:00Z'),('clientId','a'*64)]:
   a=episode();a['context'][0][key]=value
   with self.assertRaises(ValueError):d.validate_episode(a)
 def test_later_outcome_does_not_enter_decision_input(self):
  a=episode();b=episode(outcome={'status':'observed','measuredAt':'2026-09-02T00:00:00Z','evidenceHash':'b'*64,'metricVersion':'tour-attended-v1','value':1,'unit':'tours'});ma=d.manifest([a],CUTOFF);mb=d.manifest([b],CUTOFF)
  self.assertEqual(ma['episodes'][0]['decisionInputHash'],mb['episodes'][0]['decisionInputHash']);self.assertNotEqual(ma['contentHash'],mb['contentHash']);self.assertIsNone(mb['episodes'][0]['reward'])
 def test_unknown_result_and_cost_stay_unknown(self):
  m=d.manifest([episode(resultStatus='unconfirmed',receiptHash=None)],CUTOFF)['episodes'][0];self.assertIsNone(m['cost']['amount']);self.assertEqual(m['resultStatus'],'unconfirmed');self.assertIsNone(m['reward'])
 def test_browser_or_unconfirmed_result_is_not_success_without_receipt(self):
  with self.assertRaises(ValueError):d.validate_episode(episode(receiptHash=None))
 def test_policy_failures_are_retained_not_imitation_success(self):
  m=d.manifest([episode(permission='denied',allowedActions=[])],CUTOFF)['episodes'][0];self.assertTrue(m['policyViolation']);self.assertFalse(m['trainingEligible']);self.assertIsNone(m['reward'])
 def test_duplicate_episode_or_cross_client_task_rejected(self):
  with self.assertRaises(ValueError):d.manifest([episode(),episode()],CUTOFF)
  with self.assertRaises(ValueError):d.manifest([episode(),episode(2,taskId=episode()['taskId'])],CUTOFF)
 def test_cutoff_and_timezone_required(self):
  with self.assertRaises(ValueError):d.manifest([episode()], '2026-08-01T00:00:00Z')
  with self.assertRaises(ValueError):d.manifest([episode()], '2026-09-03T00:00:00')
  with self.assertRaises(ValueError):d.manifest([episode(outcome={'status':'pending','measuredAt':'2026-10-01T00:00:00Z','evidenceHash':'c'*64})],CUTOFF)
 def test_baseline_freezes_sources_and_rejects_changed_manifest(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);p=root/'model.ts';p.write_text('existing model configuration');m=d.manifest([episode()],CUTOFF);a=d.freeze_baseline(root,['model.ts'],m);p.write_text('changed prompt');b=d.freeze_baseline(root,['model.ts'],m);self.assertNotEqual(a['contentHash'],b['contentHash']);self.assertEqual(a['modelQuality'],'not_measured');m['trainingEnabled']=True
   with self.assertRaises(ValueError):d.freeze_baseline(root,['model.ts'],m)
 def test_manifest_cannot_overwrite_a_frozen_version(self):
  with tempfile.TemporaryDirectory()as folder:
   p=Path(folder)/'v1.json';d.write_new(p,{'id':'v1'})
   with self.assertRaises(FileExistsError):d.write_new(p,{'id':'changed'})
 def test_baseline_rejects_symlink(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);(root/'source.ts').write_text('code');(root/'link.ts').symlink_to(root/'source.ts')
   with self.assertRaises(ValueError):d.freeze_baseline(root,['link.ts'],d.manifest([episode()],CUTOFF))
if __name__=='__main__':unittest.main()
