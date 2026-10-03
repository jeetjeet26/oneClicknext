import {beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/property-setup/store',async original=>({...await original<typeof import('@/utils/property-setup/store')>(),requireSetupActor:d.actor,setupRpc:d.rpc}))
import {POST} from './route'
import {PropertySetupError} from '@/utils/property-setup/store'
import {creationProfile} from '@/utils/property-setup/creation-contracts'
const id='11111111-1111-1111-1111-111111111111',property='33333333-3333-3333-3333-333333333333'
const payload=()=>({requestId:id,expectedHash:'a'.repeat(64),profile:creationProfile({name:'Complete property'}),contacts:[],connectionRequests:[],reason:'Finish reviewed setup'})
const post=(v:unknown,url=`http://local/api/properties/create?propertyId=${property}`)=>POST(new Request(url,{method:'POST',body:JSON.stringify(v)}))
beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue('current-actor');d.rpc.mockResolvedValue({state:'saved',id,setupCompleted:true})})
it('finishes only the exact saved property through a versioned native save',async()=>{const r=await post(payload());expect(r.status).toBe(200);expect(d.actor).toHaveBeenCalledWith(property);const{requestId,...input}=payload();expect(d.rpc).toHaveBeenCalledWith('save_property_setup',{p_id:requestId,p_property_id:property,p_actor_id:'current-actor',p_input:{...input,completeOnboarding:true}})})
it('rejects duplicate-creating legacy fallback, missing identity and injected completion/actor fields',async()=>{for(const value of[{existingPropertyId:property,property:{name:'Legacy'},contacts:[]},{...payload(),actorId:id},{...payload(),completeOnboarding:false}])expect((await post(value)).status).toBe(400);expect((await post(payload(),'http://local/api/properties/create')).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('keeps authentication, current access, stale state and completed-state failures explicit',async()=>{for(const status of[401,403,409]){d.actor.mockRejectedValueOnce(new PropertySetupError('Current access or state changed',status));expect((await post(payload())).status).toBe(status)}expect(d.rpc).not.toHaveBeenCalled();d.rpc.mockRejectedValueOnce(new PropertySetupError('This property setup is already complete.',409));expect((await post(payload())).status).toBe(409)})
