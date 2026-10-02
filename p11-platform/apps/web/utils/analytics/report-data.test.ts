import{describe,it,expect}from'vitest'
import{buildBiReport,biExportData,reportChange,metricCurrency,metricPercent,trendForCampaign,type BiSource,type BiFact}from'./report-data'
import{csvCell,generateCSV,generatePDF}from'@/utils/export'
import{goalReportValue}from'./goal-comparison'
const fact=(overrides:Partial<BiFact>={}):BiFact=>({id:crypto.randomUUID(),date:'2026-08-03',channel_id:'google_ads',source_account_id:'1111111111',currency_code:'USD',campaign_id:'same',campaign_name:'Campaign',impressions:100,clicks:10,spend:10.01,conversions:0.125,...overrides})
const source=(rows:BiFact[],prior:BiFact[]=[]):BiSource=>({version:'bi-v1',propertyId:'33333333-3333-3333-3333-333333333333',propertyName:'Test property',filters:{startDate:'2026-08-03',endDate:'2026-08-04',compare:true,channel:null,account:null},currentRows:rows,previousRows:prior,previousPeriod:{start:'2026-08-01',end:'2026-08-02'}})
describe('trustworthy marketing reports',()=>{
 it('preserves fractional conversions and sums money in cents',()=>{const r=buildBiReport(source([fact({spend:0.1}),fact({spend:0.2,conversions:0.25})]));expect(r.totals).toMatchObject({spend:0.3,conversions:0.375,ctr:10});expect(r.totals.cpa).toBeCloseTo(0.8);expect(r.coverage).toMatchObject({records:2,observedDays:1,requestedDays:2})})
 it('weights CTR by impressions rather than averaging row percentages',()=>{expect(buildBiReport(source([fact({impressions:10,clicks:5}),fact({impressions:990,clicks:5})])).totals.ctr).toBe(1)})
 it('does not invent zero-denominator rates or zero-baseline percentage change',()=>{const r=buildBiReport(source([fact({impressions:0,clicks:0,conversions:0})],[fact({spend:0,clicks:0,impressions:0,conversions:0})]));expect(r.totals).toMatchObject({ctr:null,cpc:null,cpa:null});expect(r.comparison?.changes.spend).toBeNull();expect(metricCurrency(null)).toBe('Not available');expect(metricPercent(null)).toBe('Not available')})
 it('does retain a real zero cost when there are attributed conversions',()=>expect(buildBiReport(source([fact({spend:0})])).totals.cpa).toBe(0))
 it('does not compare against an absent prior period',()=>expect(Object.values(buildBiReport(source([fact()])).comparison!.changes).every(v=>v===null)).toBe(true))
 it('does not label missing dates as zero',()=>expect(buildBiReport(source([fact()])).timeSeries).toHaveLength(1))
 it('withholds dollars and dollar ratios for unconfirmed currency',()=>{const r=buildBiReport(source([fact(),fact({currency_code:null,source_account_id:null})]));expect(r.totals).toMatchObject({spend:null,cpc:null,cpa:null,clicks:20});expect(r.coverage.unknownAccountRecords).toBe(1);expect(r.coverage.currencyKnown).toBe(false)})
 it('allows explicitly non-spend GA4 records without a currency',()=>expect(buildBiReport(source([fact({channel_id:'ga4',spend:0,currency_code:null})])).totals.spend).toBe(0))
 it('keeps same campaign IDs separate by account and canonical channel',()=>{const s=source([fact(),fact({channel_id:'google',spend:1}),fact({source_account_id:'2222222222'}),fact({channel_id:'meta_ads'})]);const r=buildBiReport(s);expect(r.campaigns).toHaveLength(3);expect(r.channels).toHaveLength(2);const first=r.campaigns.find(c=>c.source_account_id==='1111111111'&&c.channel==='google_ads')!;expect(first.spend).toBe(11.01);expect(trendForCampaign(s,first.campaign_key)[0].spend).toBe(11.01)})
 it.each([null,NaN,Infinity,-1,Number.MAX_SAFE_INTEGER])('rejects invalid legacy metrics %s',n=>expect(()=>buildBiReport(source([fact({clicks:n as number})]))).toThrow())
 it('rejects aggregate integer overflow',()=>expect(()=>buildBiReport(source([fact({impressions:Number.MAX_SAFE_INTEGER-1}),fact()]))).toThrow())
 it('calculates actual nonzero comparison percentages',()=>expect(reportChange(15,10)).toBe(50))
 it('preserves all campaigns and definitions in CSV and PDF',()=>{const r=buildBiReport(source(Array.from({length:32},(_,i)=>fact({campaign_id:'campaign-'+i,campaign_name:i===31?'Last campaign':`Campaign ${i}`}))));const data=biExportData(r,{id:'saved-id',label:'Retained test',sourceHash:'a'.repeat(64),savedAt:'2026-09-20T12:00:00Z'});const csv=generateCSV(data);expect(csv).toContain('Last campaign');expect(csv).toContain('saved-id');expect(csv).toContain('provider-attributed');const pdf=generatePDF(data);expect(pdf.getNumberOfPages()).toBeGreaterThan(1);expect(pdf.output()).toContain('Last campaign');expect(pdf.output()).toContain('saved-id')})
 it.each(['=WEBSERVICE("secret")',' +cmd','-2+3','@formula','\tformula','\rformula'])('neutralizes spreadsheet executable cells %s',value=>expect(csvCell(value)).toContain("'"))
 it('quotes commas, quotes and newlines in CSV',()=>expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'))
})
describe('goal period alignment',()=>{
 it.each([['monthly','2026-08-01','2026-08-31'],['quarterly','2026-07-01','2026-09-30'],['yearly','2026-01-01','2026-12-31']])('compares a complete %s period', (period,start,end)=>expect(goalReportValue(12,period,{start,end},false,true)).toBe(12))
 it.each([{start:'2026-08-02',end:'2026-08-31'},{start:'2026-08-01',end:'2026-08-30'},{start:'2026-07-01',end:'2026-08-31'}])('holds mismatched date range %j',range=>expect(goalReportValue(12,'monthly',range,false,true)).toBeNull())
 it('withholds filtered, incomplete and undefined comparisons',()=>{const range={start:'2026-08-01',end:'2026-08-31'};expect(goalReportValue(12,'monthly',range,true,true)).toBeNull();expect(goalReportValue(12,'monthly',range,false,false)).toBeNull();expect(goalReportValue(null,'monthly',range,false,true)).toBeNull()})
})
