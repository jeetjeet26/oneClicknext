/** Stable per-payload identity survives a lost response/reload without storing private form text. */
export async function sendMarketDecision(path:string,method:string,input:Record<string,unknown>,allowedStates:readonly string[]=['saved','replayed'],newIntentAfterConfirmation=false){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([path,method,input]))),hash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join(''),key=`p11.market.decision.${hash}`
 let requestId:string;try{requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId)}catch{throw new Error('Browser recovery storage is unavailable. Enable it before saving a market decision.')}
 const res=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId})}),data=await res.json().catch(()=>({error:'The response could not be read. Retry this same decision or inspect its saved history.'}))
 if(!res.ok||!allowedStates.includes(data.result?.state))throw new Error(data.error||'The decision could not be confirmed. Retry the same values or inspect saved history.')
 if(newIntentAfterConfirmation){try{sessionStorage.removeItem(key)}catch{/* The confirmed request remains recoverable in saved history. */}}
 return data
}
export function marketNumber(value:string|number|null|undefined){return value===''||value===null||value===undefined?null:typeof value==='number'?value:Number(value)}
