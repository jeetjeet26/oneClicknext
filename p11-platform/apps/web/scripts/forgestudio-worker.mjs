#!/usr/bin/env node
/**
 * Local ForgeStudio publication worker loop.
 *
 * Polls the same queue-wake endpoint hosted cron uses, so local and hosted
 * execution share one code path (processDuePublications). Run alongside the
 * dev server:
 *
 *   npm run worker:forgestudio
 *
 * Env:
 *   CRON_SECRET        required — must match the web app's CRON_SECRET
 *   WORKER_BASE_URL    default http://localhost:3000
 *   WORKER_INTERVAL_MS default 30000
 */

const baseUrl = process.env.WORKER_BASE_URL || 'http://localhost:3000'
const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 30_000)
const cronSecret = process.env.CRON_SECRET

if (!cronSecret) {
  console.error('[forgestudio-worker] CRON_SECRET is required')
  process.exit(1)
}

let stopping = false
process.on('SIGINT', () => {
  stopping = true
  console.log('\n[forgestudio-worker] stopping after current cycle…')
})
process.on('SIGTERM', () => {
  stopping = true
})

async function runCycle() {
  try {
    const response = await fetch(`${baseUrl}/api/cron/process-publications`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error(`[forgestudio-worker] cycle failed (${response.status}):`, data.error || data)
      return
    }
    if (data.claimed > 0) {
      console.log(
        `[forgestudio-worker] processed ${data.claimed} job(s):`,
        data.results.map((r) => `${r.publicationId ?? r.jobId}=${r.outcome}`).join(', ')
      )
    }
  } catch (error) {
    console.error('[forgestudio-worker] cycle error:', error.message)
  }
}

console.log(
  `[forgestudio-worker] polling ${baseUrl}/api/cron/process-publications every ${intervalMs}ms`
)

// eslint-disable-next-line no-constant-condition
while (true) {
  if (stopping) break
  await runCycle()
  if (stopping) break
  await new Promise((resolve) => setTimeout(resolve, intervalMs))
}

console.log('[forgestudio-worker] stopped')
