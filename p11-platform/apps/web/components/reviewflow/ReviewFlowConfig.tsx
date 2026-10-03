'use client'
import {ReviewIntakePanel} from './ReviewIntakePanel'
import {ReviewPreferencesPanel} from './ReviewPreferencesPanel'
import {ReviewConnectionsPanel} from './ReviewConnectionsPanel'
export function ReviewFlowConfig({propertyId,initialIntakeId}:{propertyId:string;initialIntakeId?:string}){return <div className="space-y-6"><ReviewPreferencesPanel propertyId={propertyId}/><ReviewConnectionsPanel propertyId={propertyId}/><ReviewIntakePanel propertyId={propertyId} initialId={initialIntakeId}/></div>}
