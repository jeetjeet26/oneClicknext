# P11 Console (Next.js App)

The unified dashboard for P11 Autonomous Agency products. Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase, and OpenAI.

## 🚀 Quickstart

```bash
cd p11-platform/apps/web
npm install
cd ../..
# Create p11-platform/.env with your shared credentials first
npm run supabase:reset
npm run local:start
```

Visit http://localhost:3000 — authenticated users land in `/dashboard`.

## ✨ Features

### Platform
- **Authentication** - Supabase Auth with email/password and Google OAuth
- **Multi-tenant** - Property switcher with organization-scoped data
- **Dashboard Shell** - Sidebar navigation, user menu, responsive design

### Products
- **MultiChannel BI** (`/dashboard/bi`) - Marketing analytics with charts and metrics
- **LumaLeasing** (`/dashboard/luma`) - AI-powered leasing chatbot with RAG
- **Properties** (`/dashboard/properties`) - Property CRUD management
- **Team** (`/dashboard/team`) - Team member management and invitations
- **Settings** (`/dashboard/settings`) - Organization and integration settings

### AI Capabilities
- **RAG Pipeline** - Document chunking, embeddings (text-embedding-3-small), vector search
- **PDF Upload** - Parse and ingest PDF, TXT, and MD files
- **Conversation Persistence** - Chat history saved to database
- **Context-Aware Responses** - GPT-4o-mini with property-specific knowledge

## 🔧 Environment Variables

Environment variables are loaded from the **root** `p11-platform/.env` file (shared across all apps).
When using local Supabase, `npm run supabase:reset` also generates `p11-platform/.env.local` with safe local overrides so the app points at the local stack instead of your hosted project.

Create `p11-platform/.env` from the canonical template:

```bash
cd p11-platform
cp .env.example .env
```

Use `p11-platform/.env.example` as the source-of-truth variable list, then fill in real values in `p11-platform/.env`.

Key variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server-side) | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `NEXT_PUBLIC_SITE_URL` | App URL for auth redirects | Optional |

The key values are the shared app secrets in `p11-platform/.env`, while `p11-platform/.env.local` is generated automatically for local Supabase overrides.

## 🧪 Local Supabase

From `p11-platform/`:

```bash
npm run supabase:reset
```

This starts local Supabase, reapplies migrations, seeds deterministic demo fixtures, and writes `p11-platform/.env.local`.

Seeded local login:

- Email: `local-admin@p11.test`
- Password: `local-dev-password`

## 📁 Project Structure

```
apps/web/
├── app/
│   ├── api/              # API routes
│   │   ├── analytics/    # BI data endpoints
│   │   ├── chat/         # LumaLeasing RAG chat
│   │   ├── conversations/# Chat history
│   │   ├── documents/    # Document upload & ingestion
│   │   ├── properties/   # Property CRUD
│   │   └── team/         # Team management
│   ├── auth/             # Auth pages (login, signup, etc.)
│   └── dashboard/        # Dashboard pages
├── components/
│   ├── charts/           # Recharts visualizations
│   ├── layout/           # Sidebar, PropertyContext
│   ├── luma/             # Chat, DocumentUploader
│   └── ui/               # Shared UI components
├── utils/
│   └── supabase/         # Supabase client utilities
└── middleware.ts         # Auth route protection
```

## 🗄️ Database

Migrations are in `p11-platform/supabase/migrations/`. Apply them to your Supabase project:

```bash
supabase db push
```

Key tables:
- `organizations` - Multi-tenant companies
- `properties` - Apartment communities
- `documents` - RAG knowledge base with pgvector
- `fact_marketing_performance` - Unified marketing metrics
- `leads`, `conversations`, `messages` - Lead/chat tracking

## 🔌 API Reference

### Chat
```typescript
POST /api/chat
Body: { messages, propertyId, conversationId? }
Returns: { role, content, conversationId }
```

### Documents
```typescript
POST /api/documents/upload
Body: FormData { file, propertyId, title? }
Accepts: PDF, TXT, MD (max 10MB)
```

### Analytics
```typescript
GET /api/analytics/performance?propertyId=...&startDate=...&endDate=...
Returns: { timeSeries, channels, totals }
```

## 🧪 Development

```bash
# Reset and reseed local Supabase
cd p11-platform
npm run supabase:reset

# Run local smoke coverage against the seeded stack
cd p11-platform
npm run smoke:local

# Start the shared local stack from p11-platform/
cd p11-platform
npm run local:start

# Start dev server
cd apps/web
npm run dev

# Run foundation tests
npm test

# Lint the hardened foundation files only
npm run lint:foundation

# Typecheck the hardened foundation files only
npm run typecheck:foundation

# Run the current local quality gate for the hardened platform surface
npm run check:foundation
```

```bash
# Run Playwright smoke coverage directly from apps/web
npm run test:smoke
```

Recent cron-backed executions are persisted in `cron_job_runs` and exposed to signed-in users via:

```bash
GET /api/cron/runs?limit=20
```

```bash
# Full repo lint (currently includes older debt outside the foundation slice)
npm run lint

# Full TypeScript typecheck is not yet a reliable gate while broader schema/code
# alignment is still in progress.
```

## 📚 Related

- **Data Engine** - Python ETL pipelines in `services/data-engine/`
- **Platform Overview** - See `docs/P11_PLATFORM.md`
- **Product Specs** - See `docs/product-specs/`
