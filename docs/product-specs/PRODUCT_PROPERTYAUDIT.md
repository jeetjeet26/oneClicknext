# Product Spec: PropertyAudit

Last Updated: March 2, 2026
Status: Active (partially autonomous)

## 1. Purpose
Deliver GEO/AI visibility intelligence, query-level scoring, and report generation for property marketing performance.

## 2. Core Capabilities
- Query generation and execution orchestration.
- Multi-execution batch processing.
- AI Overview visibility tracking.
- Reporting and summary output generation.
- Data-engine-backed processing mode with fallback path.

## 3. Interfaces (Representative)
- `POST /api/propertyaudit/run`
- `POST /api/propertyaudit/process`
- `POST /api/propertyaudit/score`
- `POST /api/propertyaudit/generate-report`
- `GET/POST /api/propertyaudit/ai-overviews`

## 4. Data and State
- Run lifecycle must support deterministic states (`queued/running/succeeded/failed`).
- Query executions and AI overview snapshots are persisted and reportable.

## 5. Operational Requirements
- Must support fallback execution mode when data-engine is degraded.
- Must expose health/readiness signals for run execution path.
- Must maintain idempotency protections for retries.

## 6. Dependencies
- LLM providers, scraping/connectors, data-engine service, database storage.

## 7. Known Gaps
- Full autonomy loop integration (scheduled autonomous optimization) remains incomplete.
- Unified reliability SLO/alerting should be enforced via platform runbooks.

## 8. Runbook Link
- `docs/runbooks/RUNBOOK_DATA_ENGINE_PROPERTYAUDIT.md`
