// SiteForge: Generate Website API
// POST /api/siteforge/generate
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import type { GeneratedPage, GenerationPreferences, SiteArchitecture } from '@/types/siteforge'
import type { Json } from '@/types/supabase'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  createGenerationRequestSchema,
} from '@/utils/siteforge/contracts'
import { start } from 'workflow/api'
import { siteForgeGenerationWorkflow } from '@/workflows/siteforge-generation'
import { publishSiteForgeArtifact } from '@/utils/siteforge/artifacts/repository'
import {
  loadApprovedSiteForgeGenerationContext,
  SiteForgePlanError,
} from '@/utils/siteforge/plans/repository'

export async function terminalizeOrphanGenerationJob(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  sharedJobId: string,
  message: string
): Promise<void> {
  const terminalAt = new Date().toISOString()
  const { data, error } = await serviceSupabase
    .from('shared_jobs')
    .update({
      lifecycle_status: 'failed',
      status_reason: 'website_create_failed',
      stage: 'failed',
      current_step: 'Generation website record could not be created',
      error_message: message,
      error_details: { message } as Json,
      finished_at: terminalAt,
      updated_at: terminalAt,
    })
    .eq('id', sharedJobId)
    .eq('lifecycle_status', 'queued')
    .select('id')
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      `Failed to terminalize orphan generation job: ${
        error?.message || 'job row was not updated'
      }`
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedBody = createGenerationRequestSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid generation request' },
        { status: 400 }
      )
    }
    const {
      websiteId,
      planId,
      confirmedRevision,
      contentHash,
      idempotencyKey,
    } = parsedBody.data
    const localSimulationEnabled =
      new URL(request.url).searchParams.get('simulate') === '1' &&
      process.env.NODE_ENV !== 'production'

    let generationContext
    try {
      generationContext = await loadApprovedSiteForgeGenerationContext(
        {
          websiteId,
          planId,
          confirmedRevision,
          contentHash,
        },
        serviceSupabase
      )
    } catch (error) {
      if (error instanceof SiteForgePlanError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.statusCode }
        )
      }
      throw error
    }
    const structuredPlan = generationContext.plan
    const planVersion = { id: generationContext.planVersionId }
    const propertyId = generationContext.propertyId
    const preferences: GenerationPreferences = {
      style: structuredPlan.preferences.style,
      emphasis: structuredPlan.preferences.emphasis,
      ctaPriority: structuredPlan.preferences.ctaPriority,
    }
    const prompt = [
      structuredPlan.summary,
      ...structuredPlan.recommendations,
      `Approved brief:\n${JSON.stringify(generationContext.brief)}`,
      `Approved creative direction:\n${JSON.stringify(
        generationContext.creativeDirection
      )}`,
    ].join('\n\n')

    // Verify user has access to this property
    const { data: property, error: propertyError } = await serviceSupabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (
      propertyError ||
      !property?.org_id ||
      property.org_id !== generationContext.orgId
    ) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const nowIso = new Date().toISOString()

    const sharedJobPayload = {
      websiteId,
      planId,
      planVersionId: planVersion.id,
      confirmedRevision,
      contentHash,
      idempotencyKey,
      evidenceSnapshot: generationContext.evidenceSnapshot,
    }
    const { data: sharedJob, error: sharedJobError } = await serviceSupabase
      .from('shared_jobs')
      .insert({
        org_id: property.org_id,
        property_id: propertyId,
        domain: 'siteforge.generation',
        subject_type: 'property_website',
        subject_id: websiteId,
        lifecycle_status: 'queued',
        status_reason: 'workflow_starting',
        stage: 'queued',
        progress: 0,
        current_step: 'Preparing durable generation workflow',
        dedupe_key: idempotencyKey,
        payload: sharedJobPayload as unknown as Json,
        attempt_count: 1,
        max_attempts: 3,
        queued_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single()

    if (sharedJobError || !sharedJob) {
      if (sharedJobError?.code === '23505') {
        const { data: existingJob } = await serviceSupabase
          .from('shared_jobs')
          .select('id, subject_id, lifecycle_status, workflow_run_id')
          .eq('org_id', property.org_id)
          .eq('domain', 'siteforge.generation')
          .eq('dedupe_key', idempotencyKey)
          .maybeSingle()
        if (existingJob?.id && existingJob.subject_id) {
          return NextResponse.json({
            jobId: existingJob.id,
            websiteId: existingJob.subject_id,
            status: existingJob.lifecycle_status,
            workflowRunId: existingJob.workflow_run_id,
            duplicate: true,
            estimatedTimeSeconds: 180,
          })
        }
        return NextResponse.json(
          { error: 'This generation request is already starting' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to create durable generation job' },
        { status: 500 }
      )
    }

    const simulatedPages = localSimulationEnabled
      ? buildLocalSimulationPages(property.name)
      : undefined
    const simulatedArchitecture = localSimulationEnabled
      ? buildLocalSimulationArchitecture(simulatedPages || [])
      : undefined

    const websitePayload = {
      generation_status: localSimulationEnabled ? 'ready_for_preview' : 'queued',
      generation_progress: localSimulationEnabled ? 100 : 0,
      current_step: localSimulationEnabled
        ? 'Generation complete (local simulation).'
        : 'Queued for generation',
      user_preferences: preferences,
      generation_input: {
        sharedJobId: sharedJob.id,
        websiteId,
        planId,
        planVersionId: planVersion.id,
        confirmedRevision,
        contentHash,
        idempotencyKey,
        approvedBrief: generationContext.brief,
        approvedCreativeDirection: generationContext.creativeDirection,
        evidenceSnapshot: generationContext.evidenceSnapshot,
        createdAt: nowIso,
        localSimulation: localSimulationEnabled
          ? {
              enabled: true,
              completedAt: nowIso,
            }
          : undefined,
      },
      generation_started_at: nowIso,
      generation_completed_at: localSimulationEnabled ? nowIso : null,
      generation_duration_seconds: localSimulationEnabled ? 0 : null,
      pages_generated: localSimulationEnabled ? simulatedPages : null,
      site_architecture: localSimulationEnabled ? simulatedArchitecture : null,
    }

    const { data: website, error: websiteError } = await serviceSupabase
      .from('property_websites')
      .update(websitePayload as never)
      .eq('id', websiteId)
      .eq('property_id', propertyId)
      .eq('org_id', property.org_id)
      .select('id')
      .single()

    if (websiteError || !website) {
      console.error('Error preparing website record:', websiteError)
      try {
        await terminalizeOrphanGenerationJob(
          serviceSupabase,
          sharedJob.id,
          websiteError?.message || 'Failed to prepare generation website'
        )
      } catch {
        return NextResponse.json(
          {
            error:
              'Failed to prepare website and could not terminalize its generation job',
          },
          { status: 500 }
        )
      }
      return NextResponse.json({ error: 'Failed to prepare website' }, { status: 500 })
    }

    // Create job for async processing
    const jobPayload = {
      website_id: website.id,
      job_type: 'full_generation',
      status: localSimulationEnabled ? 'complete' : 'queued',
      input_params: {
        sharedJobId: sharedJob.id,
        propertyId,
        planId,
        planVersionId: planVersion.id,
        confirmedRevision,
        contentHash,
        idempotencyKey,
        evidenceSnapshot: generationContext.evidenceSnapshot,
        localSimulation: localSimulationEnabled,
      },
      output_data: localSimulationEnabled
        ? {
            mode: 'local_simulation',
            completedAt: nowIso,
          }
        : null,
      started_at: localSimulationEnabled ? nowIso : null,
      completed_at: localSimulationEnabled ? nowIso : null,
      shared_job_id: sharedJob.id,
    }

    const { data: job, error: jobError } = await serviceSupabase
      .from('siteforge_jobs')
      .insert(jobPayload as never)
      .select()
      .single()

    if (jobError || !job) {
      console.error('Error creating job:', jobError)
      await serviceSupabase
        .from('property_websites')
        .update({
          generation_status: 'failed',
          error_message: 'Failed to create durable generation job',
          updated_at: new Date().toISOString(),
        })
        .eq('id', website.id)

      await serviceSupabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'failed',
          status_reason: 'compatibility_job_failed',
          stage: 'failed',
          current_step: 'Failed to create compatibility job',
          error_message: 'Failed to create compatibility SiteForge job',
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sharedJob.id)

      return NextResponse.json({ error: 'Failed to create generation job' }, { status: 500 })
    }

    const { data: consumedPlan, error: consumePlanError } = await serviceSupabase
      .from('siteforge_plans')
      .update({
        status: 'consumed',
        consumed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', planId)
      .eq('status', 'confirmed')
      .eq('confirmed_version_id', planVersion.id)
      .select('id')
      .single()

    if (consumePlanError || !consumedPlan) {
      const message = 'Confirmed plan was already consumed or changed'
      await Promise.all([
        serviceSupabase
          .from('shared_jobs')
          .update({
            lifecycle_status: 'failed',
            status_reason: 'plan_consume_conflict',
            stage: 'failed',
            current_step: message,
            error_message: message,
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', sharedJob.id),
        serviceSupabase
          .from('siteforge_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_details: { message } as Json,
          })
          .eq('id', job.id),
        serviceSupabase
          .from('property_websites')
          .update({
            generation_status: 'failed',
            current_step: message,
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', website.id),
      ])
      return NextResponse.json({ error: message }, { status: 409 })
    }

    let workflowRunId: string | null = null
    if (!localSimulationEnabled) {
      try {
        const run = await start(siteForgeGenerationWorkflow, [
          {
            sharedJobId: sharedJob.id,
            legacyJobId: job.id,
            websiteId: website.id,
            propertyId,
            orgId: property.org_id,
            planVersionId: planVersion.id,
            preferences,
            prompt,
            approvedBrief: generationContext.brief,
            approvedCreativeDirection: generationContext.creativeDirection,
            evidenceSnapshot: generationContext.evidenceSnapshot,
            startedAt: nowIso,
          },
        ])
        workflowRunId = run.runId
        const { error: workflowLinkError } = await serviceSupabase
          .from('shared_jobs')
          .update({
            workflow_run_id: run.runId,
            workflow_name: 'siteForgeGenerationWorkflow',
            subject_id: website.id,
            payload: {
              ...sharedJobPayload,
              websiteId: website.id,
              legacyJobId: job.id,
            } as Json,
            status_reason: 'workflow_queued',
            current_step: 'Durable workflow queued',
            updated_at: new Date().toISOString(),
          })
          .eq('id', sharedJob.id)
        if (workflowLinkError) {
          await run.cancel()
          throw new Error(`Failed to link workflow run: ${workflowLinkError.message}`)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to start durable workflow'
        await Promise.all([
          serviceSupabase
            .from('shared_jobs')
            .update({
              lifecycle_status: 'failed',
              status_reason: 'workflow_start_failed',
              stage: 'failed',
              current_step: 'Workflow failed to start',
              error_message: message,
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sharedJob.id),
          serviceSupabase
            .from('siteforge_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_details: { message } as Json,
            })
            .eq('id', job.id),
          serviceSupabase
            .from('property_websites')
            .update({
              generation_status: 'failed',
              error_message: message,
              updated_at: new Date().toISOString(),
            })
            .eq('id', website.id),
        ])
        return NextResponse.json({ error: message }, { status: 500 })
      }
    } else {
      const simulatedArtifact = await publishSiteForgeArtifact(
        {
          websiteId: website.id,
          propertyId,
          orgId: property.org_id,
          sharedJobId: sharedJob.id,
          sourcePlanVersionId: planVersion.id,
          blueprint: {
            version: 1,
            propertyId,
            generatedAt: nowIso,
            pages: simulatedPages || [],
            architecture: simulatedArchitecture || {},
            plan: structuredPlan,
            generationEvidence: generationContext.evidenceSnapshot,
            approvedBrief: generationContext.brief,
            approvedCreativeDirection: generationContext.creativeDirection,
          } as unknown as Json,
          qualityReport: {
            passed: true,
            score: 100,
            mode: 'local_simulation',
          } as Json,
          qualityScore: 100,
        },
        serviceSupabase
      )
      const { data: completedJob, error: completeJobError } = await serviceSupabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'succeeded',
          status_reason: 'local_simulation_complete',
          stage: 'ready_for_preview',
          progress: 100,
          current_step: 'Generation complete (local simulation).',
          subject_id: website.id,
          output: {
            mode: 'local_simulation',
            websiteId: website.id,
            artifactId: simulatedArtifact.id,
            contentHash: simulatedArtifact.contentHash,
          },
          started_at: nowIso,
          finished_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', sharedJob.id)
        .select('id')
        .single()
      if (completeJobError || !completedJob) {
        throw new Error(
          `Failed to terminalize local generation: ${
            completeJobError?.message || 'missing job'
          }`
        )
      }
    }

    return NextResponse.json({
      jobId: sharedJob.id,
      websiteId: website.id,
      status: 'queued',
      workflowRunId,
      estimatedTimeSeconds: localSimulationEnabled ? 1 : 180,
      localSimulation: localSimulationEnabled,
    })

  } catch (error) {
    console.error('Generate website error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate website' },
      { status: 500 }
    )
  }
}

function buildLocalSimulationPages(propertyName: string | null | undefined): GeneratedPage[] {
  const label = propertyName || 'Property'
  return [
    {
      slug: 'home',
      title: `${label} Home`,
      purpose: 'Provide a deterministic local preview page for smoke validation.',
      sections: [],
    },
  ]
}

function buildLocalSimulationArchitecture(pages: GeneratedPage[]): SiteArchitecture {
  return {
    navigation: {
      structure: 'primary',
      items: pages.map((page, index) => ({
        label: page.title,
        slug: page.slug,
        priority: index === 0 ? 'high' : 'medium',
      })),
      cta: {
        text: 'Schedule a Tour',
        style: 'primary',
      },
    },
    pages,
    designDecisions: {
      colorStrategy: 'local-simulation',
      imageStrategy: 'local-simulation',
      contentDensity: 'balanced',
      conversionOptimization: ['Deterministic local simulation for smoke validation'],
    },
  }
}
