import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PackageError, packageRequestSchema } from '@/utils/siteforge/packages/contracts'
import { getPackageJob, packageDb, requirePackageOperator, savePackageRequest } from '@/utils/siteforge/packages/store'
import { loadPackageSource, sha256 } from '@/utils/siteforge/packages/source'
import { processPackage } from '@/utils/siteforge/packages/runner'

export const maxDuration=300
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}})
const failure=(error:unknown)=>reply({error:error instanceof PackageError?error.message:'The website build could not be confirmed. Refresh to check saved progress.'},error instanceof PackageError?error.status:503)
const scope=z.object({propertyId:z.guid(),downloadId:z.uuid().optional()})
async function downloadPackage(id:string,propertyId:string,actor:{id:string;orgId:string}) {
  const db=packageDb()
  const job=await getPackageJob(id,propertyId)
  if(job.org_id!==actor.orgId) throw new PackageError('Website build not found.',404)
  if(job.state!=='ready'||!job.package_path||!job.package_hash) throw new PackageError('This website package is not ready to download.',409)
  const {data,error}=await db.storage.from('siteforge-packages').download(job.package_path)
  if(error||!data) throw new PackageError('The retained website package is unavailable.')
  const bytes=new Uint8Array(await data.arrayBuffer())
  if(sha256(bytes)!==job.package_hash) throw new PackageError('Package verification failed. Ask an administrator to review this build.')
  const log=await db.rpc('record_siteforge_package_download',{p_property_id:job.property_id,p_job_id:job.id,p_actor_id:actor.id})
  if(log.error||!log.data) throw new PackageError('The download could not be recorded. Try again.')
  return new Response(bytes,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="siteforge-${job.target}-${job.id.slice(0,8)}.zip"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}
export async function GET(request:NextRequest) {
  try {
    const parsed=scope.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if(!parsed.success) throw new PackageError('Select a property.',400)
    const {propertyId}=parsed.data
    const actor=await requirePackageOperator(propertyId)
    if(parsed.data.downloadId) return await downloadPackage(parsed.data.downloadId,propertyId,actor)
    const [snapshot,history]=await Promise.all([
      loadPackageSource(propertyId),
      packageDb().from('siteforge_package_jobs').select('id,target,instructions,state,parent_id,created_at,error_message,source_hash,package_bytes').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(30),
    ])
    if(history.error) throw new PackageError('Website package history is unavailable. The local database migration may still be pending.')
    return reply({jobs:history.data,configured:Boolean(process.env.OPENAI_API_KEY),source:{name:snapshot.source.property.name,hash:snapshot.hash,floorplans:snapshot.source.floorplans.length,assets:snapshot.source.assets.length,brand:Boolean(snapshot.source.brand),direction:Boolean(snapshot.source.canonical.creative || snapshot.source.direction),warnings:snapshot.source.warnings}})
  }catch(error){return failure(error)}
}
const command=z.discriminatedUnion('action',[
  packageRequestSchema.extend({action:z.literal('generate')}),
  z.object({action:z.literal('refresh'),propertyId:z.guid(),id:z.uuid()}),
  z.object({action:z.literal('download'),propertyId:z.guid(),id:z.uuid()}),
])
export async function POST(request:NextRequest) {
  try {
    const parsed=command.safeParse(await request.json().catch(()=>null))
    if(!parsed.success) throw new PackageError('Review the website request and select a property.',400)
    const input=parsed.data,actor=await requirePackageOperator(input.propertyId)
    if(input.action==='generate') {
      const draft=packageRequestSchema.parse({requestId:input.requestId,propertyId:input.propertyId,parentId:input.parentId,target:input.target,instructions:input.instructions})
      const job=await savePackageRequest(draft,actor)
      after(async()=>{await processPackage(job.id).catch(()=>undefined)})
      return reply({id:job.id,state:job.state},202)
    }
    const job=await getPackageJob(input.id,input.propertyId)
    if(job.org_id!==actor.orgId) throw new PackageError('Website build not found.',404)
    if(input.action==='refresh') {
      after(async()=>{await processPackage(job.id).catch(()=>undefined)})
      return reply({id:job.id,state:job.state},202)
    }
    return await downloadPackage(job.id,input.propertyId,actor)
  }catch(error){return failure(error)}
}
