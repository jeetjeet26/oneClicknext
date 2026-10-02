// No document script, attachment, URL or embedded action is executed.
const {parentPort,workerData}=require('node:worker_threads')
const {getDocumentProxy}=require('unpdf')
const {createHash}=require('node:crypto')
;(async()=>{
 let pdf
 const result={totalPages:null,pages:[],text:'',complete:false,errorCode:null,blankPages:[],limitations:['PDF text order may differ from the printed layout. Images, handwriting and scanned pages require manual review; no OCR was run.']}
 try{
  const bytes=new Uint8Array(workerData.buffer)
  if(createHash('sha256').update(bytes).digest('hex')!==workerData.expectedHash){result.errorCode='original_mismatch';parentPort.postMessage(result);return}
  pdf=await getDocumentProxy(bytes,{verbosity:0,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true})
  result.totalPages=pdf.numPages
  if(pdf.numPages>100){result.errorCode='page_limit';parentPort.postMessage(result);return}
  let size=0
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
   const page=await pdf.getPage(pageNumber),content=await page.getTextContent()
   const text=content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':'')).join('')
   size+=Buffer.byteLength(text)+(pageNumber>1?2:0)
   if(size>1048576){result.errorCode='text_limit';break}
   result.pages.push(text)
   if(!text.trim())result.blankPages.push(pageNumber)
   page.cleanup()
  }
  result.text=result.pages.join('\n\n')
  if(!result.errorCode&&!result.text.trim())result.errorCode='no_text'
  if(result.text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result.text)){result.errorCode='invalid_text';result.pages=[];result.text='';result.blankPages=[];result.limitations.push('Invalid text characters prevented retaining extracted text. The exact binary original is retained.')}
  result.complete=!result.errorCode&&result.pages.length===pdf.numPages
  parentPort.postMessage(result)
 }catch(error){result.errorCode=error?.name==='PasswordException'?'password_protected':error?.name==='InvalidPDFException'?'pdf_invalid':error?.name==='UnknownErrorException'?'pdf_decoder_unavailable':error?.name==='TypeError'?'pdf_runtime_type_error':'pdf_unreadable';parentPort.postMessage(result)}finally{if(pdf)await pdf.destroy()}
})().catch(()=>parentPort.postMessage({complete:false,errorCode:'pdf_unreadable',totalPages:null,pages:[],text:'',blankPages:[],limitations:[]}))
