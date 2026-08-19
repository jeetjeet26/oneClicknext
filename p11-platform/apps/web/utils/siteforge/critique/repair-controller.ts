import type {
  SemanticBlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { semanticBlueprintPatchOperationSchema } from '@/types/siteforge'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { validateSiteForgeEditorOperations } from '@/utils/siteforge/editor/agent'
import type {
  AestheticCritiqueFinding,
  RenderedAestheticCritiqueReport,
} from './contracts'

export const SITEFORGE_REPAIR_CONTROLLER_POLICY_VERSION =
  'siteforge-bounded-repair-v1' as const

export interface BrowserRepairFinding {
  id: string
  category: string
  severity: 'blocker' | 'major' | 'moderate' | 'minor'
  passed?: boolean
  message: string
  locations?: string[]
  confidence?: number
  blockedDomains?: string[]
}

export interface DeterministicRepairFinding {
  id: string
  category: string
  triggered?: boolean
  passed?: boolean
  severity?: 'blocker' | 'major' | 'moderate' | 'minor'
  summary?: string
  message?: string
  evidence?: Record<string, unknown>
  locations?: string[]
  blockedDomains?: string[]
}

export interface NormalizedRepairFinding {
  id: string
  signature: string
  source: 'deterministic' | 'browser' | 'model'
  category: string
  severity: 'blocker' | 'major' | 'moderate' | 'minor'
  passed: boolean
  message: string
  locations: string[]
  confidence: number
  blockedDomains: string[]
}

export interface RepairProposal {
  findingIds: string[]
  summary: string
  operations: SemanticBlueprintPatchOperation[]
}

export interface RepairEvaluation {
  deterministic?: DeterministicRepairFinding[]
  browser?: BrowserRepairFinding[]
  model?: AestheticCritiqueFinding[]
  proposals: RepairProposal[]
  costUsd: number
}

export interface RepairQualityScore {
  overall: number
  brandFidelity: number
  brandDistinctiveness: number
  generalQuality: number
}

export interface RepairControllerLimits {
  maxCycles: number
  maxOperations: number
  maxCostUsd: number
  minimumImprovement: number
}

export type RepairStopReason =
  | 'quality_satisfied'
  | 'no_eligible_operations'
  | 'cycle_limit'
  | 'operation_limit'
  | 'cost_limit'
  | 'repeated_findings'
  | 'non_improvement'
  | 'blocker_regression'
  | 'validation_failed'

export interface RepairOperationDecision {
  operationHash: string
  findingIds: string[]
  operation: SemanticBlueprintPatchOperation
  decision: 'eligible' | 'blocked' | 'applied' | 'reverted'
  reasons: string[]
}

export interface RepairCycleAudit {
  cycle: number
  inputContentHash: string
  outputContentHash: string
  findingSignatures: string[]
  scoreBefore: RepairQualityScore
  scoreAfter: RepairQualityScore | null
  evaluationCostUsd: number
  cumulativeCostUsd: number
  decisions: RepairOperationDecision[]
  blockerRegressions: string[]
  repeatedFindingSignatures: string[]
  improved: boolean | null
}

export interface BoundedRepairResult {
  policyVersion: typeof SITEFORGE_REPAIR_CONTROLLER_POLICY_VERSION
  runId: string
  startedAt: string
  completedAt: string
  stopReason: RepairStopReason
  initialContentHash: string
  finalContentHash: string
  initialScore: RepairQualityScore
  finalScore: RepairQualityScore
  totalCostUsd: number
  appliedOperations: SemanticBlueprintPatchOperation[]
  finalBlueprint: SiteBlueprint
  unresolvedFindings: NormalizedRepairFinding[]
  cycles: RepairCycleAudit[]
}

const DEFAULT_LIMITS: RepairControllerLimits = {
  maxCycles: 3,
  maxOperations: 6,
  maxCostUsd: 2,
  minimumImprovement: 0.5,
}

const BLOCKED_DOMAIN_PATTERN =
  /\b(?:facts?|factual|pricing|rents?|availability|inventory|units?|legal|laws?|consent|fair housing|rights?|licenses?|credentials?|secrets?|tokens?|passwords?|runtime|extensions?|javascript|php|css|production|deploy|launch|domains?|dns|wordpress|cloudways|identity|logos?|fonts?|typography|brand tokens?)\b/i

const SEVERITY_DEDUCTION = {
  blocker: 50,
  major: 24,
  moderate: 12,
  minor: 5,
} as const

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100
}

function normalizeLocations(locations: readonly string[]): string[] {
  return [...new Set(locations.map(value => value.trim()).filter(Boolean))].sort()
}

function findingSignature(input: {
  category: string
  message: string
  locations: readonly string[]
}): string {
  return hashSiteForgeContent({
    category: input.category.toLowerCase().trim(),
    message: input.message.toLowerCase().replace(/\s+/g, ' ').trim(),
    locations: normalizeLocations(input.locations),
  })
}

export function normalizeRepairFindings(input: {
  deterministic?: DeterministicRepairFinding[]
  browser?: BrowserRepairFinding[]
  model?: AestheticCritiqueFinding[]
}): NormalizedRepairFinding[] {
  const deterministic = (input.deterministic || []).map(check => {
    const locations = Object.values(check.evidence || {}).flatMap(value =>
      typeof value === 'string' ? [value] : []
    )
    const passed = check.passed ?? !check.triggered
    return {
      id: check.id,
      source: 'deterministic' as const,
      category: check.category,
      severity: check.severity ?? ('moderate' as const),
      passed,
      message: check.message || check.summary || check.id,
      locations: normalizeLocations([...(check.locations || []), ...locations]),
      confidence: 1,
      blockedDomains: [...new Set(check.blockedDomains || [])].sort(),
    }
  })
  const browser = (input.browser || []).map(finding => ({
    id: finding.id,
    source: 'browser' as const,
    category: finding.category,
    severity: finding.severity,
    passed: finding.passed ?? false,
    message: finding.message,
    locations: normalizeLocations(finding.locations || []),
    confidence: finding.confidence ?? 1,
    blockedDomains: [...new Set(finding.blockedDomains || [])].sort(),
  }))
  const model = (input.model || []).map(finding => ({
    id: finding.id,
    source:
      finding.source === 'deterministic'
        ? ('deterministic' as const)
        : ('model' as const),
    category: finding.category,
    severity: finding.severity,
    passed: false,
    message: finding.critique,
    locations: normalizeLocations(finding.affectedSectionIds),
    confidence: finding.confidence,
    blockedDomains: [],
  }))
  return [...deterministic, ...browser, ...model]
    .map(finding => ({
      ...finding,
      signature: findingSignature(finding),
    }))
    .sort(
      (left, right) =>
        left.signature.localeCompare(right.signature) ||
        left.source.localeCompare(right.source)
    )
}

export function critiqueReportRepairEvaluation(
  report: RenderedAestheticCritiqueReport,
  options: {
    browser?: BrowserRepairFinding[]
    costUsd?: number
  } = {}
): RepairEvaluation {
  const proposalFindingIds = new Set(
    report.proposals.flatMap(proposal => proposal.findingIds)
  )
  return {
    deterministic: report.deterministicChecks,
    browser: options.browser,
    model: report.findings.filter(finding => proposalFindingIds.has(finding.id)),
    proposals: report.proposals.map(proposal => ({
      findingIds: proposal.findingIds,
      summary: proposal.summary,
      operations: proposal.operations,
    })),
    costUsd: options.costUsd ?? 0,
  }
}

export function scoreRepairQuality(
  findings: readonly NormalizedRepairFinding[]
): RepairQualityScore {
  const failed = findings.filter(finding => !finding.passed)
  const deductions = (predicate: (finding: NormalizedRepairFinding) => boolean) =>
    failed
      .filter(predicate)
      .reduce(
        (total, finding) =>
          total + SEVERITY_DEDUCTION[finding.severity] * finding.confidence,
        0
      )
  const brandFidelity = clampScore(
    100 -
      deductions(
        finding =>
          finding.category === 'fidelity' ||
          finding.category === 'brand_fidelity'
      )
  )
  const brandDistinctiveness = clampScore(
    100 - deductions(finding => finding.category === 'brand_distinctiveness')
  )
  const generalQuality = clampScore(
    100 -
      deductions(
        finding =>
          ![
            'fidelity',
            'brand_fidelity',
            'brand_distinctiveness',
          ].includes(finding.category)
      )
  )
  return {
    brandFidelity,
    brandDistinctiveness,
    generalQuality,
    overall: clampScore(
      brandFidelity * 0.3 +
        brandDistinctiveness * 0.25 +
        generalQuality * 0.45
    ),
  }
}

function blockedOperationReasons(
  operation: SemanticBlueprintPatchOperation,
  findings: readonly NormalizedRepairFinding[]
): string[] {
  const reasons: string[] = []
  const parsed = semanticBlueprintPatchOperationSchema.safeParse(operation)
  if (!parsed.success) reasons.push('unsupported_editor_operation')
  if (findings.some(finding => finding.blockedDomains.length > 0)) {
    reasons.push('finding_declares_blocked_domain')
  }
  if (
    findings.some(
      finding =>
        BLOCKED_DOMAIN_PATTERN.test(finding.category) ||
        BLOCKED_DOMAIN_PATTERN.test(finding.message)
    )
  ) {
    reasons.push('finding_touches_protected_domain')
  }
  if (BLOCKED_DOMAIN_PATTERN.test(JSON.stringify(operation))) {
    reasons.push('operation_touches_protected_domain')
  }
  if (operation.op === 'section.update') {
    const keys = Object.keys(operation.value)
    if (
      keys.length === 0 ||
      keys.some(key => !['variant', 'cssClasses'].includes(key))
    ) {
      reasons.push('section_update_is_not_low_risk_presentation_only')
    }
  } else if (operation.op !== 'section.move') {
    reasons.push('operation_is_not_low_risk_semantic_repair')
  }
  return [...new Set(reasons)]
}

function blockerRegressionIds(
  before: readonly NormalizedRepairFinding[],
  after: readonly NormalizedRepairFinding[]
): string[] {
  const afterById = new Map(after.map(finding => [finding.id, finding]))
  return before
    .filter(finding => finding.severity === 'blocker' && finding.passed)
    .flatMap(finding => {
      const next = afterById.get(finding.id)
      return next?.passed === true ? [] : [finding.id]
    })
}

function failedSignatures(
  findings: readonly NormalizedRepairFinding[]
): Set<string> {
  return new Set(
    findings.filter(finding => !finding.passed).map(finding => finding.signature)
  )
}

export async function runBoundedAutonomousRepair(input: {
  blueprint: SiteBlueprint
  evaluate: (
    blueprint: SiteBlueprint,
    context: {
      cycle: number
      priorFindingSignatures: string[]
      remainingCostUsd: number
    }
  ) => Promise<RepairEvaluation>
  limits?: Partial<RepairControllerLimits>
  now?: () => string
  validateOperations?: (input: {
    blueprint: SiteBlueprint
    operations: SemanticBlueprintPatchOperation[]
  }) => void
}): Promise<BoundedRepairResult> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  if (
    !Number.isInteger(limits.maxCycles) ||
    limits.maxCycles < 1 ||
    !Number.isInteger(limits.maxOperations) ||
    limits.maxOperations < 1 ||
    limits.maxCostUsd < 0 ||
    limits.minimumImprovement < 0
  ) {
    throw new Error('Repair controller limits are invalid')
  }
  const now = input.now ?? (() => new Date().toISOString())
  const startedAt = now()
  const initialContentHash = hashSiteForgeContent(input.blueprint)
  const runId = `repair-run-${hashSiteForgeContent({
    initialContentHash,
    startedAt,
    limits,
  }).slice(0, 20)}`
  const validateOperations =
    input.validateOperations ??
    ((candidate: {
      blueprint: SiteBlueprint
      operations: SemanticBlueprintPatchOperation[]
    }) =>
      validateSiteForgeEditorOperations({
        blueprint: candidate.blueprint,
        operations: candidate.operations,
      }))

  let currentBlueprint = structuredClone(input.blueprint)
  let evaluation = await input.evaluate(currentBlueprint, {
    cycle: 0,
    priorFindingSignatures: [],
    remainingCostUsd: limits.maxCostUsd,
  })
  let totalCostUsd = evaluation.costUsd
  let findings = normalizeRepairFindings(evaluation)
  const initialScore = scoreRepairQuality(findings)
  let currentScore = initialScore
  const appliedOperations: SemanticBlueprintPatchOperation[] = []
  const cycles: RepairCycleAudit[] = []
  let stopReason: RepairStopReason = 'cycle_limit'

  if (totalCostUsd > limits.maxCostUsd) {
    stopReason = 'cost_limit'
  } else {
    for (let cycle = 1; cycle <= limits.maxCycles; cycle += 1) {
      const inputContentHash = hashSiteForgeContent(currentBlueprint)
      const failedBefore = failedSignatures(findings)
      if (failedBefore.size === 0) {
        stopReason = 'quality_satisfied'
        break
      }
      const decisions: RepairOperationDecision[] = []
      const eligible: SemanticBlueprintPatchOperation[] = []
      for (const proposal of evaluation.proposals) {
        const linkedFindings = findings.filter(finding =>
          proposal.findingIds.includes(finding.id)
        )
        for (const operation of proposal.operations) {
          const reasons = [
            ...(linkedFindings.length === 0
              ? ['proposal_has_no_bound_finding']
              : linkedFindings.every(finding => finding.passed)
                ? ['proposal_has_no_active_finding']
                : []),
            ...blockedOperationReasons(operation, linkedFindings),
          ]
          const operationHash = hashSiteForgeContent(operation)
          decisions.push({
            operationHash,
            findingIds: proposal.findingIds,
            operation,
            decision: reasons.length ? 'blocked' : 'eligible',
            reasons,
          })
          if (!reasons.length) eligible.push(operation)
        }
      }
      const remainingOperations = limits.maxOperations - appliedOperations.length
      const bounded = eligible.slice(0, Math.max(0, remainingOperations))
      const selectedCounts = new Map<string, number>()
      for (const operation of bounded) {
        const hash = hashSiteForgeContent(operation)
        selectedCounts.set(hash, (selectedCounts.get(hash) || 0) + 1)
      }
      for (const decision of decisions) {
        if (decision.decision !== 'eligible') continue
        const count = selectedCounts.get(decision.operationHash) || 0
        if (count > 0) {
          selectedCounts.set(decision.operationHash, count - 1)
        } else {
          decision.decision = 'blocked'
          decision.reasons.push('operation_limit_exceeded')
        }
      }
      if (!bounded.length) {
        stopReason =
          remainingOperations <= 0 ? 'operation_limit' : 'no_eligible_operations'
        cycles.push({
          cycle,
          inputContentHash,
          outputContentHash: inputContentHash,
          findingSignatures: [...failedBefore].sort(),
          scoreBefore: currentScore,
          scoreAfter: null,
          evaluationCostUsd: 0,
          cumulativeCostUsd: totalCostUsd,
          decisions,
          blockerRegressions: [],
          repeatedFindingSignatures: [],
          improved: null,
        })
        break
      }
      try {
        validateOperations({ blueprint: currentBlueprint, operations: bounded })
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'editor validation failed'
        decisions
          .filter(decision =>
            bounded.some(
              operation =>
                hashSiteForgeContent(operation) === decision.operationHash
            )
          )
          .forEach(decision => {
            decision.decision = 'blocked'
            decision.reasons.push(`editor_validation_failed:${reason}`)
          })
        stopReason = 'validation_failed'
        cycles.push({
          cycle,
          inputContentHash,
          outputContentHash: inputContentHash,
          findingSignatures: [...failedBefore].sort(),
          scoreBefore: currentScore,
          scoreAfter: null,
          evaluationCostUsd: 0,
          cumulativeCostUsd: totalCostUsd,
          decisions,
          blockerRegressions: [],
          repeatedFindingSignatures: [],
          improved: null,
        })
        break
      }
      const candidate = applyBlueprintPatch(currentBlueprint, bounded)
      const candidateEvaluation = await input.evaluate(candidate, {
        cycle,
        priorFindingSignatures: [...failedBefore].sort(),
        remainingCostUsd: Math.max(0, limits.maxCostUsd - totalCostUsd),
      })
      const candidateCost = candidateEvaluation.costUsd
      totalCostUsd += candidateCost
      const candidateFindings = normalizeRepairFindings(candidateEvaluation)
      const candidateScore = scoreRepairQuality(candidateFindings)
      const regressions = blockerRegressionIds(findings, candidateFindings)
      const failedAfter = failedSignatures(candidateFindings)
      const repeated = [...failedAfter].filter(signature =>
        failedBefore.has(signature)
      )
      const improved =
        candidateScore.overall - currentScore.overall >=
        limits.minimumImprovement
      const wouldExceedCost = totalCostUsd > limits.maxCostUsd
      const accepted =
        !wouldExceedCost && regressions.length === 0 && improved
      decisions
        .filter(decision =>
          bounded.some(
            operation =>
              hashSiteForgeContent(operation) === decision.operationHash
          )
        )
        .forEach(decision => {
          decision.decision = accepted ? 'applied' : 'reverted'
          if (wouldExceedCost) decision.reasons.push('cost_limit_exceeded')
          if (regressions.length)
            decision.reasons.push('previous_blocker_pass_regressed')
          if (!improved) decision.reasons.push('quality_did_not_improve')
        })
      cycles.push({
        cycle,
        inputContentHash,
        outputContentHash: accepted
          ? hashSiteForgeContent(candidate)
          : inputContentHash,
        findingSignatures: [...failedBefore].sort(),
        scoreBefore: currentScore,
        scoreAfter: candidateScore,
        evaluationCostUsd: candidateCost,
        cumulativeCostUsd: totalCostUsd,
        decisions,
        blockerRegressions: regressions,
        repeatedFindingSignatures: repeated.sort(),
        improved,
      })
      if (!accepted) {
        stopReason = wouldExceedCost
          ? 'cost_limit'
          : regressions.length
            ? 'blocker_regression'
            : repeated.length
              ? 'repeated_findings'
              : 'non_improvement'
        break
      }
      currentBlueprint = candidate
      evaluation = candidateEvaluation
      findings = candidateFindings
      currentScore = candidateScore
      appliedOperations.push(...bounded)
      if (failedAfter.size === 0) {
        stopReason = 'quality_satisfied'
        break
      }
      if (repeated.length > 0) {
        stopReason = 'repeated_findings'
        break
      }
      if (appliedOperations.length >= limits.maxOperations) {
        stopReason = 'operation_limit'
        break
      }
      if (cycle === limits.maxCycles) stopReason = 'cycle_limit'
    }
  }

  return {
    policyVersion: SITEFORGE_REPAIR_CONTROLLER_POLICY_VERSION,
    runId,
    startedAt,
    completedAt: now(),
    stopReason,
    initialContentHash,
    finalContentHash: hashSiteForgeContent(currentBlueprint),
    initialScore,
    finalScore: currentScore,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    appliedOperations,
    finalBlueprint: currentBlueprint,
    unresolvedFindings: findings.filter(finding => !finding.passed),
    cycles,
  }
}
