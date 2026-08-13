import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  briefHasUnresolvedContradictions,
  EMPTY_SITEFORGE_BRIEF,
  hydrateBriefEditorContent,
  removeBriefItem,
  SiteForgeBriefEditor,
  updateBriefItem,
} from './SiteForgeBriefEditor'
import type { SiteForgeBrief } from '@/utils/siteforge/briefs/contracts'
import type { PersistedSiteForgeBrief } from '@/utils/siteforge/briefs/repository'

describe('SiteForgeBriefEditor structured field contract', () => {
  const brief: SiteForgeBrief = {
    ...EMPTY_SITEFORGE_BRIEF,
    title: 'Juniper House',
    summary: 'A focused brief',
    objectives: [
      {
        statement: 'Increase tours | without parsing this character',
        successSignal: '+15% completed requests',
        priority: 'primary',
      },
    ],
    audiences: [
      {
        segment: 'Urban renters',
        needs: ['availability', 'transit'],
        objections: ['unclear value'],
      },
    ],
    conversion: {
      primaryAction: 'Schedule a tour',
      secondaryActions: ['View availability'],
      funnelNotes: 'Lead with proof',
    },
    scope: {
      includedPages: ['Home', 'Floor Plans'],
      excludedItems: ['Resident portal'],
    },
    stakeholders: [
      {
        name: 'Avery',
        role: 'Marketing',
        email: 'avery@example.com',
        decisionRights: ['copy', 'brand'],
      },
    ],
    approvers: [
      { name: 'Morgan', role: 'Manager', email: 'morgan@example.com' },
    ],
    legalConstraints: [
      {
        name: 'Fair housing',
        requirement: 'Use approved language',
        blocking: true,
      },
    ],
    integrationConstraints: [
      { name: 'CRM', requirement: 'Route leads to HubSpot', blocking: true },
    ],
    references: [
      {
        label: 'Brand book',
        url: 'https://example.com/brand.pdf',
        sourceId: 'brand-1',
        notes: 'Approved',
      },
    ],
    kpis: [
      {
        name: 'Tour requests',
        target: '+15%',
        measurement: 'Submitted forms',
        owner: 'Leasing',
      },
    ],
  }

  const persisted: PersistedSiteForgeBrief = {
    id: 'brief-version-1',
    websiteId: 'website-1',
    propertyId: 'property-1',
    orgId: 'org-1',
    version: 1,
    status: 'ready_for_review',
    brief,
    unresolvedContradictions: [
      {
        id: 'contradiction-1',
        field: 'rent',
        description: 'Sources disagree',
        sources: ['readiness', 'provider'],
        resolutionNeeded: 'Choose the verified rent',
      },
    ],
    sources: {
      onboardingSnapshotId: 'snapshot-1',
      onboardingSnapshotHash: 'a'.repeat(64),
      brandAssetId: 'brand-1',
      brandContractHash: 'b'.repeat(64),
    },
    contentHash: 'c'.repeat(64),
    approvalActionAttemptId: null,
    confirmedApprovalId: null,
    decisionReason: null,
    approvedAt: null,
    createdAt: '2026-08-13T00:00:00.000Z',
  }

  it('hydrates every structured field without parsing punctuation', () => {
    const hydrated = hydrateBriefEditorContent(persisted)

    expect(hydrated.brief).toEqual(brief)
    expect(hydrated.brief.objectives[0].statement).toContain('|')
    expect(hydrated.brief.audiences[0].needs).toEqual([
      'availability',
      'transit',
    ])
    expect(hydrated.brief.stakeholders[0].decisionRights).toEqual([
      'copy',
      'brand',
    ])
    expect(hydrated.brief.legalConstraints[0].blocking).toBe(true)
    expect(hydrated.brief.references[0].sourceId).toBe('brand-1')
    expect(hydrated.brief.kpis[0].measurement).toBe('Submitted forms')
    expect(hydrated.contradictions).toEqual(
      persisted.unresolvedContradictions
    )
  })

  it('updates and removes repeatable records without flattening them', () => {
    const updated = updateBriefItem(brief.objectives, 0, {
      priority: 'secondary',
    })
    const removed = removeBriefItem(
      [...brief.audiences, { segment: 'Families', needs: [], objections: [] }],
      0
    )

    expect(updated[0]).toMatchObject({
      statement: brief.objectives[0].statement,
      successSignal: '+15% completed requests',
      priority: 'secondary',
    })
    expect(removed).toEqual([
      { segment: 'Families', needs: [], objections: [] },
    ])
  })

  it('renders labeled controls instead of delimiter instructions', () => {
    const markup = renderToStaticMarkup(
      createElement(SiteForgeBriefEditor, { websiteId: 'website-1' })
    )

    expect(markup).toContain('Add objective')
    expect(markup).toContain('Audience segment')
    expect(markup).toContain('Add stakeholder')
    expect(markup).toContain('Add legal constraint')
    expect(markup).toContain('Add reference')
    expect(markup).toContain('Add KPI')
    expect(markup).toContain('Save as current brief')
    expect(markup).not.toContain('Required rationale')
    expect(markup).not.toContain('Approve exact brief')
    expect(markup).not.toContain('statement | success signal')
    expect(markup).not.toContain('comma-separated')
  })

  it('keeps approval blocked while contradictions remain', () => {
    expect(
      briefHasUnresolvedContradictions(persisted.unresolvedContradictions)
    ).toBe(true)
    expect(briefHasUnresolvedContradictions([])).toBe(false)
  })
})
