import { Client, type SFTPWrapper } from 'ssh2'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  inspectSiteForgeRuntimeV3Package,
  type VerifiedRuntimeV3PackageIdentity,
} from '@/utils/siteforge/artifacts/release'

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
  runtimeContractVersion?: 1 | 2 | 3
  themeArchive?: Buffer
  themeArchivePath?: string
  runtimePluginArchive?: Buffer
  runtimePluginArchivePath?: string
  runtimePluginIdentity?: VerifiedRuntimeV3PackageIdentity
  acfProArchivePath?: string
  acfProLicenseKey: string
  onProgress?: (step: string) => void | Promise<void>
}

export interface PreparedWordPressInstallerArchives {
  themeArchive: Buffer
  acfProArchive: Buffer
  runtimePluginArchive: Buffer
  themeArchiveSha256: string
  runtimePluginArchiveSha256: string
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertZipArchive(archive: Buffer, label: string): void {
  if (
    archive.length < 100 ||
    archive[0] !== 0x50 ||
    archive[1] !== 0x4b
  ) {
    throw new Error(`${label} archive is missing or invalid`)
  }
}

export async function prepareWordPressInstallerArchives(
  input: Omit<WordPressInstallerInput, 'ssh' | 'acfProLicenseKey' | 'onProgress'>
): Promise<PreparedWordPressInstallerArchives> {
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
  if (
    input.runtimeContractVersion === 3 &&
    (!input.runtimePluginArchive || !input.runtimePluginIdentity)
  ) {
    throw new Error(
      'SiteForge runtime v3 installation requires exact verified package bytes and identity'
    )
  }
  const [themeArchive, acfProArchive, runtimePluginArchive] =
    await Promise.all([
      input.themeArchive
        ? Promise.resolve(Buffer.from(input.themeArchive))
        : readFile(themeArchivePath),
      readFile(acfProArchivePath),
      input.runtimePluginArchive
        ? Promise.resolve(Buffer.from(input.runtimePluginArchive))
        : readFile(runtimePluginArchivePath),
    ])
  assertZipArchive(themeArchive, 'SiteForge theme')
  assertZipArchive(acfProArchive, 'ACF Pro')
  assertZipArchive(runtimePluginArchive, 'SiteForge runtime plugin')

  if (input.runtimePluginIdentity) {
    inspectSiteForgeRuntimeV3Package(runtimePluginArchive, {
      packageId: input.runtimePluginIdentity.packageId,
      packageVersion: input.runtimePluginIdentity.packageVersion,
      archiveSha256: input.runtimePluginIdentity.archiveSha256,
      manifestSha256: input.runtimePluginIdentity.manifestSha256,
      manifest: input.runtimePluginIdentity.manifest,
      signingKeyId: input.runtimePluginIdentity.signingKeyId,
    })
  }
  return {
    themeArchive,
    acfProArchive,
    runtimePluginArchive,
    themeArchiveSha256: sha256(themeArchive),
    runtimePluginArchiveSha256: sha256(runtimePluginArchive),
  }
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

export async function createWordPressApplicationPassword(
  input: {
    ssh: WordPressSshCredentials
    label?: string
  },
  runCommand?: (
    ssh: WordPressSshCredentials,
    command: string
  ) => Promise<string>
): Promise<{ username: string; applicationPassword: string }> {
  const applicationRoot = input.ssh.applicationRoot || 'public_html'
  const label = input.label || 'siteforge-deploy'
  const command = [
    `cd ${shellQuote(applicationRoot)}`,
    'admin_user="$(wp user list --role=administrator --field=user_login | head -n 1)"',
    'test -n "$admin_user"',
    'printf \'%s\\n\' "$admin_user"',
    `wp user application-password create "$admin_user" ${shellQuote(label)} --porcelain`,
  ].join(' && ')
  let output: string
  if (runCommand) {
    output = await runCommand(input.ssh, command)
  } else {
    const client = await connect(input.ssh)
    try {
      output = await exec(client, command)
    } finally {
      client.end()
    }
  }
  const [username, applicationPassword] = output
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
  if (!username || !applicationPassword) {
    throw new Error(
      'WordPress did not return an administrator and application password'
    )
  }
  if (applicationPassword.replace(/\s/g, '').length < 24) {
    throw new Error('WordPress returned an invalid application password')
  }
  return { username, applicationPassword }
}

export async function resetWordPressRuntimeV3State(
  input: {
    ssh: WordPressSshCredentials
    siteId: string
  },
  runCommand?: (
    ssh: WordPressSshCredentials,
    command: string
  ) => Promise<string>
): Promise<void> {
  const applicationRoot = input.ssh.applicationRoot || 'public_html'
  const siteId = input.siteId.replace(/[^A-Za-z0-9._:-]/g, '')
  if (!siteId) {
    throw new Error('Runtime v3 reset requires an exact site identity')
  }
  const php = `
$site_id = ${JSON.stringify(siteId)};
$pages = get_posts(array(
  'post_type' => 'page',
  'post_status' => 'any',
  'numberposts' => -1,
  'meta_key' => '_siteforge_v3_site_id',
  'meta_value' => $site_id,
));
foreach ($pages as $page) {
  wp_delete_post($page->ID, true);
}
$owners = get_option('oneclick_siteforge_runtime_menu_owners_v3', array());
foreach (is_array($owners) ? $owners : array() as $owner) {
  if (is_array($owner) && isset($owner['siteId'], $owner['menuId']) && $owner['siteId'] === $site_id) {
    wp_delete_nav_menu((int) $owner['menuId']);
  }
}
$preparations = get_option('oneclick_siteforge_runtime_asset_preparations_v3', array());
foreach (is_array($preparations) ? $preparations : array() as $preparation) {
  foreach (is_array($preparation) && isset($preparation['assets']) && is_array($preparation['assets']) ? $preparation['assets'] : array() as $asset) {
    if (is_array($asset) && !empty($asset['attachmentId'])) {
      wp_delete_attachment((int) $asset['attachmentId'], true);
    }
  }
}
$options = array(
  'oneclick_siteforge_runtime_state_v3',
  'oneclick_siteforge_runtime_v2_projection_v3',
  'oneclick_siteforge_runtime_transactions_v3',
  'oneclick_siteforge_runtime_idempotency_v3',
  'oneclick_siteforge_runtime_deployment_lock_v3',
  'oneclick_siteforge_runtime_asset_preparations_v3',
  'oneclick_siteforge_runtime_resource_ids_v3',
  'oneclick_siteforge_runtime_menu_owners_v3',
  'oneclick_siteforge_forms_v3',
  'oneclick_siteforge_redirects_v3',
  'oneclick_siteforge_integrations_v3',
  'oneclick_siteforge_legal_v3',
  'oneclick_siteforge_seo_v3',
  'oneclick_siteforge_responsive_css_v3'
);
$resource_names = array(
  'graphVersion',
  'homepagePageId',
  'pages',
  'sections',
  'globalComponents',
  'chrome',
  'forms',
  'redirects',
  'responsiveRules',
  'accessibilityAnnotations',
  'seo',
  'legal',
  'analytics',
  'integrations',
  'assets',
  'removals',
  'target'
);
foreach ($resource_names as $resource_name) {
  $options[] = 'oneclick_siteforge_runtime_resource_v3_' . $resource_name;
}
foreach ($options as $option) {
  delete_option($option);
}
update_option('stylesheet', 'oneclick-siteforge');
update_option('template', 'oneclick-siteforge');
delete_option('current_theme');
wp_cache_flush();
`
  const command = `cd ${shellQuote(applicationRoot)} && wp eval ${shellQuote(php)}`
  if (runCommand) {
    await runCommand(input.ssh, command)
    return
  }
  const client = await connect(input.ssh)
  try {
    await exec(client, command)
  } finally {
    client.end()
  }
}

export class SshWordPressInstaller {
  async installBaseTheme(input: {
    ssh: WordPressSshCredentials
    archive: Buffer
    packageSha256: string
    onProgress?: (step: string) => void | Promise<void>
  }): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(input.packageSha256)) {
      throw new Error('Base theme package digest is invalid')
    }
    assertZipArchive(input.archive, 'SiteForge base theme')
    if (sha256(input.archive) !== input.packageSha256) {
      throw new Error('SiteForge base theme package digest mismatch')
    }
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const sftpApplicationRoot = input.ssh.sftpApplicationRoot || applicationRoot
    const archiveName = `oneclick-siteforge-${input.packageSha256.slice(0, 12)}.zip`
    const remoteArchive = `${sftpApplicationRoot}/${archiveName}`
    await input.onProgress?.('Installing the exact SiteForge base theme...')
    const client = await connect(input.ssh)
    try {
      const sftp = await getSftp(client)
      await removeFileIfExists(sftp, remoteArchive)
      await writeFile(sftp, remoteArchive, input.archive)
      await exec(
        client,
        [
          `cd ${shellQuote(applicationRoot)}`,
          `printf '%s  %s\\n' ${shellQuote(input.packageSha256)} ${shellQuote(archiveName)} | sha256sum -c -`,
          `wp theme install ${shellQuote(archiveName)} --force`,
          'wp theme activate oneclick-siteforge',
          `rm -f ${shellQuote(archiveName)}`,
        ].join(' && ')
      )
      await input.onProgress?.('Exact SiteForge base theme activated.')
    } finally {
      client.end()
    }
  }

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
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const sftpApplicationRoot = input.ssh.sftpApplicationRoot || applicationRoot
    const {
      themeArchive,
      acfProArchive,
      runtimePluginArchive,
      themeArchiveSha256,
      runtimePluginArchiveSha256,
    } = await prepareWordPressInstallerArchives(input)
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
          `printf '%s  %s\\n' ${shellQuote(themeArchiveSha256)} ${themeArchiveName} | sha256sum -c -`,
          `printf '%s  %s\\n' ${shellQuote(runtimePluginArchiveSha256)} ${runtimePluginArchiveName} | sha256sum -c -`,
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
