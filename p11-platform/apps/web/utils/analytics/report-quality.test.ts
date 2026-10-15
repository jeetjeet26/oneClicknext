import { it, expect } from 'vitest';
import { reportingRows } from './report-quality';
import type { MarketingFact } from './read-marketing-facts';
it('retains real zeroes but never fabricates missing marketing measures',()=>{
 const base={id:'x',date:'2026-10-01',channel_id:'meta',source_account_id:null,currency_code:'USD',campaign_id:'c',campaign_name:null,raw_source:null,impressions:0,clicks:0,conversions:0,spend:0} as MarketingFact;
 expect(reportingRows([base,{...base,spend:null},{...base,clicks:NaN}])).toEqual([base]);
});
