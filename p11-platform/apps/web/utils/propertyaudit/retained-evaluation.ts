import { AnswerBlockSchema, type AnswerFlag } from './types'
import { finalizeAnswerBlock } from './entity-fallback'
import { scoreAnswer, aggregateScores } from './evaluator'
import { reportRow, reportRows } from './retained-report'
export const AUDIT_EVALUATOR_VERSION = 'retained-evaluator-v1-3d48907a0ac60d3b1983c0b3e7024a0dbf35857926237af3e51a8e08ef32240b'
export function evaluateRetainedAudit(source: unknown) {
 const root=reportRow(source), run=reportRow(root.run), snapshot=reportRow(reportRow(root.job).snapshot), property=reportRow(snapshot.property), config=reportRow(snapshot.config), answers=reportRows(root.originalAnswers ?? root.answers), items=reportRows(root.items)
 if (run.status !== 'completed' || typeof property.name !== 'string' || !property.name.trim() || !answers.length || !items.length) throw new Error('This run has no complete captured evaluation context.')
 const strings=(value:unknown) => Array.isArray(value) && value.every(x=>typeof x==='string') ? value as string[] : []
 const context={brandName:property.name,brandDomains:strings(config.domains),competitors:strings(config.competitor_domains)}
 const results=answers.map(entry=>{
  const answer=reportRow(entry.answer), item=items.find(i=>i.answerId === answer.id)
  if (!item || item.state !== 'completed') throw new Error('An answer is missing its original captured question context.')
  const originalFlags=strings(answer.flags)
  const parsed=AnswerBlockSchema.safeParse({ordered_entities:reportRows(answer.ordered_entities).map(e=>({...e,rationale:typeof e.rationale==='string' && e.rationale ? e.rationale : 'Retained entity; explanation was not provided.'})),citations:reportRows(entry.citations).map(c=>({url:c.url,domain:c.domain,entity_ref:typeof c.entity_ref==='string'?c.entity_ref:''})),answer_summary:typeof answer.answer_summary==='string'?answer.answer_summary:'',notes:{flags:[]}})
  if (!parsed.success) throw new Error('A retained answer cannot be evaluated safely. No answer was skipped or changed.')
  const answerContext={...context,sourceText:[answer.natural_response,answer.answer_summary].filter(x=>typeof x==='string').join('\n')}
  const hydrated=finalizeAnswerBlock({...parsed.data,notes:{flags:originalFlags as AnswerFlag[]}}, answerContext)
  const scored=scoreAnswer({...hydrated,answer_summary:answerContext.sourceText},answerContext)
  return {id:String(answer.id),query:reportRow(item.query),scored,hydrated}
 })
 const aggregate=aggregateScores(results.map(r=>r.scored)), average=(field:'position'|'link'|'sov'|'accuracy')=>results.reduce((n,r)=>n+r.scored.breakdown[field],0)/results.length
 return {version:AUDIT_EVALUATOR_VERSION,coverage:{capturedExecutions:items.length,retainedAnswers:answers.length,evaluatedAnswers:results.length,unansweredExecutions:items.filter(i=>!i.answerId).length,synthetic:run.measurement_mode==='local_fixture'},answers:results.map(({id,query,scored,hydrated})=>({id,question:query,presence:scored.presence,llm_rank:scored.llmRank,link_rank:scored.linkRank,sov:scored.sov,flags:scored.flags,ordered_entities:hydrated.ordered_entities,score:scored.score,breakdown:scored.breakdown})),aggregate:{overall_score:aggregate.overallScore,visibility_pct:aggregate.visibilityPct,avg_llm_rank:aggregate.avgLlmRank,avg_link_rank:aggregate.avgLinkRank,avg_sov:aggregate.avgSov,breakdown:{position:average('position'),link:average('link'),sov:average('sov'),accuracy:average('accuracy')},query_scores:results.map(r=>({answer_id:r.id,score:r.scored.score,presence:r.scored.presence,breakdown:r.scored.breakdown}))}}
}
