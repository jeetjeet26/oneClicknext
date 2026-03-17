# Vision: Community Setup

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

Community Setup is the canonical operator workflow for creating a property, attaching its baseline context, and establishing the shared truth that every downstream product depends on. That includes supporting two valid brand starting points: a client who needs a new brand system, and a client who already has a brand that should be absorbed through website scraping and knowledge-base uploads.

## Role In The Platform

This is the substrate product behind the rest of the portfolio. If Community Setup is weak, then BrandForge, SiteForge, LumaLeasing, MarketVision, BI, and PropertyAudit all inherit bad inputs, duplicate state, or missing integration context.

## Current Implementation Baseline

Materially implemented today:

- multi-step add-property and onboarding flows under `app/dashboard/properties/new/*` and `app/onboarding/*`
- property, contacts, integrations, and setup APIs under `app/api/properties/*`, `app/api/onboarding/*`, and `app/api/community/*`
- shared property profile surface at `app/api/community/profile/route.ts`
- setup UI in `app/dashboard/community/page.tsx`

Current reality:

- the product exists, but it is not yet the single dependable source of truth for property setup
- the flow still mixes legacy and current data patterns
- setup completion does not yet guarantee that downstream products have trustworthy, fully wired inputs

## End-State Vision

Community Setup should feel like a guided operating-system install for a new property:

- one canonical property record is created once
- operator-provided context, scraped context, uploaded documents, units, contacts, and integration readiness attach to that same property identity
- each setup step has explicit completion criteria and explicit degraded states
- downstream products can safely assume the setup substrate is truthful, current, and auditable

The finished product should answer these questions deterministically:

- Does this property have enough context for AI products to operate?
- Is this property starting from an existing client brand, a net-new brand effort, or a hybrid of both?
- Which integrations are truly connected versus merely noted?
- Which sources are current, stale, failed, or awaiting refresh?
- What downstream products are blocked because setup is incomplete?

## P1 Closure Priorities

- unify property creation so the setup flow cannot fork into duplicate properties
- remove truth drift between `properties` and `community_profiles`
- make uploaded documents and website sources attach during setup, not just as client-side intent
- make brand intake explicit so setup can distinguish between ingesting an existing client brand and initiating a new BrandForge-created brand system
- turn integration setup from manual status bookkeeping into verified connection readiness
- add at least one deterministic local happy path for full property setup

## P2 Autonomy Contract

Before autonomy can trust this product, Community Setup must provide:

- a single canonical property identity
- machine-readable setup completeness by domain: profile, knowledge, integrations, pricing, brand, site
- explicit brand-origin state so downstream systems know whether brand truth was generated, ingested, or blended
- durable audit trail for setup mutations
- explicit blockers and degraded states
- no silent partial success on critical setup operations

Autonomy should never infer readiness from scattered tables or UI assumptions. It should read a dependable setup truth model.

## Success Metrics

- percentage of new properties created with no duplicate property records
- percentage of downstream products that can start with no manual repair after setup
- time from property creation to first trustworthy product use
- percentage of setup integrations that are verified rather than manually marked

