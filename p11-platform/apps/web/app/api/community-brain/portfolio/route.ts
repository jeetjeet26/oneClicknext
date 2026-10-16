import {brainActor,brainRpc,resolvePortfolioScope} from '@/utils/community-brain/server'
import {portfolioRequestSchema,BrainError} from '@/utils/community-brain/contracts'
import {readPortfolioBrain} from '@/utils/community-brain/portfolio'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
import {z} from 'zod'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export const maxDuration=120
const requestSchema=portfolioRequestSchema.safeExtend({requestId:z.guid()})
export async function POST(request:Request){try{requireConsoleOrigin(request);const actor=await brainActor(),parsed=requestSchema.safeParse(await boundedJson(request,64000));if(!parsed.success)throw new BrainError('Choose communities, an operation, and valid dates.',400);return Response.json(await readPortfolioBrain(actor,parsed.data),{headers:privateHeaders})}catch(error){return brainFailure(error)}}
export async function GET(request:Request){try{const actor=await brainActor(),p=new URL(request.url).searchParams,ids=z.array(z.guid()).min(1).max(500).parse(p.getAll('propertyId')),sessionId=z.guid().parse(p.get('sessionId'));const scope=await resolvePortfolioScope(actor,ids);return Response.json({messages:await brainRpc('brain_portfolio_history',{p_scope_id:scope.id,p_session_id:sessionId})},{headers:privateHeaders})}catch(error){return brainFailure(error)}}
