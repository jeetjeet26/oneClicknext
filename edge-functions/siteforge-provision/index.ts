// SiteForge Provision Edge Function
// Creates new WordPress instances for properties via hosting provider API

import { supabase } from '../_shared/supabase.ts';
import { createResponse, createErrorResponse, handleCORS } from '../_shared/cors.ts';
import type { PropertyWebsite, WPCredentials, ProvisioningResult } from '../_shared/types.ts';
import { WordPressClient } from '../siteforge-deploy/wp-client.ts';

type ProviderType = 'cloudways' | 'wpengine' | 'manual';

interface ProvisioningRequest {
  property_id: string;
  property_name: string;
  desired_subdomain: string;
  provider?: ProviderType;
}

/**
 * Validate WordPress credentials by testing the connection
 */
async function validateCredentials(credentials: WPCredentials): Promise<boolean> {
  try {
    const wpClient = new WordPressClient(credentials);
    return await wpClient.testConnection();
  } catch (error) {
    console.error('Credential validation failed:', error);
    return false;
  }
}

/**
 * Provision via Cloudways API
 * TODO: Implement full Cloudways API integration
 * Endpoint: https://api.cloudways.com/api/v1
 * Required: API key, API token
 * Steps:
 * 1. Create server (if needed)
 * 2. Install WordPress application
 * 3. Get credentials
 * 4. Configure WordPress
 */
async function provisionCloudways(
  propertyName: string,
  subdomain: string,
): Promise<ProvisioningResult> {
  console.log(`Provisioning via Cloudways for property: ${propertyName}`);
  // TODO: Implement Cloudways API calls
  throw new Error('Cloudways provisioning not yet implemented');
}

/**
 * Provision via WP Engine API
 * TODO: Implement full WP Engine API integration
 * Endpoint: https://api.wpengine.com/v1
 * Required: API key
 * Steps:
 * 1. Create account
 * 2. Configure environment
 * 3. Get credentials
 */
async function provisionWPEngine(
  propertyName: string,
  subdomain: string,
): Promise<ProvisioningResult> {
  console.log(`Provisioning via WP Engine for property: ${propertyName}`);
  // TODO: Implement WP Engine API calls
  throw new Error('WP Engine provisioning not yet implemented');
}

/**
 * Provision manual installation
 * Validates that credentials are already configured
 */
async function provisionManual(
  websiteId: string,
  credentials: WPCredentials,
): Promise<ProvisioningResult> {
  console.log('Provisioning manual WordPress installation');

  // Validate credentials
  const isValid = await validateCredentials(credentials);
  if (!isValid) {
    throw new Error('Invalid WordPress credentials: unable to connect to API');
  }

  // Get instance info to verify setup
  const wpClient = new WordPressClient(credentials);
  try {
    await wpClient.getInstanceInfo();
  } catch (error) {
    throw new Error(`Failed to access WordPress instance: ${String(error)}`);
  }

  return {
    wp_url: credentials.api_url,
    wp_admin_url: credentials.api_url + '/wp-admin',
    wp_credentials: credentials,
  };
}

/**
 * Create website record in database
 */
async function createWebsiteRecord(
  propertyId: string,
  wpUrl: string,
  wpAdminUrl: string,
  wpCredentials: WPCredentials,
  instanceId?: string,
): Promise<PropertyWebsite> {
  const { data, error } = await supabase
    .from('property_websites')
    .insert({
      property_id: propertyId,
      wp_url: wpUrl,
      wp_admin_url: wpAdminUrl,
      wp_instance_id: instanceId || null,
      wp_credentials: wpCredentials,
      generation_status: 'queued',
      generation_progress: 0,
      site_blueprint: null,
      site_architecture: null,
      pages_generated: null,
      deployed_at: null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create website record: ${error.message}`);
  }

  return data as PropertyWebsite;
}

/**
 * Update existing website record with credentials
 */
async function updateWebsiteCredentials(
  websiteId: string,
  wpUrl: string,
  wpAdminUrl: string,
  wpCredentials: WPCredentials,
  instanceId?: string,
): Promise<PropertyWebsite> {
  const { data, error } = await supabase
    .from('property_websites')
    .update({
      wp_url: wpUrl,
      wp_admin_url: wpAdminUrl,
      wp_instance_id: instanceId || null,
      wp_credentials: wpCredentials,
      generation_status: 'queued',
    })
    .eq('id', websiteId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update website credentials: ${error.message}`);
  }

  return data as PropertyWebsite;
}

/**
 * Fetch website record by ID
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
 * Main provisioning handler
 */
async function provisioningHandler(req: Request): Promise<Response> {
  // Handle CORS
  const corsResponse = handleCORS(req);
  if (corsResponse) {
    return corsResponse;
  }

  if (req.method !== 'POST') {
    return createErrorResponse('Only POST requests are supported', 405);
  }

  try {
    const body = await req.json() as Record<string, unknown>;

    // Validate request
    const propertyId = body.property_id as string | undefined;
    const propertyName = body.property_name as string | undefined;
    const provider = (body.provider || 'manual') as ProviderType;
    const desiredSubdomain = body.desired_subdomain as string | undefined;
    const websiteId = body.website_id as string | undefined;
    const wpCredentials = body.wp_credentials as WPCredentials | undefined;

    if (!propertyId && !websiteId) {
      return createErrorResponse('Either property_id or website_id is required', 400);
    }

    if (!propertyName && provider !== 'manual') {
      return createErrorResponse('property_name is required for automated provisioning', 400);
    }

    console.log(`Provisioning request: provider=${provider}, property_id=${propertyId}`);

    let result: ProvisioningResult;
    let finalWebsiteId = websiteId;

    // Execute provisioning based on provider
    switch (provider) {
      case 'cloudways':
        if (!desiredSubdomain) {
          return createErrorResponse('desired_subdomain is required for Cloudways', 400);
        }
        result = await provisionCloudways(propertyName!, desiredSubdomain);
        break;

      case 'wpengine':
        if (!desiredSubdomain) {
          return createErrorResponse('desired_subdomain is required for WP Engine', 400);
        }
        result = await provisionWPEngine(propertyName!, desiredSubdomain);
        break;

      case 'manual':
        if (!wpCredentials) {
          return createErrorResponse('wp_credentials are required for manual provisioning', 400);
        }
        if (!websiteId) {
          return createErrorResponse('website_id is required for manual provisioning', 400);
        }
        result = await provisionManual(websiteId, wpCredentials);
        break;

      default:
        return createErrorResponse(`Unknown provider: ${provider}`, 400);
    }

    // Store/update credentials in database
    let website: PropertyWebsite;

    if (websiteId) {
      // Update existing website
      website = await updateWebsiteCredentials(
        websiteId,
        result.wp_url,
        result.wp_admin_url,
        result.wp_credentials,
      );
    } else {
      // Create new website
      website = await createWebsiteRecord(
        propertyId!,
        result.wp_url,
        result.wp_admin_url,
        result.wp_credentials,
      );
      finalWebsiteId = website.id;
    }

    console.log(`Provisioning completed. Website ID: ${finalWebsiteId}, URL: ${result.wp_url}`);

    return createResponse({
      status: 'success',
      message: 'Provisioning completed successfully',
      website_id: finalWebsiteId,
      wp_url: result.wp_url,
      wp_admin_url: result.wp_admin_url,
      wp_credentials: {
        username: result.wp_credentials.username,
        api_url: result.wp_credentials.api_url,
        // NOTE: app_password is intentionally not returned in response
      },
    }, 200);
  } catch (error) {
    console.error('Provisioning handler error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    return createErrorResponse(
      'Provisioning failed',
      500,
      { error: errorMessage },
    );
  }
}

// Handler for Deno
Deno.serve(provisioningHandler);
