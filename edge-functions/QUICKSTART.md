# SiteForge Edge Functions - Quick Start Guide

Get SiteForge Edge Functions running in 15 minutes.

## Prerequisites

- Supabase project created
- Supabase CLI installed: `npm install -g supabase`
- WordPress instance with REST API enabled
- App password for WordPress user

## Step 1: Clone & Setup (2 minutes)

```bash
cd /sessions/modest-kind-mayer/mnt/oneClick/edge-functions

# Link to your Supabase project
supabase login
supabase link --project-ref your-project-ref
```

## Step 2: Setup Database (3 minutes)

```bash
# Copy and run this SQL in Supabase dashboard

CREATE TABLE property_websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL,
  wp_url TEXT,
  wp_credentials JSONB,
  generation_status TEXT DEFAULT 'queued',
  generation_progress INTEGER DEFAULT 0,
  site_blueprint JSONB,
  deployed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE siteforge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES property_websites(id),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  output_data JSONB,
  error_details JSONB,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE website_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES property_websites(id),
  asset_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  alt_text TEXT,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_siteforge_jobs_status ON siteforge_jobs(status);
CREATE INDEX idx_siteforge_jobs_website_id ON siteforge_jobs(website_id);
CREATE INDEX idx_property_websites_property_id ON property_websites(property_id);
```

## Step 3: Deploy Functions (3 minutes)

```bash
supabase functions deploy siteforge-deploy
supabase functions deploy siteforge-provision
supabase functions deploy siteforge-status
```

## Step 4: Test Deployment (5 minutes)

```bash
# Get your Supabase anon key
export SUPABASE_KEY="your-anon-key"
export SUPABASE_URL="https://your-project.supabase.co"

# Create test website
curl -X POST $SUPABASE_URL/rest/v1/property_websites \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "property_id": "00000000-0000-0000-0000-000000000000",
    "wp_url": "https://test.local",
    "wp_credentials": {
      "username": "admin",
      "app_password": "test pass",
      "api_url": "https://test.local"
    },
    "site_blueprint": {
      "pages": [{
        "slug": "home",
        "title": "Home",
        "purpose": "Homepage",
        "sections": []
      }],
      "version": 1,
      "updatedAt": "2026-03-04T00:00:00Z"
    }
  }'

# Copy the returned website ID, then create a job
curl -X POST $SUPABASE_URL/rest/v1/siteforge_jobs \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "paste-website-id-here",
    "job_type": "deploy",
    "status": "queued"
  }'

# Check status
curl "$SUPABASE_URL/functions/v1/siteforge-status?website_id=paste-website-id" \
  -H "Authorization: Bearer $SUPABASE_KEY" | jq .
```

## Verify Installation

```bash
# List deployed functions
supabase functions list

# Check logs
supabase functions logs siteforge-deploy --tail

# Test endpoints
curl https://your-project.supabase.co/functions/v1/siteforge-status?job_id=test \
  -H "Authorization: Bearer your-key"
```

## What's Next?

1. **Read Documentation**
   - Start with README.md for detailed overview
   - Check DEPLOYMENT_GUIDE.md for production setup
   - Review API_EXAMPLES.md for integration patterns

2. **Setup WordPress**
   - Install ACF plugin
   - Create app password
   - Test REST API: `curl -u admin:password https://site.com/wp-json/`

3. **Monitor Deployments**
   - Check logs: `supabase functions logs siteforge-deploy --tail`
   - Query database: `SELECT * FROM siteforge_jobs WHERE status='completed';`

4. **Troubleshooting**
   - WordPress connection failing? Check `/wp-json/` endpoint
   - Media upload issues? Verify file URL is accessible
   - Block errors? Ensure ACF blocks are registered

## Key Files

| File | Purpose |
|------|---------|
| `siteforge-deploy/index.ts` | Main deployment processor |
| `siteforge-deploy/wp-client.ts` | WordPress REST API client |
| `siteforge-deploy/blueprint-parser.ts` | Blueprint to Gutenberg converter |
| `siteforge-provision/index.ts` | Credential provisioning |
| `siteforge-status/index.ts` | Job status checker |
| `README.md` | Complete documentation |
| `DEPLOYMENT_GUIDE.md` | Production setup guide |
| `API_EXAMPLES.md` | Integration examples |

## Common Commands

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy siteforge-deploy

# View logs
supabase functions logs siteforge-deploy --tail

# List functions
supabase functions list

# Local development
supabase start
supabase functions serve
```

## Expected Behavior

1. Insert `siteforge_jobs` record with status='queued'
2. `siteforge-deploy` picks it up automatically
3. Pages created in WordPress with Gutenberg blocks
4. Navigation menu set up
5. Homepage configured
6. Job status updated to 'completed'
7. Website status updated to 'deployed'

## Support

- Check logs: `supabase functions logs <function-name> --tail`
- Review errors: Query `error_details` from `siteforge_jobs` table
- Read troubleshooting: See README.md section

---

Ready to deploy? Start with step 1 and you'll be live in 15 minutes!

**For detailed information, see README.md**
