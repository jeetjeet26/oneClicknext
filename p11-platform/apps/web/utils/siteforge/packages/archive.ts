import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { z } from 'zod'
import { crc32 } from 'node:zlib'
import { PackageError } from './contracts'
import { sha256 } from './source'
import { readWebsitePlan,validateDesignEvidence } from './quality'

const MAX=50_000_000
/** Inspect the central directory before allocating inflated files. No ZIP64, encryption, links or path traversal. */
function unpackChecked(bytes:Uint8Array) {
  if(bytes.length>MAX || bytes.length<22) throw new PackageError('The generated archive exceeds package limits.',422)
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let end=bytes.length-22
  while(end>=Math.max(0,bytes.length-65557) && view.getUint32(end,true)!==0x06054b50) end--
  if(end<0 || view.getUint32(end,true)!==0x06054b50 || end+22+view.getUint16(end+20,true)!==bytes.length) throw new PackageError('The generated ZIP is incomplete.',422)
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true)
  if(count>1500 || count===0 || offset+size!==end || view.getUint32(end+4,true)!==0 || view.getUint16(end+8,true)!==count) throw new PackageError('Unsupported generated archive.',422)
  let cursor=offset,total=0
  const names=new Set<string>()
  const checksums=new Map<string,{size:number;crc:number}>()
  for(let i=0;i<count;i++) {
    if(cursor+46>end || view.getUint32(cursor,true)!==0x02014b50) throw new PackageError('Invalid ZIP directory.',422)
    const compressed=view.getUint32(cursor+20,true),original=view.getUint32(cursor+24,true)
    const n=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true)
    if(cursor+46+n+extra+comment>end) throw new PackageError('Invalid ZIP entry.',422)
    const name=strFromU8(bytes.subarray(cursor+46,cursor+46+n))
    const mode=(view.getUint32(cursor+38,true)>>>16)&0xf000
    const localOffset=view.getUint32(cursor+42,true)
    if(localOffset+30>offset || view.getUint32(localOffset,true)!==0x04034b50) throw new PackageError('Invalid ZIP local entry.',422)
    const localNameLength=view.getUint16(localOffset+26,true),localExtraLength=view.getUint16(localOffset+28,true)
    if(localOffset+30+localNameLength+localExtraLength+compressed>offset || strFromU8(bytes.subarray(localOffset+30,localOffset+30+localNameLength))!==name) throw new PackageError('ZIP names or file sizes do not match.',422)
    total+=original
    if(!name || name.length>240 || name.startsWith('/') || name.includes('\\') || name.includes(':') || /[\x00-\x1f]/.test(name) || name.split('/').some(p=>p==='..'||p==='.') || names.has(name.toLowerCase()) || mode===0xa000 || (view.getUint16(cursor+8,true)&1) || total>MAX || original>10_000_000 || (original>1_000_000 && original>Math.max(1,compressed)*250)) throw new PackageError('The generated ZIP contains an unsafe or oversized file.',422)
    names.add(name.toLowerCase());checksums.set(name,{size:original,crc:view.getUint32(cursor+16,true)});cursor+=46+n+extra+comment
  }
  if(cursor!==end) throw new PackageError('Invalid ZIP directory size.',422)
  let actual=0
  const files=unzipSync(bytes,{filter:file=>{
    actual+=file.originalSize
    if(actual>MAX || file.originalSize>10_000_000 || !names.has(file.name.toLowerCase())) throw new PackageError('ZIP entries do not match the directory.',422)
    return true
  }})
  if(Object.values(files).reduce((sum,b)=>sum+b.length,0)>MAX) throw new PackageError('Expanded package is too large.',422)
  for(const [name,content] of Object.entries(files)) {
    const declared=checksums.get(name)
    if(!declared || content.length!==declared.size || crc32(content)!==declared.crc) throw new PackageError('A generated file failed its ZIP integrity check.',422)
  }
  return files
}
export function unpackPackage(bytes:Uint8Array) {
  try{return unpackChecked(bytes)}
  catch(error){if(error instanceof PackageError)throw error;throw new PackageError('The generated archive is invalid or damaged.',422)}
}
const bindingsSchema=z.object({
  version:z.literal(1), floorplanIds:z.array(z.string()),
  components:z.array(z.object({name:z.string().min(1),sourceFields:z.array(z.string()),editableIn:z.string().min(1),guideId:z.string().optional(),guideVersion:z.string().optional()})).min(1),
})
export function retainFinishedPackage(output:Uint8Array,input:Uint8Array,job:{id:string;source_hash:string;target:string}) {
  const files=unpackPackage(output), source=unpackPackage(input)
  for(const name of ['INSTALL.md','EDITING.md','REVIEW.md','component-bindings.json','build-report.json']) {
    if(!files[name]?.length) throw new PackageError(`The generated package is missing ${name}.`,422)
  }
  if(job.target==='wordpress' && (!files['website/style.css'] || !files['website/index.php'] || !files['website/functions.php'])) throw new PackageError('The generated WordPress theme is incomplete.',422)
  if(job.target==='standalone' && !files['website/index.html']) throw new PackageError('The generated website is missing its entry page.',422)
  let bindings:z.infer<typeof bindingsSchema>
  try {bindings=bindingsSchema.parse(JSON.parse(strFromU8(files['component-bindings.json'])));JSON.parse(strFromU8(files['build-report.json']))}
  catch {throw new PackageError('The generated component bindings or build report are incomplete.',422)}
  const property=JSON.parse(strFromU8(source['property.json'])) as {version?:number;floorplans:Array<{id:string}>;componentGuides?:Array<{id:string;version:string}>}
  if(property.floorplans.some(u=>!bindings.floorplanIds.includes(u.id))) throw new PackageError('The generated site did not account for every approved floorplan.',422)
  if(property.version===2 && bindings.components.some(c=>!property.componentGuides?.some(g=>g.id===c.guideId && g.version===c.guideVersion))) throw new PackageError('The generated site is missing its versioned P11 component guidance. Review the build before delivery.',422)
  if(job.target==='wordpress'){const plan=readWebsitePlan(files);validateDesignEvidence(files);if(property.floorplans.some(f=>!plan.pages.some(p=>p.floorplanIds.includes(f.id))))throw new PackageError('The page content is missing approved floorplans.',422)}
  // A model-authored build report is useful evidence for a reviewer, never an independent acceptance test.
  for(const [name,bytes] of Object.entries(source)) {
    if(!name.startsWith('previous-website/')) files[`source/${name}`]=bytes
  }
  if(job.target==='wordpress') {
    const theme:Record<string,Uint8Array>={}
    for(const [name,bytes] of Object.entries(files)) if(name.startsWith('website/')) theme[`siteforge-property/${name.slice(8)}`]=bytes
    files['siteforge-theme.zip']=zipSync(theme,{level:1})
    files['INSTALL.md']=strToU8('## Ready-to-upload WordPress theme\n\nUpload **siteforge-theme.zip** through WordPress → Appearance → Themes → Add New Theme → Upload Theme. The editable source is also in website/. Any theme-ZIP creation steps below are optional, for rebuilding the ZIP after source changes. Follow the theme’s starter-content and editing instructions below after installation.\n\n---\n\n'+strFromU8(files['INSTALL.md']))
  }
  files['P11-PACKAGE.json']=strToU8(JSON.stringify({version:1,id:job.id,sourceHash:job.source_hash,model:'gpt-6-astra',target:job.target,requiresHumanReview:true,independentRuntimeVerification:'pending',fileHashes:Object.fromEntries(Object.entries(files).map(([name,b])=>[name,sha256(b)]))},null,2))
  const retained=zipSync(files,{level:1})
  if(retained.length>MAX) throw new PackageError('The finished package exceeds the 50 MB limit.',422)
  return retained
}
export async function readBoundedResponse(response:Response,limit=MAX) {
  if(!response.ok || !response.body || Number(response.headers.get('content-length'))>limit) throw new PackageError('The generated package could not be downloaded.')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[]
  let total=0
  try { for(;;) {const {done,value}=await reader.read();if(done) break;total+=value.length;if(total>limit) throw new PackageError('The generated package is too large.',422);chunks.push(value)} }
  finally {await reader.cancel().catch(()=>undefined)}
  const bytes=new Uint8Array(total);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return bytes
}
