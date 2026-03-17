import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TYPES_FILE = path.join(ROOT, 'types', 'supabase.ts')
const TARGET_DIRS = [
  path.join(ROOT, 'app', 'api'),
  path.join(ROOT, 'utils', 'services'),
]

function walkFiles(dir) {
  const entries = readdirSync(dir)
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const st = statSync(fullPath)
    if (st.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }

    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) continue
    if (fullPath.endsWith('.test.ts') || fullPath.endsWith('.test.tsx')) continue
    if (fullPath.endsWith('.d.ts')) continue
    files.push(fullPath)
  }

  return files
}

function getKnownTables(typesContent) {
  const tablesBlock = typesContent.match(/Tables:\s*\{([\s\S]*?)\n\s*Views:\s*\{/)
  if (!tablesBlock) {
    throw new Error('Could not parse `Tables` block in types/supabase.ts')
  }

  const tableNames = new Set()
  const regex = /^\s{6}([a-zA-Z0-9_]+):\s*\{\s*$/gm
  let match = regex.exec(tablesBlock[1])
  while (match) {
    tableNames.add(match[1])
    match = regex.exec(tablesBlock[1])
  }
  return tableNames
}

function collectFromReferences(content) {
  const refs = []
  const fromRegex = /\.from\(\s*(['"`])([a-zA-Z0-9_]+)\1\s*\)/g
  let match = fromRegex.exec(content)
  while (match) {
    refs.push(match[2])
    match = fromRegex.exec(content)
  }
  return refs
}

const typesContent = readFileSync(TYPES_FILE, 'utf8')
const knownTables = getKnownTables(typesContent)
const unknownRefs = []

for (const dir of TARGET_DIRS) {
  const files = walkFiles(dir)
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const refs = collectFromReferences(content)

    for (const tableName of refs) {
      if (!knownTables.has(tableName)) {
        unknownRefs.push({
          file: path.relative(ROOT, file),
          table: tableName,
        })
      }
    }
  }
}

if (unknownRefs.length > 0) {
  console.error('Schema-truth check failed: route/service references unknown tables.')
  for (const ref of unknownRefs) {
    console.error(`- ${ref.file} -> .from('${ref.table}')`)
  }
  console.error('\nFix by syncing migrations + types before shipping route changes.')
  process.exit(1)
}

console.log('Schema-truth check passed: all .from() table refs exist in types/supabase.ts.')
