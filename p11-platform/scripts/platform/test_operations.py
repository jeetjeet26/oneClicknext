import unittest
from operations import qualify

class ObservationTests(unittest.TestCase):
    def spec(self,**kw):return {'job':'fixture','enabled':True,'configurationHash':'a'*64,'maxGapMinutes':60,'cycle':'fixed','cycleMinutes':60,**kw}
    def runrow(self,n,start,end,**kw):return {'id':str(n),'job':'fixture','configurationHash':'a'*64,'startedAt':start,'finishedAt':end,'status':'success','held':False,'receiptHash':'b'*64,**kw}
    def rows(self):return [self.runrow(1,'2026-09-24T10:00:00Z','2026-09-24T10:01:00Z'),self.runrow(2,'2026-09-24T11:00:00Z','2026-09-24T11:01:00Z')]
    def test_normal_completed_cycle(self):self.assertEqual(qualify(self.spec(),self.rows(),'2026-09-24T11:02:00Z')['state'],'observed')
    def test_paused_cannot_pass(self):self.assertEqual(qualify(self.spec(enabled=False),self.rows(),'2026-09-24T11:02:00Z')['state'],'held')
    def test_skipped_not_success(self):
        rows=self.rows();rows[-1]['held']=True
        self.assertEqual(qualify(self.spec(),rows,'2026-09-24T11:02:00Z')['state'],'needs_review')
    def test_future_receipt_rejected(self):
        with self.assertRaises(ValueError):qualify(self.spec(),self.rows(),'2026-09-24T10:59:00Z')
    def test_changed_config_cannot_pass(self):
        rows=self.rows();rows[-1]['configurationHash']='c'*64
        self.assertEqual(qualify(self.spec(),rows,'2026-09-24T11:02:00Z')['state'],'needs_review')
    def test_duplicate_receipt_rejected(self):
        with self.assertRaises(ValueError):qualify(self.spec(),self.rows()*2,'2026-09-24T11:02:00Z')
    def test_month_is_calendar_boundary(self):
        rows=[self.runrow(1,'2028-01-31T10:00:00Z','2028-01-31T10:01:00Z'),self.runrow(2,'2028-02-29T10:00:00Z','2028-02-29T10:01:00Z')]
        r=qualify(self.spec(cycle='calendar_month',maxGapMinutes=32*24*60),rows,'2028-02-29T10:02:00Z')
        self.assertEqual(r['state'],'observed');self.assertEqual(r['cycleBoundary'],'2028-02-29T10:00:00+00:00')
    def test_missing_interval_and_overdue_visible(self):
        rows=self.rows();rows[-1].update(startedAt='2026-09-24T12:00:00Z',finishedAt='2026-09-24T12:01:00Z')
        self.assertEqual(len(qualify(self.spec(),rows,'2026-09-24T14:02:00Z')['issues']),2)

if __name__=='__main__':unittest.main()
