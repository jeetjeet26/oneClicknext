import { Sandbox } from '@vercel/sandbox'

const CHROMIUM_SYSTEM_DEPS = [
  'nss',
  'nspr',
  'libxkbcommon',
  'atk',
  'at-spi2-atk',
  'at-spi2-core',
  'libXcomposite',
  'libXdamage',
  'libXrandr',
  'libXfixes',
  'libXcursor',
  'libXi',
  'libXtst',
  'libXScrnSaver',
  'libXext',
  'mesa-libgbm',
  'libdrm',
  'mesa-libGL',
  'mesa-libEGL',
  'cups-libs',
  'alsa-lib',
  'pango',
  'cairo',
  'gtk3',
  'dbus-libs',
]

const sandbox = await Sandbox.create({
  runtime: 'node24',
  timeout: 300_000,
})

try {
  const installSystemDependencies = await sandbox.runCommand('sh', [
    '-c',
    `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(' ')} 2>&1 && sudo ldconfig 2>&1`,
  ])
  if (installSystemDependencies.exitCode !== 0) {
    throw new Error(await installSystemDependencies.stderr())
  }

  const installAgentBrowser = await sandbox.runCommand('npm', [
    'install',
    '-g',
    'agent-browser',
  ])
  if (installAgentBrowser.exitCode !== 0) {
    throw new Error(await installAgentBrowser.stderr())
  }

  const installChromium = await sandbox.runCommand('npx', [
    'agent-browser',
    'install',
  ])
  if (installChromium.exitCode !== 0) {
    throw new Error(await installChromium.stderr())
  }

  const snapshot = await sandbox.snapshot()
  process.stdout.write(`${snapshot.snapshotId}\n`)
} catch (error) {
  await sandbox.stop()
  throw error
}
