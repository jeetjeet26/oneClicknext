'use client'
import {LegalReviewWorkbench} from './LegalReviewWorkbench'
import {NeighborhoodReviewWorkbench} from './NeighborhoodReviewWorkbench'
export function OnboardingTruthEditor({propertyId}:{propertyId:string}){return<section className="space-y-6"><LegalReviewWorkbench key={'legal:'+propertyId} propertyId={propertyId}/><NeighborhoodReviewWorkbench key={'neighborhood:'+propertyId} propertyId={propertyId}/></section>}
