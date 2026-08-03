import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const TYPES_FILE = path.join(ROOT, 'types', 'supabase.ts')
const TARGET_DIRS = [
  path.join(ROOT, 'app', 'api'),
  path.join(ROOT, 'utils', 'services'),
  path.join(ROOT, 'utils', 'siteforge'),
  path.join(ROOT, 'workflows'),
]
const MIGRATIONS_DIR = path.resolve(ROOT, '../../supabase/migrations')

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

export function collectSchemaObjectNames(block) {
  const names = new Set()
  const regex = /^\s{6}([a-zA-Z0-9_]+):\s*\{/gm
  let match = regex.exec(block)
  while (match) {
    names.add(match[1])
    match = regex.exec(block)
  }
  return names
}

export function getKnownSchemaObjects(typesContent) {
  const publicSchemaStart = typesContent.search(/\n\s{2}public:\s*\{/)
  if (publicSchemaStart < 0) {
    throw new Error('Could not parse `public` schema in types/supabase.ts')
  }
  const publicSchema = typesContent.slice(publicSchemaStart)

  const tablesBlock = publicSchema.match(/Tables:\s*\{([\s\S]*?)\n\s*Views:\s*\{/)
  if (!tablesBlock) {
    throw new Error('Could not parse `Tables` block in types/supabase.ts')
  }

  const viewsBlock = publicSchema.match(/Views:\s*\{([\s\S]*?)\n\s*Functions:\s*\{/)
  if (!viewsBlock) {
    throw new Error('Could not parse `Views` block in types/supabase.ts')
  }

  const functionsBlock = publicSchema.match(
    /Functions:\s*\{([\s\S]*?)\n\s*Enums:\s*\{/
  )
  if (!functionsBlock) {
    throw new Error('Could not parse `Functions` block in types/supabase.ts')
  }

  return {
    tables: new Set([
      ...collectSchemaObjectNames(tablesBlock[1]),
      ...collectSchemaObjectNames(viewsBlock[1]),
    ]),
    functions: collectSchemaObjectNames(functionsBlock[1]),
  }
}

function stringConstants(content) {
  const constants = new Map()
  const regex =
    /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"`])([a-zA-Z0-9_-]+)\2/g
  let match = regex.exec(content)
  while (match) {
    constants.set(match[1], match[3])
    match = regex.exec(content)
  }
  return constants
}

function resolveArgument(quote, literal, identifier, constants) {
  if (quote) return literal
  return constants.get(identifier)
}

export function collectSchemaReferences(content) {
  const constants = stringConstants(content)
  const references = []
  const fromRegex =
    /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.from\(\s*(?:(['"`])([a-zA-Z0-9_-]+)\2|([A-Z][A-Z0-9_]*))\s*\)/g
  let match = fromRegex.exec(content)
  while (match) {
    const receiver = match[1]
    const name = resolveArgument(match[2], match[3], match[4], constants)
    if (name && !['Buffer', 'Array'].includes(receiver)) {
      references.push({
        kind: receiver.endsWith('.storage') ? 'storage' : 'table',
        name,
      })
    }
    match = fromRegex.exec(content)
  }

  const rpcRegex =
    /\.rpc\(\s*(?:(['"`])([a-zA-Z0-9_]+)\1|([A-Z][A-Z0-9_]*))/g
  match = rpcRegex.exec(content)
  while (match) {
    const name = resolveArgument(match[1], match[2], match[3], constants)
    if (name) references.push({ kind: 'function', name })
    match = rpcRegex.exec(content)
  }

  return references
}

export function collectDeclaredStorageBuckets(contents) {
  const buckets = new Set()
  const patterns = [
    /\bcreateBucket\(\s*(['"`])([a-zA-Z0-9_-]+)\1/g,
    /\binsert\s+into\s+storage\.buckets[\s\S]*?\bvalues\s*\(\s*(['"])([a-zA-Z0-9_-]+)\1/gi,
  ]
  for (const content of contents) {
    for (const regex of patterns) {
      let match = regex.exec(content)
      while (match) {
        buckets.add(match[2])
        match = regex.exec(content)
      }
    }
  }
  return buckets
}

export function findUnknownSchemaReferences({
  files,
  typesContent,
  migrationContents = [],
}) {
  const known = getKnownSchemaObjects(typesContent)
  const sourceContents = files.map(file => ({
    file,
    content: readFileSync(file, 'utf8'),
  }))
  const storageBuckets = collectDeclaredStorageBuckets([
    ...migrationContents,
    ...sourceContents.map(source => source.content),
  ])
  const unknown = []

  for (const source of sourceContents) {
    for (const reference of collectSchemaReferences(source.content)) {
      const isKnown =
        reference.kind === 'table'
          ? known.tables.has(reference.name)
          : reference.kind === 'function'
            ? known.functions.has(reference.name)
            : storageBuckets.has(reference.name)
      if (!isKnown) {
        unknown.push({
          file: path.relative(ROOT, source.file),
          ...reference,
        })
      }
    }
  }
  return unknown
}

export function runSchemaTruthCheck() {
  const files = TARGET_DIRS.filter(existsSync).flatMap(walkFiles)
  const migrationContents = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter(filename => filename.endsWith('.sql'))
        .map(filename =>
          readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8')
        )
    : []
  const unknownRefs = findUnknownSchemaReferences({
    files,
    typesContent: readFileSync(TYPES_FILE, 'utf8'),
    migrationContents,
  })

  if (unknownRefs.length > 0) {
    console.error(
      'Schema-truth check failed: code references unknown database objects.'
    )
    for (const ref of unknownRefs) {
      console.error(`- ${ref.file} -> ${ref.kind} '${ref.name}'`)
    }
    console.error('\nFix by syncing migrations + types before shipping changes.')
    return false
  }

  console.log(
    'Schema-truth check passed: table, RPC, and storage references match declared schema.'
  )
  return true
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!runSchemaTruthCheck()) process.exit(1)
}
