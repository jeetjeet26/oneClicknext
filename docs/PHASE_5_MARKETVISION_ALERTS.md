# Phase 5 — recorded MarketVision alert lifecycle

September 22, 2026. Locally qualified; Phase 5 remains active.

Alert review now acts on an exact displayed selection of up to 50 IDs and versions. A newly arriving or unseen alert cannot be swept into the decision. Reported alert creation, read acknowledgment, reasoned dismissal and restoration are atomic with private before/after evidence and shared actor records. One stale or foreign record prevents every selected update. Lost replies reuse the original decision; no optimistic counter can invent a successful review. Dismissal preserves evidence, and restoration preserves the original read timestamp.

Complete property counts and paged lists use one consistent database read, including more than 1,000 rows and missing/tied dates. Open, unread, dismissed and all views remain available. Source labels distinguish recorded operator reports from unqualified earlier sources. Raw provider data is excluded, direct browser table access is revoked, and the API uses current property authorization. Read failures stay visible, delayed responses cannot cross a property switch, and current selection details are hidden after a failed read. Reviewing or dismissing an alert does not verify its source, resolve a market change or create a business outcome.

Migration: `20260922212247_phase_five_marketvision_alerts.sql`. Earlier property-wide `read_all`/`dismiss_all` requests are rejected. Manual alert creation uses a saved request, explicit reason and bounded fields, with no caller-supplied provider evidence. Content or state changes increment the review version. Source labels are backed by the exact recorded resource.

Verified: 469 unit/API cases across 53 related suites; 32 dedicated SQL assertions and 400 serial MarketVision/shared-action/editorial assertions; three browser journeys plus a final complete-selection rerun after access restrictions. Types, touched-file lint and schema stamp pass. All 310 retained function bodies match the local schema; checked fixtures/orphans are absent; advisor WARN/ERROR keys remain at the existing 1,333 baseline. Mobile layout was inspected. The separately pending ReviewFlow response SQL suite was excluded.

No provider/model calls, notifications, publication, hosted mutation or training occurred. Local validation added no migration-history entries. Brand intelligence and search, discovery/provider qualification, runtime/schedule activation, remaining interaction/system recording, client acceptance and every unfinished retained-product gate remain open.
