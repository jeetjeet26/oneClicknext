import { expect, it } from 'vitest'
import { prepareBrandRevision } from './revisions'
import { BRAND_SECTION_COLUMNS } from './contracts'
const brand = {id:'brand',property_id:'property',revision:5,...Object.fromEntries(BRAND_SECTION_COLUMNS.map(column=>[column,{content:column,_meta:{approval:{status:'approved',approvedBy:'old'},provenance:{content:[{sourceType:'manual'}]}}}]))}
it('reopens a selected section while preserving the earlier approved content and original draft evidence',()=>{
 const result=prepareBrandRevision(brand,6,{section_6_logo:{logoUrl:'https://example.invalid/new.png'}})
 expect(result).toMatchObject({current_step:6,approval_status:'reviewing',approved_by:null,approved_at:null,section_6_logo:null,section_12_implementation:null,draft_section:{step:6,name:'logo',data:{logoUrl:'https://example.invalid/new.png'}}})
 expect(result).not.toHaveProperty('section_5_name_story')
 expect(result.proposed_sections.section_7_typography._meta).toMatchObject({approval:{status:'reviewing'},provenance:{content:[{sourceType:'manual'}]}})
 expect((brand as Record<string, unknown>).section_6_logo).toMatchObject({_meta:{approval:{status:'approved'}}})
})
