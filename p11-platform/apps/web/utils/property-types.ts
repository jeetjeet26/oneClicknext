export const PROPERTY_TYPE_VALUES = [
  'multifamily',
  'senior',
  'student',
  'mixed_use',
  'affordable',
  'luxury',
  'townhome',
  'condo',
  'single_family',
  'master_planned',
] as const

export type PropertyType = (typeof PROPERTY_TYPE_VALUES)[number]

type PropertyTypeCategory = 'rental_residential' | 'for_sale_residential' | 'mixed_use'

export type PropertyTypeConfig = {
  value: PropertyType
  label: string
  description: string
  category: PropertyTypeCategory
  displayNoun: string
  pluralDisplayNoun: string
  searchNouns: string[]
  isRentalResidential: boolean
  isForSaleResidential: boolean
}

export const PROPERTY_TYPE_CONFIGS: PropertyTypeConfig[] = [
  {
    value: 'multifamily',
    label: 'Multifamily',
    description: 'Standard apartment community',
    category: 'rental_residential',
    displayNoun: 'apartment community',
    pluralDisplayNoun: 'apartment communities',
    searchNouns: ['apartments', 'apartment community', 'multifamily community'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'senior',
    label: 'Senior Living',
    description: '55+ or active adult',
    category: 'rental_residential',
    displayNoun: 'senior living community',
    pluralDisplayNoun: 'senior living communities',
    searchNouns: ['senior living', '55+ community', 'active adult apartments'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'student',
    label: 'Student Housing',
    description: 'Near universities',
    category: 'rental_residential',
    displayNoun: 'student housing community',
    pluralDisplayNoun: 'student housing communities',
    searchNouns: ['student housing', 'student apartments', 'off-campus housing'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'mixed_use',
    label: 'Mixed Use',
    description: 'Residential + commercial',
    category: 'mixed_use',
    displayNoun: 'mixed-use community',
    pluralDisplayNoun: 'mixed-use communities',
    searchNouns: ['mixed-use community', 'mixed-use apartments', 'mixed-use development'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'affordable',
    label: 'Affordable',
    description: 'Income-restricted housing',
    category: 'rental_residential',
    displayNoun: 'affordable housing community',
    pluralDisplayNoun: 'affordable housing communities',
    searchNouns: ['affordable housing', 'income-restricted apartments', 'affordable apartments'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'luxury',
    label: 'Luxury',
    description: 'High-end amenities',
    category: 'rental_residential',
    displayNoun: 'luxury apartment community',
    pluralDisplayNoun: 'luxury apartment communities',
    searchNouns: ['luxury apartments', 'luxury apartment community', 'premium apartments'],
    isRentalResidential: true,
    isForSaleResidential: false,
  },
  {
    value: 'townhome',
    label: 'Townhomes',
    description: 'Attached homes or townhome-style residences',
    category: 'for_sale_residential',
    displayNoun: 'townhome community',
    pluralDisplayNoun: 'townhome communities',
    searchNouns: ['townhomes for sale', 'new townhomes', 'townhome community'],
    isRentalResidential: false,
    isForSaleResidential: true,
  },
  {
    value: 'condo',
    label: 'Condos',
    description: 'Condominiums for ownership',
    category: 'for_sale_residential',
    displayNoun: 'condo community',
    pluralDisplayNoun: 'condo communities',
    searchNouns: ['condos for sale', 'new condos', 'condo residences'],
    isRentalResidential: false,
    isForSaleResidential: true,
  },
  {
    value: 'single_family',
    label: 'Single-Family Homes',
    description: 'Detached homes for ownership',
    category: 'for_sale_residential',
    displayNoun: 'single-family home community',
    pluralDisplayNoun: 'single-family home communities',
    searchNouns: ['new homes for sale', 'single-family homes', 'home community'],
    isRentalResidential: false,
    isForSaleResidential: true,
  },
  {
    value: 'master_planned',
    label: 'Master-Planned Community',
    description: 'Planned neighborhood with homes and amenities',
    category: 'for_sale_residential',
    displayNoun: 'master-planned community',
    pluralDisplayNoun: 'master-planned communities',
    searchNouns: ['master-planned community', 'new homes community', 'planned community'],
    isRentalResidential: false,
    isForSaleResidential: true,
  },
]

export const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPE_CONFIGS.map(({ value, label, description }) => ({
  value,
  label,
  description,
}))

const PROPERTY_TYPE_CONFIG_BY_VALUE = new Map<PropertyType, PropertyTypeConfig>(
  PROPERTY_TYPE_CONFIGS.map(config => [config.value, config])
)

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && PROPERTY_TYPE_VALUES.includes(value as PropertyType)
}

export function normalizePropertyType(value: unknown): PropertyType | null {
  if (value === null || value === undefined || value === '') return null
  return isPropertyType(value) ? value : null
}

export function getPropertyTypeConfig(value: string | null | undefined): PropertyTypeConfig {
  return PROPERTY_TYPE_CONFIG_BY_VALUE.get(normalizePropertyType(value) || 'multifamily') || PROPERTY_TYPE_CONFIGS[0]
}

export function getPropertyTypeLabel(value: string | null | undefined): string {
  if (!value) return 'Not specified'
  return getPropertyTypeConfig(value).label
}

export function getPropertySearchTerms(value: string | null | undefined): string[] {
  return getPropertyTypeConfig(value).searchNouns
}

export function isForSaleResidentialType(value: string | null | undefined): boolean {
  return getPropertyTypeConfig(value).isForSaleResidential
}

export function assertValidPropertyType(value: unknown): PropertyType | null {
  if (value === null || value === undefined || value === '') return null
  if (isPropertyType(value)) return value
  throw new Error('Invalid property type')
}
