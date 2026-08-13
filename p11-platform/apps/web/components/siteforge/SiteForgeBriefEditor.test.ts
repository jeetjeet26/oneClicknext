import { describe, expect, it } from 'vitest'
import {
  buildBriefFromEditorFields,
  EMPTY_SITEFORGE_BRIEF,
} from './SiteForgeBriefEditor'

describe('SiteForgeBriefEditor structured field contract', () => {
  it('maps every durable brief workstream field without dropping structure', () => {
    const brief = buildBriefFromEditorFields({
      base: {
        ...EMPTY_SITEFORGE_BRIEF,
        title: 'Juniper House',
        summary: 'A focused brief',
        conversion: {
          primaryAction: 'Schedule a tour',
          secondaryActions: [],
          funnelNotes: 'Lead with proof',
        },
      },
      objectives: 'Increase tours | +15% completed requests | primary',
      audiences: 'Urban renters | availability, transit | unclear value',
      stakeholders: 'Avery | Marketing | avery@example.com | copy, brand',
      approvers: 'Morgan | Manager | morgan@example.com',
      legalConstraints: 'Fair housing | Use approved language | true',
      integrationConstraints: 'CRM | Route leads to HubSpot | true',
      references:
        'Brand book | https://example.com/brand.pdf | brand-1 | Approved',
      kpis: 'Tour requests | +15% | Submitted forms | Leasing',
    })
    expect(brief.objectives[0]).toEqual({
      statement: 'Increase tours',
      successSignal: '+15% completed requests',
      priority: 'primary',
    })
    expect(brief.audiences[0]?.needs).toEqual(['availability', 'transit'])
    expect(brief.stakeholders[0]?.decisionRights).toEqual(['copy', 'brand'])
    expect(brief.approvers[0]?.email).toBe('morgan@example.com')
    expect(brief.legalConstraints[0]?.blocking).toBe(true)
    expect(brief.integrationConstraints[0]?.name).toBe('CRM')
    expect(brief.references[0]?.sourceId).toBe('brand-1')
    expect(brief.kpis[0]?.measurement).toBe('Submitted forms')
  })
})
