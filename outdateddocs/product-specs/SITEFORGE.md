# SiteForge™ - AI-Powered WordPress Site Generation

**Product Status:** MVP Complete ✅  
**Last Updated:** December 16, 2025  
**Target Quality:** Cadence Creek Standard

---

## Executive Summary

SiteForge is an AI-powered WordPress website generator that creates complete, production-ready apartment community websites in 3 minutes. Unlike manual website building (8-12 hours) or template systems (requires configuration), SiteForge is fully autonomous - it analyzes your brand assets, reasons about optimal layouts, generates all content, and deploys to WordPress automatically.

### Key Achievements
- ✅ **Agentic System** - 6 specialized AI agents (Claude Sonnet 4)
- ✅ **WordPress MCP Server** - Discovery + deployment tools
- ✅ **Vector Embeddings** - 20+ semantic searches per generation
- ✅ **Zero Hardcoding** - All intelligence-driven
- ✅ **Conversational Editing** - 3-second updates via natural language
- ✅ **Cadence Creek Benchmarking** - Quality validation

---

## System Architecture

### The 6 Specialized Agents

1. **Brand Agent** - Synthesizes BrandForge + 6 vector searches → Brand context
2. **Architecture Agent** - Discovers WordPress via MCP + 5 vector searches → Site structure
3. **Design Agent** - Aligns with theme tokens + 4 vector searches → Design system
4. **Photo Agent** - Analyzes uploads + 3 vector searches → Photo strategy
5. **Content Agent** - Writes using vector facts + brand voice → Copy
6. **Quality Agent** - Validates against Cadence benchmarks → QA report

### WordPress MCP Server
- Discovers capabilities (blocks, schemas, tokens)
- No existing WordPress required (uses template instance)
- Analyzes reference sites (Cadence Creek)
- Deploys blueprints to new instances

### Key Innovations

**No Hardcoding:**
```
❌ Before: 14 hardcoded ACF blocks
✅ After:  WordPress MCP discovers blocks at runtime

❌ Before: Template-based structure
✅ After:  Agents plan from brand context

❌ Before: Generic content
✅ After:  Vector search grounds every fact
```

**WordPress-Aware Architecture:**
```
Architecture Agent:
1. Queries WordPress MCP: "What blocks exist?"
2. Gets schemas: "How to configure each block?"
3. Plans using ONLY discovered capabilities
4. Adapts to any WordPress theme
```

**Vector Embeddings Throughout:**
```
20+ vector searches per generation:
- Brand Agent: 6 searches (personality, audience, style)
- Architecture Agent: 5 searches (pages, journey, hierarchy)
- Design Agent: 4 searches (visual prefs, spacing, colors)
- Photo Agent: 3 searches (amenities, lifestyle, differentiators)
- Content Agent: 1 per section (facts for each piece)
```

---

## Generation Pipeline

```
User: "Generate website for Sunset Apartments"
  ↓
Orchestrator initializes 6 agents
  ↓
Phase 1: Brand Agent (10%)
  • Gets BrandForge data
  • Runs 6 vector searches
  • Claude synthesizes → BrandContext
  ↓
Phase 2: Architecture + Design Agents (30%)
  • Queries WordPress MCP for capabilities
  • Plans site structure
  • Creates design system
  ↓
Phase 3: Photo Agent Strategy (50%)
  • Analyzes uploaded photos with Claude Vision
  • Plans what to generate
  ↓
Phase 4: Content Agent (60%)
  • Vector search per section for facts
  • Writes copy in brand voice
  ↓
Phase 5: Photo Agent Execution (75%)
  • Generates missing photos
  • Assigns to sections
  ↓
Phase 6: Quality Agent (90%)
  • Validates brand consistency
  • Checks content quality
  • Verifies WordPress compatibility
  ↓
Complete Blueprint (100%)
```

---

## Conversational Editing

```
User viewing preview → Clicks "Edit" on hero section
  ↓
Modal: "What would you like to change?"
User types: "Make this more resort-style with a pool photo"
  ↓
LLM Patch Generator (Claude Sonnet 4)
  ↓
Preview updates INSTANTLY (no regeneration!)
```

**Edit flow takes 3 seconds, not 3 minutes.**

---

## Template Mode (Current)

The current implementation uses 14 predefined ACF blocks from the "Collection" WordPress theme:

| Block | Purpose |
|-------|---------|
| `acf/top-slides` | Hero carousel |
| `acf/text-section` | Text content |
| `acf/content-grid` | 3-column grid |
| `acf/feature-section` | Image + text |
| `acf/image` | Single image |
| `acf/gallery` | Photo gallery |
| `acf/form` | Contact form |
| `acf/map` | Google Maps |
| `acf/accordion-section` | FAQ |
| `acf/menu` | Section navigation |
| `acf/links` | CTA buttons |
| `acf/plans-availability` | Floor plans |
| `acf/poi` | Neighborhood map |
| `acf/html-section` | Custom HTML |

---

## Custom LLM Mode (Future)

**Vision:** AI generates completely custom sites from scratch - no templates.

| Feature | Template Mode | Custom LLM Mode |
|---------|---------------|-----------------|
| Layout Options | 14 fixed blocks | Unlimited custom |
| Visual Uniqueness | Low | High (one-of-a-kind) |
| Animations | Basic | Advanced (parallax, scroll) |
| Price per Site | $99 | $299-499 |
| Time to Market | 4-5 weeks | 8-12 weeks additional |

---

## Economics

**Per Site Costs:**
- Generation: $0.85 (Claude + embeddings + images)
- QA: $13 (30 minutes)
- **Total Cost: $13.85**

**Pricing:**
- Entry: $199 (93% margin)
- Standard: $299 (95% margin)
- Premium: $499 + $25/mo hosting (97% margin)

**Break-even:** 2 sites

---

## Setup Guide

### 1. Environment Variables

```env
# Claude API (REQUIRED for all agents)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# WordPress Template Instance (for capability discovery)
WP_TEMPLATE_URL=https://template.p11sites.com
WP_TEMPLATE_USERNAME=admin
WP_TEMPLATE_PASSWORD=your-secure-password
WP_TEMPLATE_INSTANCE_ID=template-collection-theme

# Cloudways API (for creating new WordPress instances)
CLOUDWAYS_API_KEY=your-cloudways-key
CLOUDWAYS_EMAIL=your-email

# Already configured (keep existing):
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=... (for embeddings)
```

### 2. WordPress Template Instance Setup

**Option A: Use existing staging site**
```env
WP_TEMPLATE_URL=https://your-staging-site.com
```

**Option B: Create new template**
1. Create WordPress on Cloudways
2. Install Collection theme
3. Install plugins: ACF Pro, Yoast SEO, WP Rocket
4. Set credentials in .env

### 3. Install Python Dependencies

```powershell
cd p11-platform\services\mcp-servers\wordpress
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Test WordPress MCP Server

```powershell
python -m wordpress.server
# Should start MCP server on stdio
```

---

## Files Structure

### TypeScript Agents (9 files)
```
utils/siteforge/agents/base-agent.ts
utils/siteforge/agents/brand-agent.ts
utils/siteforge/agents/architecture-agent.ts
utils/siteforge/agents/design-agent.ts
utils/siteforge/agents/photo-agent.ts
utils/siteforge/agents/content-agent.ts
utils/siteforge/agents/quality-agent.ts
utils/siteforge/agents/orchestrator.ts
utils/siteforge/agents/index.ts
```

### WordPress MCP Infrastructure
```
utils/mcp/wordpress-client.ts
services/mcp-servers/wordpress/server.py
services/mcp-servers/wordpress/config.py
services/mcp-servers/wordpress/tools/abilities.py
services/mcp-servers/wordpress/tools/analysis.py
services/mcp-servers/wordpress/tools/deployment.py
```

### Editing Infrastructure
```
utils/siteforge/llm-patch-generator.ts
components/siteforge/SectionEditor.tsx
app/api/siteforge/edit/[websiteId]/route.ts
```

---

## Database Schema

```sql
CREATE TABLE property_websites (
  id uuid PRIMARY KEY,
  property_id uuid REFERENCES properties(id),
  wp_url text,
  wp_admin_url text,
  wp_instance_id text,
  wp_credentials jsonb,
  generation_status text DEFAULT 'queued',
  generation_progress int DEFAULT 0,
  current_step text,
  error_message text,
  brand_source text,
  brand_confidence numeric,
  site_architecture jsonb,
  pages_generated jsonb,
  assets_manifest jsonb,
  generation_started_at timestamptz,
  generation_completed_at timestamptz,
  generation_duration_seconds int,
  page_views int DEFAULT 0,
  tour_requests int DEFAULT 0,
  conversion_rate numeric,
  version int DEFAULT 1,
  previous_version_id uuid,
  user_preferences jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE website_assets (
  id uuid PRIMARY KEY,
  website_id uuid REFERENCES property_websites(id),
  asset_type text,
  source text,
  file_url text NOT NULL,
  file_size_bytes bigint,
  mime_type text,
  wp_media_id int,
  alt_text text,
  caption text,
  usage_context jsonb,
  optimized boolean DEFAULT false,
  original_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE siteforge_jobs (
  id uuid PRIMARY KEY,
  website_id uuid REFERENCES property_websites(id),
  job_type text,
  status text DEFAULT 'queued',
  input_params jsonb,
  output_data jsonb,
  error_details jsonb,
  attempts int DEFAULT 0,
  max_attempts int DEFAULT 3,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/siteforge/generate` | Start website generation |
| `GET /api/siteforge/status/[websiteId]` | Poll generation progress |
| `GET /api/siteforge/list?propertyId=xxx` | List websites for property |
| `GET /api/siteforge/preview/[websiteId]` | Get website data for preview |
| `POST /api/siteforge/deploy/[websiteId]` | Deploy to WordPress |
| `GET /api/siteforge/rollback/[websiteId]` | Rollback preflight (exact target version) |
| `POST /api/siteforge/rollback/[websiteId]` | Execute rollback to previous version |
| `POST /api/siteforge/edit/[websiteId]` | Conversational editing |
| `DELETE /api/siteforge/delete/[websiteId]` | Delete website |

---

## Local Verification (P1)

Run this from `p11-platform/apps/web`:

```bash
npx playwright test "e2e/local-smoke.spec.ts" --grep "siteforge deploy and rollback flow"
```

Expected outcome for the smoke step:

- The spec passes with `1 passed`.
- It generates two SiteForge versions for the same property using deterministic local simulation (`POST /api/siteforge/generate?simulate=1`) and captures both `websiteId` values.
- It executes a deterministic local deploy via `POST /api/siteforge/deploy/[websiteId]?simulate=1` and reaches `status: "complete"`.
- Deployment diagnostics show `status: "success"`, `provider: "local_simulation"`, and `verification.status: "passed"`.
- `GET /api/siteforge/rollback/[websiteId]` for the second version returns `canRollback: true` and points to the first version as the rollback target.
- `POST /api/siteforge/rollback/[websiteId]` returns `success: true`.
- Final `GET /api/siteforge/status/[websiteId]` returns `status: "ready_for_preview"`, a rollback `currentStep` message, and cleared `wpUrl`/`wpAdminUrl`.

Optional real-target validation (explicit opt-in):

```bash
SITEFORGE_REAL_DEPLOY_SMOKE=1 npx playwright test "e2e/local-smoke.spec.ts" --grep "siteforge real target deploy and rollback flow"
```

- This test is skipped unless `SITEFORGE_REAL_DEPLOY_SMOKE=1`.
- It requires either Cloudways creds (`CLOUDWAYS_API_KEY`, `CLOUDWAYS_EMAIL`) or existing WP creds (`SITEFORGE_WP_URL`, `SITEFORGE_WP_USERNAME`, `SITEFORGE_WP_APP_PASSWORD`).
- It validates deploy without simulation, then rollback, and asserts WordPress fields are cleared after rollback.

---

## Quality Validation

**Quality Agent Checks:**

| Check | Weight | Threshold |
|-------|--------|-----------|
| Brand Consistency | 30% | ≥75% vector similarity |
| Content Quality | 25% | No placeholders, CTAs present |
| Photo Quality | 20% | Hero exists, lifestyle ≥40% |
| Design Coherence | 15% | Spacing matches brand |
| WordPress Compatibility | 10% | All blocks exist |

**Overall Score:** Must be ≥80% to pass

---

## Competitive Advantages

1. **Multi-Agent Intelligence** - No competitor uses agentic architecture
2. **Vector-Grounded Facts** - Content from actual property knowledge
3. **WordPress MCP Discovery** - Adapts to any theme automatically
4. **BrandForge Integration** - Unique structured brand intelligence
5. **Conversational Editing** - Natural language interface
6. **Cadence Creek Quality** - Validated sophistication

**Competitive Moat:** 2-3 years to replicate

---

## Roadmap

### Phase 1: Complete Template Mode (4-5 weeks)
- Build WordPress deployment (Cloudways API)
- Test with beta customers
- Launch at $99/site

### Phase 2: Custom Mode Prototype (2-3 weeks)
- Expand LLM to generate component code
- Build sandboxed renderer
- Validate with pilot customers

### Phase 3: Full Custom Mode (6-8 weeks)
- Full deployment pipeline
- A/B testing
- Performance monitoring

---

## What Still Needs Implementation

### ❌ WordPress Deployment (Only Remaining Gap)
- `createWordPressInstance()` - Cloudways API integration
- `deployThemeAndPlugins()` - WP-CLI automation
- `createPage()` - WordPress REST API calls
- `uploadAssets()` - Media upload pipeline

**Estimated Effort:** 3-4 weeks

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Generation success rate | >95% |
| Average generation time | <5 minutes |
| QA pass rate | >80% |
| Lighthouse score | >90 |
| Brand consistency | >75% |

---

**SiteForge™**  
*Where Intelligence Builds Websites*









