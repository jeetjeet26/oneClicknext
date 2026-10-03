import {AsyncLocalStorage} from 'node:async_hooks'
export type LumaRequestContext={propertyId:string;requestId:string;token:string}
export const lumaRequestContext=new AsyncLocalStorage<LumaRequestContext>()
