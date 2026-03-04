# Product Spec: MarketVision and BI Imports

Last Updated: March 2, 2026
Status: Active (intelligence ingestion + reporting)

## 1. Purpose
Collect competitor/market/channel performance data and surface actionable intelligence for campaign decisions.

## 2. Core Capabilities
- Competitor intelligence views and analysis.
- Marketing channel data ingestion (Meta/Google where enabled).
- Auto-import and incremental sync strategies.
- Import history and status tracking.

## 3. Interfaces (Representative)
- MarketVision APIs (`/api/marketvision/...`).
- BI/MCP import flows and scheduler-backed ingestion paths.

## 4. Operational Requirements
- Import jobs must be idempotent and observable.
- Rate-limit and quota-aware scheduling required.
- Partial imports should be recoverable without data duplication.

## 5. Dependencies
- MCP connectors, external marketing APIs, data-engine pipeline services.

## 6. Known Gaps
- Standardized production scheduler strategy across environments needs tightening.
- Some docs duplicate implementation narratives and should be merged over time.

## 7. Runbook Link
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
