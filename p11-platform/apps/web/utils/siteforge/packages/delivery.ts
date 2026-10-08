import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { zipSync } from 'fflate'
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/utils/supabase/config'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import { createServiceClient } from '@/utils/supabase/admin'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { SshWordPressInstaller } from '@/utils/siteforge/wordpress/wordpress-installer'
import { CloudwaysProviderClient,getCloudwaysProviderCredentials,assertStagingApplicationParent } from '@/utils/siteforge/providers/cloudways-provider'
import { safePublicFetch } from '@/utils/services/safe-public-fetch'
import { getPackageJob, packageDb } from './store'
import { PackageError } from './contracts'
import { loadPackageSource, sha256, stableJson } from './source'
import { unpackPackage } from './archive'
import { readWebsitePlan,verifyWebsite } from './quality'
export type TargetSnapshot={id:string;websiteId:string;type:string;url:string;credentialRef:string;serverId:string;applicationId:string}
export type Release={id:string;job_id:string;property_id:string;org_id:string;actor_id:string;kind:'preview'|'approve'|'deploy';state:'running'|'succeeded'|'uncertain';package_hash:string;target_id:string;target_snapshot:TargetSnapshot;preview_id:string|null;approval_id:string|null;receipt:Record<string,unknown>;created_at:string;updated_at:string}
type DB={public:{Tables:{siteforge_package_releases:{Row:Release;Insert:Omit<Release,'created_at'|'updated_at'>;Update:Partial<Release>;Relationships:[]}};Views:Record<string,never>;Functions:Record<string,never>}}
const db=()=>createClient<DB>(getSupabaseUrl(),getSupabaseServiceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}})
export async function deliveryView(propertyId:string){
 const [targets,history]=await Promise.all([createServiceClient().from('siteforge_wordpress_targets').select('id,website_id,target_type,site_url,provider,credential_ref,provider_server_id,provider_application_id').eq('property_id',propertyId).eq('is_active',true).eq('status','ready').eq('provider','cloudways').in('target_type',['staging','production']),db().from('siteforge_package_releases').select('*').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(100)])
 if(targets.error||history.error)throw new PackageError('Website delivery setup could not be loaded. Apply the local delivery migration first.')
 return {targets:(targets.data??[]).filter(t=>t.credential_ref&&t.site_url&&t.provider_application_id&&t.provider_server_id).map(t=>({id:t.id,websiteId:t.website_id,type:t.target_type,url:t.site_url})),releases:(history.data??[]).map(r=>({id:r.id,jobId:r.job_id,kind:r.kind,state:r.state,targetId:r.target_id,url:r.target_snapshot.url,previewId:r.preview_id,approvalId:r.approval_id,createdAt:r.created_at,qualityVerified:!!r.receipt.quality,message:r.receipt.message}))}
}
async function target(id:string,propertyId:string,orgId:string){const {data:t,error}=await createServiceClient().from('siteforge_wordpress_targets').select('*').eq('id',id).eq('property_id',propertyId).eq('org_id',orgId).eq('provider','cloudways').eq('is_active',true).eq('status','ready').single();if(error||!t?.credential_ref||!t.site_url||!t.provider_application_id||!t.provider_server_id)throw new PackageError('Choose a connected Cloudways WordPress destination.',409);const u=new URL(t.site_url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new PackageError('A secure Cloudways destination is required.',409);return {id:t.id,websiteId:t.website_id,type:t.target_type,url:t.site_url,credentialRef:t.credential_ref,serverId:t.provider_server_id,applicationId:t.provider_application_id} as TargetSnapshot}
async function credential(t:TargetSnapshot){const c=await getWordPressCredentialReference(t.credentialRef);if(c.provider!=='cloudways'||!c.ssh?.applicationRoot||!c.ssh.sftpApplicationRoot||c.providerMetadata?.applicationId!==t.applicationId||c.providerMetadata?.serverId!==t.serverId||c.url.replace(/\/$/,'')!==t.url.replace(/\/$/,''))throw new PackageError('The saved WordPress credentials do not match this destination.',409);return c.ssh}
async function release(id:string,propertyId:string){const r=await db().from('siteforge_package_releases').select('*').eq('id',id).eq('property_id',propertyId).single();if(r.error||!r.data)throw new PackageError('Saved release not found.',404);return r.data}
export function themeArchive(bytes:Uint8Array,slug:string){if(!/^p11-astra-[a-f0-9]{24}$/.test(slug))throw new PackageError('Invalid theme identity.',422);const input=unpackPackage(bytes);const theme:Record<string,Uint8Array>={};for(const [name,b]of Object.entries(input))if(name.startsWith('website/')&&!name.endsWith('/'))theme[slug+'/'+name.slice(8)]=b;if(!theme[slug+'/style.css']||!theme[slug+'/index.php']||!theme[slug+'/functions.php'])throw new PackageError('An installable WordPress package is required.',422);return zipSync(theme,{level:1})}
async function packageBytes(job:Awaited<ReturnType<typeof getPackageJob>>){if(job.state!=='ready'||job.target!=='wordpress'||!job.package_path||!job.package_hash)throw new PackageError('Choose a ready WordPress package.',409);const r=await packageDb().storage.from('siteforge-packages').download(job.package_path);if(r.error||!r.data)throw new PackageError('The retained package could not be read.');const b=new Uint8Array(await r.data.arrayBuffer());if(sha256(b)!==job.package_hash)throw new PackageError('Package integrity check failed.',409);return b}
function themeChecksums(bytes:Uint8Array,slug:string){const files=unpackPackage(themeArchive(bytes,slug));return Object.fromEntries(Object.entries(files).map(([name,b])=>['wp-content/themes/'+name,sha256(b)]))}
async function verifyPreview(p:Release){const current=await target(p.target_id,p.property_id,p.org_id);if(stableJson(current)!==stableJson(p.target_snapshot))throw new PackageError('Preview destination changed. Create another preview.',409);const latest=await db().from('siteforge_package_releases').select('id').eq('target_id',p.target_id).in('kind',['preview','deploy']).order('created_at',{ascending:false}).limit(1).single();if(latest.data?.id!==p.id)throw new PackageError('The preview has been superseded.',409);return await new SshWordPressInstaller().verifyGeneratedPackage({ssh:await credential(current),releaseId:p.id,packageHash:p.package_hash,theme:String(p.receipt.theme),expectedUrl:current.url,checksums:themeChecksums(await packageBytes(await getPackageJob(p.job_id,p.property_id)),String(p.receipt.theme))});}
export async function requestDelivery(input:{requestId:string;propertyId:string;jobId:string;targetId:string;kind:Release['kind'];previewId?:string;approvalId?:string},actor:{id:string;orgId:string}){
 const existing=await db().from('siteforge_package_releases').select('*').eq('id',input.requestId).maybeSingle();if(existing.error)throw new PackageError('Release history unavailable.');if(existing.data){const r=existing.data;if(r.actor_id!==actor.id||r.org_id!==actor.orgId||r.property_id!==input.propertyId||r.job_id!==input.jobId||r.target_id!==input.targetId||r.kind!==input.kind||r.preview_id!==(input.previewId??null)||r.approval_id!==(input.approvalId??null))throw new PackageError('This request already has different saved details.',409);return {id:r.id,state:r.state,created:false}}
 const job=await getPackageJob(input.jobId,input.propertyId);if(job.org_id!==actor.orgId)throw new PackageError('Website unavailable.',404);readWebsitePlan(unpackPackage(await packageBytes(job)));
 const t=await target(input.targetId,input.propertyId,actor.orgId);await credential(t);
 if(input.kind==='preview'&&t.type!=='staging')throw new PackageError('Preview requires a separate staging destination.',409);
 let approvedContent:Record<string,unknown>={};
 if(input.kind!=='preview'){
  const source=await loadPackageSource(input.propertyId);if(source.hash!==job.source_hash)throw new PackageError('Property information changed. Generate and review an updated website first.',409);
  if(!input.previewId)throw new PackageError('Review a successful preview first.',409);const p=await release(input.previewId,input.propertyId);if(p.kind!=='preview'||p.state!=='succeeded'||p.job_id!==job.id||p.package_hash!==job.package_hash)throw new PackageError('An exact successful preview is required.',409);approvedContent=await verifyPreview(p);await verifyWebsite(p.target_snapshot.url,readWebsitePlan(unpackPackage(await packageBytes(job))));
  if(input.kind==='approve'&&t.id!==p.target_id)throw new PackageError('Approve the preview destination.',409);
  if(input.kind==='deploy'&&(!input.approvalId||t.type!=='production'||t.websiteId!==p.target_snapshot.websiteId||t.url===p.target_snapshot.url))throw new PackageError('Select the separate production destination for this preview.',409);
  if(input.kind==='deploy'){
   const a=await release(input.approvalId!,input.propertyId);if(a.kind!=='approve'||a.state!=='succeeded'||a.preview_id!==p.id||a.package_hash!==p.package_hash||!a.receipt.contentHash||a.receipt.contentHash!==approvedContent.contentHash)throw new PackageError('The preview changed. Approve its current content before publishing.',409);
   const config=getCloudwaysProviderCredentials();if(!config)throw new PackageError('Connect the server Cloudways account before publishing.',409);
   if(p.target_snapshot.serverId!==t.serverId)throw new PackageError('Select staging and production on the same Cloudways server.',409);
   assertStagingApplicationParent(await new CloudwaysProviderClient(config).getApplication({serverId:t.serverId,applicationId:p.target_snapshot.applicationId,expectedHostname:new URL(p.target_snapshot.url).hostname}),t.applicationId);
  }
 }
 const record={id:input.requestId,job_id:job.id,property_id:input.propertyId,org_id:actor.orgId,actor_id:actor.id,kind:input.kind,state:input.kind==='approve'?'succeeded':'running',package_hash:job.package_hash!,target_id:t.id,target_snapshot:t,preview_id:input.previewId??null,approval_id:input.approvalId??null,receipt:input.kind==='approve'?{message:'Exact preview approved for deployment.',contentHash:approvedContent.contentHash}:{}} as Omit<Release,'created_at'|'updated_at'>;
 const saved=await db().from('siteforge_package_releases').insert(record).select('*').single();if(saved.error||!saved.data)throw new PackageError('The release could not be started. Another release may be running, or the preview/approval changed. Refresh before retrying.',409);return{id:record.id,state:record.state,created:true};
}
async function checkpoint(id:string,receipt:Record<string,unknown>){const r=await db().from('siteforge_package_releases').update({receipt}).eq('id',id).eq('state','running');if(r.error)throw r.error}
export async function executeDelivery(id:string){
 const result=await db().from('siteforge_package_releases').select('*').eq('id',id).single();const r=result.data;if(!r||r.state!=='running'||r.kind==='approve')return;
 // Only the request that inserted the running record dispatches. Unknown results are never retried automatically.
 let receipt:Record<string,unknown>={};
 try{
  const access=await validateSiteForgeOwnerOperatorAccess(r.actor_id,r.property_id);if(!access.authorized||access.orgId!==r.org_id)throw Error('Access changed');
  const t=await target(r.target_id,r.property_id,r.org_id);if(stableJson(t)!==stableJson(r.target_snapshot))throw Error('Destination changed');
  const job=await getPackageJob(r.job_id,r.property_id);const bytes=await packageBytes(job);if(job.package_hash!==r.package_hash)throw Error('Package changed');
  let slug='p11-astra-'+r.id.replaceAll('-','').slice(0,24);
  if(r.kind==='preview'){
   receipt={stage:'installing',message:'Installing the complete website: theme, editable pages and homepage.'};await checkpoint(r.id,receipt);
   const archive=themeArchive(bytes,slug);
   receipt=await new SshWordPressInstaller().installGeneratedPackage({ssh:await credential(t),archive:Buffer.from(archive),archiveHash:sha256(archive),slug,releaseId:r.id,packageHash:r.package_hash,expectedUrl:t.url,preview:true,checksums:themeChecksums(bytes,slug),installContent:true});
   receipt={...receipt,stage:'checking',message:'Checking every page, navigation link, image and floorplan.'};await checkpoint(r.id,receipt);
   await new SshWordPressInstaller().verifyGeneratedPackage({ssh:await credential(t),releaseId:r.id,packageHash:r.package_hash,theme:slug,expectedUrl:t.url,checksums:themeChecksums(bytes,slug)});
  }else{
   const source=await loadPackageSource(r.property_id);if(source.hash!==job.source_hash)throw Error('Property information changed');
   const p=await release(r.preview_id!,r.property_id),a=await release(r.approval_id!,r.property_id),proof=await verifyPreview(p);
   if(!a.receipt.contentHash||a.receipt.contentHash!==proof.contentHash)throw Error('Preview content changed after approval');
   const config=getCloudwaysProviderCredentials();if(!config)throw Error('Cloudways API credentials are missing');const provider=new CloudwaysProviderClient(config);
   if(p.target_snapshot.serverId!==t.serverId)throw Error('Staging and production must share the selected server');
   assertStagingApplicationParent(await provider.getApplication({serverId:t.serverId,applicationId:p.target_snapshot.applicationId,expectedHostname:new URL(p.target_snapshot.url).hostname}),t.applicationId);
   const visibility=await new SshWordPressInstaller().productionVisibility(await credential(t));
   const backup=await provider.createApplicationBackup({serverId:t.serverId,applicationId:t.applicationId});if(!backup.operationId)throw Error('Backup operation was not returned');
   receipt={backupOperationId:backup.operationId,productionVisibility:visibility};await checkpoint(r.id,receipt);
   await provider.waitForOperation(backup.operationId,90000);const backupId=await provider.getLatestRestorePoint({serverId:t.serverId,applicationId:t.applicationId});if(!backupId)throw Error('Backup restore point unavailable');
   await provider.verifyOperation(backup.operationId,{kind:'backup',serverId:t.serverId,applicationId:t.applicationId,backupId});
   // Recheck approval after backup, immediately before the one-time provider mutation.
   const latestProof=await verifyPreview(p);if(latestProof.contentHash!==a.receipt.contentHash)throw Error('Preview changed');
   const promotion=await provider.promoteStagingApplication({serverId:t.serverId,stagingApplicationId:p.target_snapshot.applicationId,productionApplicationId:t.applicationId});
   receipt={...receipt,backupId,operationId:promotion.operationId,theme:p.receipt.theme,previewReleaseId:p.id};await checkpoint(r.id,receipt);if(!promotion.operationId)throw Error('Promotion result requires inspection');
   await provider.waitForOperation(promotion.operationId,90000);await provider.verifyOperation(promotion.operationId,{kind:'promotion',serverId:t.serverId,applicationId:t.applicationId,stagingApplicationId:p.target_snapshot.applicationId});
   await new SshWordPressInstaller().productionVisibility(await credential(t),visibility);
   slug=String(p.receipt.theme);await new SshWordPressInstaller().verifyGeneratedPackage({ssh:await credential(t),releaseId:p.id,packageHash:r.package_hash,theme:slug,expectedUrl:t.url,checksums:themeChecksums(bytes,slug)});
  }
  const quality=await verifyWebsite(t.url,readWebsitePlan(unpackPackage(bytes)));receipt={...receipt,quality};
  const page=await safePublicFetch(t.url,{maxBytes:2_000_000});if(!page.ok)throw Error('Public page check failed');const html=await page.text();if(!html.includes('/themes/'+slug+'/'))throw Error('The served page does not show the activated theme. Check caching and starter-content setup.');
  const done=await db().from('siteforge_package_releases').update({state:'succeeded',receipt:{...receipt,message:r.kind==='preview'?'All pages, navigation, images and floorplans checked. Review the design on desktop and mobile before approval.':'Reviewed staging site deployed to Cloudways and homepage verified.'}}).eq('id',r.id).eq('state','running');if(done.error)throw done.error;
 }catch(error){await db().from('siteforge_package_releases').update({state:'uncertain',receipt:{...receipt,message:error instanceof PackageError?error.message+' The preview is not approved. Inspect the saved installation before retrying.':'Website installation needs inspection. The preview is not approved; check its retained backup before another attempt.'}}).eq('id',r.id).eq('state','running');}
}

/** Read back an interrupted deployment without repeating installation or activation. */
export async function reconcileDelivery(id:string,propertyId:string,actor:{id:string;orgId:string}){
 const r=await release(id,propertyId);if(r.org_id!==actor.orgId)throw new PackageError('Release unavailable.',404);if(r.state==='succeeded')return {id:r.id,state:r.state};
 const t=await target(r.target_id,r.property_id,r.org_id);if(stableJson(t)!==stableJson(r.target_snapshot))throw new PackageError('Destination changed. Manual inspection is required.',409);
 const job=await getPackageJob(r.job_id,r.property_id),bytes=await packageBytes(job);
 let markerId=r.id,slug='p11-astra-'+r.id.replaceAll('-','').slice(0,24);
 try{
 if(r.kind==='deploy'){
  const config=getCloudwaysProviderCredentials();if(!config||typeof r.receipt.operationId!=='string'||!r.preview_id)throw Error('Provider receipt unavailable');
  const p=await release(r.preview_id,r.property_id);
  await new CloudwaysProviderClient(config).verifyOperation(r.receipt.operationId,{kind:'promotion',serverId:t.serverId,applicationId:t.applicationId,stagingApplicationId:p.target_snapshot.applicationId});
  if(await new SshWordPressInstaller().productionVisibility(await credential(t))!==r.receipt.productionVisibility)throw Error('Search visibility needs inspection');
  markerId=p.id;slug=String(p.receipt.theme);
 }
 const receipt=await new SshWordPressInstaller().verifyGeneratedPackage({ssh:await credential(t),releaseId:markerId,packageHash:r.package_hash,theme:slug,expectedUrl:t.url,checksums:themeChecksums(bytes,slug)});
 const quality=await verifyWebsite(t.url,readWebsitePlan(unpackPackage(bytes)));
 const page=await safePublicFetch(t.url,{maxBytes:2_000_000});if(!page.ok||!(await page.text()).includes('/themes/'+slug+'/'))throw Error('Page verification failed');
 const saved=await db().from('siteforge_package_releases').update({state:'succeeded',receipt:{...r.receipt,...receipt,quality,message:'Installation confirmed by inspecting WordPress; no deployment was repeated.'}}).eq('id',r.id).in('state',['running','uncertain']);if(saved.error)throw saved.error;return {id:r.id,state:'succeeded'};
 }catch(error){if(error instanceof PackageError)throw new PackageError(error.message+' No deployment was repeated.',409);throw new PackageError('The exact installation could not be confirmed. Inspect WordPress and its retained backup; no deployment was repeated.',409)}
}
