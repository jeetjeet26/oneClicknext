import { z } from 'zod'

const text = z.string().trim().min(1).max(3000)
export const recommendationEvidence = z.object({
  id: z.string().max(160), label: z.string().max(200), reference: z.string().max(200),
  observedAt: z.iso.datetime(), data: z.json(),
}).strict()
export const aiRecommendation = z.object({
  title: z.string().trim().min(1).max(200),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.enum(['media', 'website', 'content', 'search', 'data', 'operations']),
  finding: text, rationale: text, action: text,
  steps: z.array(text).min(1).max(6),
  targetMetric: z.string().trim().min(1).max(200),
  measurement: text, expectedImpact: text, rollback: text,
  confidence: z.enum(['low', 'medium', 'high']),
  limitations: z.array(text).min(1).max(6),
  evidenceIds: z.array(z.string().max(160)).min(1).max(12),
}).strict()
export const aiRecommendationOutput = z.object({
  summary: text, recommendations: z.array(aiRecommendation).max(8),
}).strict()
export const aiRecommendationGeneration = z.object({
  version: z.literal(1), model: z.string().min(1).max(100), generatedAt: z.iso.datetime(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: text, recommendations: z.array(aiRecommendation).max(8),
  sources: z.array(recommendationEvidence).max(200), withheldCount: z.number().int().min(0),
}).strict()
export type RecommendationEvidence = z.infer<typeof recommendationEvidence>
export type AIRecommendation = z.infer<typeof aiRecommendation>
export type AIRecommendationGeneration = z.infer<typeof aiRecommendationGeneration>
