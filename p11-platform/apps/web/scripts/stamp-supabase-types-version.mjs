import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = path.join(ROOT, '..', '..', 'supabase', 'migrations')
const TYPES_FILE = path.join(ROOT, 'types', 'supabase.ts')
const VERSION_MARKER_PREFIX = '// schema_migration_version:'

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

const latestMigrationVersion = getLatestMigrationVersion()
const stampLine = `${VERSION_MARKER_PREFIX} ${latestMigrationVersion}`
const currentContent = readFileSync(TYPES_FILE, 'utf8')

let nextContent
if (currentContent.startsWith(VERSION_MARKER_PREFIX)) {
  nextContent = currentContent.replace(
    /^\/\/ schema_migration_version:\s*\d{14}/,
    stampLine
  )
} else {
  nextContent = `${stampLine}\n${currentContent}`
}

writeFileSync(TYPES_FILE, nextContent)
console.log(`Stamped types/supabase.ts with migration version ${latestMigrationVersion}`)
