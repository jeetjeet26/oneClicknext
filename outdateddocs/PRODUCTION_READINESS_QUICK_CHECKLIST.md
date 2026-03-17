# Production Readiness - Quick Checklist
**P11 Platform | December 15, 2025**

This checklist is for hosted production hardening, not the current source of truth for local `P0` execution order.

For current priority, use:

- [`.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`](../.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md)
- [`docs/P0_LOCAL_CONTINUATION_CONTEXT.md`](./P0_LOCAL_CONTINUATION_CONTEXT.md)

Interpretation for current work:

- Sentry, hosted monitoring, PITR, staging, and environment cutover are deferred hosted-ops items, not immediate local `P0` blockers.
- Python/data-engine and ETL concerns remain relevant, but they should only move into the current lane if they block local smoke/e2e, cron visibility, or failure-injection work.

## ⚠️ CRITICAL - DO NOT DEPLOY WITHOUT THESE

### 🔴 Security (Must Fix Immediately)
```bash
# 1. EXPOSED SECRETS - FIX NOW!
- [ ] Rotate ALL API keys (Supabase, OpenAI, Google, SerpAPI, Apify)
- [ ] Remove .env from git: git rm --cached p11-platform/.env
- [ ] Verify .env* is in .gitignore
- [ ] Check git history: git log --all -- "*/.env"
- [ ] Use BFG Repo Cleaner if .env was committed

# 2. RATE LIMITING
- [ ] Install: npm install @upstash/ratelimit @upstash/redis
- [ ] Add rate limits to:
  - /api/chat (10 req/min per user)
  - /api/lumaleasing/chat (20 req/min per IP)
  - /api/brandforge/* (5 req/hour per property)
  - /api/siteforge/* (3 req/hour per property)

# 3. INPUT VALIDATION
- [ ] Install: npm install zod
- [ ] Add validation schemas for ALL API routes
- [ ] Sanitize user input (notes, messages, names)

# 4. CORS CONFIGURATION
- [ ] Replace 'Access-Control-Allow-Origin: *' with specific domains
- [ ] Python data-engine: update CORS_ORIGINS list
```

---

### 🔴 Testing (Zero Coverage = High Risk)
```bash
# Minimum viable tests (Priority order)
- [ ] API authentication (all routes require valid session)
- [ ] Lead creation & duplicate detection
- [ ] Tour scheduling & date validation
- [ ] Payment/conversion tracking
- [ ] RAG document search (match_documents function)
- [ ] CSV parser (analytics upload)
- [ ] Email/SMS sending (mock external services)

# Setup
cd p11-platform/apps/web
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
npm install --save-dev @vitest/ui
```

**Target: 50% code coverage minimum**

---

### 🔴 Monitoring (Currently Blind)
```bash
# 1. Error Tracking
- [ ] Sign up: https://sentry.io
- [ ] Add to .env: SENTRY_DSN=...
- [ ] Install: npm install @sentry/nextjs
- [ ] Configure: npx @sentry/wizard@latest -i nextjs

# 2. Logging
- [ ] Install: npm install pino pino-pretty
- [ ] Replace all console.log with structured logs
- [ ] Add request IDs to all logs

# 3. Uptime Monitoring
- [ ] Sign up: https://uptimerobot.com (free)
- [ ] Monitor endpoints:
  - https://your-domain.com/
  - https://your-domain.com/api/health
  - https://your-domain.com/dashboard

# 4. Alerts (Set up notifications)
- [ ] Error rate > 1%
- [ ] Response time > 3s
- [ ] Database connection failures
- [ ] OpenAI API failures
```

---

### 🔴 Database Backups
```bash
# Supabase Dashboard
- [ ] Enable automated backups (daily)
- [ ] Set retention: 30 days
- [ ] Enable point-in-time recovery (PITR)
- [ ] Test restoration process (monthly)

# Document recovery procedure
- [ ] Create runbook: docs/disaster-recovery.md
- [ ] Assign on-call person
- [ ] Set up backup monitoring alerts
```

---

### 🔴 Deployment Process
```bash
# 1. Create Health Check Endpoint
# File: app/api/health/route.ts
export async function GET() {
  const dbCheck = await testDatabaseConnection()
  const openaiCheck = await testOpenAI()
  
  return NextResponse.json({
    status: dbCheck && openaiCheck ? 'healthy' : 'unhealthy',
    checks: { database: dbCheck, openai: openaiCheck }
  })
}

# 2. Staging Environment
- [ ] Create staging Supabase project
- [ ] Deploy to staging: vercel --prod
- [ ] Test all critical flows in staging
- [ ] Load test staging environment

# 3. Rollback Plan
- [ ] Document: How to rollback a bad deploy?
- [ ] Keep previous 3 deployments available
- [ ] Test rollback procedure
```

---

## 🟠 HIGH PRIORITY (Before First Real Users)

### API Security Hardening
```bash
- [ ] Implement CSRF protection
- [ ] Add request signing for webhooks
- [ ] Hash API keys in database (lumaleasing_config)
- [ ] Add API key expiration (90 days)
- [ ] Log all API key usage
```

### Error Handling Standardization
```typescript
// Create: utils/errors.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public userMessage: string,
    message: string
  ) {
    super(message)
  }
}

// Use in all API routes
try {
  // ... logic
} catch (error) {
  if (error instanceof AppError) {
    return NextResponse.json({ 
      error: error.userMessage, 
      code: error.code 
    }, { status: error.statusCode })
  }
  // Log and return generic error
}
```

### Database Optimization
```sql
-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_leads_property_id ON leads(property_id);
CREATE INDEX CONCURRENTLY idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX CONCURRENTLY idx_documents_property_id ON documents(property_id);
CREATE INDEX CONCURRENTLY idx_fact_marketing_property_date 
  ON fact_marketing_performance(property_id, date DESC);

-- Set query timeout
ALTER DATABASE postgres SET statement_timeout = '30s';

-- Enable query stats
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

---

## 🟡 MEDIUM PRIORITY (Within 2 Weeks)

### Performance Optimization
```bash
# 1. Caching Setup
- [ ] Install: npm install @upstash/redis
- [ ] Cache property data (5 min TTL)
- [ ] Cache analytics aggregations (15 min TTL)
- [ ] Cache AI responses for duplicate questions (1 hour TTL)

# 2. CDN Configuration
- [ ] Set up Cloudflare or CloudFront
- [ ] Configure caching headers
- [ ] Compress images (next/image already does this)

# 3. Database Connection Pooling
- [ ] Verify Supabase connection limits
- [ ] Configure pooler mode (transaction vs session)
```

### Code Quality
```bash
# Fix TODOs
- [ ] wordpress-client.ts - Implement or remove stubs
- [ ] brand-intelligence.ts - Implement Gemini Vision analysis
- [ ] llm-orchestration.ts - Implement refinement logic
- [ ] Document which TODOs are intentionally postponed

# Type Safety
- [ ] Enable TypeScript strict mode
- [ ] Remove all `any` types
- [ ] Add proper types for API responses
```

### Retry Logic for External APIs
```typescript
// utils/retry.ts
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; delay: number; backoff: number }
): Promise<T> {
  // Implement exponential backoff retry
}

// Use for:
// - OpenAI API calls
// - Google Gemini API
// - Twilio/Resend
// - External scraping
```

---

## 🟢 LOW PRIORITY (Month 2-3)

### Documentation
- [ ] Generate API docs (Swagger/OpenAPI)
- [ ] Create deployment runbook
- [ ] Document incident response process
- [ ] Create developer onboarding guide

### Compliance
- [ ] Add privacy policy
- [ ] Add terms of service
- [ ] Implement data export (GDPR)
- [ ] Implement data deletion (GDPR)

### Advanced Monitoring
- [ ] Set up distributed tracing (OpenTelemetry)
- [ ] Configure APM (Application Performance Monitoring)
- [ ] Set up log aggregation (Datadog, LogDNA)

---

## Quick Test Commands

```bash
# Security
npm audit --production
npm install -g gitleaks && gitleaks detect --source .

# Testing
npm test
npm run test:coverage

# Performance
npm run build -- --profile
npm install -g lighthouse
lighthouse https://your-domain.com

# Database
psql -c "SELECT count(*) FROM pg_stat_activity;"
psql -c "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"

# Load testing
npm install -g artillery
artillery quick --count 10 --num 50 https://your-domain.com/api/health
```

---

## Daily Production Checks (Once Live)

### Morning Check (5 min)
- [ ] Check Sentry for overnight errors
- [ ] Check uptime monitor (any downtime?)
- [ ] Check database backup completion
- [ ] Check disk space (database + storage buckets)

### Weekly Check (30 min)
- [ ] Review slow query log
- [ ] Check OpenAI API usage/costs
- [ ] Review Supabase bandwidth usage
- [ ] Check for security updates (npm audit)
- [ ] Review error trends

### Monthly Check (2 hours)
- [ ] Test backup restoration
- [ ] Review and clean up old data
- [ ] Update dependencies (security patches)
- [ ] Review and optimize database indexes
- [ ] Performance testing

---

## Emergency Contacts & Escalation

```bash
# Add to team docs
- Database emergency: [Primary DBA Contact]
- Security incident: [Security Lead]
- API provider outages: 
  - Supabase: https://status.supabase.com
  - OpenAI: https://status.openai.com
  - Vercel: https://www.vercel-status.com

# On-call rotation
- Week 1: [Engineer A]
- Week 2: [Engineer B]
```

---

## Cost Monitoring Thresholds

Set up billing alerts:

```bash
# OpenAI
- Warning: $500/month
- Critical: $1000/month
- Hard limit: $1500/month

# Supabase
- Database size: 8GB (Free tier limit)
- Bandwidth: 50GB/month
- Concurrent connections: 100

# Vercel
- Bandwidth: 100GB/month
- Build minutes: 6000 min/month
```

---

## Sign-Off Checklist (Before Going Live)

```bash
ALL CRITICAL ITEMS ABOVE COMPLETED?
- [ ] Security: Keys rotated, rate limiting, input validation
- [ ] Testing: 50%+ coverage, critical paths tested
- [ ] Monitoring: Sentry, logging, uptime monitors
- [ ] Backups: Automated, tested restoration
- [ ] Deployment: Health checks, rollback plan

TEAM PREPARED?
- [ ] Runbook created and reviewed
- [ ] On-call schedule assigned
- [ ] Emergency contacts documented
- [ ] Incident response plan practiced

LEGAL/COMPLIANCE?
- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] GDPR requirements met (if applicable)

STAKEHOLDERS INFORMED?
- [ ] Launch plan communicated
- [ ] Support team trained
- [ ] Customer success ready
```

---

**REMEMBER:** Production is not a destination, it's a practice. Continuous monitoring, testing, and improvement are essential.

**Estimated Timeline:**
- Critical fixes: 1 week
- High priority: 2 weeks
- Medium priority: 4 weeks
- Production ready: 4-6 weeks total

**Need help?** Refer to full audit: `PRODUCTION_READINESS_AUDIT_2025-12-15.md`
