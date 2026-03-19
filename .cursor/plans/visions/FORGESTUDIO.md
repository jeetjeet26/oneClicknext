# Vision: ForgeStudio

Last Updated: March 17, 2026
Document Type: Vision grounded in current implementation

## Mission

ForgeStudio is the content operating system for each property. It should generate reusable campaign assets and channel-ready drafts while preserving brand alignment, provider safety, and publish control.

## Role In The Platform

ForgeStudio is the campaign and creative execution surface that sits downstream of BrandForge and upstream of publishing channels. It is the product most likely to support future supervised content loops, but only after publish reliability is strong. The brand context it uses should come from the broader platform brand layer, whether that truth was generated inside BrandForge or ingested from existing client brand materials through scraping and knowledge-base uploads.

## Current Implementation Baseline

Materially implemented today:

- generation, drafts, templates, assets, social config, connect, callback, connections, and publish routes in `app/api/forgestudio/*`
- scheduled publish in `app/api/cron/publish-scheduled/route.ts`
- UI components under `components/forgestudio/*`

Current reality:

- content generation and social publishing surfaces are real
- scheduled publish exists
- publish leasing, draft readiness, and provider-failure semantics still need hardening

## End-State Vision

ForgeStudio should be the property-level content factory:

- operators can generate text, image, and video-backed drafts quickly
- every draft carries channel, asset, and readiness metadata
- publishing is controlled, scheduled, auditable, and retry-safe
- brand context is inherited from the broader platform rather than recreated manually each time, including both generated and client-ingested brand truth

The product should make it easy to go from campaign idea to approved, scheduled, and published content without hidden risk.

## P1 Closure Priorities

- make scheduled publishing claim-safe under overlapping cron execution
- distinguish draft success from partial generation success when requested media fails
- add at least one full local happy path for generate -> approve/schedule -> publish
- improve operator clarity around provider failures and retry state

## P2 Autonomy Contract

Before autonomy can recommend or execute content actions through ForgeStudio, the product must provide:

- durable publish action records
- policy checks for channels, cadence, and asset classes
- explicit draft readiness state
- retry-safe publish semantics with no duplicate posting
- approval and confidence support before autonomous scheduling or posting
- human reviewers who can approve, deny, or modify scheduling or publishing proposals with preserved free-text rationale

## Success Metrics

- draft generation success rate
- publish success rate
- duplicate publish rate
- operator time from idea to approved scheduled draft
- percentage of drafts that are fully ready on first pass

