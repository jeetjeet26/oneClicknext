import { NextRequest } from 'next/server'
import { z } from 'zod'
import { runBrandCommand } from '@/utils/brandforge/operations'
import { prepareBrandRevision } from '@/utils/brandforge/revisions'
export async function POST(request: NextRequest) {
 return runBrandCommand(request, 'revise', { step: z.number().int().min(1).max(12).default(1) }, async ({ body, brand }) => ({ updates: prepareBrandRevision(brand, body.step), result: { readyForReview: true, step: body.step } }))
}
