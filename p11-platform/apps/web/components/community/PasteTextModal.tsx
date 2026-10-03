'use client'
import {KnowledgeWorkbench} from './KnowledgeWorkbench'
export function PasteTextModal({propertyId,onClose,onSuccess}:{propertyId:string;onClose:()=>void;onSuccess:()=>void}){return <div role="dialog" aria-modal="true" aria-label="Saved knowledge workflow" className="fixed inset-0 z-50 overflow-auto bg-white p-4"><button type="button" onClick={onClose} className="mb-4 rounded-lg border p-2">Close knowledge workflow</button><KnowledgeWorkbench key={propertyId} propertyId={propertyId} onChange={onSuccess}/></div>}
