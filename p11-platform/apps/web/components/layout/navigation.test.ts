import { load } from 'cheerio'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { WorkspaceHeading } from './WorkspaceHeading'

const location = vi.hoisted(() => ({ url: new URL('https://hellop11.com/dashboard') }))

vi.mock('next/navigation', () => ({
  usePathname: () => location.url.pathname,
  useSearchParams: () => location.url.searchParams,
}))

describe('console navigation', () => {
  it.each([
    ['/dashboard/intelligence?section=campaigns', '/dashboard/intelligence', 'Property intelligence'],
    ['/dashboard', '/dashboard', 'Overview'],
  ])('shows the active workspace for %s', (path, activeHref, heading) => {
    location.url = new URL(path, 'https://hellop11.com')
    const markup = renderToStaticMarkup(
      createElement(Fragment, null, createElement(Sidebar), createElement(WorkspaceHeading)),
    )
    const $ = load(markup)
    const activeLinks = $('aside a[aria-current="page"]').toArray()

    expect(activeLinks.map(link => $(link).attr('href'))).toEqual([activeHref, activeHref])
    expect($('.console-location strong').text()).toBe(heading)
  })
})
