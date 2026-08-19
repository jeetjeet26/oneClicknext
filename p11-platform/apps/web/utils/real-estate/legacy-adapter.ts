import {
  PROPERTY_TYPE_VALUES,
  type PropertyType,
} from '@/utils/property-types'
import {
  propertySubjectKindSchema,
  propertyVerticalProfileSchema,
  type CreatePropertyVerticalProfile,
  type PropertyVerticalProfile,
  type PropertySubjectKind,
} from './contracts'

type LegacyVerticalMapping = {
  verticalKey: string
  displayName: string
  operatingModel: string
  mappingStatus: 'confirmed' | 'needs_review'
  mappingReason: string
}

const LEGACY_MAPPINGS: Record<PropertyType, LegacyVerticalMapping> = {
  multifamily: {
    verticalKey: 'multifamily_residential',
    displayName: 'Multifamily residential',
    operatingModel: 'rental_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy multifamily mapping.',
  },
  senior: {
    verticalKey: 'senior_living',
    displayName: 'Senior living',
    operatingModel: 'rental_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy senior-living mapping.',
  },
  student: {
    verticalKey: 'student_housing',
    displayName: 'Student housing',
    operatingModel: 'rental_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy student-housing mapping.',
  },
  mixed_use: {
    verticalKey: 'mixed_use',
    displayName: 'Mixed-use real estate',
    operatingModel: 'mixed_use',
    mappingStatus: 'needs_review',
    mappingReason:
      'Legacy mixed_use does not identify the primary offering or operating model.',
  },
  affordable: {
    verticalKey: 'affordable_housing',
    displayName: 'Affordable housing',
    operatingModel: 'rental_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy affordable-housing mapping.',
  },
  luxury: {
    verticalKey: 'residential',
    displayName: 'Residential real estate',
    operatingModel: 'residential',
    mappingStatus: 'needs_review',
    mappingReason:
      'Legacy luxury is a market position, not an unambiguous vertical.',
  },
  townhome: {
    verticalKey: 'townhome_community',
    displayName: 'Townhome community',
    operatingModel: 'for_sale_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy townhome mapping.',
  },
  condo: {
    verticalKey: 'condominium_community',
    displayName: 'Condominium community',
    operatingModel: 'for_sale_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy condominium mapping.',
  },
  single_family: {
    verticalKey: 'single_family_community',
    displayName: 'Single-family community',
    operatingModel: 'for_sale_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy single-family mapping.',
  },
  master_planned: {
    verticalKey: 'master_planned_community',
    displayName: 'Master-planned community',
    operatingModel: 'for_sale_residential',
    mappingStatus: 'confirmed',
    mappingReason: 'Deterministic legacy master-planned mapping.',
  },
}

export function legacyPropertyTypeToVerticalProfile(
  propertyType: PropertyType | null,
  subjectKind: PropertySubjectKind = 'real_estate_property'
): CreatePropertyVerticalProfile {
  const mapping = propertyType
    ? LEGACY_MAPPINGS[propertyType]
    : {
        verticalKey: 'residential',
        displayName: 'Residential real estate',
        operatingModel: 'residential',
        mappingStatus: 'needs_review' as const,
        mappingReason: 'Legacy property type is missing.',
      }

  return {
    profile: {
      schemaVersion: 2,
      subjectKind,
      verticalKey: mapping.verticalKey,
      displayName: mapping.displayName,
      operatingModel: mapping.operatingModel,
      attributes: {},
      audiences: [],
      complianceTags: [],
      source: 'legacy_property_type',
      legacyPropertyType: propertyType,
    },
    mappingStatus: mapping.mappingStatus,
    mappingReason: mapping.mappingReason,
    verticalPack: {
      key: `siteforge.real_estate.${mapping.verticalKey}`,
      version: 1,
    },
    expectedVersion: null,
  }
}

export function normalizeLegacyPropertyVerticalProfile(
  value: unknown
): PropertyVerticalProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const legacy = value as Record<string, unknown>
  if (legacy.source !== 'legacy_property_type') return null
  const legacyType =
    typeof legacy.legacyPropertyType === 'string' &&
    PROPERTY_TYPE_VALUES.includes(legacy.legacyPropertyType as PropertyType)
      ? (legacy.legacyPropertyType as PropertyType)
      : null
  const subjectKind =
    propertySubjectKindSchema.safeParse(legacy.subjectKind).data ||
    'real_estate_property'
  const mapped = legacyPropertyTypeToVerticalProfile(legacyType, subjectKind)
  const candidate = {
    ...mapped.profile,
    verticalKey:
      typeof legacy.verticalKey === 'string'
        ? legacy.verticalKey
        : mapped.profile.verticalKey,
    displayName:
      typeof legacy.displayName === 'string'
        ? legacy.displayName
        : mapped.profile.displayName,
    operatingModel:
      typeof legacy.operatingModel === 'string'
        ? legacy.operatingModel
        : mapped.profile.operatingModel,
    attributes:
      legacy.attributes &&
      typeof legacy.attributes === 'object' &&
      !Array.isArray(legacy.attributes)
        ? legacy.attributes
        : mapped.profile.attributes,
    audiences: Array.isArray(legacy.audiences)
      ? legacy.audiences
      : mapped.profile.audiences,
    complianceTags: Array.isArray(legacy.complianceTags)
      ? legacy.complianceTags
      : mapped.profile.complianceTags,
  }
  const parsed = propertyVerticalProfileSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
