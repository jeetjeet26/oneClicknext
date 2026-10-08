// Opt-in disposable local WordPress qualification. SSH transport is replaced with Docker exec;
// the install, backup, activation, readback and file-integrity commands run in real WordPress.
import {describe,it,expect,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {Writable} from 'node:stream'
import {spawn,execFileSync} from 'node:child_process'
import {readFileSync,readdirSync,writeFileSync,mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID,createHash} from 'node:crypto'
import {zipSync,unzipSync} from 'fflate'
const fixture=vi.hoisted(()=>({docker:'/Applications/Docker.app/Contents/Resources/bin/docker',container:'p11-astra-qualification-wp'}))
vi.mock('ssh2',()=>({Client:class extends EventEmitter{
 connect(){queueMicrotask(()=>this.emit('ready'));return this}end(){}
 exec(command:string,callback:(error:Error|null, result:EventEmitter&{stderr:EventEmitter})=>void){const channel=new EventEmitter()as EventEmitter&{stderr:EventEmitter};channel.stderr=new EventEmitter();callback(null,channel);const p=spawn(fixture.docker,['exec','-e','WP_CLI_ALLOW_ROOT=1',fixture.container,'sh','-c',command]);p.stdout.on('data',d=>channel.emit('data',d));p.stderr.on('data',d=>channel.stderr.emit('data',d));p.on('close',code=>channel.emit('close',code))}
 sftp(callback:(error:Error|null, result:{createWriteStream:(destination:string)=>Writable})=>void){callback(null,{createWriteStream:(destination:string)=>new Writable({write(chunk,_encoding,done){const dir=mkdtempSync(join(tmpdir(),'p11-upload-'));const file=join(dir,'theme.zip');writeFileSync(file,chunk);try{execFileSync(fixture.docker,['cp',file,`${fixture.container}:${destination}`]);done()}catch(e){done(e as Error)}}})})}
}}))
import {SshWordPressInstaller}from '@/utils/siteforge/wordpress/wordpress-installer'
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const wp=(command:string)=>execFileSync(fixture.docker,['exec','-e','WP_CLI_ALLOW_ROOT=1',fixture.container,'sh','-c','cd /var/www/html && '+command],{encoding:'utf8'})
describe.skipIf(process.env.P11_DELIVERY_RUNTIME!=='1')('disposable WordPress package delivery',()=>{
 it('backs up, installs, verifies, detects changed files, and restores the prior database',async()=>{
  const id=randomUUID(),slug='p11-astra-'+id.replaceAll('-','').slice(0,24),root='/private/tmp/p11-astra-wordpress-preview/website',files:Record<string,Uint8Array>={};
  function walk(dir:string,relative=''){for(const e of readdirSync(dir,{withFileTypes:true})){const r=relative+e.name;if(e.isDirectory())walk(join(dir,e.name),r+'/');else files[slug+'/'+r]=readFileSync(join(dir,e.name))}}walk(root)
  const pages=['home','residences','amenities','gallery','contact'].map(slug=>({slug,title:slug,contentFile:`website/content/${slug}.html`,floorplanIds:[]}));
  files[slug+'/siteforge-content.json']=Buffer.from(JSON.stringify({version:1,title:'Complete site qualification',pages}));
  for(const page of pages)files[slug+'/content/'+page.slug+'.html']=Buffer.from(`<h1>${page.title}</h1><p>Complete native page content with <a href="{{SITE_URL}}/residences/">residences</a>.</p>`);
  const archive=zipSync(files),checksums=Object.fromEntries(Object.entries(unzipSync(archive)).map(([n,b])=>['wp-content/themes/'+n,hash(b)]));
  const expectedUrl=wp('wp option get home --skip-plugins --skip-themes').trim(),installer=new SshWordPressInstaller(),ssh={host:'local-test',username:'fixture',password:'fixture',applicationRoot:'/var/www/html',sftpApplicationRoot:'/var/www/html'};
  let backup='';try{
   const r=await installer.installGeneratedPackage({ssh,archive:Buffer.from(archive),archiveHash:hash(archive),slug,releaseId:id,packageHash:hash(archive),expectedUrl,preview:true,checksums,installContent:true});backup=r.backup;expect(r.theme).toBe(slug);expect(wp('wp option get blog_public --skip-plugins --skip-themes').trim()).toBe('0');
   expect(wp('wp option get blogname --skip-plugins --skip-themes').trim()).toBe('Complete site qualification');
   const homepage=wp('wp option get page_on_front --skip-plugins --skip-themes').trim();
   expect(wp(`wp post get ${homepage} --field=post_content --skip-plugins --skip-themes`)).toContain(expectedUrl+'/residences/');
   for(const page of pages)expect(wp(`wp post list --post_type=page --name=${page.slug} --post_status=publish --format=count --skip-plugins --skip-themes`).trim()).toBe('1');
   const verification={ssh,releaseId:id,packageHash:hash(archive),theme:slug,expectedUrl,checksums};await installer.verifyGeneratedPackage(verification);
   wp(`printf '\\n/* changed */\\n' >> wp-content/themes/${slug}/style.css`);await expect(installer.verifyGeneratedPackage(verification)).rejects.toThrow('Preview files changed');
  }finally{if(backup)wp(`wp db import '${backup}' --skip-plugins --skip-themes`)}
 },180000)
})
