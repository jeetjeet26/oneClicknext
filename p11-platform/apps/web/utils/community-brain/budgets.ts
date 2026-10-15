import 'server-only'
import { brainRpc } from './server'

/** A reservation is an approved allowance, not a fabricated provider bill.
 * It remains held until an independently verified cost can settle it. */
export async function reservePackageProcessing(kind:'site_package'|'social'|'brand',id:string,operation:'initial'|'repair'|'visual_review') {
  const value=Number(process.env.COMMUNITY_BRAIN_PACKAGE_CALL_RESERVATION_CENTS)
  return brainRpc('brain_reserve_package_processing',{
    p_kind:kind,p_id:id,p_operation:operation,
    p_cents:Number.isSafeInteger(value)&&value>0?value:null,
  })
}
