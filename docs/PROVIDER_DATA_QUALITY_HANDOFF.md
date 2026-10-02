# oneClick / P11 — daily provider report qualification

September 14, 2026. Local follow-up to import tracking and recovery; no release or real account sync.

## Behavior corrected

Google's previous manual-import helper returned one aggregate per campaign, limited the result to 100 campaigns, then assigned yesterday to each total. The new purpose-specific helper requests `segments.date` and every campaign/day in an explicit window. It consumes the SDK's entire search iterator and converts cost micros to major currency units once. The manager identity is configured on the SDK client; the new helper does not pass the unsupported `login_customer_id` argument to `search`. The synchronous SDK work runs off the asynchronous request loop.

Meta's previous helper returned one aggregate per campaign from only the first page. The new helper requests campaign-level insights with `time_increment=1`, explicit `since`/`until` dates, account/currency fields and all cursor pages. Each continuation uses the original account endpoint and the returned cursor; it does not follow the supplied next URL. Invalid pages, missing continuation cursors, repeated cursors and later-page failures reject that account's report before any of its rows are written.

Both helpers resolve the seven supported UI periods against the advertising account's own timezone. Last 7/14/30 days exclude today; Today and This Month include the current day; Last Month covers the prior calendar month. Missing or invalid timezones and unsupported ranges are explicit errors. The legacy incremental first-import fallback is now LAST_30_DAYS rather than MAXIMUM. Large historical backfills need a separate bounded plan.

A shared transformation validates account identity, USD currency, single-day dates inside the report window, campaign identity, duplicate campaign/day rows, numeric values and existing storage limits. It rejects multi-day totals instead of assigning a fallback date. Missing core metrics are not silently turned into zero. It preserves the existing Meta conversion definition (lead + complete_registration + purchase) and does not add overlapping aliases. It rounds each daily spend amount to the current table's cent precision using decimal arithmetic. Verified new rows use `raw_source=mcp_daily_v1` to distinguish the new path from old `mcp` output.

Provider exceptions are not copied into visible job errors, where request URLs could contain credentials. Known validation failures have specific operator-visible explanations; other failures show a safe provider-report error. Account writes happen only after the full report has been read and validated. Storage uses batches of 250 confirmed rows. A later failed/unconfirmed storage batch preserves earlier confirmed counts as a partial result; freshness changes only after all account batches are confirmed. An unconfirmed database response may still have committed rows and remains a reconciliation case.

## Verification

**97 passing Python cases:** 63 new daily-report cases plus the 34 existing import acceptance/recovery/authentication cases. Coverage includes calendar and timezone boundaries, DST, leap month and year boundaries, invalid ranges/timezones/identities/dates/metrics, micros-to-currency conversion, duplicate rows, fractional-value rejection, Meta conversion aliases, Google reports over 100 rows, Meta continuation pages, late-page failure, safe error text, whole-account validation, 700-row writes, and partial counts after a later storage-batch failure. The existing FastAPI TestClient dependency deprecation warning remains.

A separate localhost-only Supabase check ran the actual new transformation and existing import acceptance/worker/persistence flow with provider reads replaced by fixtures. It verified two dated rows (12.35 and 7.20), a repeated request claiming only once, authenticated/RLS reads, explicit rejection of fractional conversions and unchanged freshness on failure. All exact temporary job/account/fact rows were removed. A read-only SQL check confirmed the current local schema: spend numeric(10,2), conversions bigint, primary key (date, property_id, campaign_id). No migrations or persistent schema changes were made.

Whitespace/syntax review passed. No web UI files changed, and browser/type results from the previous increment were not counted as fresh checks. SDK interface inspection used anonymous credentials after an initial dummy-credential construction attempted an OAuth refresh and failed at sandbox DNS; no real provider credentials were used by those checks. The tests replace every provider transport/client boundary.

## Remaining work and release boundaries

- **Fractional conversions:** the current bigint cannot preserve attributed fractions. The new path explicitly refuses these records instead of truncating or rounding. A compatible numeric migration plus a reader/export/KPI audit is still required; do not claim fractional support.
- **Currency:** BI/export currently assumes USD and facts have no currency dimension. Non-USD and missing currency reports are refused; no exchange-rate conversion occurs. Supporting other currencies requires an explicit storage and display policy.
- **Account/channel keys:** returned account identity is verified, but the old fact primary key still omits channel/account and does not persist source-account identity. This increment does not prevent collisions across separate accounts/channels. Upgrade all native, MCP, CSV and legacy writers/readers together; do not simply namespace campaign IDs or add a key while leaving legacy writers active.
- **Historical data:** old aggregated or truncated rows have not been inspected, relabeled, deleted or backfilled. A normal authorized daily upsert can replace the same existing day/property/campaign key; it does not reconcile all historical errors or remove records omitted from a later report. Reconciliation and release qualification must precede real sync.
- **Native scheduled paths:** existing native Google/Meta adapters, their API versions, attribution behavior, UTC date selection, numeric conversions and currency/account keys still need qualification. They do not automatically gain the new manual-import helper behavior.
- **Execution:** background jobs remain process-local; hard termination can leave running rows requiring review, and distinct job IDs can overlap. No autonomous replay or durable worker queue was introduced.

No push, hosted migration, credential reconnection, real provider sync, client messaging, backlog replay or deployment occurred. Keep the earlier release hold and backend-before-web sequencing. No client website or personal SiteForge skill changed.

## Changed files

- `p11-platform/services/mcp-servers/shared/daily_reports.py`: shared account/date/timezone validation and calendar windows.
- `p11-platform/services/mcp-servers/google_ads/tools/performance.py`: separate complete daily-report reader; existing summary tool defaults preserved.
- `p11-platform/services/mcp-servers/google_ads/config.py`: SDK manager-account configuration.
- `p11-platform/services/mcp-servers/meta_ads/client.py`: separate daily paginated reader; existing summary methods preserved.
- `p11-platform/services/data-engine/pipelines/marketing_report.py`: validated fact transformation against the current table contract.
- `p11-platform/services/data-engine/pipelines/mcp_marketing_sync.py`: daily helper integration, bounded initial history, safe failures and confirmed write batches.
- `p11-platform/services/data-engine/tests/test_daily_marketing_reports.py`: provider, transformation and persistence regression fixtures.

This task's `work/provider-data-quality/` contains pre-change copies, hash-checked installation metadata and the localhost verification helper. Earlier Phase 0, SiteForge, Pipelines and import-tracking work remains preserved and uncommitted.

## Primary references checked

The implementation follows Google's [report segmentation](https://developers.google.com/google-ads/api/docs/reporting/segmentation), [automatic SDK pagination](https://developers.google.com/google-ads/api/docs/reporting/paging) and [date-range definitions](https://developers.google.com/google-ads/api/docs/query/date-ranges). The installed SDK search signature was also inspected locally.

Meta's official [Insights field definitions](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py) and [SDK cursor implementation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/api.py) support the selected account/currency/date fields and cursor continuation. The direct Meta documentation endpoints were unavailable during this check. The existing native adapter already requests daily insights; current account access and API acceptance still require a separately authorized provider qualification.
