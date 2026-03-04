# Product Spec: Knowledge Base Management

Last Updated: March 2, 2026
Status: Active (agency memory layer)

## 1. Purpose
Ingest, store, and refresh structured/unstructured property knowledge for downstream AI workflows.

## 2. Core Capabilities
- Add website URL sources and scrape content.
- Paste text content directly as managed source material.
- Upload and manage documents.
- Refresh/sync source content for current state.

## 3. Interfaces (Representative)
- `POST /api/community/scrape-website`
- `POST /api/documents/paste-text`
- Document/source management APIs in community module.

## 4. Data and State
- Source metadata and ingestion state must be persisted.
- Vectorized retrieval/embedding integration supports downstream products.

## 5. Operational Requirements
- Ingestion jobs must surface errors with actionable categories.
- Source freshness and re-sync windows should be trackable.
- Failed ingestion must not corrupt existing knowledge records.

## 6. Dependencies
- OpenAI embeddings stack, storage layer, parser/scraper utilities.

## 7. Known Gaps
- Standardized ingestion SLOs and alerting are not uniformly enforced.
- Product-level run quality dashboards remain limited.

## 8. Runbook Link
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
