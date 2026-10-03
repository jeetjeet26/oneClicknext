// Structured floor-plan facts are consumed by the reviewed assistant-facts snapshot.
// Keep this compatibility function side-effect free; old callers cannot delete text or invoke embeddings.
export async function syncPropertyUnitsToKnowledgeBase(_propertyId:string):Promise<{success:boolean;document_id?:string;error?:string}>{void _propertyId;return{success:false,error:'Approve the exact floor-plan facts, then prepare and publish reviewed assistant facts.'}}
