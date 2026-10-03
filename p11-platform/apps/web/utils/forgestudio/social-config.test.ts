import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const {from}=vi.hoisted(()=>({from:vi.fn()}));vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from})}))
import {getSocialAppCredentials} from './social-config'
function result(data:unknown,error:unknown=null){const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data,error})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);from.mockReturnValue(q)}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('META_APP_ID','environment-id');vi.stubEnv('META_APP_SECRET','environment-secret');vi.stubEnv('ENCRYPTION_KEY','test-key')});afterEach(()=>vi.unstubAllEnvs())
it('uses environment credentials only for an absent saved row',async()=>{result(null);expect(await getSocialAppCredentials('property','meta')).toMatchObject({appId:'environment-id',source:'environment'})})
it('does not fall back to environment credentials after a database read failure',async()=>{result(null,{message:'unavailable'});await expect(getSocialAppCredentials('property','meta')).rejects.toThrow()})
it('does not fall back after secret decryption fails',async()=>{result({app_id:'saved',app_secret_encrypted:'encv1:malformed',is_configured:true});await expect(getSocialAppCredentials('property','meta')).rejects.toThrow()})
it('does not fall back after a saved app is disabled',async()=>{result({app_id:'disabled',app_secret_encrypted:'',is_configured:false});expect(await getSocialAppCredentials('property','meta')).toBeNull()})
