import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AIRecommendations } from './AIRecommendations'
import type { Document } from '@/utils/intelligence/contracts'
const render = (documents: Document[] = [], canManage = true) => renderToStaticMarkup(React.createElement(AIRecommendations, { propertyId: 'cayman', propertyName: 'Cayman', documents, canManage, onChanged: async () => {} }))
it('replaces the manual recommendation form with community-scoped AI generation', () => {
  const html = render()
  expect(html).toContain('Recommendations for Cayman'); expect(html).toContain('Generate AI recommendations')
  expect(html).not.toContain('Add a recommendation'); expect(html).toContain('Last 180 days')
})
it('keeps generation controls out of a read-only view', () => {
  const html = render([], false)
  expect(html).not.toContain('Generate AI recommendations'); expect(html).not.toContain('type="date"')
})
it('does not label a legacy team-authored recommendation as AI output', () => {
  const html = render([{ id: 'legacy', kind: 'recommendation', status: 'draft', payload: { title: 'Team-authored advice', rationale: 'Team opinion' } } as Document])
  expect(html).not.toContain('Team-authored advice'); expect(html).not.toContain('Team opinion')
})
