import { expect, test, type Page } from '@playwright/test'

const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
test.skip(!['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local fixture pages only')
const oldSession = '11111111-1111-4111-8111-111111111111'
const freshSession = '22222222-2222-4222-8222-222222222222'
const history = (last = 'Initial team reply', human = true) => ({
  conversationId: 'fixture-conversation', isHumanMode: human, leadCaptured: false,
  messages: Array.from({ length: 200 }, (_, i) => ({
    id: i === 199 ? last : `message-${i}`, role: 'assistant', content: i === 199 ? last : `Earlier reply ${i}`,
    createdAt: '2026-09-15T12:00:00Z',
  })),
})
async function prepare(page: Page, historyResponse: { status?: number; json: unknown }) {
  await page.route('**/__phase4_widget', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body><h1>Local widget fixture</h1></body></html>' }))
  await page.route('**/api/lumaleasing/**', route => route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } }))
  await page.route('**/api/lumaleasing/config', route => route.fulfill({ json: { config: {
    widgetName: 'Fixture assistant', welcomeMessage: 'Welcome to the fixture community.', primaryColor: '#174C45', secondaryColor: '#B7E0D2', autoPopupDelay: 0, toursEnabled: false,
  } } }))
  await page.route('**/api/lumaleasing/session/history?**', route => route.fulfill(historyResponse))
  await page.goto('/__phase4_widget')
  await page.clock.install()
  await page.evaluate(session => localStorage.setItem('lumaleasing_session_id', session), oldSession)
  await page.addScriptTag({ url: `${base}/lumaleasing.js` })
  await page.evaluate(() => (window as unknown as { lumaleasing: (command: string, key?: string) => void }).lumaleasing('init', 'fixture-key'))
  await expect(page.locator('#lumaleasing-widget')).toBeAttached()
  await page.evaluate(() => (window as unknown as { lumaleasing: (command: string) => void }).lumaleasing('open'))
  await expect(page.locator('#ll-input')).toBeVisible()
}
async function send(page: Page, message = 'Are tours available?') {
  await page.locator('#ll-input').fill(message)
  await page.locator('#ll-send').click()
}
async function storedSession(page: Page) {
  return page.evaluate(() => localStorage.getItem('lumaleasing_session_id'))
}

test('a temporary restore error retains the session for the next message', async ({ page }) => {
  const requests: unknown[] = []
  await prepare(page, { status: 503, json: { error: 'Unavailable' } })
  await page.route('**/api/lumaleasing/chat', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { content: 'Conversation continued.', sessionId: oldSession } })
  })
  expect(await storedSession(page)).toBe(oldSession)
  await send(page)
  await expect(page.getByText('Conversation continued.', { exact: false })).toBeVisible()
  expect(requests).toEqual([expect.objectContaining({ sessionId: oldSession })])
})

test('latest human replies appear even when both snapshots contain 200 messages', async ({ page }, info) => {
  await prepare(page, { json: history() })
  await expect(page.getByText('Initial team reply', { exact: false })).toBeVisible()
  await page.locator('#ll-input').fill('A draft stays here')
  await page.route('**/api/lumaleasing/session/history?**', route => route.fulfill({ json: history('New team reply') }))
  await page.clock.fastForward(6100)
  await expect(page.getByText('New team reply', { exact: false })).toBeVisible()
  await expect(page.locator('#ll-input')).toHaveValue('A draft stays here')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('widget-human-recovery-mobile.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('transient polling failures do not stop later human replies', async ({ page }) => {
  await prepare(page, { json: history() })
  await expect(page.getByText('Initial team reply', { exact: false })).toBeVisible()
  let calls = 0
  await page.route('**/api/lumaleasing/session/history?**', route => {
    calls += 1
    return route.fulfill(calls === 1 ? { status: 429, json: { error: 'Slow down' } } : { json: history('Reply after recovery') })
  })
  await page.clock.fastForward(6100)
  await expect.poll(() => calls).toBe(1)
  await page.clock.fastForward(6100)
  await expect(page.getByText('Reply after recovery', { exact: false })).toBeVisible()
  expect(await storedSession(page)).toBe(oldSession)
})

test('confirmed expiry retries once with a clean session and preserves the current question', async ({ page }) => {
  await prepare(page, { json: history('Previous conversation', false) })
  const requests: Array<Record<string, unknown>> = []
  await page.route('**/api/lumaleasing/chat', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill(requests.length === 1
      ? { status: 410, json: { code: 'session_expired', error: 'Session expired' } }
      : { json: { content: 'Fresh conversation.', sessionId: freshSession } })
  })
  await send(page)
  await expect(page.getByText('Fresh conversation.', { exact: false })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0].sessionId).toBe(oldSession)
  expect(requests[1]).toEqual({ requestId:expect.any(String),messages: [{ role: 'user', content: 'Are tours available?' }] })
  expect(await storedSession(page)).toBe(freshSession)
  await expect(page.getByText('Previous conversation', { exact: false })).toHaveCount(0)
})

for (const status of [400, 500]) {
  test(`a ${status} chat failure does not silently start another conversation`, async ({ page }) => {
    await prepare(page, { json: history('Saved earlier reply', false) })
    let calls = 0
    await page.route('**/api/lumaleasing/chat', route => {
      calls += 1
      return route.fulfill({ status, json: { error: 'Request not accepted' } })
    })
    await send(page)
    await expect(page.getByText("I'm having trouble connecting. Please try again!", { exact: false })).toBeVisible()
    expect(calls).toBe(1)
    expect(await storedSession(page)).toBe(oldSession)
  })
}

test('a failed human handoff never shows the saved-for-team notice', async ({ page }) => {
  await prepare(page, { json: history('Earlier team reply') })
  await page.route('**/api/lumaleasing/chat', route => route.fulfill({ status: 500, json: { error: 'Storage unavailable' } }))
  await send(page)
  await expect(page.getByText("I'm having trouble connecting. Please try again!", { exact: false })).toBeVisible()
  await expect(page.getByText('Your message is saved for the team.', { exact: false })).toHaveCount(0)
})


test('reset clears the conversation and ignores an older history response', async ({ page }) => {
  await prepare(page, { json: history() })
  await expect(page.getByText('Initial team reply')).toBeVisible()
  let release: () => void = () => undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/lumaleasing/session/history?**', async route => {
    requested = true
    await waiting
    await route.fulfill({ json: history('Old response arriving late') })
  })
  await page.clock.fastForward(6100)
  await expect.poll(() => requested).toBe(true)
  await page.evaluate(() => (window as unknown as { lumaleasing: (command: string) => void }).lumaleasing('reset'))
  expect(await storedSession(page)).toBeNull()
  const lateResponse = page.waitForResponse(response => response.url().includes('/session/history'))
  release()
  await (await lateResponse).finished()
  await page.clock.runFor(20)
  await expect(page.getByText('Initial team reply')).toHaveCount(0)
  await expect(page.getByText('Old response arriving late')).toHaveCount(0)
  await expect(page.locator('#ll-input')).toBeVisible()
})

test('an older poll cannot replace a newly submitted message', async ({ page }) => {
  await prepare(page, { json: history() })
  await expect(page.getByText('Initial team reply')).toBeVisible()
  let release: () => void = () => undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/lumaleasing/session/history?**', async route => {
    requested = true
    await waiting
    await route.fulfill({ json: history('Stale history response') })
  })
  await page.clock.fastForward(6100)
  await expect.poll(() => requested).toBe(true)
  await page.route('**/api/lumaleasing/chat', route => route.fulfill({ json: { isHumanMode: true, waitingForHuman: true, sessionId: oldSession } }))
  await send(page, 'My newer question')
  await expect(page.getByText('Your message is saved for the team.')).toBeVisible()
  const lateResponse = page.waitForResponse(response => response.url().includes('/session/history'))
  release()
  await (await lateResponse).finished()
  await page.clock.runFor(20)
  await expect(page.getByText('My newer question')).toBeVisible()
  await expect(page.getByText('Stale history response')).toHaveCount(0)
})

test('a repeated question after a lost response retains the same request identity',async({page})=>{
 await prepare(page,{json:history('Saved team reply')})
 const requests:Array<Record<string,unknown>>=[]
 await page.route('**/api/lumaleasing/chat',route=>{
  requests.push(route.request().postDataJSON())
  if(requests.length===1) return route.abort('failed')
  return route.fulfill({json:{content:'Saved once.',sessionId:oldSession}})
 })
 await send(page,'Please contact me')
 await expect(page.getByText("I'm having trouble connecting",{exact:false})).toBeVisible()
 await send(page,'Please contact me')
 await expect(page.getByText('Saved once.',{exact:false})).toBeVisible()
 expect(requests).toHaveLength(2)
 expect(requests[0].requestId).toBe(requests[1].requestId)
 expect(requests[0]).toEqual(requests[1])
})
