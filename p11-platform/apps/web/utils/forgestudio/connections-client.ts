export interface SavedSocialConnection {
 id:string;platform:string;account_id:string;account_name:string|null;account_username:string|null;is_active:boolean|null;scopes:string[]|null;token_expires_at:string|null;security_version:number;disconnected_at:string|null;permission_evidence:{source?:string;expiryKnown?:boolean;observedAt?:string}|null;needs_refresh:boolean;can_renew:boolean;renewal_state:string|null;renewal_reason:string|null;renewal_started_at:string|null;refresh_token_expires_at:string|null
}
export async function socialJson<T>(url:string,init:RequestInit={}):Promise<T>{
 const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000)
 const response=await fetch(url,{...init,signal,cache:'no-store'}),data=await response.json()
 if(!response.ok)throw new Error(data.error||'Saved connection state could not be loaded.');return data as T
}
export async function loadSocialConnections(propertyId:string,signal?:AbortSignal){
 const connections:SavedSocialConnection[]=[];let cursor:string|null=null;const seen=new Set<string>()
 do{const data:{connections:SavedSocialConnection[];nextCursor:string|null}=await socialJson<{connections:SavedSocialConnection[];nextCursor:string|null}>(`/api/forgestudio/social/connections?propertyId=${encodeURIComponent(propertyId)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal});connections.push(...data.connections);cursor=data.nextCursor;if(cursor){if(seen.has(cursor)||seen.size>=100)throw new Error('The account list is incomplete. Reload connections.');seen.add(cursor)}}while(cursor)
 return{connections}
}
