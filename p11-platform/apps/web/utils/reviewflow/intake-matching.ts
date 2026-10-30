import {IntakeValidationError,normalizeIntakeRows,type IntakeRow} from './intake-parser'
export type SavedReviewIdentity={platform:string;platform_review_id:string|null;reviewer_name:string|null;review_text:string|null;rating:number|null;review_date:string|null;reviewer_avatar_url?:string|null}
const clean=(s:string|null)=> (s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()
/** Preserve the saved identity when Google Maps and Places use different IDs.
 * Never choose among competing candidates or silently insert an uncertain match.
 */
export function matchSavedGoogleReviews(rows:IntakeRow[],saved:SavedReviewIdentity[]):IntakeRow[]{
 const existing=saved.filter(r=>r.platform==='google'),seen=new Set<string>(),seenContent=new Set<string>()
 return rows.map((row,index)=>{
  if(row.platform!=='google')return row
  const exact=existing.filter(r=>r.platform_review_id===row.platformReviewId)
  const name=clean(row.reviewerName),text=clean(row.reviewText)
  const contentKey=JSON.stringify([name,text,row.rating])
  if(seenContent.has(contentKey))throw new IntakeValidationError('Duplicate Google review content appears under multiple source IDs. Review this source before applying.',index+1)
  seenContent.add(contentKey)
  const sameAuthor=existing.filter(r=>name!=='anonymous'&&clean(r.reviewer_name)===name)
  const candidates=exact.length?exact:existing.filter(r=>{
   const oldText=clean(r.review_text),sameName=name!=='anonymous'&&clean(r.reviewer_name)===name
   const identical=sameName&&text===oldText&&row.rating===r.rating
   const expanded=sameName&&Math.min(text.length,oldText.length)>=80&&(text.startsWith(oldText)||oldText.startsWith(text))
   const sameDate=sameName&&row.reviewDate&&r.review_date&&Date.parse(row.reviewDate)===Date.parse(r.review_date)
   const ratingOnly=sameName&&!text&&!oldText&&row.rating===r.rating
   return identical||expanded||sameDate||ratingOnly
  })
  const uncertainAuthor=!exact.length&&existing.some(r=>text.length>=40&&text===clean(r.review_text)&&row.rating===r.rating&&clean(r.reviewer_name)!==name)
  if(uncertainAuthor||candidates.length>1||(!candidates.length&&sameAuthor.length))throw new IntakeValidationError('Possible existing Google review. Resolve the source identity before importing; no duplicate was added.',index+1)
  const match=candidates[0],id=match?.platform_review_id||row.platformReviewId
  if(seen.has(id))throw new IntakeValidationError('Two Google rows match the same saved review. Review this source before applying.',index+1)
  seen.add(id)
  // Source imports add missing reviews. A known review is a no-op, including
  // changed text or avatar; the immutable receipt retains the newly observed data.
  return match?normalizeIntakeRows([{platform:'google',platformReviewId:id,
   reviewerName:match.reviewer_name||'Anonymous',reviewText:match.review_text||'',
   rating:match.rating,reviewDate:match.review_date,
   reviewerAvatarUrl:match.reviewer_avatar_url??null}],true).reviews[0]:row
 })
}
