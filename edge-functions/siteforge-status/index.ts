// SiteForge Status Edge Function
// Returns current status of deployment jobs and website generation

import { supabase } from '../_shared/supabase.ts';
import { createResponse, createErrorResponse, handleCORS } from '../_shared/cors.ts';
import type { SiteforgeJob, PropertyWebsite, StatusResponse } from '../_shared/types.ts';

/**
 * Fetch job by ID
 */
async function getJobById(jobId: string): Promise<SiteforgeJob | null> {
  const { data, error } = await supabase
    .from('siteforge_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('Error fetching job:', error);
    throw error;
  }

  return data || null;
}

/**
 * Fetch website by ID
 */
async function getWebsiteById(websiteId: string): Promise<PropertyWebsite | null> {
  const { data, error } = await supabase
    .from('property_websites')
    .select('*')
    .eq('id', websiteId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('Error fetching website:', error);
    throw error;
  }

  return data || null;
}

/**
 * Fetch latest job for a website
 */
async function getLatestJobForWebsite(websiteId: string): Promise<SiteforgeJob | null> {
  const { data, error } = await supabase
    .from('siteforge_jobs')
    .select('*')
    .eq('website_id', websiteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('Error fetching latest job:', error);
    throw error;
  }

  return data || null;
}

/**
 * Calculate progress percentage based on job status and website generation progress
 */
function calculateProgress(job: SiteforgeJob, website: PropertyWebsite | null): number {
  if (job.status === 'completed') {
    return 100;
  }

  if (job.status === 'failed') {
    return website?.generation_progress || 0;
  }

  if (job.status === 'running') {
    // Use website generation progress if available
    return website?.generation_progress || 50;
  }

  // queued status
  return website?.generation_progress || 0;
}

/**
 * Build status response
 */
function buildStatusResponse(job: SiteforgeJob, website: PropertyWebsite | null): StatusResponse {
  const progress = calculateProgress(job, website);

  return {
    job_id: job.id,
    website_id: job.website_id,
    job_type: job.job_type,
    status: job.status as any,
    progress,
    error: job.error_details || null,
    deployed_url: website?.wp_url || null,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

/**
 * Main status handler
 */
async function statusHandler(req: Request): Promise<Response> {
  // Handle CORS
  const corsResponse = handleCORS(req);
  if (corsResponse) {
    return corsResponse;
  }

  if (req.method !== 'GET') {
    return createErrorResponse('Only GET requests are supported', 405);
  }

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const websiteId = url.searchParams.get('website_id');

    if (!jobId && !websiteId) {
      return createErrorResponse('Either job_id or website_id query parameter is required', 400);
    }

    let job: SiteforgeJob | null = null;
    let website: PropertyWebsite | null = null;

    if (jobId) {
      console.log(`Fetching status for job: ${jobId}`);
      job = await getJobById(jobId);

      if (!job) {
        return createErrorResponse(`Job not found: ${jobId}`, 404);
      }

      // Fetch associated website
      website = await getWebsiteById(job.website_id);
    } else {
      console.log(`Fetching status for website: ${websiteId}`);
      website = await getWebsiteById(websiteId!);

      if (!website) {
        return createErrorResponse(`Website not found: ${websiteId}`, 404);
      }

      // Fetch latest job for website
      job = await getLatestJobForWebsite(websiteId!);

      if (!job) {
        // No job yet, but website exists
        // Return a synthetic response based on website status
        return createResponse({
          website_id: website.id,
          generation_status: website.generation_status,
          progress: website.generation_progress,
          deployed_url: website.wp_url,
          deployed_at: website.deployed_at,
          message: 'No deployment job found for this website',
        }, 200);
      }
    }

    const statusResponse = buildStatusResponse(job, website);

    console.log(`Status retrieved for job ${job.id}:`, statusResponse);

    return createResponse(statusResponse, 200);
  } catch (error) {
    console.error('Status handler error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    return createErrorResponse(
      'Failed to retrieve status',
      500,
      { error: errorMessage },
    );
  }
}

// Handler for Deno
Deno.serve(statusHandler);
