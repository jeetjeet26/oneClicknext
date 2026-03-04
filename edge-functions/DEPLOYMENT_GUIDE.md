# SiteForge Edge Functions Deployment Guide

Complete step-by-step guide for deploying SiteForge Edge Functions to production.

## Prerequisites

1. **Supabase Project** — Access to the oneClick Supabase project
2. **Supabase CLI** — Install via `npm install -g supabase`
3. **Deno** — Supabase uses Deno runtime (built-in, no install needed)
4. **Git Access** — Ability to push code to repository

## Pre-Deployment Checklist

### Database Setup

Ensure these tables exist in your Supabase PostgreSQL database:

```sql
-- property_websites table
CREATE TABLE IF NOT EXISTS property_websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id),
  wp_url TEXT,
  wp_admin_url TEXT,
  wp_instance_id TEXT,
  wp_credentials JSONB,
  generation_status TEXT DEFAULT 'queued',
  generation_progress INTEGER DEFAULT 0,
  site_blueprint JSONB,
  site_architecture JSONB,
  pages_generated JSONB,
  deployed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- siteforge_jobs table
CREATE TABLE IF NOT EXISTS siteforge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES property_websites(id),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  input_params JSONB,
  output_data JSONB,
  error_details JSONB,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- website_assets table
CREATE TABLE IF NOT EXISTS website_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES property_websites(id),
  asset_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  page_assignment TEXT,
  alt_text TEXT,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_siteforge_jobs_status ON siteforge_jobs(status);
CREATE INDEX idx_siteforge_jobs_website_id ON siteforge_jobs(website_id);
CREATE INDEX idx_property_websites_property_id ON property_websites(property_id);
CREATE INDEX idx_website_assets_website_id ON website_assets(website_id);
```

### WordPress Instance Setup

For each WordPress instance that will receive deployments:

1. **Install WordPress** on hosting provider
2. **Enable REST API** — Verify `/wp-json/` returns JSON
3. **Create Application Password** for Edge Function user
   - WP Admin → Users → Select user → App Passwords section
   - Generate password, copy to secure storage
4. **Install ACF Plugin** — Advanced Custom Fields (PRO recommended for ACF blocks)
5. **Create ACF Blocks** — Register all 14 block types
6. **Install REST API Menus Plugin** — For menu creation via API
7. **Test REST API Access** — Use cURL with Basic Auth:

```bash
curl -u "username:app_password" \
  "https://your-site.com/wp-json/wp/v2/pages"
```

### WordPress ACF Block Setup

Register all 14 ACF block types. Example registration (add to functions.php):

```php
<?php
// Register ACF blocks
acf_register_block_type([
    'name'            => 'top-slides',
    'title'           => 'Top Slides (Hero)',
    'description'     => 'Hero slider section with autoplay',
    'render_callback' => 'my_acf_block_render_callback',
    'category'        => 'siteforge',
    'icon'            => 'slides',
    'keywords'        => ['hero', 'slider'],
    'supports'        => [
        'align' => false,
        'mode'  => false,
    ],
]);

acf_register_block_type([
    'name'            => 'amenities-grid',
    'title'           => 'Amenities Grid',
    'render_callback' => 'my_acf_block_render_callback',
    'category'        => 'siteforge',
]);

// ... repeat for all 14 block types
?>
```

Or use ACF JSON export/import for easier deployment.

## Local Development

### 1. Clone Repository

```bash
cd /sessions/modest-kind-mayer/mnt/oneClick/
git clone <repo-url> edge-functions
cd edge-functions
```

### 2. Link to Supabase Project

```bash
supabase login
supabase link --project-ref your-project-ref
```

### 3. Test Edge Functions Locally

```bash
# Start local Supabase environment
supabase start

# In another terminal, serve edge functions
supabase functions serve

# Test deployment function
curl -X POST http://localhost:54321/functions/v1/siteforge-deploy \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Verify Database Connection

Insert test data into local database:

```bash
# Connect to local Postgres
psql postgresql://postgres:postgres@localhost:54322/postgres

-- Create test website record
INSERT INTO property_websites (property_id, wp_url, wp_credentials, site_blueprint)
VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'https://test.local',
  '{"username": "test", "app_password": "test", "api_url": "https://test.local"}',
  '{"pages": [], "version": 1, "updatedAt": "2026-03-04T00:00:00Z"}'
);

-- Create test job
INSERT INTO siteforge_jobs (website_id, job_type, status)
VALUES ((SELECT id FROM property_websites LIMIT 1), 'deploy', 'queued');

-- Check status
SELECT * FROM siteforge_jobs ORDER BY created_at DESC LIMIT 1;
```

## Production Deployment

### 1. Prepare Code

```bash
# Ensure all files are committed
git add -A
git commit -m "chore: SiteForge edge functions v1.0"

# Run any tests
# npm test (if applicable)
```

### 2. Deploy to Supabase

```bash
# Deploy all functions
supabase functions deploy

# Or deploy individual functions
supabase functions deploy siteforge-deploy
supabase functions deploy siteforge-provision
supabase functions deploy siteforge-status
```

### 3. Verify Deployment

```bash
# List deployed functions
supabase functions list

# View function details
supabase functions describe siteforge-deploy

# Check logs
supabase functions logs siteforge-deploy

# Test endpoint
curl -X POST https://your-project.supabase.co/functions/v1/siteforge-deploy \
  -H "Authorization: Bearer $(supabase auth-token)" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Enable Webhooks (Optional)

To automatically trigger deployments on blueprint generation:

```bash
# Create webhook trigger for siteforge-deploy
supabase functions deploy siteforge-deploy \
  --publish \
  --verify-jwt false  # Only if not requiring auth
```

Configure webhook in Supabase:
1. Database → Webhooks
2. Create webhook on `siteforge_jobs` table
3. Trigger: INSERT
4. HTTP Method: POST
5. URL: `https://your-project.supabase.co/functions/v1/siteforge-deploy`

## Monitoring & Logs

### View Function Logs

```bash
# Stream logs in real-time
supabase functions logs siteforge-deploy --tail

# View logs for specific time range
supabase functions logs siteforge-deploy --since 1h
```

### Check Job Status

```bash
curl "https://your-project.supabase.co/functions/v1/siteforge-status?job_id=<job-id>" \
  -H "Authorization: Bearer $(supabase auth-token)"
```

### Database Monitoring

```sql
-- Check pending jobs
SELECT id, website_id, status, attempts, created_at
FROM siteforge_jobs
WHERE status IN ('queued', 'running');

-- Check failed jobs
SELECT id, website_id, error_details, attempts
FROM siteforge_jobs
WHERE status = 'failed';

-- Check deployment progress
SELECT id, generation_status, generation_progress, deployed_at
FROM property_websites
WHERE generation_status IN ('generating', 'deployed');
```

## Troubleshooting Deployment

### Issue: "Unable to connect to Supabase"

```bash
# Verify authentication
supabase auth current-user

# Re-login if needed
supabase login
supabase link --project-ref your-project-ref
```

### Issue: "Function deployment timeout"

- Check function file size (max 10MB)
- Ensure dependencies are properly imported
- Check Deno permissions in deno.json

### Issue: "Cold start taking too long"

Edge Functions have cold starts. To reduce:
- Minimize dependencies
- Use top-level imports efficiently
- Pre-warm functions with periodic calls

Example periodic trigger (using external service):

```bash
# Call every 5 minutes to keep warm
*/5 * * * * curl -H "Authorization: Bearer token" \
  https://your-project.supabase.co/functions/v1/siteforge-deploy
```

### Issue: "WordPress REST API 403 Forbidden"

```bash
# Test authentication
curl -u "username:app_password" \
  "https://site.com/wp-json/wp/v2/users/me"

# Verify permissions
# WP Admin → Settings → Permalinks (not plain)
# WP Admin → Users → Check user role (Editor/Administrator)
```

### Issue: "ACF block not found"

```php
# Verify blocks are registered (in WordPress)
// In WordPress admin or functions.php:
var_dump(acf_get_block_types());
```

## Rollback

If deployment causes issues:

```bash
# Redeploy previous version from git
git checkout <previous-commit>

# Redeploy functions
supabase functions deploy

# Or delete function and redeploy
supabase functions delete siteforge-deploy
supabase functions deploy siteforge-deploy
```

## Performance Optimization

### Cold Start Optimization

```typescript
// Import only what's needed at top level
// Avoid heavy imports inside functions

// Good
import { supabase } from '../_shared/supabase.ts';

// Avoid
const { supabase } = require('@supabase/supabase-js'); // Heavy
```

### Database Query Optimization

```typescript
// Use SELECT with specific columns
const { data } = await supabase
  .from('siteforge_jobs')
  .select('id,status,website_id') // Specific columns
  .eq('status', 'queued');

// Avoid SELECT * unless needed
```

### Connection Pooling

Supabase automatically handles connection pooling for Edge Functions.

## Security Checklist

- [ ] Never expose `SUPABASE_SERVICE_ROLE_KEY` in logs
- [ ] Always use HTTPS for WordPress API connections
- [ ] Validate all input parameters
- [ ] Use Basic Auth for WordPress (HTTPS required)
- [ ] Implement rate limiting if needed
- [ ] Audit function access logs regularly
- [ ] Keep dependencies updated
- [ ] Use environment variables for secrets

## Maintenance

### Regular Tasks

**Weekly:**
- Check function logs for errors
- Monitor failed jobs in database
- Review error_details for patterns

**Monthly:**
- Update Supabase SDK version
- Test WordPress API connectivity
- Review and optimize slow queries
- Audit ACF block registration

**Quarterly:**
- Update Deno dependencies
- Review security logs
- Capacity planning based on job volume

### Update Dependencies

```bash
# Check for updates
deno cache --reload

# Update imports in files as needed
# Supabase SDK auto-updates via ESM
```

## Support & Escalation

**For deployment issues:**
1. Check logs: `supabase functions logs <function-name> --tail`
2. Test locally: `supabase functions serve`
3. Verify database schema
4. Check WordPress API access

**For SiteForge issues:**
- Contact SiteForge development team
- Include job ID and error details
- Provide WordPress version and plugins installed

## Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [WordPress REST API Docs](https://developer.wordpress.org/rest-api/)
- [Advanced Custom Fields](https://www.advancedcustomfields.com/)
- [Deno Documentation](https://deno.land/manual)

---

**Last Updated:** 2026-03-04
**Version:** 1.0.0
**Status:** Production Ready
