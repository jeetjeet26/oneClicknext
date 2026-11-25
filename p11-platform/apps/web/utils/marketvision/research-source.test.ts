import { describe, expect, it } from 'vitest'
import { parseResearchHtml, scopedResearchLinks } from './research-source'
describe('usable competitor evidence', () => {
  it('rejects the actual legacy Cloudflare failure instead of extracting Security as an amenity', () => {
    expect(()=>parseResearchHtml('<title>example.com | 521: Web server is down</title><body>Performance & security by Cloudflare</body>','https://example.com')).toThrow()
  })
  it('removes menus and country lists while retaining structured data, visual references and disclaimers', () => {
    const parsed = parseResearchHtml('<title>Homes</title><body><nav>Other community $500,000</nav><main><h1>Community</h1><p>Plan 1 from $1,350,000</p><form><select><option>Zimbabwe</option></select></form><img src="/plan.png" alt="Plan 1"><a href="/c/plan-1">Plan</a></main><footer class="disclaimer">Plus cost of solar</footer><script type="application/ld+json">{"@type":"Product"}</script></body>','https://example.com/c/')
    expect(parsed.text).toContain('$1,350,000'); expect(parsed.text).not.toMatch(/Zimbabwe|Other community/)
    expect(parsed.terms).toContain('Plus cost of solar'); expect(parsed.structuredData).toEqual([{'@type':'Product'}]); expect(parsed.images[0].url).toBe('https://example.com/plan.png')
  })
  it('keeps discovered sibling communities out of a scoped crawl', () => {
    expect(scopedResearchLinks('https://builder.com/new-homes/cayman',[{url:'https://builder.com/new-homes/cayman/plan-1',label:'Plan'},{url:'https://builder.com/new-homes/other/plan-1',label:'Plan'}])).toHaveLength(1)
  })
})
