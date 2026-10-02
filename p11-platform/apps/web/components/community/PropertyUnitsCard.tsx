'use client'
import {PropertyUnitsWorkbench} from './PropertyUnitsWorkbench'
type PropertyUnit={id:string;unit_type:string;bedrooms:number;bathrooms:number;sqft_min:number|null;sqft_max:number|null;rent_min:number|null;rent_max:number|null;available_count:number;move_in_specials:string|null;last_updated_at:string}
// Compatibility wrapper: the workbench reads a complete native snapshot and its review history.
export function PropertyUnitsCard({propertyId}:{units?:PropertyUnit[];propertyId:string}){return <PropertyUnitsWorkbench key={propertyId} propertyId={propertyId}/>}
