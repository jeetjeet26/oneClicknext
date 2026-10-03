export async function saveNoteDecision(leadId:string,input:Record<string,unknown>){
 const path=`/api/leads/${leadId}/activities`,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([path,input]))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),key=`p11.lead-note.${hash}`
 let requestId:string;try{requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId)}catch{throw new Error('Browser recovery storage is unavailable. Enable it before saving a note.')}
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId}),signal:AbortSignal.timeout(15000)}),data=await response.json().catch(()=>({error:'The response could not be read. Retry the same note or inspect its history.'}))
 if(!response.ok||!['saved','replayed'].includes(data.result?.state))throw new Error(data.error||'The note decision could not be confirmed. Retry the same values or inspect history.')
 try{sessionStorage.removeItem(key)}catch{/* The confirmed decision remains in saved history. */}
 return data.result
}
