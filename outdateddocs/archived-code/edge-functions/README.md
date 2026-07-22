# SiteForge Edge Functions

Supabase Edge Functions for the SiteForge AI website generation deployment pipeline. These functions handle provisioning WordPress instances, deploying blueprint-based website designs, and tracking job status.

## Overview

The SiteForge deployment pipeline consists of three main Edge Functions:

1. **siteforge-deploy** — Main job processor that deploys websites
2. **siteforge-provision** — Creates WordPress instances
3. **siteforge-status** — Returns deployment job status

## Architecture

```
┌─────────────────────────┐
│   AI Blueprint Gen      │ (external service)
└────────┬────────────────┘
         │ stores
         ▼
┌─────────────────────────┐
│  property_websites      │
│  (site_blueprint)       │
└────────┬────────────────┘
         │ references
         ▼
┌─────────────────────────────┐
│   siteforge_jobs            │
│   (status: queued)          │
└────────┬────────────────────┘
         │ picked up by
         ▼
┌──────────────────────────────────┐
│   siteforge-deploy function      │
│   - Reads blueprint              │
│   - Uploads media                │
│   - Creates WordPress pages      │
│   - Sets homepage & menus        │
│   - Updates job status           │
└──────────────────────────────────┘
```

## File Structure

```
edge-functions/
├── siteforge-deploy/
│   ├── index.ts              # Main deployment processor
│   ├── wp-client.ts          # WordPress REST API client
│   ├── blueprint-parser.ts   # Blueprint → Gutenberg converter
│   └── deno.json
├── siteforge-provision/
│   ├── index.ts              # Provisioning handler
│   └── deno.json
├── siteforge-status/
│   ├── index.ts              # Status checker
│   └── deno.json
├── _shared/
│   ├── types.ts              # TypeScript interfaces
│   ├── supabase.ts           # Supabase client
│   └── cors.ts               # CORS helpers
└── README.md
```

## 1. siteforge-deploy

**Purpose:** Main job processor that deploys website blueprints to WordPress.

**Trigger:** Called via webhook when `siteforge_jobs.status = 'queued'`

### Deployment Flow

1. Query for oldest queued job
2. Mark job as `running`, set `started_at`
3. Fetch WordPress credentials from `property_websites` table
4. Test WordPress REST API connection
5. Upload media assets (`website_assets` table)
6. Create/update WordPress pages from blueprint sections
7. Set site title and description
8. Create navigation menu from page slugs
9. Set homepage to first page
10. Update job status to `completed` or `failed`
11. Update website status to `deployed` or `failed`

### Database Schema

**siteforge_jobs:**
```json
{
  "id": "uuid",
  "website_id": "uuid (fk → property_websites)",
  "job_type": "deploy | regenerate_page | upload_assets",
  "status": "queued | running | completed | failed",
  "input_params": { ... },
  "output_data": { "pages_created": 3, "media_uploaded": 12, ... },
  "error_details": { "code": "...", "message": "..." },
  "attempts": 1,
  "max_attempts": 3,
  "started_at": "2026-03-04T10:30:00Z",
  "completed_at": "2026-03-04T10:35:00Z"
}
```

**property_websites:**
```json
{
  "id": "uuid",
  "property_id": "uuid",
  "wp_url": "https://aurora.oneclick.com",
  "wp_admin_url": "https://aurora.oneclick.com/wp-admin",
  "wp_instance_id": "cloudways_xyz123",
  "wp_credentials": {
    "username": "wp_admin",
    "app_password": "abcd efgh ijkl mnop",
    "api_url": "https://aurora.oneclick.com"
  },
  "generation_status": "deployed | failed | ready_for_preview",
  "generation_progress": 100,
  "site_blueprint": { "pages": [...], "version": 1 },
  "deployed_at": "2026-03-04T10:35:00Z"
}
```

**website_assets:**
```json
{
  "id": "uuid",
  "website_id": "uuid",
  "asset_type": "hero_image | amenity_photo | logo | floor_plan",
  "file_url": "https://cdn.oneclick.com/assets/hero-001.jpg",
  "alt_text": "Building exterior",
  "ai_generated": true,
  "page_assignment": "home | floor-plans | gallery"
}
```

### WordPress Integration

The function uses Basic Auth to authenticate with WordPress REST API:

```typescript
const encodedAuth = btoa(`${username}:${app_password}`);
const headers = {
  'Authorization': `Basic ${encodedAuth}`,
};
```

**Required REST API Endpoints:**
- `GET /wp-json/wp/v2/pages` — List pages
- `POST /wp-json/wp/v2/pages` — Create page
- `PUT /wp-json/wp/v2/pages/{id}` — Update page
- `DELETE /wp-json/wp/v2/pages/{id}` — Delete page
- `POST /wp-json/wp/v2/media` — Upload images
- `POST /wp-json/wp/v2/settings` — Update site settings
- `POST /wp-json/wp/v2/menus` — Create navigation menu (requires plugin)

### Gutenberg Block Format

Blueprint sections are converted to Gutenberg block comments:

```html
<!-- wp:acf/top-slides {
  "id": "block_abc123",
  "name": "acf/top-slides",
  "data": {
    "slides_0_headline": "Welcome",
    "slides_0_subheadline": "To Aurora",
    "autoplay": 1
  },
  "mode": "preview"
} /-->
```

ACF repeater fields use indexed keys:
- `fieldname_0_subfield`
- `fieldname_1_subfield`
- etc.

### Supported ACF Block Types

The blueprint parser supports 14 ACF block types:

1. **hero** (`acf/top-slides`) — Hero/slider sections with autoplay
2. **amenities** (`acf/amenities-grid`) — Grid of amenity cards with icons/images
3. **floor-plans** (`acf/floor-plans`) — Floor plan tabs/carousel
4. **gallery** (`acf/gallery`) — Image gallery with lightbox
5. **text-section** (`acf/text-section`) — Rich text with alignment/colors
6. **cta-section** (`acf/cta-section`) — Call-to-action with button
7. **testimonials** (`acf/testimonials`) — Testimonials carousel
8. **pricing-table** (`acf/pricing-table`) — Pricing plans comparison
9. **features-grid** (`acf/features-grid`) — Feature icons + descriptions
10. **contact-form** (`acf/contact-form`) — Contact form with field mapping
11. **faq** (`acf/faq`) — Accordion FAQ
12. **timeline** (`acf/timeline`) — Vertical/horizontal timeline
13. **social-links** (`acf/social-links`) — Social media icon links
14. **video-section** (`acf/video-section`) — YouTube/Vimeo embed

### API Endpoint

```bash
POST https://your-supabase-instance.supabase.co/functions/v1/siteforge-deploy
Authorization: Bearer eyJ...
Content-Type: application/json

{}  # Automatically picks up queued jobs
```

### Response

```json
{
  "status": "success",
  "job_id": "abc123def456",
  "website_id": "xyz789",
  "deployment_result": {
    "status": "success | partial | failed",
    "pages_created": 3,
    "media_uploaded": 12,
    "errors": [],
    "wp_url": "https://aurora.oneclick.com",
    "deployed_pages": ["home", "floor-plans", "contact"]
  },
  "final_website_status": "deployed | ready_for_preview | failed"
}
```

## 2. siteforge-provision

**Purpose:** Creates WordPress instances for properties via hosting provider APIs.

**Supported Providers:**
- `manual` — Validates existing credentials
- `cloudways` — TODO: Implement Cloudways API integration
- `wpengine` — TODO: Implement WP Engine API integration

### Manual Provisioning

For manual provisioning, WordPress credentials must be provided:

```bash
POST https://your-supabase-instance.supabase.co/functions/v1/siteforge-provision
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "provider": "manual",
  "website_id": "abc123def456",
  "wp_credentials": {
    "username": "wp_admin",
    "app_password": "abcd efgh ijkl mnop",
    "api_url": "https://aurora.oneclick.com"
  }
}
```

### Cloudways Provisioning (TODO)

```typescript
// TODO: Implement these steps
// 1. Call Cloudways API to create server
// 2. Install WordPress application
// 3. Configure WordPress
// 4. Get credentials
// 5. Return result
```

**Cloudways API Endpoints:**
- `POST /api/v1/server` — Create server
- `POST /api/v1/apps` — Install application
- API Documentation: https://www.cloudways.com/en/api-documentation.html

### WP Engine Provisioning (TODO)

```typescript
// TODO: Implement these steps
// 1. Call WP Engine API to create account
// 2. Configure WordPress environment
// 3. Get credentials
// 4. Return result
```

**WP Engine API Endpoints:**
- `POST /api/v1/accounts` — Create account
- API Documentation: https://api.wpengine.com/docs

### Provisioning Response

```json
{
  "status": "success",
  "message": "Provisioning completed successfully",
  "website_id": "abc123def456",
  "wp_url": "https://aurora.oneclick.com",
  "wp_admin_url": "https://aurora.oneclick.com/wp-admin",
  "wp_credentials": {
    "username": "wp_admin",
    "api_url": "https://aurora.oneclick.com"
    // Note: app_password is NOT returned
  }
}
```

## 3. siteforge-status

**Purpose:** Returns current status of deployment jobs.

### Query Parameters

Either `job_id` or `website_id` is required:

```bash
GET /siteforge-status?job_id=abc123def456
GET /siteforge-status?website_id=xyz789
```

### Status Response

```json
{
  "job_id": "abc123def456",
  "website_id": "xyz789",
  "job_type": "deploy",
  "status": "completed",
  "progress": 100,
  "error": null,
  "deployed_url": "https://aurora.oneclick.com",
  "started_at": "2026-03-04T10:30:00Z",
  "completed_at": "2026-03-04T10:35:00Z"
}
```

### Status Values

- `queued` — Job waiting to be processed (progress: 0-10%)
- `running` — Job in progress (progress: 10-95%)
- `completed` — Job finished successfully (progress: 100%)
- `failed` — Job failed after max attempts

## Deployment

### Deploy to Supabase

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy siteforge-deploy
supabase functions deploy siteforge-provision
supabase functions deploy siteforge-status
```

### Local Development

```bash
# Run local Supabase and edge functions
supabase start
supabase functions serve

# In another terminal, test functions
curl -X POST http://localhost:54321/functions/v1/siteforge-deploy \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Environment Variables

Required for Edge Functions (auto-set by Supabase):

- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (for admin access)

Optional (for Cloudways/WP Engine):

- `CLOUDWAYS_API_KEY`
- `CLOUDWAYS_API_TOKEN`
- `WPENGINE_API_KEY`

## Error Handling

### Retry Logic

If a job fails, it's automatically retried:

1. First failure: Job status → `queued`, attempts → 2
2. Second failure: Job status → `queued`, attempts → 3
3. Third failure: Job status → `failed`, attempts → 3
4. Website status → `failed`

Max retries is configurable per job in `siteforge_jobs.max_attempts`.

### Error Details

Failed jobs include error details:

```json
{
  "job_id": "abc123",
  "status": "failed",
  "error": {
    "code": "DEPLOYMENT_ERROR",
    "message": "Failed to connect to WordPress instance",
    "details": "...",
    "timestamp": "2026-03-04T10:35:00Z"
  }
}
```

## Blueprint Structure

Example site blueprint:

```json
{
  "version": 1,
  "updatedAt": "2026-03-04T10:00:00Z",
  "pages": [
    {
      "slug": "home",
      "title": "Aurora - Downtown Denver",
      "purpose": "Homepage with hero and amenities",
      "sections": [
        {
          "id": "hero-001",
          "type": "hero",
          "acfBlock": "acf/top-slides",
          "order": 1,
          "content": {
            "slides": [
              {
                "headline": "Welcome to Aurora",
                "subheadline": "Luxury Apartments Downtown",
                "cta_text": "Schedule Tour",
                "cta_link": "/contact",
                "image": "https://cdn.oneclick.com/hero-1.jpg"
              }
            ],
            "autoplay": 1
          },
          "fields": {},
          "cssClasses": ["hero-fullwidth"],
          "photoRequirement": {
            "scene": "building-exterior",
            "category": "hero"
          }
        },
        {
          "id": "amenities-001",
          "type": "amenities",
          "acfBlock": "acf/amenities-grid",
          "order": 2,
          "content": {
            "layout": "grid-3",
            "amenities": [
              {
                "name": "Fitness Center",
                "description": "State-of-the-art equipment",
                "icon": "dumbbell",
                "image": "https://cdn.oneclick.com/fitness.jpg"
              }
            ]
          },
          "fields": {},
          "cssClasses": []
        }
      ]
    }
  ]
}
```

## Testing

### Test Deployment

```bash
# Insert test data
INSERT INTO siteforge_jobs (website_id, job_type, status)
VALUES ('test-website-id', 'deploy', 'queued');

# Call function
curl -X POST http://localhost:54321/functions/v1/siteforge-deploy

# Check status
curl "http://localhost:54321/functions/v1/siteforge-status?job_id=test-job-id"
```

### Test Provisioning

```bash
curl -X POST http://localhost:54321/functions/v1/siteforge-provision \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "manual",
    "website_id": "test-website-id",
    "wp_credentials": {
      "username": "wp_admin",
      "app_password": "test-password",
      "api_url": "https://test-site.local"
    }
  }'
```

## Troubleshooting

### "Failed to connect to WordPress instance"

- Verify WP REST API is enabled: `/wp-json/`
- Check username and app password are correct
- Ensure firewall allows API requests
- Check WordPress user has REST API permissions

### "Media upload failed"

- Verify file URL is accessible
- Check file size is within WordPress limits
- Ensure WordPress media upload directory is writable

### "Page creation failed: Block validation failed"

- Verify ACF blocks are installed on WordPress
- Check ACF field names match blueprint
- Ensure Gutenberg block format is correct

### Debugging

Enable verbose logging:

```typescript
// In index.ts
console.log('Debug info:', { jobId, website, deploymentResult });

// Check logs
supabase functions logs siteforge-deploy
```

## Future Enhancements

- [ ] Cloudways API integration
- [ ] WP Engine API integration
- [ ] Batch deployment (multiple sites)
- [ ] Template versioning and rollback
- [ ] Custom ACF block registration
- [ ] Advanced media processing (resize, crop)
- [ ] SEO optimization (meta tags, sitemap)
- [ ] Backup and restore functionality
- [ ] A/B testing support
- [ ] Multi-language support

## Support

For issues, feature requests, or documentation updates, contact the SiteForge development team.
