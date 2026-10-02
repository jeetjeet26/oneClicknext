import copy, unittest
from retention import plan,finish,exclude_erased
from datasets import digest

class RetentionTests(unittest.TestCase):
    def inventory(self):
        rows=[{'id':digest(i),'clientId':digest('client'),'kind':kind,'sha256':digest('bytes'+str(i)),'state':'withdrawn','references':[]if i==0 else[digest(i-1)],'hold':False}for i,kind in enumerate(['original','extraction','source','embedding','dataset'])]
        return {'formatVersion':1,'source':'synthetic','records':rows}
    def review(self,inv=None):return plan(inv or self.inventory(),digest('client'),[digest(0)],'2026-09-24T12:00:00Z')
    def receipts(self,r):return [{**{k:v for k,v in row.items()if k in ['id','sha256','kind']},'state':'erased','observedAt':'2026-09-24T12:01:00Z','receiptHash':digest(row)}for row in r['targets']]
    def test_descendant_closure(self):self.assertEqual(len(self.review()['targets']),5)
    def test_cross_client_selection(self):
        with self.assertRaises(ValueError):plan(self.inventory(),digest('other'),[digest(0)],'2026-09-24T12:00:00Z')
    def test_cross_client_descendant(self):
        inv=self.inventory();inv['records'][-1]['clientId']=digest('other')
        with self.assertRaises(ValueError):self.review(inv)
    def test_active_hold_and_expiry_block(self):
        inv=self.inventory();inv['records'][0].update(state='active',hold=True,retainUntil='2026-10-24T12:00:00Z');r=self.review(inv)
        self.assertEqual(len(r['blockers']),3)
        with self.assertRaises(ValueError):finish(r,inv,self.receipts(r))
    def test_unknown_ref_blocks(self):
        inv=self.inventory();inv['records'][0]['references']=[digest('missing')];self.assertEqual(self.review(inv)['blockers'][0]['reason'],'incomplete_lineage_inventory')
    def test_changed_source_fails(self):
        inv=self.inventory();r=self.review(inv);inv['records'][0]['sha256']=digest('changed')
        with self.assertRaises(ValueError):finish(r,inv,self.receipts(r))
    def test_missing_original_or_backup_receipt(self):
        r=self.review()
        with self.assertRaises(ValueError):finish(r,self.inventory(),self.receipts(r)[1:])
    def test_unconfirmed_receipt(self):
        r=self.review();receipts=self.receipts(r);receipts[0]['state']='requested'
        with self.assertRaises(ValueError):finish(r,self.inventory(),receipts)
    def test_stale_or_duplicate_receipt(self):
        r=self.review();receipts=self.receipts(r);receipts[0]['observedAt']='2026-09-23T12:00:00Z'
        with self.assertRaises(ValueError):finish(r,self.inventory(),receipts)
        with self.assertRaises(ValueError):finish(r,self.inventory(),self.receipts(r)*2)
    def test_tombstone_excludes_context_before_dataset_selection(self):
        r=self.review();t=finish(r,self.inventory(),self.receipts(r));row={'clientId':digest('client'),'episodeId':digest('episode'),'taskId':digest('task'),'context':[{'id':digest(2)}]}
        other=copy.deepcopy(row);other['clientId']=digest('other');other['episodeId']=digest('other episode')
        result=exclude_erased([row,other],[t]);self.assertEqual(result['episodes'],[other]);self.assertEqual(result['removedEpisodeIds'],[row['episodeId']])
    def test_private_fields_refused(self):
        inv=self.inventory();inv['records'][0]['content']='private text'
        with self.assertRaises(ValueError):self.review(inv)
    def test_altered_deletion_evidence_rejected(self):
        r=self.review();t=finish(r,self.inventory(),self.receipts(r));t['erasedIds']=[]
        with self.assertRaises(ValueError):exclude_erased([],[t])

if __name__=='__main__':unittest.main()
