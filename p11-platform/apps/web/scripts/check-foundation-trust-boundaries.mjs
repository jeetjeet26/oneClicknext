import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const requiredRouteTests = [
  'app/api/dashboard/overview/route.test.ts',
  'app/api/documents/route.test.ts',
  'app/api/cron/runs/route.test.ts',
  'app/api/cron/knowledge-refresh/route.test.ts',
  'app/api/cron/publish-scheduled/route.test.ts',
  'app/api/cron/sync-ads/route.test.ts',
  'app/api/cron/sync-reviews/route.test.ts',
  'app/api/siteforge/deploy/[websiteId]/route.test.ts',
  'app/api/propertyaudit/process/route.test.ts',
]

const requiredRouteGuards = [
  {
    file: 'app/api/dashboard/overview/route.ts',
    checks: ['validatePropertyAccess('],
  },
  {
    file: 'app/api/documents/route.ts',
    checks: ['validatePropertyAccess('],
  },
  {
    file: 'app/api/cron/runs/route.ts',
    checks: [".from('profiles')", "['admin', 'manager']"],
  },
  {
    file: 'app/api/cron/knowledge-refresh/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
  {
    file: 'app/api/cron/publish-scheduled/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
  {
    file: 'app/api/cron/sync-ads/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
  {
    file: 'app/api/cron/sync-reviews/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
  {
    file: 'app/api/siteforge/deploy/[websiteId]/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
  {
    file: 'app/api/propertyaudit/process/route.ts',
    checks: ['createRequestContext(', 'ctx.logStart('],
  },
]

const errors = []

for (const relPath of requiredRouteTests) {
  const fullPath = path.join(ROOT, relPath)
  if (!existsSync(fullPath)) {
    errors.push(`Missing required foundation route test: ${relPath}`)
  }
}

for (const rule of requiredRouteGuards) {
  const fullPath = path.join(ROOT, rule.file)
  if (!existsSync(fullPath)) {
    errors.push(`Missing required foundation route file: ${rule.file}`)
    continue
  }

  const content = readFileSync(fullPath, 'utf8')
  for (const snippet of rule.checks) {
    if (!content.includes(snippet)) {
      errors.push(`Missing trust-boundary guard in ${rule.file}: expected "${snippet}"`)
    }
  }
}

if (errors.length > 0) {
  console.error('Foundation trust-boundary check failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Foundation trust-boundary check passed for critical Tier 1 routes.')
