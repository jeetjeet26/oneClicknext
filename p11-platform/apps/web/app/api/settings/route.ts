import{NextResponse}from'next/server'
import{accountCommand,accountQuery}from'@/utils/account-settings/contracts'
import{accountActor,currentAccountOrganization,AccountSettingsError,readAccountSettings,decideAccountSettings}from'@/utils/account-settings/store'
import{teamBody as body,requireTeamOrigin,teamHeaders as headers}from'@/utils/team/http'
function failure(e:unknown){return NextResponse.json({error:e instanceof AccountSettingsError?e.message:'Account settings are unavailable.'},{status:e instanceof AccountSettingsError?e.status:503,headers})}
export async function GET(req:Request){try{const actor=await accountActor(),q=accountQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!q.success)throw new AccountSettingsError('Choose saved account settings.',400);const{orgId,...input}=q.data;return NextResponse.json(await readAccountSettings(actor,orgId||await currentAccountOrganization(actor),input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await accountActor();requireTeamOrigin(req);const q=accountCommand.safeParse(await body(req));if(!q.success)throw new AccountSettingsError(q.error.issues[0]?.message||'Review the settings decision.',400);return NextResponse.json(await decideAccountSettings(actor,q.data),{headers})}catch(e){return failure(e)}}
export async function PATCH(){return NextResponse.json({error:'Save a reviewed settings decision with its current source version.'},{status:410,headers})}
