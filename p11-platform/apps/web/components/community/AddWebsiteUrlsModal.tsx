'use client'
import {KnowledgeWebsitesWorkbench} from './KnowledgeWebsitesWorkbench'
export function AddWebsiteUrlsModal({propertyId,onClose}:{propertyId:string;onClose:()=>void;onSuccess?:()=>void}){return <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-label="Website source review" className="mx-auto max-w-3xl rounded-xl bg-white p-4"><button className="mb-3 rounded border px-3 py-2" onClick={onClose}>Close website review</button><KnowledgeWebsitesWorkbench key={propertyId} propertyId={propertyId}/></div></div>}
