# SiteForge Edge Functions API Examples

Complete examples for integrating with SiteForge Edge Functions.

## Base URLs

```
Development:  http://localhost:54321/functions/v1
Staging:      https://project.supabase.co/functions/v1
Production:   https://project-prod.supabase.co/functions/v1
```

## Authentication

All requests require Bearer token authentication:

```bash
Authorization: Bearer <SUPABASE_ANON_KEY> or <SUPABASE_SERVICE_ROLE_KEY>
```

## 1. Deployment Examples

### Trigger Deployment (Automatic)

The system automatically picks up queued jobs. No manual trigger needed unless you're testing:

```bash
# Manually trigger deployment processor
POST /siteforge-deploy
Authorization: Bearer your-anon-key

# Response
{
  "status": "success",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "website_id": "7b5c8a10-d2a1-4c8f-b1e0-3f8c5d2e1a9b",
  "deployment_result": {
    "status": "success",
    "pages_created": 3,
    "media_uploaded": 12,
    "errors": [],
    "wp_url": "https://aurora.oneclick.com",
    "deployed_pages": ["home", "floor-plans", "amenities"]
  },
  "final_website_status": "deployed"
}
```

### Check Deployment Status

```bash
# By job ID
GET /siteforge-status?job_id=550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer your-anon-key

# By website ID
GET /siteforge-status?website_id=7b5c8a10-d2a1-4c8f-b1e0-3f8c5d2e1a9b
Authorization: Bearer your-anon-key

# Response
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "website_id": "7b5c8a10-d2a1-4c8f-b1e0-3f8c5d2e1a9b",
  "job_type": "deploy",
  "status": "completed",
  "progress": 100,
  "error": null,
  "deployed_url": "https://aurora.oneclick.com",
  "started_at": "2026-03-04T10:30:00Z",
  "completed_at": "2026-03-04T10:35:00Z"
}
```

## 2. Provisioning Examples

### Provision Manual WordPress Instance

```bash
POST /siteforge-provision
Authorization: Bearer your-anon-key
Content-Type: application/json

{
  "provider": "manual",
  "website_id": "7b5c8a10-d2a1-4c8f-b1e0-3f8c5d2e1a9b",
  "wp_credentials": {
    "username": "wp_admin",
    "app_password": "abcd efgh ijkl mnop qrst",
    "api_url": "https://aurora.oneclick.com"
  }
}

# Response
{
  "status": "success",
  "message": "Provisioning completed successfully",
  "website_id": "7b5c8a10-d2a1-4c8f-b1e0-3f8c5d2e1a9b",
  "wp_url": "https://aurora.oneclick.com",
  "wp_admin_url": "https://aurora.oneclick.com/wp-admin",
  "wp_credentials": {
    "username": "wp_admin",
    "api_url": "https://aurora.oneclick.com"
  }
}
```

### Error Response

```json
{
  "error": "Invalid WordPress credentials: unable to connect to API",
  "details": null,
  "timestamp": "2026-03-04T10:35:00Z"
}
```

## 3. Database Examples

### Create Property Website Record

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data, error } = await supabase
  .from('property_websites')
  .insert({
    property_id: propertyId,
    wp_url: null,  // Set after provisioning
    wp_credentials: null,  // Set after provisioning
    generation_status: 'queued',
    generation_progress: 0,
  })
  .select()
  .single();

console.log('Website created:', data.id);
```

### Queue Deployment Job

```typescript
const { data, error } = await supabase
  .from('siteforge_jobs')
  .insert({
    website_id: websiteId,
    job_type: 'deploy',
    status: 'queued',
    max_attempts: 3,
  })
  .select()
  .single();

console.log('Job queued:', data.id);
```

### Upload Website Assets

```typescript
const { data, error } = await supabase
  .from('website_assets')
  .insert({
    website_id: websiteId,
    asset_type: 'hero_image',
    file_url: 'https://cdn.oneclick.com/aurora-hero-001.jpg',
    page_assignment: 'home',
    alt_text: 'Aurora building exterior',
    ai_generated: true,
  });
```

### Monitor Job Progress

```typescript
// Subscribe to job status changes
const subscription = supabase
  .from(`siteforge_jobs:website_id=eq.${websiteId}`)
  .on('*', (payload) => {
    console.log('Job updated:', payload.new);
    updateUI(payload.new.status, payload.new.progress);
  })
  .subscribe();
```

## 4. JavaScript/TypeScript Integration

### Full Deployment Example

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function deployWebsite(propertyId: string, blueprint: SiteBlueprint) {
  try {
    // 1. Create website record
    const { data: website } = await supabase
      .from('property_websites')
      .insert({
        property_id: propertyId,
        site_blueprint: blueprint,
        generation_status: 'queued',
        generation_progress: 0,
      })
      .select()
      .single();

    console.log('Website created:', website.id);

    // 2. Create deployment job
    const { data: job } = await supabase
      .from('siteforge_jobs')
      .insert({
        website_id: website.id,
        job_type: 'deploy',
        status: 'queued',
        input_params: {
          blueprint_version: blueprint.version,
        },
      })
      .select()
      .single();

    console.log('Job queued:', job.id);

    // 3. Trigger deployment (via Edge Function)
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/siteforge-deploy`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const result = await response.json();
    console.log('Deployment result:', result);

    return {
      website_id: website.id,
      job_id: job.id,
      status: result.final_website_status,
    };
  } catch (error) {
    console.error('Deployment failed:', error);
    throw error;
  }
}
```

### Monitor Deployment Progress

```typescript
async function watchDeploymentProgress(jobId: string) {
  let isComplete = false;

  while (!isComplete) {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/siteforge-status?job_id=${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const status = await response.json();
    console.log(`Progress: ${status.progress}% - Status: ${status.status}`);

    if (status.status === 'completed') {
      console.log('Deployment complete!', status.deployed_url);
      isComplete = true;
    } else if (status.status === 'failed') {
      console.error('Deployment failed:', status.error);
      throw new Error(status.error.message);
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
```

## 5. React Component Example

```typescript
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export function DeploymentMonitor({ jobId }: { jobId: string }) {
  const [status, setStatus] = useState<'queued' | 'running' | 'completed' | 'failed'>('queued');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/siteforge-status?job_id=${jobId}`,
          {
            headers: {
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        );

        const data = await response.json();
        setStatus(data.status);
        setProgress(data.progress);
        setDeployedUrl(data.deployed_url);

        if (data.error) {
          setError(data.error.message);
        }

        if (data.status !== 'running' && data.status !== 'queued') {
          return; // Stop polling
        }

        setTimeout(pollStatus, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    pollStatus();
  }, [jobId]);

  return (
    <div className="deployment-monitor">
      <h3>Deployment Status</h3>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress}%` }}
        >
          {progress}%
        </div>
      </div>

      <p>Status: <strong>{status}</strong></p>

      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}

      {deployedUrl && (
        <div className="success-message">
          Deployed to: <a href={deployedUrl}>{deployedUrl}</a>
        </div>
      )}

      {status === 'running' && (
        <div className="loading">Deploying...</div>
      )}
    </div>
  );
}
```

## 6. Error Handling

### Handle API Errors

```typescript
async function safeApiCall<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
```

### Retry Logic

```typescript
async function deployWithRetry(
  websiteId: string,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/siteforge-deploy`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ website_id: websiteId }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.job_id;
    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }

  throw new Error('Max retries exceeded');
}
```

## 7. Testing

### Unit Test Example (Deno/Jest)

```typescript
import { assertEquals } from 'https://deno.land/std@0.140.0/testing/asserts.ts';
import { blueprintToGutenbergContent } from './blueprint-parser.ts';

Deno.test('Blueprint parser converts hero section', () => {
  const section = {
    id: 'hero-001',
    type: 'hero',
    acfBlock: 'acf/top-slides',
    order: 1,
    content: {
      slides: [
        {
          headline: 'Welcome',
          subheadline: 'To Aurora',
          cta_text: 'Tour',
          cta_link: '/contact',
        },
      ],
      autoplay: 1,
    },
    fields: {},
    cssClasses: [],
  };

  const content = blueprintToGutenbergContent([section]);

  assertEquals(content.includes('wp:acf/top-slides'), true);
  assertEquals(content.includes('Welcome'), true);
  assertEquals(content.includes('autoplay'), true);
});
```

### Integration Test Example

```bash
# Test deployment with real database
curl -X POST http://localhost:54321/functions/v1/siteforge-deploy \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Test status endpoint
curl "http://localhost:54321/functions/v1/siteforge-status?job_id=test-id" \
  -H "Authorization: Bearer test-key" | jq .
```

## 8. Webhook Integration

### Trigger on Job Completion

```typescript
// Webhook receiver endpoint (e.g., Next.js API route)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, record } = req.body;

  if (type === 'UPDATE' && record.status === 'completed') {
    // Deployment completed!
    console.log('Deployment successful for website:', record.website_id);

    // Send notification email
    await sendEmail({
      to: 'admin@oneclick.com',
      subject: 'Website Deployment Complete',
      body: `Website ${record.website_id} has been successfully deployed.`,
    });
  } else if (type === 'UPDATE' && record.status === 'failed') {
    // Deployment failed
    console.error('Deployment failed:', record.error_details);

    // Send error notification
    await sendEmail({
      to: 'admin@oneclick.com',
      subject: 'Website Deployment Failed',
      body: `Website ${record.website_id} deployment failed: ${record.error_details.message}`,
    });
  }

  res.status(200).json({ received: true });
}
```

## 9. Monitoring & Logging

### Log Streaming

```bash
# Stream logs from function
supabase functions logs siteforge-deploy --tail

# Filter logs
supabase functions logs siteforge-deploy --tail | grep "ERROR"
```

### Query Job History

```sql
-- Check recent deployments
SELECT
  sj.id,
  sj.website_id,
  sj.status,
  sj.started_at,
  sj.completed_at,
  pw.wp_url
FROM siteforge_jobs sj
JOIN property_websites pw ON sj.website_id = pw.id
WHERE sj.status = 'completed'
ORDER BY sj.completed_at DESC
LIMIT 10;

-- Check failed jobs
SELECT
  id,
  website_id,
  error_details,
  attempts,
  max_attempts
FROM siteforge_jobs
WHERE status = 'failed'
ORDER BY created_at DESC;
```

## 10. Performance Considerations

### Request Timeout

The deployment function has a maximum execution time of 10 minutes. For larger websites with many pages:

```typescript
// Estimate deployment time
const estimatedTime =
  (pages.length * 2000) + // 2 seconds per page
  (assets.length * 1000) + // 1 second per asset
  5000; // Base overhead

console.log(`Estimated deployment time: ${estimatedTime}ms`);
```

### Rate Limiting

To avoid overwhelming WordPress:

```typescript
// Add delay between page creations
async function createPagesWithDelay(pages, delayMs = 500) {
  for (const page of pages) {
    await createPage(page);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
```

---

**Last Updated:** 2026-03-04
**Version:** 1.0.0
