import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = path.join(ROOT, '..', '..', 'supabase', 'migrations')
const TYPES_FILE = path.join(ROOT, 'types', 'supabase.ts')
const VERSION_MARKER = '// schema_migration_version:'

function getLatestMigrationVersion() {
  const entries = readdirSync(MIGRATIONS_DIR)
  const versions = entries
    .map((name) => {
      const match = name.match(/^(\d{14})_.*\.sql$/)
      return match ? match[1] : null
    })
    .filter(Boolean)
    .sort()

  if (versions.length === 0) {
    throw new Error('No Supabase migrations found in supabase/migrations.')
  }

  return versions[versions.length - 1]
}

function getStampedVersion(typesContent) {
  const firstLines = typesContent.split('\n').slice(0, 5).join('\n')
  const match = firstLines.match(/schema_migration_version:\s*(\d{14})/)
  return match ? match[1] : null
}

const latestMigrationVersion = getLatestMigrationVersion()
const typesContent = readFileSync(TYPES_FILE, 'utf8')
const stampedVersion = getStampedVersion(typesContent)

if (!stampedVersion) {
  console.error('Schema types sync check failed: missing schema migration stamp in types/supabase.ts.')
  console.error(`Expected first line marker: "${VERSION_MARKER} <14-digit-migration-version>"`)
  console.error('Fix: regenerate Supabase types, then run `npm run schema:types:stamp`.')
  process.exit(1)
}

if (stampedVersion !== latestMigrationVersion) {
  console.error('Schema types sync check failed: types/supabase.ts is out of sync with migrations.')
  console.error(`- Latest migration version: ${latestMigrationVersion}`)
  console.error(`- Stamped type version:    ${stampedVersion}`)
  console.error('Fix: apply migration(s) in Supabase, regenerate types, then run `npm run schema:types:stamp`.')
  process.exit(1)
}

console.log(`Schema types sync check passed: ${stampedVersion}`)
