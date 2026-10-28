import type { StoredWordPressCredential } from '@/utils/siteforge/wordpress/credential-vault'
import type { WordPressSshCredentials } from '@/utils/siteforge/wordpress/wordpress-installer'
import { PackageError } from './contracts'

type Destination={url:string;serverId:string;applicationId:string}
type Application={id:string|number;server_id?:string|number;app_fqdn:string;sys_user?:string;master_user?:string;public_ip?:string}
export async function resolveDestinationSsh(target:Destination,credential:StoredWordPressCredential,privateKey:string|undefined,lookup:()=>Promise<Application>):Promise<WordPressSshCredentials>{
  if(credential.provider!=='cloudways'||credential.providerMetadata?.applicationId!==target.applicationId||credential.providerMetadata.serverId!==target.serverId||credential.url.replace(/\/$/,'')!==target.url.replace(/\/$/,''))throw new PackageError('The saved WordPress credentials do not match this destination.',409)
  if(privateKey?.trim()){
    const app=await lookup()
    const hostname=app.app_fqdn.replace(/^https?:\/\//,'').replace(/\/$/,'')
    if(String(app.id)!==target.applicationId||String(app.server_id)!==target.serverId||hostname!==new URL(target.url).hostname||!app.master_user||!app.public_ip||!app.sys_user||!/^[a-zA-Z0-9_-]+$/.test(app.sys_user))throw new PackageError('Cloudways could not verify the exact selected WordPress application.',409)
    return {host:app.public_ip,port:22,username:app.master_user,privateKey:privateKey.replace(/\\n/g,'\n'),applicationRoot:`/home/master/applications/${app.sys_user}/public_html`,sftpApplicationRoot:`/applications/${app.sys_user}/public_html`}
  }
  if(!credential.ssh?.applicationRoot||!credential.ssh.sftpApplicationRoot)throw new PackageError('This WordPress connection is missing its verified SSH and SFTP paths. Reconnect the destination.',409)
  return credential.ssh
}
