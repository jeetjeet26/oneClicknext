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

// The generator omits explicit NULL from SQL Args. Preserve the nullable
// contracts exercised by the server and database tests when types are refreshed.
const nullableRpcArguments = {
  query_marketing_analytics: ['p_channel'],
  email_reply_matches_account: ['p_thread_id', 'p_message_id'],
  checkpoint_siteforge_monitoring_sweep: ['p_after_id'],
  request_crm_handoff: ['p_actor_id', 'p_note'],
  close_integration_authorization: ['p_claim_token'],
  upsert_luma_lead: ['p_email', 'p_phone', 'p_existing_id'],
  start_tour_reminder_channel: ['p_subject'],
  finish_tour_reminder_channel: ['p_provider_id'],
  start_workflow_delivery: ['p_subject', 'p_issue'],
  finish_workflow_delivery: ['p_provider_id'],
}
for (const [name, args] of Object.entries(nullableRpcArguments)) {
  const pattern = new RegExp(String.raw`      ${name}: \{\n        Args: \{[\s\S]*?\n        \}`)
  const section = nextContent.match(pattern)?.[0]
  if (!section) throw new Error(`Generated types are missing the saved SQL contract: ${name}`)
  let normalized = section
  for (const arg of args) {
    const argument = new RegExp(String.raw`(\b${arg}\??: string)(?: \| null)?`)
    if (!argument.test(normalized)) throw new Error(`Generated types are missing ${name}.${arg}`)
    normalized = normalized.replace(argument, '$1 | null')
  }
  nextContent = nextContent.replace(section, normalized)
}
nextContent = nextContent.trimEnd() + '\n'

writeFileSync(TYPES_FILE, nextContent)
console.log(`Stamped types/supabase.ts with migration version ${latestMigrationVersion}`)
