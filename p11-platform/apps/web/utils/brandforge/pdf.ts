import { jsPDF } from 'jspdf'
const internalFields = new Set(['_meta','assetId','asset_id','exampleAssetIds','sourceId','approvedBy','approvedAt','approved_by','approved_at','status','version','schemaVersion','generatedAt','generated_at'])
const title = (value: string) => value.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase())
const clean = (value: string) => value.replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function buildBrandBookPdf(brandBook: Record<string, unknown>): Uint8Array {
 const doc = new jsPDF({unit:'pt',format:'letter'})
 const width=612,height=792,margin=48,meta=record(brandBook.metadata),sections=record(brandBook.sections),cover=record(sections.cover)
 const name=String(cover.brandName || meta.brandName || 'Brand guidelines')
 let y=margin
 const space=(needed:number)=>{if(y+needed>height-64){doc.addPage();y=margin}}
 const text=(value:string,size=10,bold=false,indent=0)=>{
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(bold?'#172033':'#435067')
  const lines: string[]=doc.splitTextToSize(clean(value),width-margin*2-indent)
  for(const line of lines){space(size*1.5);doc.text(line,margin+indent,y);y+=size*1.5}
  y+=5
 }
 const content=(value:unknown,label='',depth=0)=>{
  if(value===null||value===undefined||value===''||depth>7)return
  const indent=Math.min(depth*12,60)
  if(Array.isArray(value)){
   if(!value.length)return
   if(label){space(40);text(title(label),10,true,indent)}
   value.forEach((item,index)=>content(item,typeof item==='object'?`${title(label || 'Item')} ${index+1}`:'',depth+1))
   return
  }
  if(typeof value==='object'){
   const entries=Object.entries(value).filter(([key])=>!internalFields.has(key))
   if(label&&entries.length){space(40);text(title(label),10,true,indent)}
   for(const [key,item] of entries)content(item,key,depth+(label?1:0))
   return
  }
  const rendered=typeof value==='boolean'?(value?'Yes':'No'):String(value)
  if(label&&/^#[0-9a-f]{6}$/i.test(rendered)){
   space(28);doc.setFillColor(rendered);doc.rect(margin+indent,y-10,14,14,'F');text(`${title(label)}: ${rendered.toUpperCase()}`,10,false,indent+23);return
  }
  if(label){space(36);text(title(label),9,true,indent)}
  text(rendered,10,false,indent)
 }
 doc.setFillColor('#5037DD');doc.rect(margin,y,36,4,'F');y+=34
 text(name,27,true)
 text('Brand guidelines',14)
 if(cover.tagline)text(String(cover.tagline),12)
 const date=typeof meta.generatedAt==='string'?meta.generatedAt.slice(0,10):''
 text([typeof meta.revision==='number'?`Approved version ${meta.revision}`:null,date].filter(Boolean).join(' | '),9)
 y+=18
 const ordered:[string,unknown][]=[['Introduction',sections.introduction],['Positioning',sections.positioning],['Target audience',sections.targetAudience],['Personas',sections.personas],['Name and story',sections.nameStory],['Logo',sections.logo],['Typography',sections.typography],['Colors',sections.colors],['Design elements',sections.designElements],['Photography',sections.photoGuidelines],['Implementation',sections.implementation]]
 ordered.forEach(([heading,value],index)=>{space(65);doc.setDrawColor('#DBE0E8');doc.line(margin,y,width-margin,y);y+=25;text(`${String(index+1).padStart(2,'0')}  ${heading}`,14,true);content(value);y+=12})
 const pages=doc.getNumberOfPages()
 for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor('#657187');doc.text('Brand guidelines',margin,height-30);doc.text(`${page} / ${pages}`,width-margin,height-30,{align:'right'})}
 return new Uint8Array(doc.output('arraybuffer'))
}
