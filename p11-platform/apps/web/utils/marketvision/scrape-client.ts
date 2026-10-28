import { sendMarketDecision } from './decision-client'

/** Read current source/version before submitting through the existing authorized workflow. */
export async function scrapeCompetitor(propertyId: string, competitorId: string): Promise<string> {
  const response = await fetch(`/api/marketvision/sources?${new URLSearchParams({propertyId, competitorId})}`, {cache: 'no-store'})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load the competitor source. Try again.')
  if (!data.competitor?.isActive) return 'Skipped: competitor is archived.'
  const source = data.competitor.website ? 'website' : data.competitor.apartments_com ? 'apartments_com' : null
  if (!source) return 'Skipped: add a website or Apartments.com URL under Manage → Edit.'
  if (data.execution?.paused !== false) return 'Scraping is paused. Enable external fetching before trying again.'
  const result = await sendMarketDecision('/api/marketvision/sources', 'POST', {
    propertyId, competitorId, expectedVersion: data.competitor.version, source, reason: 'On-demand competitor scrape',
  }, ['queued', 'running', 'received', 'held', 'stopped', 'busy'], true)
  if (result.execution?.paused) return 'Request saved; external fetching is now paused.'
  switch (result.result.state) {
    case 'received': return 'Page fetched. Open the full profile → Manage sources and pricing to review it.'
    case 'held': return 'Scrape needs attention. Open the full profile → Manage sources and pricing.'
    case 'stopped': return 'This request was stopped. Review its saved status in the full profile.'
    case 'busy': return 'A request is already open. Review its status in the full profile → Manage sources and pricing.'
    default: return 'Scrape requested. Open the full profile → Manage sources and pricing for progress and results.'
  }
}
