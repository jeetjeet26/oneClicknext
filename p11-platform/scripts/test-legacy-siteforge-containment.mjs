import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import assert from 'node:assert/strict'
for (const name of ['siteforge-deploy', 'siteforge-provision', 'siteforge-status']) {
  let handler
  let external = 0
  const code = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
  runInNewContext(code, { Deno: { serve: callback => { handler = callback } }, Response, JSON, fetch: () => { external++; throw Error('External calls forbidden') } })
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await handler(new Request('http://localhost', {method}))
    assert.equal(response.status, 503)
    assert.match((await response.json()).error, /paused/)
  }
  assert.equal(external, 0)
  console.log(`PASS: ${name} containment rejects all methods without database or provider access`)
}
