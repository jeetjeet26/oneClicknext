# Phase 5 — complete and truthful competitor reporting

Status: locally verified for saved pricing overview/comparison/history and the report read API. Saved brief generation and recommendation/export decisions remain the next increment.

A single access-checked database snapshot supplies the active competitive set, every floor plan, the selected observation window and its prior baseline, with scoped capture metadata. Reads do not silently truncate at 1,000 rows. Failed, invalid or oversized snapshots produce an error rather than an empty or partial report. Private receipt bodies and references stay private.

Missing rents and availability stay unknown; known zero stays zero. Bedroom comparisons count distinct competitors and explain the floor-plan-weighted mean of advertised starting rents. They do not infer pricing upside from an unmatched mix of plans. Source metadata separates console recording, capture, verified fetch and price-effective times. Opening a report never updates source freshness.

History uses a fixed set of plans with a known pre-window baseline and no intervening unknown rents. Repeated updates and newly added plans do not change weighting. Conflicting same-time observations are retained and excluded from inferred changes/history. Daily UTC checkpoints carry saved observations; they do not claim live market prices stayed unchanged. Percent movement requires a nonzero baseline and at least two competitors. Unsupported movement remains insufficient evidence.

The overview and comparison displays include sample counts, source evidence and explicit read recovery. Rapid filter changes discard late responses, property switches clear prior data, and mobile layout is verified. The report GET endpoint uses the same calculation and omits unsupported financial recommendations. The older saved-brief path and direct report POST still require the next recorded-report increment.

## Verification

- 280 MarketVision service/API/calculation/action/transport checks across 38 suites pass, including unknown/zero handling, fixed cohorts, same-time ambiguity, invalid filters and read failures.
- 18 new SQL assertions; all five MarketVision rollback suites pass serially (164 assertions). The separate ReviewFlow response suite remains pending and excluded.
- Three distinct browser journeys pass. The initial empty-property read exceeded the first browser timeout; the targeted recovery/property-switch rerun passed after waiting for property selection and allowing preview response time. Mobile evidence inspected.
- Full application types, changed-file lint and generated-schema stamp pass. 282 saved function bodies match the local database; no fixture/orphan records remain. Existing 1,333 database WARN/ERROR findings are unchanged.
- Migration 20260922190937_phase_five_marketvision_reporting.sql is local only. No hosted mutation, model/provider calls, deployment or training occurred.

Continue saved briefs, reviewed recommendations/exports, monitoring/discovery/intake, system/interaction coverage and every retained product gate. Phase 5 remains open.
