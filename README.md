# P11 Platform — The Autonomous Agency

<div align="center">

**AI-Powered Marketing Suite for Multifamily Real Estate**

[![TypeScript](https://img.shields.io/badge/TypeScript-81.0%25-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-16.1%25-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)

</div>

---

## 🎯 Overview

P11 Platform is an **all-in-one AI marketing operating system** for apartment communities. It replaces 10+ disconnected tools with a unified platform that automates lead nurturing, content generation, review management, competitive intelligence, and multi-channel analytics.

**The result:** Property managers scale from 10-12 properties to **30-40 properties** per person.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        P11 Platform                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐    ┌─────────────────────────────┐   │
│  │      Web Console     │    │       Data Engine           │   │
│  │  (Next.js 16 + React)│    │   (Python + FastAPI)        │   │
│  │                      │    │                             │   │
│  │  • Dashboard Shell   │    │  • ETL Pipelines            │   │
│  │  • AI Products UI    │    │  • Web Scrapers             │   │
│  │  • Analytics Views   │    │  • CRM Integrations         │   │
│  │  • Settings & Auth   │    │  • AI Schema Discovery      │   │
│  └──────────┬───────────┘    └─────────────┬───────────────┘   │
│             │                              │                    │
│             └──────────────┬───────────────┘                    │
│                            │                                    │
│  ┌─────────────────────────▼─────────────────────────────────┐  │
│  │                     Supabase                               │  │
│  │  • PostgreSQL (Data Lake + pgvector)                      │  │
│  │  • Auth (Multi-tenant RLS)                                │  │
│  │  • Storage (Brand assets, documents)                      │  │
│  │  • Real-time subscriptions                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Products

### Intelligent Conversion
| Product | Description | Status |
|---------|-------------|--------|
| **TourSpark™** | CRM with lead management, activity timeline, automated workflows, and tour scheduling | Local-ready |
| **LumaLeasing™** | 24/7 AI chatbot with RAG-powered responses, embeddable widget, and human takeover | Local-ready |
| **LeadPulse™** | Predictive lead scoring with 5-dimensional algorithm (engagement, timing, source, completeness, behavior) | Local-ready |
| **CRM Sync** | One-way lead push to Yardi, RealPage, Salesforce, and HubSpot with AI field mapping | Local-ready |

### Content Factory
| Product | Description | Status |
|---------|-------------|--------|
| **BrandForge™** | AI-powered brand-book generation with operator review and provider-gated visual steps | Provider validation pending |
| **SiteForge™** | AI WordPress site generation with local smoke coverage and explicit provider gating | Provider validation pending |
| **ForgeStudio AI™** | Content generation with Google Veo 3 video + Imagen 3 images | Local-ready |
| **ReviewFlow AI™** | Multi-source review sync with AI-generated drafts and manual-review fallback on provider failure | Local-ready |

### Strategic Intelligence
| Product | Description | Status |
|---------|-------------|--------|
| **MultiChannel BI** | Unified analytics dashboard with CSV import and recurring channel sync | Verification pending |
| **MarketVision 360™** | Competitor scraping and brand-intelligence analysis with explicit import/runtime gating | Verification pending |
| **PropertyAudit™** | Parallel AI audits (OpenAI + Claude) with quality flags and source-aware OpenAI natural mode | Local-ready |

---

## ✨ Key Features

### CRM Integration (New!)
- **AI-Powered Field Mapping** - Claude analyzes CRM schema and suggests intelligent mappings
- **Duplicate Prevention** - Searches CRM by email/phone before creating leads
- **Multi-CRM Support** - Yardi RENTCafé, RealPage OneSite, Salesforce, HubSpot
- **Test Sync Validation** - Creates/reads/deletes test record to verify mappings
- **Bulk Sync** - Push existing leads to CRM with checkbox selection
- **Learning System** - Tracks user corrections to improve future suggestions
- **Real-time Monitoring** - Dashboard with success rates and sync history

### Lead Management
- **Activity Timeline** - Complete lead history with notes and interactions
- **Automated Workflows** - 3 default templates (new lead nurture, no-show recovery, post-tour)
- **Lead Scoring** - 5-dimensional algorithm with Hot/Warm/Cold buckets
- **Tour Scheduling** - Calendar integration with AI-generated confirmation emails
- **Multi-channel Follow-ups** - SMS + Email automation

### Content Generation
- **Brand Books** - 12-section brand guidelines with logo, colors, typography
- **WordPress Sites** - Complete websites with 14 ACF block types
- **Video Content** - Veo 3 text-to-video with synchronized audio
- **Image Assets** - Imagen 3 generation with style presets
- **Social Media** - Per-property Instagram OAuth configuration

### Competitive Intelligence
- **Competitor Scraping** - Automated website analysis with Apify
- **Brand Intelligence** - AI analysis of positioning, voice, and messaging
- **Semantic Search** - pgvector-powered search across competitor content
- **Market Gap Analysis** - Identifies opportunities in competitive landscape

### Analytics & Reporting
- **Unified Dashboard** - Multi-channel performance in one view
- **CSV Import** - Support for 8+ report types (keywords, demographics, devices, locations)
- **MCP Auto-Sync** - One-click data import from Google Ads and Meta Ads
- **Historical Trends** - Unlimited historical data storage
- **Scheduled Reports** - Automated email reports

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS |
| **Backend** | Next.js API Routes, FastAPI (Python) |
| **Database** | PostgreSQL + pgvector (Supabase) |
| **AI Models** | OpenAI GPT-4o, Claude Sonnet 4, Google Gemini 2.0 & 3.0 |
| **Video** | Google Veo 3 Preview |
| **Images** | Google Imagen 3.0 via Vertex AI |
| **CRM APIs** | simple-salesforce, hubspot-api-client, Yardi/RealPage REST |
| **Data Pipelines** | Python, dlt, Apify |
| **Auth** | Supabase Auth with Row Level Security |
| **Deployment** | Vercel (web), Heroku (data-engine) |

---

## 📁 Project Structure

```
oneClick/
├── p11-platform/
│   ├── apps/
│   │   └── web/                          # Next.js 16 Dashboard
│   │       ├── app/
│   │       │   ├── api/                  # 100+ API endpoints
│   │       │   │   ├── analytics/        # BI & performance data
│   │       │   │   ├── brandforge/       # Brand book generation
│   │       │   │   ├── siteforge/        # WordPress site generation
│   │       │   │   ├── integrations/     # CRM, ad platforms
│   │       │   │   ├── leads/            # TourSpark CRM
│   │       │   │   ├── lumaleasing/      # AI chatbot
│   │       │   │   ├── marketvision/     # Competitor intelligence
│   │       │   │   └── reviewflow/       # Review management
│   │       │   ├── dashboard/            # Product pages
│   │       │   │   ├── leads/            # TourSpark page
│   │       │   │   ├── settings/         # Settings & CRM config
│   │       │   │   ├── brandforge/       # Brand book viewer
│   │       │   │   └── siteforge/        # Website generator
│   │       │   └── auth/                 # Authentication
│   │       ├── components/               # React components
│   │       │   ├── crm/                  # CRM sync monitor
│   │       │   ├── leads/                # Tour scheduling
│   │       │   └── layout/               # Dashboard shell
│   │       └── utils/
│   │           └── services/
│   │               ├── crm-sync.ts       # CRM integration
│   │               └── messaging.ts      # SMS/Email
│   ├── services/
│   │   └── data-engine/                  # Python FastAPI
│   │       ├── connectors/
│   │       │   ├── crm_adapters/         # Yardi, RealPage, Salesforce, HubSpot
│   │       │   ├── openai_connector.py
│   │       │   └── claude_connector.py
│   │       ├── jobs/
│   │       │   ├── propertyaudit.py      # Parallel AI audits
│   │       │   └── crm_schema_agent.py   # AI field mapping
│   │       ├── routers/
│   │       │   ├── brand_intelligence.py
│   │       │   └── crm_integration.py    # CRM API endpoints
│   │       ├── pipelines/                # ETL pipelines
│   │       └── scrapers/                 # Web scrapers
│   └── supabase/
│       └── migrations/                   # 55+ database migrations
└── docs/                                 # Technical documentation
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Python 3.13+
- Docker for local Supabase or a hosted Supabase project (with pgvector enabled)
- OpenAI API key
- Google Cloud project (for Vertex AI)
- Anthropic API key (for Claude)

### 1. Clone & Install

```bash
git clone https://github.com/jeetjeet26/oneClick.git
cd oneClick/p11-platform
```

### 2. Install Dependencies

**Web App:**
```bash
cd apps/web
npm install
```

**Data Engine:**
```bash
cd ../../services/data-engine
pip install -r requirements.txt
```

### 3. Configure Environment

Use the canonical shared template in `p11-platform/.env.example`:

```bash
cd p11-platform
cp .env.example .env
```

Then fill in real values in `p11-platform/.env`.
`npm run supabase:reset` will generate `p11-platform/.env.local` overrides for local Supabase, so keep long-lived shared secrets in `.env` and let `.env.local` remain generated.

Important shared env groups in `p11-platform/.env.example`:

- App/runtime: `NEXT_PUBLIC_SITE_URL` (preferred), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_URL`, `INTERNAL_API_KEY`, `CRON_SECRET`
- Data engine: `DATA_ENGINE_URL`, `DATA_ENGINE_API_KEY`
- Google/LumaLeasing: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_WEBHOOK_URL`, `GMAIL_WATCH_TOPIC`
- SiteForge deploy: either `CLOUDWAYS_API_KEY` + `CLOUDWAYS_EMAIL` or `SITEFORGE_WP_URL` + `SITEFORGE_WP_USERNAME` + `SITEFORGE_WP_APP_PASSWORD`
- Optional real-provider smoke toggles: `SITEFORGE_REAL_DEPLOY_SMOKE`, `LUMALEASING_REAL_SMOKE`, `LUMALEASING_REAL_SMOKE_API_KEY`

### 4. Initialize Local Supabase

```bash
cd p11-platform
npm run supabase:reset
```

This will:

- Start local Supabase
- Apply all repo migrations
- Seed deterministic local fixtures
- Generate `p11-platform/.env.local` so local services use the local database

Seeded local login:

- Email: `local-admin@p11.test`
- Password: `local-dev-password`

### 5. Start Services

```bash
cd p11-platform
npm run local:start
```

This starts:

- The web app on `http://localhost:3000`
- The data engine on `http://localhost:8000`
- Local Supabase on `http://127.0.0.1:54321`

Visit **http://localhost:3000** and sign up to get started!

### 6. Run Local Smoke Coverage

```bash
cd p11-platform
npm run smoke:local
```

This exercises seeded local flows on the shared local stack.

### 7. Inspect Recent Cron Runs

After local cron-backed routes execute, recent runs are visible through `GET /api/cron/runs?limit=20` for signed-in users.

### 8. Public Widget Hardening

The main anonymous LumaLeasing/widget routes now have explicit validation and rate-limit coverage for local `P0`.

### 9. Failure-Injection Coverage

Targeted local failure-injection coverage now verifies:

- provider-down booking behavior when Google Calendar event creation fails
- service-down cron behavior when the data-engine scraping service is unavailable

---

## P0 Roadmap Context

The active roadmap is local-first. Local `P0` closure is now complete, so the next work should come from deferred hosted production-hardening tasks or `P1`.

Next sequence:

1. Resume deferred hosted-only `P0` work such as CI/app-gate enforcement, hosted deployment gates, staging verification, or monitoring.

Sentry, hosted monitoring, PITR, staging, CI, and cutover planning remain valid, but they are deferred hosted-ops work rather than local `P0` blockers.

The Python data-engine and ETL layer have not been abandoned; they are simply not the pacing item for `P0` unless they block those local tasks.

See [`docs/P0_LOCAL_CONTINUATION_CONTEXT.md`](docs/P0_LOCAL_CONTINUATION_CONTEXT.md) and [`p11-platform/README.md`](p11-platform/README.md) for the current interpretation.

---

## 📊 Database Schema

Core tables in the unified data model:

| Category | Tables |
|----------|--------|
| **Identity** | `organizations`, `properties`, `profiles`, `team_members` |
| **CRM** | `leads`, `lead_activities`, `lead_scores`, `tours`, `tour_bookings`, `workflow_definitions`, `lead_workflows` |
| **Conversations** | `conversations`, `messages`, `widget_sessions`, `lumaleasing_config` |
| **Content** | `content_drafts`, `forgestudio_assets`, `property_brand_assets`, `property_websites`, `website_assets` |
| **Intelligence** | `competitors`, `competitor_brand_intelligence`, `competitor_content_chunks`, `reviews`, `review_responses` |
| **Analytics** | `fact_marketing_performance`, `fact_extended_metrics`, `scheduled_reports`, `metric_goals` |
| **Integrations** | `integration_credentials`, `field_mapping_suggestions`, `ad_account_connections`, `social_auth_configs` |
| **Knowledge** | `documents`, `knowledge_sources` (pgvector embeddings) |

---

## 🔌 API Endpoints

### CRM Integration
```typescript
POST /api/integrations/crm
Actions:
  - test-connection      // Test CRM API credentials
  - discover-schema      // AI-powered field mapping
  - search-lead          // Check for duplicates
  - push-lead            // Sync single lead
  - bulk-sync            // Sync multiple leads
  - validate-mapping     // Test with create/read/delete
  - save-mapping         // Save configuration
  - sync-stats           // Get sync statistics
  - sync-history         // Recent sync activity
```

### Lead Management
```typescript
GET  /api/leads?propertyId=...&status=...&page=...
POST /api/leads                           // Create lead
PATCH /api/leads                          // Update lead
GET  /api/leads/[id]/activities           // Activity timeline
POST /api/leads/[id]/activities           // Add note/activity
POST /api/leads/[id]/tours                // Schedule tour
POST /api/leads/[id]/send-message         // Send SMS/Email
```

### AI Chatbot
```typescript
POST /api/lumaleasing/chat
Headers: { X-API-Key: string, X-Visitor-ID: string }
Body: { messages: Message[], sessionId?: string, leadInfo?: object }
Response: { content: string, sessionId: string, shouldPromptLeadCapture: boolean }
```

### Brand & Site Generation
```typescript
POST /api/brandforge/conversation         // Chat with Gemini 2.0
POST /api/brandforge/generate-next-section // Generate brand book sections
POST /api/brandforge/generate-pdf         // Export PDF

POST /api/siteforge/generate              // Generate WordPress site
GET  /api/siteforge/status/[websiteId]    // Poll generation progress
POST /api/siteforge/deploy/[websiteId]    // Deploy to WordPress
```

### Analytics
```typescript
GET /api/analytics/performance?propertyId=...&startDate=...&endDate=...
POST /api/analytics/upload                // CSV import (8+ report types)
GET /api/analytics/campaigns              // Campaign performance
```

---

## 🧪 Development

### Web App
```bash
cd p11-platform/apps/web
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run linter
```

### Data Engine
```bash
cd p11-platform/services/data-engine
python main.py       # Start FastAPI server
# API docs available at http://localhost:8000/docs
```

### Database
```bash
cd p11-platform/supabase
supabase db push     # Apply migrations
supabase db reset    # Reset database
```

---

## 📊 Performance Metrics

| Metric | Traditional | With P11 |
|--------|-------------|----------|
| Lead Response Time | Hours | **< 1 minute** |
| Content Output | 50-75/month | **300+/month** |
| Brand Book Creation | 2-3 weeks | **30 minutes** |
| Website Generation | 2-3 weeks | **3 minutes** |
| Properties per Manager | 10-12 | **30-40** |
| Campaign Optimization | Business hours | **24/7/365** |
| Review Response | Days | **< 1 hour** |
| CRM Data Entry | Manual | **Automatic** |

---

## 🔐 Security

- **Row Level Security (RLS)** - Multi-tenant data isolation at database level
- **API Key Authentication** - Secure widget and data-engine endpoints
- **Encrypted Storage** - Social OAuth credentials encrypted at rest
- **Service Role Protection** - Admin operations use service role key
- **CORS Configuration** - Restricted origins for API access

---

## 🌟 Recent Updates

### January 2026 - CRM Integration
- ✅ AI-powered schema discovery with Claude Sonnet 4
- ✅ One-way lead push to Yardi, RealPage, Salesforce, HubSpot
- ✅ Duplicate checking before creating leads
- ✅ Bulk sync existing leads from TourSpark
- ✅ Self-service configuration UI with field mapping review
- ✅ Test sync validation (create/read/delete test record)
- ✅ Learning system tracks corrections for better AI suggestions
- ✅ Real-time sync monitoring dashboard

### December 2025 - Data Engine Migration
- ✅ PropertyAudit migrated to Python with 50% faster parallel execution
- ✅ MCP marketing data auto-sync (Google Ads + Meta Ads)
- ✅ Real-time progress tracking for long-running jobs
- ✅ Feature flag architecture for zero-downtime migrations

### December 2025 - Site Generation
- ✅ SiteForge WordPress generator with Gemini 3 Pro
- ✅ BrandForge brand book generator with Gemini 2.0
- ✅ 3-tier brand intelligence extraction
- ✅ Cloudways deployment integration

---

## 📚 Documentation

### Product Guides
- [CRM Integration Quick Start](./docs/CRM_QUICK_START.md)
- [BrandForge Quick Start](./docs/BRANDFORGE.md)
- [SiteForge Quick Start](./docs/SITEFORGE.md)
- [Data Engine Migration](./docs/DATA_ENGINE_MIGRATION.md)
- [Production Readiness Audit](./docs/PRODUCTION_READINESS_AUDIT_2025-12-15.md)

### Technical Docs
- [MCP Servers](./p11-platform/services/mcp-servers/README.md)
- [Data Engine](./p11-platform/services/data-engine/README.md)
- [Agents Documentation](./docs/AGENTS.md)

---

## 🤝 Contributing

This is a private project for P11 Creative. For internal team members:

1. Create a feature branch from `main`
2. Make your changes with descriptive commits
3. Submit a pull request for review
4. Ensure all tests pass and linter is clean

---

## 📄 License

Proprietary — P11 Creative © 2025-2026

---

<div align="center">

**Built with ❤️ by P11 Creative**

*The Autonomous Agency*

</div>
