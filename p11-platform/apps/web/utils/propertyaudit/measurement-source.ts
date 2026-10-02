import { createHash } from 'node:crypto'
import type { ReportAnswer, ReportQuery } from './reporting'

export type MeasurementRun = {
  run: { id: string; property_id: string; surface: string; model_name: string | null; status: string; batch_id: string | null; started_at: string; finished_at: string | null; archived_at: string | null; measurement_mode: string | null; cross_model_analysis: unknown; run_metadata?: { evaluator_version?: string } }
  job: { snapshot: { config?: unknown; property?: unknown } } | null
  answers: { answer: ReportAnswer; citations: NonNullable<ReportAnswer['geo_citations']> }[]
  scores: { overall_score: number | null; visibility_pct: number | null; avg_llm_rank: number | null; avg_link_rank: number | null; avg_sov: number | null; breakdown?: unknown }[]
  items: { id: string; ordinal: number; query: ReportQuery; state: string; answerId: string | null }[]
}
export type MeasurementRead = { state: string; scope: string; hash: string; batchId: string | null; runs: MeasurementRun[] }

// Version identity includes every scoring-relevant question field. A mutable query ID
// alone must never combine answers to differently worded questions.
export function capturedAnswers(sources: MeasurementRun[]) {
  const queries = new Map<string, ReportQuery>()
  const answers: ReportAnswer[] = []
  for (const source of sources) {
    const itemByAnswer = new Map(source.items.filter(i => i.answerId).map(i => [i.answerId, i]))
    for (const entry of source.answers) {
      const query = itemByAnswer.get(entry.answer.id)?.query
      const key = query ? createHash('sha256').update(JSON.stringify([entry.answer.query_id, query.text, query.type, query.geo ?? null, query.weight ?? 1])).digest('hex') : `unknown:${source.run.id}:${entry.answer.query_id || entry.answer.id}`
      const original = query ? { ...query, id: key } : { id: key, text: 'Original question context not retained', type: 'unknown' }
      queries.set(key, original)
      answers.push({ ...entry.answer, run_id: source.run.id, query_id: key, geo_queries: original, geo_citations: entry.citations })
    }
  }
  return { answers, queries: [...queries.values()] }
}
export function comparableMeasurements(left: MeasurementRun[], right: MeasurementRun[]): boolean {
  if (!left.length || left.length !== right.length) return false
  const signature = (source: MeasurementRun) => {
    if (!source.job || !source.items.length || source.answers.length !== source.items.length || source.items.some(i => i.state !== 'completed' || !i.answerId)) return null
    const questions = source.items.map(i => [i.query.text, i.query.type, i.query.geo ?? null, i.query.weight ?? 1]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return JSON.stringify([source.run.surface, source.run.model_name, source.run.measurement_mode, source.run.run_metadata?.evaluator_version ?? null, source.job.snapshot.config, source.job.snapshot.property, questions])
  }
  return left.every(source => {
    const previous = right.find(item => item.run.surface === source.run.surface)
    const a = signature(source)
    return a !== null && previous !== undefined && a === signature(previous)
  })
}
export function measurementBatchStatus(runs: { status: string | null }[]) {
  if (!runs.length) return 'pending'
  if (runs.some(r => ['running', 'queued'].includes(r.status || ''))) return 'running'
  if (runs.every(r => r.status === 'completed')) return 'completed'
  if (runs.every(r => r.status === 'failed')) return 'failed'
  return 'partial'
}
