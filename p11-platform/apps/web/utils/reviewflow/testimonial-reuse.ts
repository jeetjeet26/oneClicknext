import type {SupabaseClient} from '@supabase/supabase-js'
import type {Database} from '@/types/supabase'
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Recheck managed testimonial content when a saved release is loaded, including promotion of old artifacts. */
export async function assertSiteForgeTestimonialPermissions(client:SupabaseClient<Database>,propertyId:string,blueprint:unknown){
 const pages=object(blueprint).pages,uses:Record<string,unknown>[]=[]
 if(!Array.isArray(pages))return
 for(const page of pages){const sections=object(page).sections;if(!Array.isArray(sections))continue;for(const section of sections){const s=object(section);if(s.acfBlock!=='acf/testimonials')continue;const content=object(s.content);if(content.source!=='reviewflow'||!Array.isArray(content.reviews))throw new Error('This testimonial section is missing its saved ReviewFlow source. Review the artifact before release.');for(const review of content.reviews){const r=object(review);if(typeof r.id!=='string'||!(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.id)))throw new Error('A testimonial is missing its exact saved permission identity.');uses.push(r)}}}
 if(!uses.length)return
 const ids=[...new Set(uses.map(r=>String(r.id)))];if(ids.length>500)throw new Error('This release has too many testimonial permissions for a single checked release.')
 const {data,error}=await client.rpc('eligible_reviewflow_testimonials',{p_property_id:propertyId,p_channel:'website'}).in('id',ids)
 if(error||!data)throw new Error('Current testimonial permissions could not be confirmed. No release can proceed.')
 for(const use of uses){const permission=data.find(a=>a.id===use.id);if(!permission||permission.reviewer_name_snapshot!==use.reviewer_name||permission.review_text_snapshot!==use.review_text||permission.rating_snapshot!==use.rating||permission.platform_snapshot!==use.platform||typeof use.review_date!=='string'||!permission.review_date_snapshot||!Number.isFinite(Date.parse(use.review_date))||Date.parse(permission.review_date_snapshot)!==Date.parse(use.review_date))throw new Error('A testimonial permission expired, was revoked, changed source, or does not match this exact content. Review and rebuild the artifact before release.')}
}
