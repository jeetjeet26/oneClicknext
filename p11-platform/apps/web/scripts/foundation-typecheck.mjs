import { spawnSync } from 'node:child_process'
import { foundationFiles } from './foundation-files.mjs'

const tscBin =
  process.platform === 'win32'
    ? 'node_modules/.bin/tsc.cmd'
    : 'node_modules/.bin/tsc'

const result = spawnSync(tscBin, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})

const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim()

if (!combinedOutput) {
  console.log('Foundation typecheck passed with no TypeScript errors.')
  process.exit(0)
}

const relevantLines = combinedOutput
  .split('\n')
  .filter(line => foundationFiles.some(file => line.includes(file)))

if (relevantLines.length > 0) {
  console.error('Foundation typecheck failed:')
  console.error(relevantLines.join('\n'))
  process.exit(1)
}

console.log('Foundation typecheck passed for the trusted foundation slice.')
process.exit(0)
