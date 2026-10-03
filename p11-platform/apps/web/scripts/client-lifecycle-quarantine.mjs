/** Revoke access to the synthetic local source retained for an offboarding rehearsal. */
import {createClient} from '@supabase/supabase-js'
import {readFile,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const [journeyPath,output]=process.argv.slice(2)
const fixture=JSON.parse(await readFile(journeyPath,'utf8'))
const url=process.env.NEXT_PUBLIC_SUPABASE_URL
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||fixture.source!=='synthetic')throw new Error('Local synthetic rehearsal required')
for(const value of[fixture.org,fixture.actor])if(!/^[a-f0-9-]{36}$/.test(value))throw new Error('Invalid fixture identity')
if(process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith('unix://'))throw new Error('Local Docker required')
const context=JSON.parse(execFileSync('docker',['context','inspect'],{encoding:'utf8'}))
if(!context[0].Endpoints.docker.Host.startsWith('unix://'))throw new Error('Local Docker required')
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const checked=async query=>{const r=await query;if(r.error)throw new Error(r.error.message);return r.data}
const org=await checked(db.from('organizations').select('name').eq('id',fixture.org).single())
if(!org.name.startsWith('Synthetic lifecycle '))throw new Error('Synthetic client name required')
const user=await checked(db.auth.admin.getUserById(fixture.actor))
if(!/^lifecycle-[a-f0-9-]+@p11.test$/.test(user.user.email))throw new Error('Synthetic account required')
const profiles=await checked(db.from('profiles').select('id,org_id,role').eq('org_id',fixture.org))
if(profiles.some(p=>p.id!==fixture.actor))throw new Error('Additional client members need a reviewed scope')
const properties=await checked(db.from('properties').select('id').eq('org_id',fixture.org)),ids=properties.map(p=>p.id)
const transfers=await checked(db.from('crm_handoffs').select('id,property_id,state').in('property_id',ids))
if(transfers.some(h=>['sending','needs_reconciliation','confirmed'].includes(h.state)))throw new Error('Provider work requires its own offboarding review')
const jobs=await checked(db.from('shared_jobs').select('id,domain,lifecycle_status').eq('org_id',fixture.org))
if(jobs.some(j=>!['succeeded','failed','cancelled'].includes(j.lifecycle_status)&&j.domain!=='crm.delivery'))throw new Error('Other active work needs a native stop adapter')
const followups=await checked(db.from('lead_workflows').select('id,lead:leads!inner(property_id)').eq('status','active').in('lead.property_id',ids))
if(followups.length)throw new Error('Active lead follow-up needs explicit native cancellation')
const rpc=async(name,args)=>checked(db.rpc(name,args)),stopped=[]
for(const property of ids){
 const config=await rpc('read_luma_configuration',{p_property_id:property})
 if(config.config?.is_active){const r=await rpc('save_recorded_luma_configuration',{p_property_id:property,p_actor_id:fixture.actor,p_request_id:randomUUID(),p_operation:'save',p_config:{is_active:false},p_expected_revision:config.revision});if(!['applied','replayed'].includes(r.state))throw new Error('Widget stop needs review: '+r.state);stopped.push({property,kind:'widget'})}
 const tours=await checked(db.from('tours').select('id,lead_id,schedule_version').eq('property_id',property).in('status',['scheduled','confirmed']))
 for(const tour of tours){const r=await rpc('change_tour_schedule',{p_property_id:property,p_lead_id:tour.lead_id,p_source:'tours',p_tour_id:tour.id,p_actor_id:fixture.actor,p_request_id:randomUUID(),p_expected_version:tour.schedule_version,p_change:{action:'cancel',reason:'Synthetic client offboarding rehearsal',notify:false}});if(!['applied','replayed'].includes(r.state))throw new Error('Tour stop needs review: '+r.state);stopped.push({property,kind:'tour',id:tour.id})}
}
for(const h of transfers.filter(h=>['queued','searching'].includes(h.state))){const r=await rpc('stop_crm_handoff',{p_property_id:h.property_id,p_actor_id:fixture.actor,p_handoff_id:h.id,p_request_id:randomUUID()});if(r.state!=='cancelled')throw new Error('Transfer stop needs review');stopped.push({kind:'crm',id:h.id})}
await checked(db.auth.admin.updateUserById(fixture.actor,{ban_duration:'876000h'}))
// Exact synthetic membership only. Removing membership makes existing access tokens
// fail the application's current-membership checks, even before token expiration.
execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`BEGIN;SELECT set_config('p11.team_scope','${fixture.org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE id='${fixture.actor}' AND org_id='${fixture.org}';COMMIT;`,stdio:['pipe','pipe','pipe']})
const remaining=await checked(db.from('profiles').select('org_id,role').eq('id',fixture.actor).single())
if(remaining.org_id!==null||remaining.role!=='viewer')throw new Error('Membership removal was not confirmed')
await writeFile(output,JSON.stringify({state:'synthetic_source_quarantined',org:fixture.org,actor:fixture.actor,stopped,access:'account banned and current organization membership removed',retention:'Source rows remain as explicitly retained synthetic rehearsal evidence; original bytes have a separate removal receipt.',providerCalls:false,trainingEligible:false},null,2)+'\n',{flag:'wx',mode:0o600})
console.log(JSON.stringify({state:'synthetic_source_quarantined',stopped:stopped.length}))
