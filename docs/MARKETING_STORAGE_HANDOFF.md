# oneClick / P11 — marketing account identity and fractional conversions

September 14, 2026. Local implementation following daily provider report qualification. This supersedes that handoff's whole-conversion rejection and old storage-key limitations; its separately dated evidence remains historical.

## Result

Daily facts now retain provider account and channel as part of their identity, so the same campaign ID from different ad accounts or platforms can coexist. An import retry updates only its matching date/property/channel/account/campaign row. Conversion storage is numeric and the application preserves attributed fractions, including 0.000125, through daily imports, CSV parsing, campaign views, KPIs and export formatting.

The migration adds a UUID primary key, nullable historical account/currency fields, and a unique constraint on `(date, property_id, channel_id, source_account_id, campaign_id)` with NULLS NOT DISTINCT. A NOT VALID check preserves historical rows while requiring valid account identity, supported channel, confirmed USD and bounded nonnegative metrics on every new or changed row. GA4's zero-spend records may have no currency. There is no exchange-rate conversion.

Historical source accounts and currencies remain unknown; no attribution was invented. An invoker trigger refuses overlapping writes where the same property/day/campaign has a legacy row with a matching channel alias or an unknown channel. The manual import job exposes a specific reconciliation message. This prevents adding a second account-attributed row alongside an ambiguous older record. It does not reconcile the historical dataset or prove that every old campaign naming convention refers to the same campaign.

All located Python manual/legacy Google, Meta and GA4 writers, native web Google/Meta writers, the daily CSV writer, seed fixtures, web types and the bounded analytics RPC use the new contract. Legacy Google normalization retains account/currency and decimal conversions; legacy Meta requests daily campaign rows and validates returned account/currency/dates. These changes do not qualify all legacy provider behavior.

Campaign lists, counts, trends and exports retain account identity. Selecting a campaign requests its account and channel; a campaign-ID-only trend request spanning multiple identities returns a conflict instead of merging them. Unattributed historical rows display “Account needs review.” Failed or superseded trend requests do not display stale data.

CSV review requires an account ID and explicit USD confirmation. Daily conversions use decimal parsing instead of integer rounding; malformed, negative or out-of-range conversion values fail before preview or storage. Existing empty/no-data conversion markers retain their zero interpretation. Campaign summaries are refused as daily performance, including during preview. The preview explains supported report behavior and renders date-only values without shifting them to the previous day in Pacific time. Extended reports remain separate analysis records.

## Fresh verification

- **100 Python cases passed** across daily report qualification, import acceptance/recovery and authentication. Provider transports were replaced by fixtures. Existing FastAPI/Starlette dependency deprecation warnings remain.
- **60 web unit/route cases passed** across campaign reads/export formatting, CSV upload/parser, native Google/Meta adapters and scheduled sync outcomes. These cover decimal parsing and rejection, account conflicts, scoped trend reads, source validation and writes. This is the current suite count, not an addition to earlier historical counts.
- **12 browser cases passed:** five account/CSV cases and seven existing import-tracking cases. The five latest cases verify account selection, visible trend failure, source/USD review, tiny-fraction display, missing-account rejection by the actual local API and a fractional preview through that API. Most report fixtures are intercepted; the actual API cases authenticate to localhost. No real provider was contacted.
- Full web type checking, targeted lint and whitespace checks passed. Desktop campaign and CSV screenshots were inspected. PDF export formatting changed, but no rendered PDF visual qualification was performed. Node 26 was installed for these checks; the repository's declared Node 24 runtime still needs release-environment qualification.
- SQL checks passed for separate account/channel rows, exact numeric fractions, isolated upsert retries, invalid identity/currency/numeric rejection, obsolete conflict-key rejection, historical-overlap protection, authenticated/anonymous reads and bounded campaign grouping. Pre-migration verification proved that existing metric values and unknown account/currency were preserved.
- A localhost integration check exercised actual import acceptance, worker claims, persistence and authenticated reads using three mocked provider reports with the same campaign ID across two Google accounts and one Meta account. A new-job reimport updated those three rows without duplication. Temporary jobs, connections and facts were removed.
- **32 Phase 0 SQL assertions passed conditionally:** both prepared Phase 0 migrations and the latest account-aware analytics function were applied inside a temporary transaction, tested, then rolled back. This verifies compatibility; it does not mean the Phase 0 repairs are installed in the current local or hosted database.
- Local database advisor reports contained **1,386 warnings before and after, with zero added findings**. This is comparison evidence, not a clean security audit.

## Exact local schema state and release prerequisites

Migration `20260914195328_marketing_fact_account_identity.sql` was created with the installed Supabase CLI. Its SQL is applied to the local development database only. It was deliberately not recorded as applied in migration history during direct SQL iteration. Local migration history also lacks the two prepared Phase 0 repairs and other earlier entries. Do not blindly repair history, reset/seed the database or push the entire migration directory.

The broader access suite initially exposed those missing Phase 0 prerequisites. Conditional transaction verification passed after including both `20260905190852_phase_zero_access_hardening.sql` and `20260906014842_phase_zero_engagement_conflict_repair.sql`; the old persistent local access configuration was left unchanged. Hosted state has not been inspected in this increment.

Before a specifically authorized release: inventory actual schema/history, back up, reconcile prerequisites and historical account ownership, then coordinate the new schema with every backend/web writer and reader. The old three-column upsert target now fails explicitly. An old application rollback is therefore not automatically compatible with the new schema. Keep scheduled writers and real import attempts held until that coordinated validation is complete. Existing local historical seed rows must not be blindly reseeded under the new identity.

## Remaining work

1. Reconcile historical aggregate/truncated/unknown-account records against authorized provider evidence. Resolve row ownership, identify obsolete aggregates and missing rows, and make each correction reviewable. No relabel, delete, backfill or real sync was performed here.
2. Qualify native scheduled and legacy provider paths end to end: API versions, timezone windows, pagination, attribution definitions, returned counts and freshness. Manual Meta imports retain lead + registration + purchase; the native adapter's additional application action is still a semantic difference requiring a deliberate metric definition.
3. Qualify complete paginated analytics reads and reconcile dashboard/export totals against stored rows. Existing Data API limits remain a risk for large windows. Monetary display remains USD-only and storage remains cent precision; JavaScript/Python numeric boundaries and 15-significant-digit display do not promise arbitrary-precision fractional presentation.
4. Tighten CSV report contracts beyond this increment: supported provider header/date formats, inferred campaign IDs and date-range naming, account evidence inside exports, and complete metric/date validation. CSV IDs generated from names/ranges do not establish identity with provider campaign IDs. Extended-report account provenance was not migrated here.
5. Add durable execution and coordination beyond process-local workers. Hard termination can leave running jobs, and different job IDs can overlap. There is no autonomous replay, queue recovery or account-level job lock yet.

No push, hosted migration, credential reconnection, real provider sync, deployment, message or backlog replay occurred. The oneClick release hold remains. No client website or personal SiteForge skill changed. This completes a reporting increment, not the full improvement plan.

## Files and continuation

The migration and `supabase/tests/marketing_fact_identity.test.sql` define the storage contract. Python changes are in `services/data-engine/pipelines/` and its normalizers/tests. Web changes cover analytics upload/campaigns, native sync routes, the MarketVision summary reader, `utils/analytics/marketing-fact.ts`, the CSV parser, chart components, BI page, exports, types and browser tests.

This task's `work/reporting-storage/` contains pre-change copies, the hash-checked installer, SQL/local integration helpers, advisor comparisons and reviewed screenshots. The temporary Phase 0 verifier rolls back its changes. The initial migration-apply and pre-migration helpers are one-time scripts and must not be rerun against the already-updated local table.

Continue from `P11_IMPLEMENTATION_PLAN.md`; preserve earlier uncommitted work and the personal-Codex SiteForge decision. The next local reporting work should establish read-only reconciliation and complete read coverage before any proposal to change historical facts or run real accounts.
