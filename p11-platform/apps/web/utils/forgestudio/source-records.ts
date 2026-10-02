/** Exact selected source values, verified inside the snapshot transaction. */
export const sourceFields = {
  "property": [
    "id",
    "name",
    "address",
    "property_type",
    "website_url",
    "unit_count",
    "target_audience",
    "brand_voice"
  ],
  "config": [
    "brand_voice",
    "target_audience",
    "key_amenities",
    "include_hashtags",
    "include_cta",
    "max_caption_length"
  ],
  "onboarding": [
    "id",
    "status",
    "snapshot_payload",
    "content_hash",
    "unresolved_conflicts"
  ],
  "legal": [
    "id",
    "status",
    "version",
    "fair_housing",
    "pricing_disclaimer",
    "accessibility",
    "effective_at"
  ],
  "brand": [
    "id",
    "generation_status",
    "approval_status",
    "contract_version",
    "contract_hash",
    "section_1_introduction",
    "section_2_positioning",
    "section_3_target_audience",
    "section_4_personas",
    "section_5_name_story",
    "section_6_logo",
    "section_7_typography",
    "section_8_colors",
    "section_9_design_elements",
    "section_10_photo_yep",
    "section_11_photo_nope",
    "section_12_implementation"
  ],
  "asset": [
    "id",
    "name",
    "asset_type",
    "file_url",
    "thumbnail_url",
    "description",
    "width",
    "height",
    "duration_seconds",
    "alt_text",
    "rights_status",
    "approval_status",
    "curation_status",
    "expires_at",
    "duplicate_of",
    "content_hash",
    "storage_bucket",
    "storage_path",
    "archived_at",
    "replacement_asset_id"
  ],
  "inventory": [
    "id",
    "active",
    "unit_type",
    "bedrooms",
    "bathrooms",
    "sqft_min",
    "sqft_max",
    "rent_min",
    "rent_max",
    "available_count",
    "move_in_specials",
    "effective_at",
    "source_updated_at",
    "expires_at",
    "confidence",
    "review_status",
    "source_identity"
  ],
  "poi": [
    "id",
    "name",
    "category",
    "address",
    "distance_miles",
    "travel_time_minutes",
    "source_url",
    "captured_at",
    "confidence",
    "approval_status"
  ],
  "testimonial": [
    "id",
    "status",
    "review_text_snapshot",
    "reviewer_name_snapshot",
    "rating_snapshot",
    "platform_snapshot",
    "attribution_approved",
    "rights_basis",
    "revoked_at"
  ],
  "document": [
    "id",
    "content",
    "metadata"
  ]
} as const
export type SourceRecordKind = keyof typeof sourceFields
export type SourceRecord = {kind:SourceRecordKind;id:string;values:Record<string,unknown>}
export function sourceRecord(kind:SourceRecordKind,id:string,row:Record<string,unknown>):SourceRecord {
 return {kind,id,values:Object.fromEntries(sourceFields[kind].map(key=>[key,row[key]??null]))}
}
