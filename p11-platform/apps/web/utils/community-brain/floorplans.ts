/** Exact drawing identity shared by generation and portfolio retrieval. Never use similarity here. */
type Plan = { id: string; property_id?: string | null; unit_type: string; floor_plan_image_asset_id: string | null; floor_plan_image_url: string | null }
type Asset = { id: string; property_id?: string | null; asset_role: string | null; file_url: string | null }
export type FloorplanBinding = { planId: string; assetId: string | null; legacyUrl: string | null }

export function resolveFloorplanBindings(propertyId: string, plans: readonly Plan[], assets: readonly Asset[]): FloorplanBinding[] {
  if (!propertyId || plans.some(plan => 'property_id' in plan && plan.property_id !== propertyId)
      || assets.some(asset => 'property_id' in asset && asset.property_id !== propertyId)) {
    throw new Error('Floorplan ownership does not match the community.')
  }
  if (new Set(assets.map(asset => asset.id)).size !== assets.length || new Set(plans.map(plan => plan.id)).size !== plans.length) {
    throw new Error('Duplicate floorplan or asset identity.')
  }
  return plans.map(plan => {
    // An explicit reference is authoritative even if an older URL still matches another asset.
    const matches = plan.floor_plan_image_asset_id
      ? assets.filter(asset => asset.id === plan.floor_plan_image_asset_id)
      : assets.filter(asset => plan.floor_plan_image_url && asset.file_url === plan.floor_plan_image_url)
    if (plan.floor_plan_image_asset_id && !matches.length) throw new Error(`Approve the saved image for ${plan.unit_type} before generating.`)
    if (matches.length > 1) throw new Error(`The legacy drawing for ${plan.unit_type} is ambiguous. Select its exact floorplan asset.`)
    const asset = matches[0]
    if (asset && asset.asset_role !== 'floorplan') throw new Error(`The selected asset for ${plan.unit_type} must be an approved floorplan.`)
    return { planId: plan.id, assetId: asset?.id ?? null, legacyUrl: asset ? null : plan.floor_plan_image_url }
  })
}
