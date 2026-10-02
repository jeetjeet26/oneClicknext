'use client'
import {ReviewResponsePanel} from './ReviewResponsePanel'
/** The response dialog shares the saved source, draft and approval workspace. */
export function ResponseGenerator({propertyId,reviewId,onGenerated,onClose}:{propertyId:string;reviewId:string;onGenerated:()=>void;onClose:()=>void}){
 return <div role="dialog" aria-modal="true" aria-label="Review response workspace" className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4"><div className="mx-auto max-w-2xl space-y-4 rounded-xl bg-white p-4 dark:bg-slate-900"><button aria-label="Close response workspace" className="rounded-lg border px-3 py-2" onClick={onClose}>Close</button><ReviewResponsePanel propertyId={propertyId} reviewId={reviewId} onSaved={onGenerated}/></div></div>
}
