import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const SCAN_TARGETS = ['app/api', 'utils/services', 'app/auth']
const ALLOWED_LOCALHOST_FILES = new Set([
  'utils/services/runtime-config.ts',
  'utils/services/runtime-config.test.ts',
])

const violations = []

function walkFiles(relativePath) {
  const fullPath = path.join(ROOT, relativePath)
  if (!statSync(fullPath).isDirectory()) return [relativePath]

  const files = []
  for (const entry of readdirSync(fullPath)) {
    const childRelativePath = path.join(relativePath, entry)
    const childFullPath = path.join(ROOT, childRelativePath)
    const stats = statSync(childFullPath)

    if (stats.isDirectory()) {
      files.push(...walkFiles(childRelativePath))
      continue
    }

    files.push(childRelativePath)
  }

  return files
}

function shouldScanFile(relativePath) {
  if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) return false
  if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.spec.ts')) return false
  return true
}

function assertNoMatch(relativePath, content, pattern, reason) {
  if (!pattern.test(content)) return
  violations.push(`${relativePath}: ${reason}`)
}

for (const target of SCAN_TARGETS) {
  for (const file of walkFiles(target)) {
    if (!shouldScanFile(file)) continue

    const content = readFileSync(path.join(ROOT, file), 'utf8')

    assertNoMatch(
      file,
      content,
      /process\.env\.DATA_ENGINE_URL[\s\S]{0,200}['"]http:\/\/localhost:(8000|8001)['"]/m,
      'do not use DATA_ENGINE_URL localhost fallback inline; use getDataEngineUrl()'
    )

    assertNoMatch(
      file,
      content,
      /process\.env\.NEXT_PUBLIC_(SITE_URL|APP_URL|BASE_URL)[\s\S]{0,200}['"]http:\/\/localhost:3000['"]/m,
      'do not use NEXT_PUBLIC_* URL fallback/ternary inline; use getAppBaseUrl()'
    )

    if (!ALLOWED_LOCALHOST_FILES.has(file)) {
      assertNoMatch(
        file,
        content,
        /['"]http:\/\/localhost:(3000|8000|8001)['"]/m,
        'localhost URL literals are restricted; centralize in runtime-config.ts'
      )
    }
  }
}

if (violations.length > 0) {
  console.error('Runtime config hardening check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Runtime config hardening check passed.')
