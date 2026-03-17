# Vision: MultiChannel BI

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

MultiChannel BI is the system that normalizes marketing performance across channels and turns raw imports into operator-trustworthy reporting, comparison, and future optimization input.

## Role In The Platform

This product is the performance truth layer for paid media and channel reporting. It is the product most likely to influence future pacing, budget, and creative optimization loops, so its data integrity bar must be high.

## Current Implementation Baseline

Materially implemented today:

- analytics APIs in `app/api/analytics/*`
- import and reporting paths in `app/api/marketvision/import/route.ts` and related BI surfaces
- recurring sync in `app/api/cron/sync-ads/route.ts`
- dashboard and import UI under BI and MarketVision components

Current reality:

- the reporting and import surface is real
- recurring sync and connection health logic exist in parts of the stack
- normalization and scheduler wiring still need cleanup before this becomes a dependable optimization substrate

## End-State Vision

MultiChannel BI should behave like a trustworthy data operating system for campaign performance:

- one normalized channel model
- one clear import state model
- one operator-visible truth about success, failure, freshness, and partial completion
- clean reporting surfaces for property-level and portfolio-level analysis

The finished product should answer:

- what changed
- where the data came from
- what is missing
- what is trustworthy enough to drive action

## P1 Closure Priorities

- normalize channel identity across all import paths, especially Meta
- implement or remove scheduler paths that appear in UI but not in the API surface
- preserve partial-import failure semantics visibly
- add one validated local happy path across connection, import, reporting, and recurring sync

## P2 Autonomy Contract

Before autonomy can recommend pacing, budget, or creative actions, MultiChannel BI must provide:

- stable normalized dimensions and metrics
- explicit freshness and completeness state
- action-safe attribution confidence for optimization use cases
- shared job/audit semantics for imports and refreshes
- no hidden drift between ingestion paths and reporting expectations

## Success Metrics

- import success rate by channel
- normalized-data consistency across sync paths
- report freshness
- operator trust in reported performance as a basis for action
- percentage of imports needing manual cleanup

