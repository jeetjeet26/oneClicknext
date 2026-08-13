import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  generationPreferencesSchema,
  siteForgeSiteTypeSchema,
} from '@/utils/siteforge/contracts'
import {
  createPlanRevision,
  getLatestWebsitePlanRevision,
  SiteForgePlanError,
} from '@/utils/siteforge/plans/repository'
import { SITEFORGE_CLAUDE_MODEL } from '@/utils/siteforge/models'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const conversationEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(20_000),
  timestamp: z.string().datetime().optional(),
})

const planningRequestSchema = z.object({
  websiteId: z.guid(),
  propertyId: z.guid(),
  planId: z.guid().nullable().optional(),
  expectedRevision: z.number().int().positive().nullable().optional(),
  conversationHistory: z.array(conversationEntrySchema).max(30).default([]),
  userMessage: z.string().trim().min(1).max(5_000).nullable().optional(),
  preferences: generationPreferencesSchema.optional(),
  siteType: siteForgeSiteTypeSchema.optional(),
  // Accepted during the client migration, but intentionally ignored. The
  // trusted brand context is always assembled again on the server.
  brandContext: z.unknown().optional(),
})

function planSummaryForPrompt(plan: {
  summary: string
  brandDirection: { positioning: string; visualDirection: string }
  pages: Array<{ title: string; sections: Array<{ label: string }> }>
  conversionStrategy: { primaryAction: string }
  recommendations: string[]
}) {
  return {
    summary: plan.summary,
    positioning: plan.brandDirection.positioning,
    visualDirection: plan.brandDirection.visualDirection,
    primaryAction: plan.conversionStrategy.primaryAction,
    pages: plan.pages.map((page) => ({
      title: page.title,
      sections: page.sections.map((section) => section.label),
    })),
    operatorRecommendations: plan.recommendations,
  }
}

export async function GET(request: NextRequest) {
  try {
    const propertyId = new URL(request.url).searchParams.get('propertyId')
    const websiteId = new URL(request.url).searchParams.get('websiteId')
    const parsedPropertyId = z.guid().safeParse(propertyId)
    const parsedWebsiteId = z.guid().safeParse(websiteId)
    if (!parsedPropertyId.success || !parsedWebsiteId.success) {
      return NextResponse.json(
        { error: 'Valid property and website IDs required' },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, parsedPropertyId.data)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const plan = await getLatestWebsitePlanRevision({
      websiteId: parsedWebsiteId.data,
      propertyId: parsedPropertyId.data,
      orgId: access.orgId,
    })
    return NextResponse.json({ plan })
  } catch (error) {
    if (error instanceof SiteForgePlanError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('SiteForge plan load error:', error)
    return NextResponse.json({ error: 'Failed to load SiteForge plan' }, { status: 500 })
  }
}

async function createNarrativeResponse(
  plan: Parameters<typeof planSummaryForPrompt>[0],
  userMessage: string | null | undefined
): Promise<string> {
  const response = await anthropic.messages.create({
    model: SITEFORGE_CLAUDE_MODEL,
    max_tokens: 1_500,
    system: `You are SiteForge's planning assistant for multifamily websites.
Explain the supplied server-owned structured plan in clear, concise language.
Distinguish verified direction from recommendations. Do not invent property facts,
demographic claims, safety claims, pricing, amenities, or availability. Never ask
the user to type a magic phrase. The interface provides explicit review and
approval controls. End with one optional, high-value refinement question.`,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          currentStructuredPlan: planSummaryForPrompt(plan),
          latestOperatorDirection: userMessage || null,
        }),
      },
    ],
  })

  const narrative = response.content
    .filter((item): item is Anthropic.TextBlock => item.type === 'text')
    .map((item) => item.text)
    .join('')
    .trim()

  if (!narrative) {
    return `${plan.summary}\n\nThe structured plan is ready for review.`
  }

  return narrative
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedRequest = planningRequestSchema.safeParse(await request.json())
    if (!parsedRequest.success) {
      return NextResponse.json({ error: 'Invalid planning request' }, { status: 400 })
    }

    const {
      propertyId,
      websiteId,
      planId,
      expectedRevision,
      conversationHistory,
      userMessage,
      preferences,
      siteType,
    } = parsedRequest.data

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const persisted = await createPlanRevision({
      propertyId,
      websiteId,
      userId: user.id,
      preferences,
      siteType,
      operatorDirection: userMessage,
      planId,
      expectedRevision,
      conversationHistory: [
        ...conversationHistory.map((entry) => ({
          role: entry.role,
          content: entry.content,
          timestamp: entry.timestamp || now,
        })),
        ...(userMessage
          ? [{ role: 'user' as const, content: userMessage, timestamp: now }]
          : []),
      ],
    })
    const aiResponse = await createNarrativeResponse(persisted.plan, userMessage)

    return NextResponse.json({
      aiResponse,
      planId: persisted.planId,
      planVersionId: persisted.planVersionId,
      revision: persisted.revision,
      contentHash: persisted.contentHash,
      plan: persisted.plan,
      readiness: persisted.readiness,
      planState: persisted.status,
      suggestedActions: ['Review plan', 'Refine with AI'],
    })
  } catch (error) {
    if (error instanceof SiteForgePlanError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Planning conversation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Planning failed' },
      { status: 500 }
    )
  }
}
