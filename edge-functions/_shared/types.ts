// Database types and interfaces for SiteForge deployment pipeline

export interface PropertyWebsite {
  id: string;
  property_id: string;
  wp_url: string | null;
  wp_admin_url: string | null;
  wp_instance_id: string | null;
  wp_credentials: WPCredentials | null;
  generation_status: 'queued' | 'generating' | 'completed' | 'ready_for_preview' | 'deployed' | 'failed';
  generation_progress: number;
  site_blueprint: SiteBlueprint | null;
  site_architecture: unknown | null;
  pages_generated: unknown | null;
  deployed_at: string | null;
}

export interface WPCredentials {
  username: string;
  app_password: string;
  api_url: string;
}

export interface SiteforgeJob {
  id: string;
  website_id: string;
  job_type: 'full_generation' | 'regenerate_page' | 'upload_assets' | 'deploy';
  status: 'queued' | 'running' | 'completed' | 'failed';
  input_params: Record<string, unknown>;
  output_data: Record<string, unknown> | null;
  error_details: ErrorDetails | null;
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface ErrorDetails {
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
}

export interface SiteBlueprint {
  pages: BlueprintPage[];
  version: number;
  updatedAt: string;
}

export interface BlueprintPage {
  slug: string;
  title: string;
  purpose: string;
  sections: BlueprintSection[];
}

export interface BlueprintSection {
  id: string;
  type: string;
  acfBlock: string;
  order: number;
  content: Record<string, unknown>;
  fields: Record<string, unknown>;
  cssClasses: string[];
  photoRequirement?: {
    scene: string;
    category: string;
  };
}

export interface WebsiteAsset {
  id: string;
  website_id: string;
  asset_type: 'hero_image' | 'amenity_photo' | 'logo' | 'floor_plan';
  file_url: string;
  page_assignment: string;
  alt_text: string;
  ai_generated: boolean;
}

export interface WPPage {
  id: number;
  slug: string;
  title: {
    rendered: string;
  };
  content: {
    raw: string;
  };
  status: 'publish' | 'draft';
  meta?: Record<string, unknown>;
}

export interface WPMedia {
  id: number;
  source_url: string;
  media_details: {
    width: number;
    height: number;
  };
}

export interface GutenbergBlock {
  blockName: string;
  attrs: Record<string, unknown>;
  innerBlocks: GutenbergBlock[];
  innerHTML: string;
}

export interface DeploymentResult {
  status: 'success' | 'partial' | 'failed';
  pages_created: number;
  media_uploaded: number;
  errors: string[];
  wp_url: string;
  deployed_pages: string[];
}

export interface ProvisioningResult {
  wp_url: string;
  wp_admin_url: string;
  wp_credentials: WPCredentials;
}

export interface StatusResponse {
  job_id: string;
  website_id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  error: ErrorDetails | null;
  deployed_url: string | null;
  started_at: string | null;
  completed_at: string | null;
}
