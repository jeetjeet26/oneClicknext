import {it,expect} from 'vitest'
import {historicalBrand,profileText,currentClaims,rentSummary,scopeNotes,type CompetitorProfile} from './profiles'
const profile={id:'c',name:'Example',address:null,amenities:[],scopeNotes:[],historicalBrand:historicalBrand({highlighted_amenities:['Pool','Coworking lounge'],active_specials:['Previously six weeks free'],positioning_statement:'Garden retreat'}),reviewedBrand:null,units:[]} as unknown as CompetitorProfile
it('restores searchable historical amenities and positioning without promoting them to reviewed claims',()=>{
 expect(profileText(profile)).toContain('coworking');expect(profileText(profile)).toContain('garden retreat');expect(currentClaims(profile,'amenity')).toEqual([]);expect(profile.amenities).toEqual([])
})
it('excludes withdrawn and outdated source reviews from current claims',()=>{
 const review={requestId:'r',createdAt:'2026-01-01',disposition:'published',sourceCurrent:true,claims:[{category:'amenity',kind:'source_claim',statement:'Pool',quote:'pool'}]}
 expect(currentClaims({...profile,reviewedBrand:review},'amenity')).toEqual(['Pool'])
 expect(currentClaims({...profile,reviewedBrand:{...review,disposition:'withdrawn'}},'amenity')).toEqual([])
 expect(currentClaims({...profile,reviewedBrand:{...review,sourceCurrent:false}},'amenity')).toEqual([])
})
it('keeps zero rents and missing rents distinct and compares only the selected bedrooms',()=>{
 expect(rentSummary([{bedrooms:1,rentMin:0},{bedrooms:1,rentMin:null},{bedrooms:2,rentMin:3000}],1)).toEqual({total:2,priced:1,mean:0})
})
it('flags management sources for scope review',()=>{expect(scopeNotes({...profile,websiteUrl:'https://example.com/property-management'},null)).toHaveLength(1)})
