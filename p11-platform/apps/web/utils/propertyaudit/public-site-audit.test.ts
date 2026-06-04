import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditPublicSite } from './public-site-audit'

describe('auditPublicSite', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns URL-only blockers when no URL is configured', async () => {
    const audit = await auditPublicSite(null)

    expect(audit.homepageReachable).toBe(false)
    expect(audit.notes).toContain('No public website URL is configured for this property.')
    expect(audit.pages).toEqual([])
  })

  it('extracts public crawl and structured-data signals', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }

      return new Response(`
        <html>
          <head>
            <title>Test Property</title>
            <meta name="description" content="Great apartments">
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"FAQPage"}
            </script>
          </head>
          <body>
            <h2>What amenities are available?</h2>
            <a href="/floorplans">Floorplans</a>
          </body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('https://example.com')

    expect(audit.homepageReachable).toBe(true)
    expect(audit.robotsTxtReachable).toBe(true)
    expect(audit.sitemapReachable).toBe(true)
    expect(audit.llmsTxtReachable).toBe(true)
    expect(audit.title).toBe('Test Property')
    expect(audit.structuredDataTypes).toContain('FAQPage')
    expect(audit.answerBlockSignals).toBeGreaterThan(0)
    expect(audit.pages?.some(page => page.pageType === 'floorplans')).toBe(true)
    expect(audit.crawlSummary?.pagesAudited).toBeGreaterThan(0)
  })

  it('extracts schema types from Yoast-style JSON-LD graphs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }

      return new Response(`
        <html>
          <head>
            <title>Epoca</title>
            <meta name="description" content="San Diego master planned community">
            <script type="application/ld+json" class="yoast-schema-graph">
              {
                "@context": "https://schema.org",
                "@graph": [
                  { "@type": "WebPage", "@id": "https://example.com/" },
                  { "@type": "ImageObject", "@id": "https://example.com/#primaryimage" },
                  { "@type": "BreadcrumbList" },
                  { "@type": "WebSite" },
                  {
                    "@type": "Organization",
                    "logo": { "@type": "ImageObject" }
                  }
                ]
              }
            </script>
          </head>
          <body><h1>Epoca</h1></body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('https://example.com')

    expect(audit.structuredDataTypes).toEqual([
      'BreadcrumbList',
      'ImageObject',
      'Organization',
      'WebPage',
      'WebSite',
    ])
    expect(audit.organizationStructuredData).toBe(true)
    expect(audit.notes).not.toContain('No JSON-LD structured data was detected on audited pages.')
  })

  it('discovers same-origin sitemap and internal-link pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }
      if (url.endsWith('/sitemap.xml')) {
        return new Response(`
          <urlset>
            <url><loc>https://example.com/amenities</loc></url>
            <url><loc>https://example.com/neighborhood</loc></url>
            <url><loc>https://other.example/ignored</loc></url>
          </urlset>
        `, { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      if (url.endsWith('/amenities')) {
        return new Response('<html><head><title>Amenities</title></head><body><h1>Amenities</h1><p>Pool, fitness center, parking, clubhouse, package lockers, and pet spa amenities.</p></body></html>', { status: 200 })
      }
      if (url.endsWith('/neighborhood')) {
        return new Response('<html><head><title>Neighborhood</title></head><body><h1>Neighborhood</h1><p>Near downtown, restaurants, transit, schools, and major employers.</p></body></html>', { status: 200 })
      }

      return new Response(`
        <html>
          <head><title>Home</title><meta name="description" content="Apartments"></head>
          <body>
            <a href="/faq">FAQ</a>
            <a href="https://external.example/floorplans">External</a>
            <h1>Home</h1>
            <p>Welcome to our apartment community.</p>
          </body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('example.com')
    const pages = audit.pages || []

    expect(audit.discoveredUrls).toContain('https://example.com/amenities')
    expect(audit.discoveredUrls).toContain('https://example.com/neighborhood')
    expect(audit.discoveredUrls).toContain('https://example.com/faq')
    expect(audit.discoveredUrls).not.toContain('https://external.example/floorplans')
    expect(pages.some(page => page.pageType === 'amenities')).toBe(true)
    expect(pages.some(page => page.pageType === 'neighborhood')).toBe(true)
    expect(audit.crawlSummary?.discoverySources).toContain('sitemap.xml')
    expect(audit.crawlSummary?.discoverySources).toContain('homepage_links')
  })

  it('keeps corporate community crawls scoped to the selected property path', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }
      if (url.endsWith('/sitemap.xml')) {
        return new Response(`
          <urlset>
            <url><loc>https://www.brandywine-homes.com/communities/persimmon/features/</loc></url>
            <url><loc>https://www.brandywine-homes.com/communities/persimmon/floor-plans/</loc></url>
            <url><loc>https://www.brandywine-homes.com/communities/persimmon/availability/</loc></url>
            <url><loc>https://www.brandywine-homes.com/communities/alisal/</loc></url>
            <url><loc>https://www.brandywine-homes.com/compare/</loc></url>
          </urlset>
        `, { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      if (url.includes('/communities/persimmon/features/')) {
        return new Response('<html><head><title>Persimmon Features</title></head><body><h1>Features</h1><p>Persimmon offers smart home features, gated access, garages, and energy efficient townhomes.</p></body></html>', { status: 200 })
      }
      if (url.includes('/communities/persimmon/floor-plans/')) {
        return new Response('<html><head><title>Persimmon Floor Plans</title></head><body><h1>Floor Plans</h1><p>3 bedroom and 4 bedroom floor plans with pricing and availability.</p></body></html>', { status: 200 })
      }
      if (url.includes('/communities/persimmon/availability/')) {
        return new Response('<html><head><title>Persimmon Availability</title></head><body><h1>Availability</h1><p>Available homes and pricing for Persimmon.</p></body></html>', { status: 200 })
      }
      if (url.includes('/communities/alisal/') || url.includes('/compare/')) {
        return new Response('<html><head><title>Other Page</title></head><body><h1>Other Page</h1></body></html>', { status: 200 })
      }

      return new Response(`
        <html>
          <head><title>Persimmon</title><meta name="description" content="Pomona new homes"></head>
          <body>
            <a href="/communities/persimmon/features/">Features</a>
            <a href="/communities/persimmon/contact-us/">Contact</a>
            <a href="/communities/alisal/">Alisal</a>
            <h1>Persimmon New Homes</h1>
          </body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('https://www.brandywine-homes.com/communities/persimmon/')

    expect(audit.discoveredUrls).toContain('https://www.brandywine-homes.com/communities/persimmon/features/')
    expect(audit.discoveredUrls).toContain('https://www.brandywine-homes.com/communities/persimmon/floor-plans/')
    expect(audit.discoveredUrls).not.toContain('https://www.brandywine-homes.com/communities/alisal/')
    expect(audit.filteredOutUrls).toContain('https://www.brandywine-homes.com/communities/alisal/')
    expect(audit.filteredOutUrls).toContain('https://www.brandywine-homes.com/compare/')
    expect(audit.pages?.some(page => page.url.includes('/communities/persimmon/features/'))).toBe(true)
    expect(audit.pages?.every(page => !page.url.includes('/communities/alisal/'))).toBe(true)
  })

  it('classifies an amenities URL as amenities before broad real estate copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }
      if (url.endsWith('/amenities') || url.endsWith('/amenities/')) {
        return new Response('<html><head><title>Kahuina Amenities</title></head><body><h1>Amenities</h1><p>Condos, residences, parking, gathering spaces, and fitness features.</p></body></html>', { status: 200 })
      }

      return new Response(`
        <html>
          <head><title>Kahuina</title><meta name="description" content="Honolulu condos"></head>
          <body><a href="/amenities/">Amenities</a><h1>Kahuina condos</h1></body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('https://mykahuina.com')
    const amenitiesPage = audit.pages?.find(page => page.url.endsWith('/amenities/'))

    expect(amenitiesPage?.pageType).toBe('amenities')
    expect(audit.missingPageTypes).not.toContain('amenities')
    expect(audit.notes).not.toContain('No reachable amenities page was detected during the URL-only crawl.')
  })

  it('counts a reachable FAQ URL as FAQ coverage even when apartment terms appear first', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml') || url.endsWith('/llms.txt')) {
        return new Response('ok', { status: 200 })
      }
      if (url.endsWith('/faq') || url.endsWith('/faq/')) {
        return new Response(`
          <html>
            <head><title>Epoca Apartments FAQ</title></head>
            <body>
              <h1>Frequently Asked Questions</h1>
              <h2>What apartment floor plans are available?</h2>
              <h2>Where is the community located?</h2>
              <h2>Do you allow pets?</h2>
              <div class="faq">Answers about leasing, amenities, location, and tours.</div>
            </body>
          </html>
        `, { status: 200 })
      }

      return new Response(`
        <html>
          <head><title>Epoca Life</title><meta name="description" content="Apartments"></head>
          <body>
            <a href="/faq">FAQ</a>
            <h1>Epoca Life Apartments</h1>
          </body>
        </html>
      `, { status: 200 })
    }))

    const audit = await auditPublicSite('https://epocalife.com')
    const faqPage = audit.pages?.find(page => page.url.includes('/faq'))

    expect(faqPage?.pageType).toBe('faq')
    expect(faqPage?.answerBlockSignals).toBeGreaterThan(0)
    expect(audit.missingPageTypes).not.toContain('faq')
    expect(audit.notes).not.toContain('No reachable faq page was detected during the URL-only crawl.')
  })

  it('rejects local or private hosts before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const audit = await auditPublicSite('http://localhost:3000')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(audit.homepageReachable).toBe(false)
    expect(audit.notes).toContain('The configured website URL is not safe for URL-only auditing.')
  })
})
