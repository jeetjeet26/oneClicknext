import type { PropertyContext } from '@/types/siteforge'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function propertyContextFromOnboardingSnapshot(
  value: unknown,
): PropertyContext {
  const snapshot = record(value)
  const property = record(snapshot.property || snapshot)
  const address = record(property.address)
  const assets = Array.isArray(snapshot.assets) ? snapshot.assets.map(record) : []
  const units = Array.isArray(snapshot.units) ? snapshot.units.map(record) : []
  const contacts = Array.isArray(snapshot.contacts)
    ? snapshot.contacts.map(record)
    : []
  const primaryContact =
    contacts.find((contact) => contact.is_primary === true) || contacts[0] || {}
  const socialMedia = record(property.social_media)

  const id = string(property.id)
  const name = string(property.name)
  if (!id || !name) {
    throw new Error('Pinned onboarding snapshot is missing property identity')
  }

  return {
    id,
    name,
    address: {
      street: string(address.street || address.address1 || address.line1),
      city: string(address.city) || '',
      state: string(address.state) || '',
      zip: string(address.zip || address.postalCode),
      country: string(address.country) || 'USA',
    },
    phone: string(primaryContact.phone),
    email: string(primaryContact.email),
    socialLinks: Object.fromEntries(
      Object.entries(socialMedia).flatMap(([platform, url]) => {
        const normalizedUrl = string(url)
        return normalizedUrl ? [[platform, normalizedUrl]] : []
      })
    ),
    amenities: Array.isArray(property.amenities)
      ? property.amenities.filter((item): item is string => typeof item === 'string')
      : [],
    floorplans: units.map(unit => ({
      name: string(unit.unit_type || unit.name) || 'Apartment',
      bedrooms: typeof unit.bedrooms === 'number' ? unit.bedrooms : 0,
      bathrooms: typeof unit.bathrooms === 'number' ? unit.bathrooms : 0,
      sqft: typeof unit.sqft_min === 'number'
        ? unit.sqft_min
        : typeof unit.sqft === 'number'
          ? unit.sqft
          : 0,
      ...(typeof unit.rent_min === 'number'
        ? { rent: unit.rent_min }
        : typeof unit.rent === 'number'
          ? { rent: unit.rent }
          : {}),
    })),
    photos: assets.flatMap(asset =>
      string(asset.file_url)
        ? [{
            url: string(asset.file_url)!,
            alt: string(asset.alt_text) || name,
            category: string(asset.asset_role),
          }]
        : [],
    ),
    policies: {
      pets: property.pet_policy,
      parking: property.parking_info,
    },
    specialFeatures: Array.isArray(property.special_features)
      ? property.special_features.filter((item): item is string => typeof item === 'string')
      : [],
    unitCount: typeof property.unit_count === 'number' ? property.unit_count : undefined,
    yearBuilt: typeof property.year_built === 'number' ? property.year_built : undefined,
  }
}

export function runtimePropertyProfile(context: PropertyContext) {
  const locality = [context.address.city, context.address.state]
    .filter(Boolean)
    .join(', ')
  return {
    name: context.name,
    address: [
      context.address.street,
      [locality, context.address.zip].filter(Boolean).join(' '),
      context.address.country,
    ]
      .filter(Boolean)
      .join('\n'),
    phone: context.phone || '',
    email: context.email || '',
    socialLinks: context.socialLinks || {},
  }
}
