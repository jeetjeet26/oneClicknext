// SiteForge Deploy Edge Function
// Main job processor for deploying website blueprints to WordPress instances

import { supabase } from '../_shared/supabase.ts';
import { createResponse, createErrorResponse, handleCORS } from '../_shared/cors.ts';
import type { PropertyWebsite, SiteforgeJob, WebsiteAsset, DeploymentResult, ErrorDetails } from '../_shared/types.ts';
import { WordPressClient } from './wp-client.ts';

const MAX_DEPLOYMENT_TIME = 600000; // 10 minutes

/**
 * Create error details object
 */
function createErrorDetails(code: string, message: string, details?: unknown): ErrorDetails {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Update job status in database
 */
async function updateJobStatus(
  jobId: string,
  status: 'queued' | 'running' | 'completed' | 'failed',
  outputData?: Record<string, unknown>,
  errorDetails?: ErrorDetails,
  attempts?: number,
) {
  const updateData: Record<string, unknown> = { status };

  if (status === 'running') {
    updateData.started_at = new Date().toISOString();
  } else if (status === 'completed') {
    updateData.completed_at = new Date().toISOString();
    if (outputData) {
      updateData.output_data = outputData;
    }
  } else if (status === 'failed') {
    updateData.completed_at = new Date().toISOString();
    if (errorDetails) {
      updateData.error_details = errorDetails;
    }
  }

  if (attempts !== undefined) {
    updateData.attempts = attempts;
  }

  const { error } = await supabase
    .from('siteforge_jobs')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    console.error('Error updating job status:', error);
    throw error;
  }
}

/**
 * Update website generation status in database
 */
async function updateWebsiteStatus(
  websiteId: string,
  status: 'queued' | 'generating' | 'completed' | 'ready_for_preview' | 'deployed' | 'failed',
  progress?: number,
  wpUrl?: string,
) {
  const updateData: Record<string, unknown> = { generation_status: status };

  if (progress !== undefined) {
    updateData.generation_progress = progress;
  }

  if (wpUrl) {
    updateData.wp_url = wpUrl;
    updateData.deployed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('property_websites')
    .update(updateData)
    .eq('id', websiteId);

  if (error) {
    console.error('Error updating website status:', error);
    throw error;
  }
}

/**
 * Fetch queued job from database
 */
async function getQueuedJob(): Promise<SiteforgeJob | null> {
  const { data, error } = await supabase
    .from('siteforge_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    console.error('Error fetching queued job:', error);
    throw error;
  }

  return data || null;
}

/**
 * Fetch website data from database
 */
async function getWebsite(websiteId: string): Promise<PropertyWebsite> {
  const { data, error } = await supabase
    .from('property_websites')
    .select('*')
    .eq('id', websiteId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch website: ${error.message}`);
  }

  return data as PropertyWebsite;
}

/**
 * Fetch website assets for media upload
 */
async function getWebsiteAssets(websiteId: string): Promise<WebsiteAsset[]> {
  const { data, error } = await supabase
    .from('website_assets')
    .select('*')
    .eq('website_id', websiteId);

  if (error) {
    console.error('Error fetching assets:', error);
    return [];
  }

  return (data || []) as WebsiteAsset[];
}

/**
 * Deploy website to WordPress instance
 */
async function deployWebsite(job: SiteforgeJob, website: PropertyWebsite): Promise<DeploymentResult> {
  if (!website.wp_credentials) {
    throw new Error('WordPress credentials not configured for this website');
  }

  if (!website.site_blueprint) {
    throw new Error('Site blueprint not found for this website');
  }

  const wpClient = new WordPressClient(website.wp_credentials);

  // Test connection
  console.log('Testing WordPress connection...');
  const isConnected = await wpClient.testConnection();
  if (!isConnected) {
    throw new Error('Failed to connect to WordPress instance');
  }

  const deploymentResult: DeploymentResult = {
    status: 'success',
    pages_created: 0,
    media_uploaded: 0,
    errors: [],
    wp_url: website.wp_url || website.wp_credentials.api_url,
    deployed_pages: [],
  };

  try {
    // Step 1: Update site settings
    const firstPage = website.site_blueprint.pages[0];
    const siteTitle = firstPage?.title || 'Website';
    console.log(`Updating site settings to: ${siteTitle}`);
    await updateWebsiteStatus(website.id, 'generating', 10, undefined);

    try {
      await wpClient.updateSiteSettings(siteTitle, 'Welcome to our site');
    } catch (err) {
      console.warn('Failed to update site settings:', err);
      deploymentResult.errors.push(`Site settings update failed: ${String(err)}`);
    }

    // Step 2: Upload media assets
    console.log('Uploading media assets...');
    await updateWebsiteStatus(website.id, 'generating', 20, undefined);

    const assets = await getWebsiteAssets(website.id);
    const uploadedMediaIds: Record<string, number> = {};

    for (const asset of assets) {
      try {
        const media = await wpClient.uploadMedia(asset.file_url, asset.alt_text);
        uploadedMediaIds[asset.id] = media.id;
        deploymentResult.media_uploaded++;
        console.log(`Uploaded media: ${asset.id} -> ${media.id}`);
      } catch (err) {
        const errorMsg = `Failed to upload media ${asset.id}: ${String(err)}`;
        console.error(errorMsg);
        deploymentResult.errors.push(errorMsg);
      }
    }

    // Step 3: Create/update pages
    console.log('Creating/updating pages...');
    await updateWebsiteStatus(website.id, 'generating', 40, undefined);

    const existingPages = await wpClient.getAllPages();
    const existingPageSlugs = new Set(existingPages.map(p => p.slug));
    let homePageId: number | null = null;

    for (let i = 0; i < website.site_blueprint.pages.length; i++) {
      const pageBlueprint = website.site_blueprint.pages[i];
      const progress = 40 + Math.floor((i / website.site_blueprint.pages.length) * 40);

      try {
        const existingPage = existingPageSlugs.has(pageBlueprint.slug)
          ? existingPages.find(p => p.slug === pageBlueprint.slug)
          : null;

        const page = await wpClient.createOrUpdatePage(
          pageBlueprint.title,
          pageBlueprint.slug,
          pageBlueprint.sections,
          existingPage?.id,
        );

        deploymentResult.pages_created++;
        deploymentResult.deployed_pages.push(pageBlueprint.slug);

        // Set first page as homepage
        if (i === 0) {
          homePageId = page.id;
        }

        console.log(`Created/updated page: ${pageBlueprint.slug} (ID: ${page.id})`);
        await updateWebsiteStatus(website.id, 'generating', progress, undefined);
      } catch (err) {
        const errorMsg = `Failed to create/update page ${pageBlueprint.slug}: ${String(err)}`;
        console.error(errorMsg);
        deploymentResult.errors.push(errorMsg);
      }
    }

    // Step 4: Set homepage
    if (homePageId) {
      console.log(`Setting homepage to page ID: ${homePageId}`);
      await updateWebsiteStatus(website.id, 'generating', 85, undefined);

      try {
        await wpClient.setHomepage(homePageId);
      } catch (err) {
        const errorMsg = `Failed to set homepage: ${String(err)}`;
        console.error(errorMsg);
        deploymentResult.errors.push(errorMsg);
      }
    }

    // Step 5: Create navigation menu
    console.log('Creating navigation menu...');
    await updateWebsiteStatus(website.id, 'generating', 90, undefined);

    const menuItems = website.site_blueprint.pages.map(p => ({
      title: p.title,
      url: `/${p.slug}`,
    }));

    try {
      await wpClient.createNavigationMenu('Main Menu', menuItems);
    } catch (err) {
      console.warn('Failed to create navigation menu:', err);
      deploymentResult.errors.push(`Menu creation failed: ${String(err)}`);
    }

    // Determine final status
    if (deploymentResult.errors.length === 0) {
      deploymentResult.status = 'success';
    } else if (deploymentResult.pages_created > 0) {
      deploymentResult.status = 'partial';
    } else {
      deploymentResult.status = 'failed';
    }

    console.log('Deployment completed:', deploymentResult);
    return deploymentResult;
  } catch (err) {
    console.error('Deployment failed:', err);
    throw err;
  }
}

/**
 * Main handler function
 */
async function deploymentHandler(req: Request): Promise<Response> {
  // Handle CORS
  const corsResponse = handleCORS(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    console.log('Starting SiteForge deployment process...');

    // Fetch next queued job
    const job = await getQueuedJob();
    if (!job) {
      console.log('No queued jobs found');
      return createResponse({
        status: 'idle',
        message: 'No jobs to process',
      }, 200);
    }

    console.log(`Processing job: ${job.id}`);

    // Mark job as running
    await updateJobStatus(job.id, 'running');

    // Fetch website data
    const website = await getWebsite(job.website_id);
    console.log(`Deploying website: ${website.id}`);

    // Execute deployment
    const deploymentResult = await deployWebsite(job, website);

    // Update job status to completed
    const outputData = {
      ...deploymentResult,
      website_id: website.id,
      completed_at: new Date().toISOString(),
    };

    await updateJobStatus(job.id, 'completed', outputData);

    // Update website status based on result
    const finalStatus = deploymentResult.status === 'failed'
      ? 'failed'
      : deploymentResult.status === 'partial'
        ? 'ready_for_preview'
        : 'deployed';

    await updateWebsiteStatus(website.id, finalStatus, 100, website.wp_url || undefined);

    console.log(`Deployment job ${job.id} completed with status: ${finalStatus}`);

    return createResponse({
      status: 'success',
      job_id: job.id,
      website_id: website.id,
      deployment_result: deploymentResult,
      final_website_status: finalStatus,
    }, 200);
  } catch (error) {
    console.error('Deployment handler error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Try to update job status if we have a job
    try {
      const job = await getQueuedJob();
      if (job) {
        const errorDetails = createErrorDetails(
          'DEPLOYMENT_ERROR',
          errorMessage,
          error instanceof Error ? error.stack : undefined,
        );

        const newAttempts = (job.attempts || 0) + 1;
        const isFinal = newAttempts >= (job.max_attempts || 3);

        await updateJobStatus(
          job.id,
          isFinal ? 'failed' : 'queued',
          undefined,
          isFinal ? errorDetails : undefined,
          newAttempts,
        );

        if (isFinal) {
          await updateWebsiteStatus(job.website_id, 'failed', 0, undefined);
        }
      }
    } catch (updateError) {
      console.error('Failed to update job status on error:', updateError);
    }

    return createErrorResponse(
      'Deployment failed',
      500,
      { error: errorMessage },
    );
  }
}

// Handler for Deno
Deno.serve(deploymentHandler);
