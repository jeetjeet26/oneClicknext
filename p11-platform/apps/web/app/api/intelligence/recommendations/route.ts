import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTeamOrigin, teamBody } from '@/utils/team/http'
import { InventoryError } from '@/utils/knowledge/inventory'
import { BrainError } from '@/utils/community-brain/contracts'
import { propertyIdSchema } from '@/utils/property-setup/contracts'
import { dateRange } from '@/utils/intelligence/contracts'
import { IntelligenceError } from '@/utils/intelligence/store'
import { generatePropertyRecommendations } from '@/utils/intelligence/recommendations'

export const maxDuration = 300
const request = z.object({ propertyId: propertyIdSchema, start: z.string(), end: z.string() }).strict()
export async function POST(req: NextRequest) {
  try {
    requireTeamOrigin(req)
    const body = request.parse(await teamBody(req, 4096))
    const range = dateRange.parse(body)
    if (range.end >= new Date().toISOString().slice(0, 10)) throw new IntelligenceError('Choose a completed reporting period ending yesterday or earlier.', 400)
    return NextResponse.json(await generatePropertyRecommendations(body.propertyId, range.start, range.end), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    const known = error instanceof IntelligenceError || error instanceof InventoryError || error instanceof BrainError
    return NextResponse.json({ error: error instanceof z.ZodError ? 'Choose a valid community and a reporting period of up to 366 days.' : known ? error.message : 'AI recommendations could not be completed. Your saved analysis is still available; retry to refresh.' }, {
      status: known ? error.status : error instanceof z.ZodError ? 400 : 503,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
}
