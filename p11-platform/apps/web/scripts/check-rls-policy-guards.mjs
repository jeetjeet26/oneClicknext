import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = path.join(ROOT, '..', '..', 'supabase', 'migrations')
const ENFORCED_FROM_VERSION = '20260316123000'

function getMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{14}_.*\.sql$/.test(name))
    .sort()
}

function getVersion(fileName) {
  const match = fileName.match(/^(\d{14})_/)
  return match ? match[1] : null
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
}

const violations = []

for (const fileName of getMigrationFiles()) {
  const version = getVersion(fileName)
  if (!version || version < ENFORCED_FROM_VERSION) continue

  const fullPath = path.join(MIGRATIONS_DIR, fileName)
  const sql = readFileSync(fullPath, 'utf8')
  const statements = splitSqlStatements(sql)

  for (const statement of statements) {
    const normalized = statement.toLowerCase()
    const createsProfilesPolicy =
      normalized.includes('create policy') &&
      (normalized.includes(' on profiles') || normalized.includes(' on public.profiles'))

    if (!createsProfilesPolicy) continue

    // Direct self-reference on profiles in a profiles policy is a recursion risk.
    if (/\bfrom\s+public\.profiles\b|\bfrom\s+profiles\b/i.test(statement)) {
      violations.push({
        fileName,
        statement: statement.slice(0, 220).replace(/\s+/g, ' '),
      })
    }
  }
}

if (violations.length > 0) {
  console.error('RLS policy guard failed: recursive profiles policy pattern detected.')
  for (const violation of violations) {
    console.error(`- ${violation.fileName}: ${violation.statement}...`)
  }
  console.error(
    'Use a SECURITY DEFINER helper function (for example current_user_org_id()) instead of querying profiles directly inside a profiles policy.'
  )
  process.exit(1)
}

console.log('RLS policy guard passed: no recursive profiles policy patterns detected in new migrations.')
