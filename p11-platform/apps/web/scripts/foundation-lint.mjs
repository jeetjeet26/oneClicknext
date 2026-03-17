import { spawnSync } from 'node:child_process'
import { foundationFiles as files } from './foundation-files.mjs'

const eslintBin =
  process.platform === 'win32'
    ? 'node_modules/.bin/eslint.cmd'
    : 'node_modules/.bin/eslint'

const result = spawnSync(eslintBin, files, {
  stdio: 'inherit',
  cwd: process.cwd(),
})

process.exit(result.status ?? 1)
