import {describe,it,expect} from 'vitest'
import {buildResearchAnalysis} from './research'
const now=new Date('2026-09-16T12:00:00Z'),options={requestId:'saved',radiusMiles:3,mode:'saved' as const,provider:{discovery:'not_requested' as const,intelligence:'not_requested' as const}}
const row=(id:string,override:Record<string,unknown>={})=>({id,name:`Competitor ${id}`,brand_intel:{brand_voice:'luxury',pages_analyzed:2,confidence_score:0.8,last_analyzed_at:'2026-09-15T00:00:00Z',analysis_version:'v1',...override}})
describe('research evidence',()=>{
 it('does not fabricate market gaps from no competitors',()=>{const r=buildResearchAnalysis([],options,now);expect(r.marketGaps).toEqual([]);expect(r.evidence.sufficientForHypotheses).toBe(false);expect(r.warnings[0]).toContain('does not establish')})
 it('labels a small sample as insufficient',()=>{expect(buildResearchAnalysis([row('1'),row('2')],options,now).marketGaps).toEqual([])})
 it('keeps old, low confidence and undated evidence out of hypotheses',()=>{const r=buildResearchAnalysis([row('1'),row('2',{last_analyzed_at:'2025-01-01T00:00:00Z'}),row('3',{confidence_score:0.1}),row('4',{last_analyzed_at:null})],options,now);expect(r.evidence).toMatchObject({current:1,stale:1,unverified:2,sufficientForHypotheses:false});expect(r.marketGaps).toEqual([])})
 it('limits hypotheses to their stated sample and preserves source versions',()=>{const r=buildResearchAnalysis([row('1'),row('2'),row('3')],options,now);expect(r.marketGaps).toHaveLength(3);expect(r.marketGaps[0]).toContain('these 3 current competitor records');expect(r.competitors[0].analysisVersion).toBe('v1')})
 it('recognizes composite voice terms rather than inventing absent themes',()=>{const r=buildResearchAnalysis([row('1',{brand_voice:'Modern and innovative'}),row('2',{brand_voice:'Community-focused and affordable'}),row('3')],options,now);expect(r.marketGaps).toEqual([])})
 it('distinguishes queued brand analysis from current evidence',()=>{const r=buildResearchAnalysis([],{...options,provider:{discovery:'completed',intelligence:'queued',jobId:'job'}},now);expect(r.warnings.join(' ')).toContain('analysis is queued');expect(r.marketGaps).toEqual([])})
})
