import { describe, expect, it } from 'vitest';
import { batchSchema, observationSchema } from './contracts';
import { periodMeasures, leaseAttribution } from './reporting';
import type { RetainedObservation } from './analysis';
import { parseObservationCsv } from './import';
const row = (input: Record<string, unknown> = {}): RetainedObservation => ({
  ...observationSchema.parse({ key: 'one', date: '2026-10-01', metric: 'sessions', value: 10, ...input }),
  source: 'CRM export', provider: 'reviewed_import', account: 'account-a', batchId: 'batch', capturedAt: '2026-10-02T00:00:00Z',
});
const range = ['2026-10-01', '2026-10-31'] as const;
describe('client reporting definitions', () => {
  it('does not combine total, mobile, channel or other account observations', () => {
    const result = periodMeasures([row(), row({device:'mobile'}), row({channel:'google'}), {...row(), account:'account-b'}], ...range)[0];
    expect(result.sources.map(s=>s.value)).toEqual([10,10]);
  });
  it('does not report missing sources as zero', () => {
    expect(periodMeasures([], ...range).every(m=>m.sources.length===0)).toBe(true);
  });
  it('uses latest snapshots and flags same-date conflicts', () => {
    const metric='effective_rent';
    const read=(rs: RetainedObservation[])=>periodMeasures(rs,...range).find(m=>m.metric===metric)!.sources[0].value;
    expect(read([row({metric,value:1500}),row({metric,date:'2026-10-02',value:1600})])).toBe(1600);
    expect(read([row({metric,value:1500}),row({metric,value:1600})])).toBeNull();
  });
  it('deduplicates outcomes and retains unknown/conflicting attribution', () => {
    const lease=(outcomeId:string,channel:string)=>row({metric:'signed_leases',value:1,outcomeId,channel,reference:'export/1',verification:'source_confirmed',attributionModel:'last_touch'});
    const result=leaseAttribution([lease('a','google'),lease('a','google'),lease('b','unknown'),lease('c','google'),lease('c','meta')],...range)[0];
    expect(result).toMatchObject({total:3,matched:1,unknown:1,conflicting:1,coverage:1/3});
  });
  it('does not infer attribution from ordinary signed-lease counts', () => {
    expect(leaseAttribution([row({metric:'signed_leases',value:20,channel:'google'})],...range)).toEqual([]);
  });
  it('rejects unsupported attribution claims at ingestion', () => {
    const base={provider:'reviewed_import',account:'crm',source:'CRM',start:range[0],end:range[1],observedAt:'2026-10-02T00:00:00Z',limitations:[]};
    expect(batchSchema.safeParse({...base, rows:[{key:'a',date:range[0],metric:'signed_leases',value:20,attributionModel:'last_touch'}]}).success).toBe(false);
    expect(batchSchema.safeParse({...base, rows:[{key:'a',date:range[0],metric:'occupancy_percent',value:101}]}).success).toBe(false);
  });
  it('accepts an attributed lease through the existing CSV workflow', () => {
    const batch=parseObservationCsv('key,date,metric,value,channel,reference,outcomeId,attributionModel,verification\na,2026-10-01,signed_leases,1,google,export/1,lease-1,last_touch,source_confirmed','Leasing export','crm');
    expect(batch.rows[0]).toMatchObject({outcomeId:'lease-1',attributionModel:'last_touch'});
  });
});
