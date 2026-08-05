import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { ACACIA_REGRESSION_BASELINE_V1 as acacia } from '@/fixtures/acacia-regression.v1'

const widgetSource = readFileSync(
  new URL('./lumaleasing.js', import.meta.url),
  'utf8'
)

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  }
}

function widgetDocument() {
  const elements = new Map<string, Record<string, unknown>>()
  const makeElement = () => {
    const element: Record<string, unknown> = {
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      value: '',
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      }),
      remove: () => {
        const id = String(element.id || '')
        if (id) elements.delete(id)
      },
    }
    return element
  }
  const append = (element: Record<string, unknown>) => {
    const id = String(element.id || '')
    if (id) elements.set(id, element)
  }

  return {
    currentScript: {
      src: 'https://widget.test/assets/lumaleasing.js?version=1',
    },
    readyState: 'complete',
    documentElement: { clientWidth: 1280, clientHeight: 800 },
    body: { appendChild: append },
    head: { appendChild: append },
    createElement: makeElement,
    getElementById: (id: string) => elements.get(id) ?? null,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: vi.fn(),
  }
}

describe('Acacia LumaLeasing widget regression contract', () => {
  it('derives the API origin from the loader and performs no lead or tour write on init', async () => {
    const document = widgetDocument()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config: {
          widgetName: 'Acacia Assistant',
          welcomeMessage: 'Ask a question about Acacia.',
          primaryColor: '#123456',
          secondaryColor: '#234567',
          autoPopupDelay: 0,
          toursEnabled: true,
        },
      }),
    })
    const queuedInit = Object.assign(
      function queuedLumaleasing(...args: unknown[]) {
        queuedInit.q.push(args)
      },
      {
        q: [
          [
            'init',
            'local-regression-key',
            { position: 'bottom-left' },
          ],
        ] as unknown[][],
      }
    )
    const window = {
      location: {
        href: acacia.property.publicUrl,
        origin: 'https://www.dividendhomes.com',
      },
      innerWidth: 1280,
      innerHeight: 800,
      localStorage: storage(),
      sessionStorage: storage(),
      lumaleasing: queuedInit,
      addEventListener: vi.fn(),
    } as Record<string, unknown>
    window.window = window
    window.document = document

    runInNewContext(widgetSource, {
      window,
      document,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
      fetch: fetchMock,
      URL,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      `https://widget.test${acacia.widget.initEndpoint}`,
      { headers: { 'X-API-Key': 'local-regression-key' } }
    )
    await vi.waitFor(() =>
      expect(document.getElementById('lumaleasing-widget')).toMatchObject({
        className: 'll-widget bottom-left',
      })
    )

    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(requestedUrls).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(acacia.chatbot.handoff.leadEndpoint),
        expect.stringContaining(acacia.chatbot.handoff.tourBookingEndpoint),
      ])
    )
  })

  it('keeps loader, chat, lead, and explicit tour handoff paths stable without credentials', () => {
    expect(widgetSource).toContain(
      `const WIDGET_VERSION = '${acacia.widget.version}'`
    )
    expect(widgetSource).toContain('window.LUMALEASING_API_BASE || loaderOrigin || window.location.origin')
    expect(widgetSource).toContain(acacia.widget.chatEndpoint)
    expect(widgetSource).toContain(acacia.chatbot.handoff.leadEndpoint)
    expect(widgetSource).toContain(
      acacia.chatbot.handoff.tourAvailabilityEndpoint
    )
    expect(widgetSource).toContain(acacia.chatbot.handoff.tourBookingEndpoint)
    expect(widgetSource).toContain('if (data.tourCta && !tourBooked')

    const serialized = JSON.stringify(acacia)
    expect(serialized).not.toMatch(/service[_-]?role/i)
    expect(serialized).not.toMatch(/-----BEGIN [A-Z ]+PRIVATE KEY-----/)
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./)
  })
})
