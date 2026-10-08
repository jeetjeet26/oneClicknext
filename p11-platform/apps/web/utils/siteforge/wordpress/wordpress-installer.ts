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
  reuseInstalledAcfPro?: boolean
  onProgress?: (step: string) => void | Promise<void>
}

export interface PreparedWordPressInstallerArchives {
  themeArchive: Buffer
  acfProArchive: Buffer | null
  runtimePluginArchive: Buffer
  themeArchiveSha256: string
  runtimePluginArchiveSha256: string
}

export interface WordPressActiveTheme {
  stylesheet: string
  template: string
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
      input.reuseInstalledAcfPro
        ? Promise.resolve(null)
        : readFile(acfProArchivePath),
      input.runtimePluginArchive
        ? Promise.resolve(Buffer.from(input.runtimePluginArchive))
        : readFile(runtimePluginArchivePath),
    ])
  assertZipArchive(themeArchive, 'SiteForge theme')
  if (acfProArchive) assertZipArchive(acfProArchive, 'ACF Pro')
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
  /** Install an immutable generated theme on an explicitly selected WordPress app. */
  async installGeneratedPackage(input: {
    ssh: WordPressSshCredentials; archive: Buffer; archiveHash: string;
    slug: string; releaseId: string; packageHash: string; expectedUrl: string; preview: boolean;
    checksums: Record<string,string>; installContent?: boolean;
  }): Promise<{ theme: string; previousTheme: string; backup: string; url: string }> {
    if (!/^p11-astra-[a-f0-9]{24}$/.test(input.slug) || !/^[a-f0-9-]{36}$/.test(input.releaseId) ||
      !/^[a-f0-9]{64}$/.test(input.packageHash) || sha256(input.archive) !== input.archiveHash) throw new Error('Invalid generated theme identity');
    const root = input.ssh.applicationRoot;
    if (!root || !input.ssh.sftpApplicationRoot) throw new Error('Explicit WordPress and SFTP application paths are required');
    const client = await connect(input.ssh);
    const timer = setTimeout(() => client.end(), 180_000);
    const wp = (command: string) => exec(client, `cd ${shellQuote(root)} && ${command}`);
    const archiveName = `.p11-${input.releaseId}.zip`;
    try {
      await wp('wp core is-installed --skip-plugins --skip-themes');
      const actualUrl = (await wp('wp option get home --skip-plugins --skip-themes')).trim().replace(/\/$/, '');
      if (actualUrl !== input.expectedUrl.replace(/\/$/, '')) throw new Error('WordPress URL does not match the selected destination');
      const previousTheme = (await wp('wp option get stylesheet --skip-plugins --skip-themes')).trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(previousTheme)) throw new Error('Previous theme identity is invalid');
      // Backup is outside public_html and private to the application user. Never return DB contents.
      const home = (await exec(client, `printf '%s' "$HOME"`)).trim();
      if (!home.startsWith('/') || home === '/' || home.includes('/public_html')) throw new Error('Private backup home is unavailable');
      const backupDirectory = `${home}/.p11-package-backups`;
      const backup = `${backupDirectory}/${input.releaseId}.sql`;
      await wp(`umask 077 && mkdir -p ${shellQuote(backupDirectory)} && test ! -e ${shellQuote(backup)} && wp db export ${shellQuote(backup)} --skip-plugins --skip-themes`);
      const sftp = await getSftp(client);
      await writeFile(sftp, `${input.ssh.sftpApplicationRoot}/${archiveName}`, input.archive);
      await wp(`printf '%s  %s\\n' ${shellQuote(input.archiveHash)} ${shellQuote(archiveName)} | sha256sum -c -`);
      // Each attempt uses a new folder; existing themes and manual edits are not overwritten.
      await wp(`test ! -e ${shellQuote('wp-content/themes/' + input.slug)} && wp theme install ${shellQuote(archiveName)} --skip-plugins --skip-themes`);
      await wp(`find ${shellQuote('wp-content/themes/' + input.slug)} -type f -name '*.php' -exec php -l {} \\;`);
      if (input.preview) await wp('wp option update blog_public 0 --skip-plugins --skip-themes');
      await wp(`wp theme activate ${shellQuote(input.slug)}`);
      if(input.installContent){
        const contentScheme = new URL(input.expectedUrl).protocol === 'https:' ? 'https' : 'http';
        const importer = "$scheme='" + contentScheme + "';$release=" + "'" + input.releaseId + "';" + "$dir=get_stylesheet_directory();$manifest=json_decode(file_get_contents($dir.'/siteforge-content.json'),true);if(!is_array($manifest)||count($manifest['pages']??[])<5)throw new Exception('Complete page manifest required');$ids=[];foreach($manifest['pages'] as $page){$slug=$page['slug'];if(!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/',$slug))throw new Exception('Invalid page');$old=get_page_by_path($slug,OBJECT,'page');if($old&&get_post_meta($old->ID,'_p11_package_release',true)===$release){$ids[$slug]=$old->ID;continue;}if($old){$result=wp_update_post(['ID'=>$old->ID,'post_name'=>'p11-previous-'.$old->ID.'-'.substr($release,0,8),'post_status'=>'draft'],true);if(is_wp_error($result))throw new Exception('Could not preserve previous page');}$id=wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_name'=>$slug,'post_title'=>$page['title'],'comment_status'=>'closed','ping_status'=>'closed','meta_input'=>['_p11_package_release'=>$release]],true);if(is_wp_error($id))throw new Exception('Page creation failed');$ids[$slug]=$id;}foreach($manifest['pages'] as $page){$file=$page['contentFile'];if(!preg_match('#^website/content/[a-z0-9-]+\\.html$#',$file))throw new Exception('Invalid content path');$content=file_get_contents($dir.'/'.substr($file,8));$content=str_replace(['{{SITE_URL}}','{{THEME_URL}}'],[untrailingslashit(home_url('',$scheme)),untrailingslashit(set_url_scheme(get_stylesheet_directory_uri(),$scheme))],$content);$result=wp_update_post(wp_slash(['ID'=>$ids[$page['slug']],'post_content'=>wp_kses_post($content)]),true);if(is_wp_error($result))throw new Exception('Content import failed');}update_option('page_on_front',$ids['home']);update_option('show_on_front','page');update_option('blogname',$manifest['title']);update_option('permalink_structure','/%postname%/');echo wp_json_encode($ids);\n";
        await wp(`wp eval ${shellQuote(importer)} --skip-plugins`);
      }
      await wp('wp rewrite flush');
      // Importing with plugins skipped avoids side effects, but bypasses cache invalidation hooks.
      // Clear only this WordPress site's Breeze cache before checking the public pages.
      const hasBreeze = (await wp("wp eval 'echo class_exists(\"Breeze_WP_Cli_Core\") ? \"yes\" : \"no\";' --skip-themes")).trim();
      if (hasBreeze === 'yes') {
        const blogId = (await wp("wp eval 'echo is_multisite() ? get_current_blog_id() : 0;' --skip-plugins --skip-themes")).trim();
        if (!/^(0|[1-9][0-9]*)$/.test(blogId)) throw new Error('WordPress cache scope is unavailable');
        await wp(`wp breeze purge --cache=all${blogId === '0' ? '' : ` --level=${blogId}`} --skip-themes`);
      }
      const active = (await wp('wp option get stylesheet --skip-plugins --skip-themes')).trim();
      if (active !== input.slug) throw new Error('Activated theme could not be verified');
      const receipt = { releaseId: input.releaseId, packageHash: input.packageHash, theme: input.slug, previousTheme, backup, url: actualUrl };
      await wp(`wp option update p11_astra_release ${shellQuote(JSON.stringify(receipt))} --format=json --skip-plugins --skip-themes`);
      return receipt;
    } finally {
      await wp(`rm -f ${shellQuote(archiveName)}`).catch(() => undefined);
      clearTimeout(timer); client.end();
    }
  }

  async verifyGeneratedPackage(input: {ssh: WordPressSshCredentials; releaseId: string; packageHash: string; theme: string; expectedUrl: string; checksums: Record<string,string>}): Promise<Record<string,unknown>> {
    if (!input.ssh.applicationRoot) throw new Error('WordPress path is missing');
    const client = await connect(input.ssh);
    const timer = setTimeout(() => client.end(), 30_000);
    try {
      const command = `cd ${shellQuote(input.ssh.applicationRoot)} && wp option get p11_astra_release --format=json --skip-plugins --skip-themes && wp option get stylesheet --skip-plugins --skip-themes && wp option get home --skip-plugins --skip-themes`;
      const lines = (await exec(client, command)).trim().split('\n');
      const expected = Buffer.from(JSON.stringify(input.checksums)).toString('base64');
      const verify = `$files=json_decode(base64_decode('${expected}'),true);foreach($files as $file=>$hash){if(!is_file($file)||hash_file('sha256',$file)!==$hash){fwrite(STDERR,'Preview files changed');exit(1);}}`;
      await exec(client, `cd ${shellQuote(input.ssh.applicationRoot)} && php -r ${shellQuote(verify)}`);
      const marker = JSON.parse(lines[0]);
      if (marker.releaseId !== input.releaseId || marker.packageHash !== input.packageHash || marker.theme !== input.theme || lines[1] !== input.theme || lines[2]?.replace(/\/$/, '') !== input.expectedUrl.replace(/\/$/, '')) throw new Error('The preview changed. Create and review a fresh preview.');
      const fingerprintPhp = `global $wpdb; $data=array(); $data['posts']=$wpdb->get_results("SELECT ID,post_type,post_status,post_title,post_name,post_content,post_excerpt,post_parent,menu_order FROM {$wpdb->posts} WHERE post_type <> 'revision' ORDER BY ID",ARRAY_A); $data['meta']=$wpdb->get_results("SELECT post_id,meta_key,meta_value FROM {$wpdb->postmeta} WHERE meta_key NOT IN ('_edit_lock','_edit_last') ORDER BY post_id,meta_key,meta_id",ARRAY_A); $data['options']=$wpdb->get_results("SELECT option_name,option_value FROM {$wpdb->options} WHERE option_name IN ('blogname','blogdescription','show_on_front','page_on_front','page_for_posts','permalink_structure','sidebars_widgets') OR option_name LIKE 'theme_mods_%' OR option_name LIKE 'widget_%' ORDER BY option_name",ARRAY_A); $data['terms']=$wpdb->get_results("SELECT * FROM {$wpdb->terms} ORDER BY term_id",ARRAY_A); $data['taxonomies']=$wpdb->get_results("SELECT * FROM {$wpdb->term_taxonomy} ORDER BY term_taxonomy_id",ARRAY_A); $data['relationships']=$wpdb->get_results("SELECT * FROM {$wpdb->term_relationships} ORDER BY object_id,term_taxonomy_id",ARRAY_A); echo hash('sha256',wp_json_encode($data));`;
      const contentHash=(await exec(client,`cd ${shellQuote(input.ssh.applicationRoot)} && wp eval ${shellQuote(fingerprintPhp)} --skip-plugins --skip-themes`)).trim();
      if(!/^[a-f0-9]{64}$/.test(contentHash))throw new Error('WordPress content fingerprint unavailable');
      return {theme:marker.theme,previousTheme:marker.previousTheme,backup:marker.backup,url:marker.url,contentHash};
    } finally { clearTimeout(timer); client.end(); }
  }

  async productionVisibility(ssh:WordPressSshCredentials,restore?:'0'|'1'):Promise<'0'|'1'>{
    if(!ssh.applicationRoot)throw new Error('WordPress path required');const client=await connect(ssh);const timer=setTimeout(()=>client.end(),30000);
    try{const prefix=`cd ${shellQuote(ssh.applicationRoot)} && `;if(restore!==undefined)await exec(client,prefix+`wp option update blog_public ${restore} --skip-plugins --skip-themes`);const value=(await exec(client,prefix+'wp option get blog_public --skip-plugins --skip-themes')).trim();if(value!=='0'&&value!=='1')throw new Error('Search visibility unavailable');return value;}finally{clearTimeout(timer);client.end();}
  }

  async getActiveTheme(input: {
    ssh: WordPressSshCredentials
    rememberForRollback?: boolean
    requireStylesheetCss?: boolean
  }): Promise<WordPressActiveTheme> {
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const remember = input.rememberForRollback !== false
      ? "update_option('oneclick_siteforge_runtime_pending_theme_v3', $theme, false);"
      : ''
    const verifyCss = input.requireStylesheetCss
      ? "$loaded = false; do_action('wp_enqueue_scripts'); foreach (wp_styles()->queue as $handle) { $registered = wp_styles()->registered[$handle] ?? null; $src = $registered ? (string) $registered->src : ''; if (false !== strpos($src, '/themes/' . $theme['stylesheet'] . '/') && false !== strpos($src, '.css')) { $loaded = true; break; } } if (!$loaded) { throw new Exception('Active child-theme CSS readback failed'); }"
      : ''
    const client = await connect(input.ssh)
    try {
      const output = await exec(
        client,
        `cd ${shellQuote(applicationRoot)} && wp eval ${shellQuote(
          `$theme = array('stylesheet' => get_stylesheet(), 'template' => get_template()); ${remember} ${verifyCss} echo wp_json_encode($theme);`
        )}`
      )
      const theme = JSON.parse(output.trim()) as Partial<WordPressActiveTheme>
      if (
        !theme.stylesheet ||
        !theme.template ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(theme.stylesheet) ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(theme.template)
      ) {
        throw new Error('WordPress returned an invalid active theme identity')
      }
      return {
        stylesheet: theme.stylesheet,
        template: theme.template,
      }
    } finally {
      client.end()
    }
  }

  async restoreActiveTheme(input: {
    ssh: WordPressSshCredentials
    theme: WordPressActiveTheme
  }): Promise<void> {
    const { stylesheet, template } = input.theme
    if (
      !/^[a-z0-9][a-z0-9_-]*$/.test(stylesheet) ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(template)
    ) {
      throw new Error('Prior WordPress theme identity is invalid')
    }
    const applicationRoot = input.ssh.applicationRoot || 'public_html'
    const verify = `$stylesheet = ${JSON.stringify(stylesheet)}; $template = ${JSON.stringify(template)}; if (get_stylesheet() !== $stylesheet || get_template() !== $template) { throw new Exception('Prior active theme readback mismatch'); } delete_option('oneclick_siteforge_runtime_pending_theme_v3');`
    const client = await connect(input.ssh)
    try {
      await exec(
        client,
        [
          `cd ${shellQuote(applicationRoot)}`,
          `wp theme activate ${shellQuote(stylesheet)}`,
          `wp eval ${shellQuote(verify)}`,
        ].join(' && ')
      )
    } finally {
      client.end()
    }
  }

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
      const verify = `$stylesheet = ${JSON.stringify(overlaySlug)}; if (get_stylesheet() !== $stylesheet || get_template() !== 'oneclick-siteforge') { throw new Exception('Overlay active theme readback mismatch'); } do_action('wp_enqueue_scripts'); $loaded = false; foreach (wp_styles()->queue as $handle) { $registered = wp_styles()->registered[$handle] ?? null; $src = $registered ? (string) $registered->src : ''; if (false !== strpos($src, '/themes/' . $stylesheet . '/') && false !== strpos($src, '.css')) { $loaded = true; break; } } if (!$loaded) { throw new Exception('Overlay CSS was not loaded from the active child theme'); }`
      await exec(
        client,
        [
          `cd ${shellQuote(applicationRoot)}`,
          `rm -rf ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `mkdir -p ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `unzip -oq ${shellQuote(`${overlaySlug}.zip`)} -d ${shellQuote(`wp-content/themes/${overlaySlug}`)}`,
          `wp theme activate ${shellQuote(overlaySlug)}`,
          `wp eval ${shellQuote(verify)}`,
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
        ...(acfProArchive
          ? [removeFileIfExists(sftp, remoteAcfArchivePath)]
          : []),
        removeFileIfExists(sftp, remoteRuntimePluginArchivePath),
      ])
      await Promise.all([
        writeFile(sftp, remoteThemeArchivePath, themeArchive),
        ...(acfProArchive
          ? [writeFile(sftp, remoteAcfArchivePath, acfProArchive)]
          : []),
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
          ...(acfProArchive
            ? [`wp plugin install ${acfArchive} --force`]
            : []),
          'wp plugin activate advanced-custom-fields-pro',
          `wp plugin install ${runtimePluginArchiveName} --force`,
          'wp plugin activate oneclick-siteforge-runtime',
          `wp config set ACF_PRO_LICENSE ${acfLicense} --type=constant`,
          `wp theme install ${themeArchiveName} --force`,
          'rm -f wp-content/mu-plugins/siteforge-theme-activator.php',
          'wp theme activate oneclick-siteforge',
          'wp rewrite structure /%postname%/ --hard',
          'wp rewrite flush --hard',
          `rm -f ${themeArchiveName} ${
            acfProArchive ? acfArchive : ''
          } ${runtimePluginArchiveName}`,
        ].join(' && ')
      )
    } finally {
      client.end()
    }
  }
}
