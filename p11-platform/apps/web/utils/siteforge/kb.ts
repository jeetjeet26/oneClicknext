import 'server-only'
import {brainActor,resolveCommunityScope,getCommunityContext} from '@/utils/community-brain/server'

/** Compatibility adapter. It uses the same actor-bound eligible evidence as all
 * other readers; an empty result never falls back to legacy vector rows. */
export async function retrieveKbContext(args:{propertyId:string;query:string;matchCount?:number;matchThreshold?:number}) {
  const scope=await resolveCommunityScope(await brainActor(),args.propertyId,'research')
  const context=await getCommunityContext(scope,{propertyId:args.propertyId,query:args.query})
  const chunks=context.evidence.slice(0,Math.min(12,Math.max(1,args.matchCount??6))).map(row=>({content:row.content,similarity:row.score,metadata:row.metadata}))
  return {contextText:chunks.map((c,i)=>`SOURCE ${i+1} (scoped relevance ${c.similarity.toFixed(3)}):\n${c.content}`).join('\n\n---\n\n'),chunks}
}
