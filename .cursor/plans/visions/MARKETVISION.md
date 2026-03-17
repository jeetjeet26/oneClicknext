# Vision: MarketVision

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

MarketVision gives each property a live picture of the surrounding competitive landscape: positioning, pricing, messaging, and shifts that should influence marketing and leasing strategy.

## Role In The Platform

MarketVision is the external-awareness system for the platform. It should complement internal property truth with competitor truth, giving BrandForge, SiteForge, ForgeStudio, and PropertyAudit richer context.

## Current Implementation Baseline

Materially implemented today:

- competitor, scrape, analysis, units, amenities, alerts, report, and brand-intelligence APIs in `app/api/marketvision/*`
- brand-intelligence jobs in the data-engine
- UI surfaces under `components/marketvision/*`

Current reality:

- the product has substantial breadth
- competitor discovery and intelligence are materially real
- reliability and consistency across import, job state, and downstream reporting still need closure

## End-State Vision

MarketVision should become a decision-grade competitor intelligence system that:

- maintains current competitor sets and source coverage
- tracks pricing, availability, messaging, and positioning signals
- shows changes over time, not just snapshots
- surfaces structured insights that downstream products can consume safely

The best version of the product tells operators not just what competitors are doing, but what that should change in our brand, site, content, and campaign strategy.

## P1 Closure Priorities

- add a fully validated local happy path for competitor ingest and insight generation
- harden partial-failure handling so imports cannot silently look successful
- unify state semantics across intelligence jobs
- increase test depth beyond auth and thin route coverage

## P2 Autonomy Contract

Before autonomy can rely on MarketVision, the product must provide:

- trustworthy competitor data lineage
- recoverable partial-import semantics
- explicit confidence levels on extracted intelligence
- stable, queryable job and result states
- clear distinction between fresh insight, stale insight, and failed insight

## Success Metrics

- competitor coverage per property
- freshness of tracked pricing and positioning data
- operator usage of MarketVision insights in decision workflows
- percentage of competitor imports that complete without manual repair

