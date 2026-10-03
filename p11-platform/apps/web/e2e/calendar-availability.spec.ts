import {expect, test, type Page} from '@playwright/test'
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
test.skip(!['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local fixture only')
test.use({timezoneId: 'Asia/Kolkata'})
async function prepare(page: Page) {
  await page.route('**/__calendar_widget', route => route.fulfill({contentType: 'text/html', body: '<html><head></head><body><h1>Local calendar fixture</h1></body></html>'}))
  await page.route('**/api/lumaleasing/**', route => route.fulfill({status: 500, json: {error: 'Unexpected fixture request'}}))
  await page.route('**/api/lumaleasing/config', route => route.fulfill({json: {config: {widgetName: 'Fixture assistant', welcomeMessage: 'Welcome.', primaryColor: '#174C45', secondaryColor: '#B7E0D2', autoPopupDelay: 0, toursEnabled: true}}}))
  await page.route('**/api/lumaleasing/chat', route => route.fulfill({json: {content: 'Choose a tour.', tourCta: true, sessionId: '11111111-1111-4111-8111-111111111111'}}))
  await page.goto('/__calendar_widget'); await page.clock.install({time: new Date('2030-03-01T03:00:00Z')})
  await page.addScriptTag({url: `${base}/lumaleasing.js`})
  await page.evaluate(() => {const app = (window as unknown as {lumaleasing: (command: string, key?: string) => void}).lumaleasing; app('init', 'fixture-key')})
  await page.getByRole('button', {name: 'Open Fixture assistant chat', exact: true}).click()
  await page.locator('#ll-input').fill('I would like a tour'); await page.locator('#ll-send').click()
  await expect(page.getByRole('button', {name: 'Schedule a tour', exact: false})).toBeVisible()
}
const availability = {success: true, availableDates: ['2030-03-01'], slotsByDate: {'2030-03-01': [{time: '10:00', available: true}]}, timezone: 'America/New_York', tourDuration: 45, bufferMinutes: 15}
test('a visitor in a positive UTC offset selects the displayed property day and time', async ({page}, info) => {
  await prepare(page)
  await page.route('**/api/lumaleasing/tours/availability*', route => {expect(new URL(route.request().url()).searchParams.has('startDate')).toBe(false); return route.fulfill({json: availability})})
  let body: unknown
  await page.route('**/api/lumaleasing/tours', route => {body = route.request().postDataJSON(); return route.fulfill({json: {success: true, message: 'Your tour is reserved. Confirmation is pending.'}})})
  await page.getByRole('button', {name: 'Schedule a tour', exact: false}).click()
  const day = page.getByRole('button', {name: '2030-03-01', exact: true}); await expect(day).toHaveText('1')
  await day.focus(); await page.keyboard.press('Enter')
  await expect(page.getByText('Times shown in America/New_York')).toBeVisible()
  await page.getByRole('button', {name: '10:00 AM', exact: true}).click()
  await expect(page.getByText('10:00 AM · America/New_York')).toBeVisible()
  await page.screenshot({path: info.outputPath('property-timezone-widget.png')})
  await page.locator('#ll-first-name').fill('Fixture'); await page.locator('#ll-last-name').fill('Visitor'); await page.locator('#ll-email').fill('fixture@example.com')
  await page.getByRole('button', {name: 'Confirm Tour', exact: true}).click()
  await expect(page.getByText('Your tour is reserved. Confirmation is pending.')).toBeVisible()
  expect(body).toMatchObject({tourDate: '2030-03-01', tourTime: '10:00', requestId: expect.any(String)})
})
test('uncertain or malformed availability preserves an explicit retry in the chat', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844}); await prepare(page)
  let mode = 'unavailable'
  await page.route('**/api/lumaleasing/tours/availability*', route => route.fulfill(mode === 'unavailable' ? {status: 503, json: {fallback: true, message: 'Tour availability could not be verified. Please try again.'}} : {json: mode === 'malformed' ? {...availability, slotsByDate: {}} : availability}))
  await page.getByRole('button', {name: 'Schedule a tour', exact: false}).click()
  await expect(page.getByText('Tour availability could not be verified. Please try again.')).toBeVisible()
  await expect(page.locator('.ll-calendar-day')).toHaveCount(0)
  await expect(page.getByRole('button', {name: 'Schedule a tour', exact: false})).toBeVisible()
  await page.screenshot({path: info.outputPath('availability-retry-mobile.png')})
  mode = 'malformed'; await page.getByRole('button', {name: 'Schedule a tour', exact: false}).click()
  await expect(page.getByText('Unable to load calendar. Please try again or call us.')).toBeVisible()
  mode = 'ready'; await page.getByRole('button', {name: 'Schedule a tour', exact: false}).click()
  await expect(page.getByRole('button', {name: '2030-03-01', exact: true})).toBeVisible()
})
