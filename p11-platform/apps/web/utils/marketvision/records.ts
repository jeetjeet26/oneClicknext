export interface Competitor {
  id: string
  version: number
  propertyId: string
  name: string
  address: string | null
  addressJson: {
    street?: string
    city?: string
    state?: string
    zip?: string
    lat?: number
    lng?: number
  } | null
  websiteUrl: string | null
  phone: string | null
  unitsCount: number | null
  yearBuilt: number | null
  propertyType: string
  amenities: string[]
  photos: string[]
  ilsListings: Record<string, string>
  notes: string | null
  isActive: boolean
  lastScrapedAt: string | null
  createdAt: string
  updatedAt: string
  units?: CompetitorUnit[]
}

export interface CompetitorUnit {
  version: number
  id: string
  competitorId: string
  unitType: string
  bedrooms: number
  bathrooms: number | null
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  deposit: number | null
  availableCount: number | null
  moveInSpecials: string | null
  lastUpdatedAt: string
}

// Format competitor from DB to API response
export function formatCompetitor(data: Record<string, unknown>): Competitor {
  const amenities = Array.isArray(data.amenities) ? data.amenities as string[] : []
  const formatted: Competitor = {
    id: data.id as string,
    version: data.version as number,
    propertyId: data.property_id as string,
    name: data.name as string,
    address: data.address as string | null,
    addressJson: data.address_json as Competitor['addressJson'],
    websiteUrl: data.website_url as string | null,
    phone: data.phone as string | null,
    unitsCount: data.units_count as number | null,
    yearBuilt: data.year_built as number | null,
    propertyType: data.property_type as string || 'multifamily',
    amenities,
    photos: (data.photos as string[]) || [],
    ilsListings: (data.ils_listings as Record<string, string>) || {},
    notes: data.notes as string | null,
    isActive: data.is_active as boolean,
    lastScrapedAt: data.last_scraped_at as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string
  }

  // Include units if present
  if (data.units && Array.isArray(data.units)) {
    formatted.units = data.units.map(formatUnit)
  }

  return formatted
}

export function formatUnit(data: Record<string, unknown>): CompetitorUnit {
  return {
    id: data.id as string,
    version: data.version as number,
    competitorId: data.competitor_id as string,
    unitType: data.unit_type as string,
    bedrooms: data.bedrooms as number,
    bathrooms: data.bathrooms as number | null,
    sqftMin: data.sqft_min as number | null,
    sqftMax: data.sqft_max as number | null,
    rentMin: data.rent_min as number | null,
    rentMax: data.rent_max as number | null,
    deposit: data.deposit as number | null,
    availableCount: data.available_count as number | null,
    moveInSpecials: data.move_in_specials as string | null,
    lastUpdatedAt: data.last_updated_at as string
  }
}

