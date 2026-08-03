import { Client, type SFTPWrapper } from 'ssh2'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export interface WordPressSshCredentials {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  applicationRoot?: string
  sftpApplicationRoot?: string
}

export interface WordPressInstallerInput {
  ssh: WordPressSshCredentials
  themeArchivePath?: string
  runtimePluginArchivePath?: string
  acfProArchivePath?: string
  acfProLicenseKey: string
  onProgress?: (step: string) => void | Promise<void>
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function connect(credentials: WordPressSshCredentials): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client
      .once('ready', () => resolve(client))
      .once('error', reject)
      .connect({
        host: credentials.host,
        port: credentials.port || 22,
        username: credentials.username,
        password: credentials.password,
        privateKey: credentials.privateKey,
        readyTimeout: 30_000,
      })
  })
}

function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)))
  })
}

function mkdir(sftp: SFTPWrapper, directory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(directory, (statError) => {
      if (!statError) {
        resolve()
        return
      }
      sftp.mkdir(directory, (error) => (error ? reject(error) : resolve()))
    })
  })
}

async function mkdirRecursive(
  sftp: SFTPWrapper,
  directory: string
): Promise<void> {
  const segments = directory.split('/').filter(Boolean)
  let current = directory.startsWith('/') ? '/' : ''
  for (const segment of segments) {
    current =
      current === '/'
        ? `/${segment}`
        : current
          ? `${current}/${segment}`
          : segment
    await mkdir(sftp, current)
  }
}

function writeFile(
  sftp: SFTPWrapper,
  destination: string,
  contents: Buffer
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(destination, { mode: 0o644 })
    stream.once('close', resolve)
    stream.once('error', reject)
    stream.end(contents)
  })
}

function removeFileIfExists(
  sftp: SFTPWrapper,
  destination: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(destination, (error) => {
      if (!error || (error as Error & { code?: number }).code === 2) {
        resolve()
        return
      }
      reject(error)
    })
  })
}

function exec(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      stream.once('close', (code: number | null) => {
        if (code === 0) resolve(stdout)
        else
          reject(new Error(`Remote WordPress command failed: ${stderr.trim()}`))
      })
    })
  })
}

export class SshWordPressInstaller {
  async installThemeOverlay(input: {
    ssh: WordPressSshCredentials
    archive: Buffer
    contentHash: string
    onProgress?: (step: string) => void | Promise<void>
  }): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
      throw new Error('Theme overlay content hash is invalid')
    }
    if (
      input.archive.length < 100 ||
      input.archive[0] !== 0x50 ||
      input.archive[1] !== 0x4b
    ) {
      throw new Error('Theme overlay archive is invalid')
    }
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const sftpApplicationRoot = input.ssh.sftpApplicationRoot || applicationRoot
    const overlaySlug = `oneclick-siteforge-overlay-${input.contentHash.slice(0, 12)}`
    const remoteArchive = `${sftpApplicationRoot}/${overlaySlug}.zip`
    const remoteThemeRoot = `${sftpApplicationRoot}/wp-content/themes/${overlaySlug}`
    await input.onProgress?.(
      'Installing the exact signed SiteForge theme overlay...'
    )
    const client = await connect(input.ssh)
    try {
      const sftp = await getSftp(client)
      await mkdirRecursive(sftp, remoteThemeRoot)
      await removeFileIfExists(sftp, remoteArchive)
      await writeFile(sftp, remoteArchive, input.archive)
      await exec(
        client,
        [
          `cd ${shellQuote(applicationRoot)}`,
          `rm -rf ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `mkdir -p ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `unzip -oq ${shellQuote(`${overlaySlug}.zip`)} -d ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `wp theme activate ${shellQuote(overlaySlug)}`,
          `rm -f ${shellQuote(`${overlaySlug}.zip`)}`,
        ].join(' && ')
      )
      await input.onProgress?.('Signed SiteForge theme overlay activated.')
      return overlaySlug
    } finally {
      client.end()
    }
  }

  async syncThemeFiles(input: {
    ssh: WordPressSshCredentials
    themeDirectoryPath?: string
    remoteThemeSlug?: string
    onProgress?: (step: string) => void | Promise<void>
  }): Promise<void> {
    const themeDirectoryPath =
      input.themeDirectoryPath ||
      path.resolve(process.cwd(), '../../../wordpress-theme/oneclick-siteforge')
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const sftpApplicationRoot = input.ssh.sftpApplicationRoot || applicationRoot
    const remoteThemeSlug = input.remoteThemeSlug || 'oneclick-siteforge'
    const remoteThemeRoot = `${sftpApplicationRoot}/wp-content/themes/${remoteThemeSlug}`
    await input.onProgress?.('Connecting to WordPress application over SFTP...')
    const client = await connect(input.ssh)
    try {
      const sftp = await getSftp(client)
      await input.onProgress?.('Synchronizing premium SiteForge theme files...')
      await mkdirRecursive(sftp, remoteThemeRoot)

      const uploadDirectory = async (
        localDirectory: string,
        remoteDirectory: string
      ): Promise<void> => {
        const entries = await readdir(localDirectory, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name === '.DS_Store' || entry.name === '.gitkeep') continue
          const localPath = path.join(localDirectory, entry.name)
          const remotePath = path.posix.join(remoteDirectory, entry.name)
          if (entry.isDirectory()) {
            await mkdirRecursive(sftp, remotePath)
            await uploadDirectory(localPath, remotePath)
          } else if (entry.isFile()) {
            try {
              await writeFile(sftp, remotePath, await readFile(localPath))
            } catch (error) {
              throw new Error(
                `Failed to upload SiteForge theme file ${remotePath}: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            }
          }
        }
      }

      await uploadDirectory(themeDirectoryPath, remoteThemeRoot)
      if (remoteThemeSlug !== 'oneclick-siteforge') {
        const muPluginDirectory = `${sftpApplicationRoot}/wp-content/mu-plugins`
        await mkdirRecursive(sftp, muPluginDirectory)
        const activator = `<?php
/**
 * Activates the immutable SiteForge theme synchronized by P11.
 */
add_action( 'plugins_loaded', function () {
\t$target = '${remoteThemeSlug.replace(/[^a-z0-9_-]/gi, '')}';
\tif ( get_stylesheet() !== $target && wp_get_theme( $target )->exists() ) {
\t\tswitch_theme( $target );
\t}
} );
`
        await writeFile(
          sftp,
          `${muPluginDirectory}/siteforge-theme-activator.php`,
          Buffer.from(activator)
        )
      }
      await input.onProgress?.('Premium SiteForge theme files synchronized.')
    } finally {
      client.end()
    }
  }

  async ensureInstalled(input: WordPressInstallerInput): Promise<void> {
    const themeArchivePath =
      input.themeArchivePath ||
      path.resolve(process.cwd(), 'runtime-assets/oneclick-siteforge.zip')
    const acfProArchivePath =
      input.acfProArchivePath ||
      path.resolve(
        process.cwd(),
        'runtime-assets/advanced-custom-fields-pro.zip'
      )
    const runtimePluginArchivePath =
      input.runtimePluginArchivePath ||
      path.resolve(
        process.cwd(),
        'runtime-assets/oneclick-siteforge-runtime.zip'
      )
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const sftpApplicationRoot = input.ssh.sftpApplicationRoot || applicationRoot
    const [themeArchive, acfProArchive, runtimePluginArchive] =
      await Promise.all([
        readFile(themeArchivePath),
        readFile(acfProArchivePath),
        readFile(runtimePluginArchivePath),
      ])
    if (
      themeArchive.length < 100 ||
      themeArchive[0] !== 0x50 ||
      themeArchive[1] !== 0x4b
    ) {
      throw new Error('SiteForge theme archive is missing or invalid')
    }
    if (
      acfProArchive.length < 100 ||
      acfProArchive[0] !== 0x50 ||
      acfProArchive[1] !== 0x4b
    ) {
      throw new Error('ACF Pro archive is missing or invalid')
    }
    if (
      runtimePluginArchive.length < 100 ||
      runtimePluginArchive[0] !== 0x50 ||
      runtimePluginArchive[1] !== 0x4b
    ) {
      throw new Error('SiteForge runtime plugin archive is missing or invalid')
    }
    const remoteThemeArchivePath = `${sftpApplicationRoot}/oneclick-siteforge.zip`
    const remoteAcfArchivePath = `${sftpApplicationRoot}/advanced-custom-fields-pro.zip`
    const remoteRuntimePluginArchivePath = `${sftpApplicationRoot}/oneclick-siteforge-runtime.zip`

    await input.onProgress?.('Connecting to WordPress application over SSH...')
    const client = await connect(input.ssh)
    try {
      const sftp = await getSftp(client)
      await input.onProgress?.(
        'Uploading private ACF Pro and signed SiteForge theme archives...'
      )
      await mkdir(sftp, sftpApplicationRoot)
      await Promise.all([
        removeFileIfExists(sftp, remoteThemeArchivePath),
        removeFileIfExists(sftp, remoteAcfArchivePath),
        removeFileIfExists(sftp, remoteRuntimePluginArchivePath),
      ])
      await Promise.all([
        writeFile(sftp, remoteThemeArchivePath, themeArchive),
        writeFile(sftp, remoteAcfArchivePath, acfProArchive),
        writeFile(sftp, remoteRuntimePluginArchivePath, runtimePluginArchive),
      ])

      await input.onProgress?.('Installing ACF Pro and activating the theme...')
      const wpRoot = shellQuote(applicationRoot)
      const acfArchive = shellQuote('advanced-custom-fields-pro.zip')
      const acfLicense = shellQuote(input.acfProLicenseKey)
      const themeArchiveName = shellQuote('oneclick-siteforge.zip')
      const runtimePluginArchiveName = shellQuote(
        'oneclick-siteforge-runtime.zip'
      )
      await exec(
        client,
        [
          `cd ${wpRoot}`,
          'wp core is-installed',
          `wp plugin install ${acfArchive} --force`,
          'wp plugin activate advanced-custom-fields-pro',
          `wp plugin install ${runtimePluginArchiveName} --force`,
          'wp plugin activate oneclick-siteforge-runtime',
          `wp config set ACF_PRO_LICENSE ${acfLicense} --type=constant`,
          `wp theme install ${themeArchiveName} --force`,
          'rm -f wp-content/mu-plugins/siteforge-theme-activator.php',
          'wp theme activate oneclick-siteforge',
          'wp rewrite structure /%postname%/ --hard',
          'wp rewrite flush --hard',
          `rm -f ${themeArchiveName} ${acfArchive} ${runtimePluginArchiveName}`,
        ].join(' && ')
      )
    } finally {
      client.end()
    }
  }
}
