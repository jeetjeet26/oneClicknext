import { describe, expect, it } from 'vitest'
import {
  buildRenderedDomOutline,
  extractCssSelectors,
  findDeadCssSelectors,
} from './rendered-dom'

const HTML = `
<html><body>
<main>
  <section class="block-content-grid grid-cols-3" data-siteforge-section-id="core.page.section.s3" data-siteforge-variant="editorial">
    <div class="site-container">
      <div class="grid-layout">
        <div class="grid-item"><h3 class="grid-item-headline">Card one</h3><p>Body</p></div>
        <div class="grid-item"><h3 class="grid-item-headline">Card two</h3><p>Body</p></div>
      </div>
    </div>
  </section>
  <section class="block-top-slides" data-siteforge-section-id="core.page.section.hero">
    <h1 class="slide-headline">Hero</h1>
  </section>
</main>
<script>ignored()</script>
</body></html>`

describe('buildRenderedDomOutline', () => {
  it('outlines every siteforge section with tags, classes, and data attributes', () => {
    const outline = buildRenderedDomOutline(HTML)
    expect(outline).toContain(
      '<section.block-content-grid.grid-cols-3 data-siteforge-section-id="core.page.section.s3" data-siteforge-variant="editorial">'
    )
    expect(outline).toContain('<div.grid-item>')
    expect(outline).toContain('<h3.grid-item-headline> “Card one”')
    expect(outline).toContain('<h1.slide-headline> “Hero”')
    expect(outline).not.toContain('ignored()')
  })

  it('scopes the outline to one section when requested', () => {
    const outline = buildRenderedDomOutline(HTML, {
      sectionId: 'core.page.section.hero',
    })
    expect(outline).toContain('slide-headline')
    expect(outline).not.toContain('grid-item')
  })
})

describe('extractCssSelectors', () => {
  it('extracts flat rules, selector lists, and @media contents', () => {
    const css = `
      /* comment { not a rule } */
      .a, .b > .c { color: red; }
      @media (min-width: 600px) { .d .e { margin: 0; } }
      @font-face { font-family: X; src: url(x.woff); }
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
    `
    expect(extractCssSelectors(css)).toEqual(['.a', '.b > .c', '.d .e'])
  })
})

describe('findDeadCssSelectors', () => {
  it('reports selectors matching nothing in the rendered DOM', () => {
    // The exact failure that shipped a no-op overlay: CSS written against a
    // guessed wrapper structure instead of the real rendered markup.
    const css = `
      [data-siteforge-section-id="core.page.section.s3"] .block-content-grid > *:nth-child(2) { align-items: flex-start; }
      [data-siteforge-section-id="core.page.section.s3"] .grid-item { align-items: flex-start; }
    `
    expect(findDeadCssSelectors(HTML, css)).toEqual([
      '[data-siteforge-section-id="core.page.section.s3"] .block-content-grid > *:nth-child(2)',
    ])
  })

  it('ignores pseudo-classes and pseudo-elements when matching', () => {
    const css = `
      .grid-item:hover { color: red; }
      .grid-item::before { content: ''; }
      .grid-item:nth-child(2) { color: blue; }
    `
    expect(findDeadCssSelectors(HTML, css)).toEqual([])
  })

  it('never reports selectors it cannot evaluate server-side', () => {
    const css = `.grid-item:has(> h3) { color: red; }`
    expect(findDeadCssSelectors(HTML, css).length).toBeLessThanOrEqual(1)
  })
})
