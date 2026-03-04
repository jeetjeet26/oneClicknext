# Documentation Consolidation Diff Analysis

Last Updated: March 2, 2026
Comparison Baseline:
- Existing docs in `oneClick/`, `oneClick/docs/`, and `oneClick/p11-platform/`.
- New target docs:
  - `docs/CANONICAL_AUTONOMY_OPERATING_SPEC.md`
  - `docs/runbooks/*.md`
  - `docs/product-specs/*.md`

## 1. Goal of This Diff
Determine whether the new canonical doc + specialized runbooks + product specs preserve the intent of existing documentation without deleting anything yet.

## 2. Result Summary
- Consolidation is now broad-coverage across strategy, operations, and product-specific intent.
- Existing docs still hold detailed commands/examples that can be retained as appendices until selectively merged.
- Main remaining risk is contradictory status claims across legacy docs if they are treated as current truth.

## 3. Coverage Categories
- `Covered`: intent is represented in canonical/runbooks/product-specs.
- `Partial`: intent is represented, but specific command-level or deep implementation detail is still only in legacy doc.
- `Gap`: intent not represented in new docs.
- `Historical`: point-in-time report; retained for audit trail.

## 4. Old-to-New Intent Mapping
| Existing Doc | Original Intent | New Location | Coverage | Action Recommendation |
|---|---|---|---|---|
| `MASTER_PLAN.md` | long-range autonomous strategy and phased roadmap | `CANONICAL_AUTONOMY_OPERATING_SPEC.md` | Covered | Keep as historical planning record |
| `FULL_AGENCY_AUTOMATION_TECHNICAL_SUMMARY.md` | architecture/gaps/workstreams summary | Canonical sections 3, 4, 7 | Covered | Keep short-term reference |
| `README.md` (root) | onboarding and project overview | Canonical scope + README onboarding role | Partial | Keep onboarding details here |
| `p11-platform/README.md` | module overview, APIs, setup | Product specs + canonical governance | Partial | Align status wording to canonical |
| `docs/P11_PLATFORM.md` | platform vision, roadmap, status | Canonical + product specs | Covered | Keep as ecosystem background |
| `docs/PRODUCTION_READINESS_AUDIT_2025-12-15.md` | audit snapshot and blockers | Canonical reqs + runbooks | Historical | Retain for traceability |
| `docs/PRODUCTION_READINESS_QUICK_CHECKLIST.md` | readiness checklist | `RUNBOOK_RELEASE_AND_DEPLOYMENT.md` | Partial | Keep as quick operator checklist |
| `docs/INCIDENT_RESPONSE_PROCESS.md` | vuln/security process | `RUNBOOK_INCIDENT_RESPONSE.md` | Partial | Keep security-policy-specific legal text |
| `DATA_ENGINE_MIGRATION_QUICKSTART.md` | quick execution mode control | `RUNBOOK_DATA_ENGINE_PROPERTYAUDIT.md` | Partial | Keep command appendix |
| `docs/DATA_ENGINE_MIGRATION.md` | detailed migration steps | data-engine + release runbooks | Partial | Keep migration command details |
| `FINAL_IMPLEMENTATION_STATUS.md` | PropertyAudit completion narrative | `PRODUCT_PROPERTYAUDIT.md` + canonical state model | Covered | Mark historical later |
| `PROPERTYAUDIT_COMPLETE_STATUS.md` | PropertyAudit features, endpoints, usage | `PRODUCT_PROPERTYAUDIT.md` | Covered | Keep as detailed reference |
| `IMPLEMENTATION_COMPLETE.md` | migration completion note | data-engine runbook + product spec | Covered | Keep as historical milestone |
| `LUMALEASING_IMPLEMENTATION_STATUS.md` | LumaLeasing status and next steps | `PRODUCT_LUMALEASING.md` | Covered | Keep as detailed progress log |
| `LUMALEASING_WIDGET_IMPLEMENTATION_COMPLETE.md` | widget implementation and setup | `PRODUCT_LUMALEASING.md` + runbooks | Covered | Keep as deep implementation appendix |
| `LUMALEASING_CALENDAR_SETUP.md` | Google setup and cron ops | LumaLeasing product spec + integrations/cron runbooks | Covered | Keep provider command detail |
| `RENDER_SETUP_INSTRUCTIONS.md` | platform-specific cron setup | cron runbook | Partial | Keep environment-specific instructions |
| `KNOWLEDGE_BASE_FEATURES.md` | knowledge ingest features/schema/workflows | `PRODUCT_KNOWLEDGE_BASE.md` | Covered | Keep deep troubleshooting examples |
| `docs/BRANDFORGE.md` | BrandForge architecture/flows/setup | `PRODUCT_BRANDFORGE.md` | Covered | Keep deep implementation details |
| `docs/SITEFORGE.md` | SiteForge architecture/deploy gap | `PRODUCT_SITEFORGE.md` | Covered | Keep detailed agent internals |
| `docs/LUMALEASING.md` | long-form integration plan | `PRODUCT_LUMALEASING.md` + runbooks | Covered | Keep plan history |
| `docs/CRM_QUICK_START.md` | CRM setup and tests | `PRODUCT_CRM_TOURSPARK_LEADPULSE.md` + runbooks | Covered | Keep quick command guide |
| `p11-platform/MULTICHANNEL_BI_MCP_INTEGRATION.md` | BI/MCP integration state and usage | `PRODUCT_MARKETVISION_AND_BI_IMPORTS.md` | Covered | Keep detailed operator steps |
| `p11-platform/SCALABLE_IMPORT_SYSTEM.md` | import architecture and autoscheduling | MarketVision/BI product spec + cron runbook | Covered | Keep technical deep dive |
| `docs/LIBRARY_OUTDATED_REPORT_2025-12-15.md` | dependency audit snapshot | canonical quality requirements | Historical | Keep for audit history |
| `docs/LIBRARY_UPDATE_SAFETY_ANALYSIS.md` | dependency update process | release runbook | Partial | Keep detailed update guardrails |
| `docs/LIBRARY_UPDATE_QUICK_REFERENCE.md` | quick dependency fix | release runbook | Partial | Keep as short cheat sheet |
| `TOKEN_LIMITS_REFERENCE.md` | model token config reference | product specs (implementation appendix role) | Partial | Keep technical reference |

## 5. Coverage Score (Current)
- Strategy coverage: High.
- Operational coverage: High.
- Product-specific coverage: High (all major products now represented).
- Remaining partials are mostly command-level/operator details retained in legacy docs.

## 6. What You Can Safely Do Now
Without deleting anything:
1. Use `CANONICAL_AUTONOMY_OPERATING_SPEC.md` for all maturity/status decisions.
2. Use `runbooks/` for operational execution.
3. Use `product-specs/` as product truth layer.
4. Keep legacy docs as historical/appendix until optional archive pass.

## 7. Pre-Archive Exit Criteria
Do not delete legacy docs until all are true:
1. Each product spec has owner + last verified date.
2. Runbooks contain all command-level procedures required by operators.
3. Contradictory status text in legacy docs is clearly marked historical.
4. Team dry-run confirms daily operations can be executed from canonical + runbooks + product specs only.
