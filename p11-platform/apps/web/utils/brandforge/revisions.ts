import { BRAND_SECTION_COLUMNS } from './contracts'
import { sectionNames, type BrandRow } from './operations'
export function prepareBrandRevision(brand: BrandRow, step: number, changed: Record<string, unknown> = {}) {
 const sections = Object.fromEntries(BRAND_SECTION_COLUMNS.map(column => {
  const original = (changed[column] || brand[column] || {}) as Record<string, unknown>
  return [column, { ...original, status: 'reviewing', approved_by: null, approved_at: null, _meta: { ...(original._meta as Record<string, unknown> || {}), approval: { status: 'reviewing' } } }]
 }))
 return {
  ...Object.fromEntries(BRAND_SECTION_COLUMNS.slice(step - 1).map(column => [column, null])),
  proposed_sections: sections,
  current_step: step, current_step_name: sectionNames[step - 1],
  draft_section: { step, name: sectionNames[step - 1], data: sections[BRAND_SECTION_COLUMNS[step - 1]], version: 1 },
  approval_status: 'reviewing', generation_status: 'reviewing', approved_by: null, approved_at: null, contract_hash: null,
 }
}
