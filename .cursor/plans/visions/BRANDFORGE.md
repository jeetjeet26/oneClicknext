# Vision: BrandForge

Last Updated: August 17, 2026
Document Type: Vision grounded in current implementation

## Mission

BrandForge establishes the strategic brand system for a property: positioning, audience, visual identity, messaging principles, and reusable brand artifacts that other products can consume. It serves multifamily rental and for-sale real estate as two equal lanes. It must support creating a net-new brand and digesting a supplied brand, with both paths converging on one immutable brand contract.

## Role In The Platform

BrandForge should be the platform layer that normalizes brand truth for:

- SiteForge
- ForgeStudio
- Knowledge Base enrichment
- future creative and messaging autonomy loops

That brand truth may originate in two ways:

- BrandForge generates a new brand system for the property
- BrandForge ingests and structures a supplied brand from identity files, website scraping, documents, assets, and knowledge-base uploads

Origin does not change the downstream interface. Both paths produce the same normalized, versioned brand contract so SiteForge and every other consumer operate from one source of truth.

## Immutable Brand Contract

The brand contract is the handoff boundary between brand formation and autonomous execution. It must:

- identify the property lane as multifamily rental or for-sale without treating either as secondary
- preserve provenance for generated decisions and supplied source material
- define canonical name, marks, typography, palette, voice, positioning, audience, visual principles, required usage, and prohibited mutations
- distinguish verified source truth from generated strategic interpretation
- carry a content hash and version identity that downstream artifacts bind to exactly
- remain immutable for a SiteForge run; a brand change creates a new contract version and a new run boundary rather than mutating identity underneath generated work
- fail closed when identity-critical sources conflict or required truth is missing

BrandForge may fill strategic whitespace when commissioned to generate a brand, but it must never fabricate supplied logos, legal names, property facts, claims, inventory, pricing, or other externally verifiable truth.

## Autonomous Commissioning Model

BrandForge is not a low-level questionnaire or an approval workflow. It collects an owner brief: business intent, audience, references, supplied assets, source truth, and non-negotiables. The AI owns synthesis and commissions the strategy, voice, identity system, and downstream creative requirements at the level expected from a premium agency team.

The owner may inspect the resulting brand truth and correct factual or source errors, but normal production does not require external client review, section-by-section approvals, internal creative committee sign-off, or preserved rationale before SiteForge can consume the contract. Deterministic internal policy resolves schema validity, provenance, accessibility constraints, lane rules, identity consistency, and prohibited content.

The quality target is a brand foundation capable of supporting a bespoke **$50,000-$100,000 agency website**. Generic templates, interchangeable positioning, and ungrounded visual direction do not satisfy the contract.

## Current Implementation Baseline

Materially implemented today:

- generation, section review, edit, approval, status, export, and embed routes in `app/api/brandforge/*`
- UI components under `components/brandforge/*`
- progress and warning visibility in `app/api/brandforge/status/route.ts`

Current reality:

- the guided generation flow is real
- the broader product vision should include both generated and ingested brand truth, even if the ingestion path is still more implicit than first-class in the current implementation
- the product has meaningful operator value today
- export and embed semantics still need closure before this can serve as a trusted platform asset

## End-State Vision

BrandForge should deliver a brand operating system, not just a generated document:

- structured brand truth that downstream products can read programmatically
- one immutable downstream contract regardless of whether the brand was generated or supplied
- first-class support for multifamily rental and for-sale lanes
- owner-visible output with version history and factual correction paths
- exportable artifacts for human use
- knowledge-base-ready content for cross-product retrieval
- a brand system that evolves by explicit new versions without mutating prior identity

The finished product should let a property reach a usable strategic system through either path:

- generate a new brand when the client needs one
- absorb, structure, and operationalize an existing brand when the client already has one

## P1 Closure Priorities

- unify export behavior with the actual promised artifact format
- align knowledge-base embedding logic with the real generated section schema
- add a true local happy path for `analyze -> generate/edit -> export/embed`
- improve long-running progress visibility during section generation
- make degraded asset/provider fallback states explicit and recoverable

## P2 Autonomy Contract

Before autonomy can act from BrandForge outputs, the product must provide:

- machine-readable brand truth with stable semantics
- auditable version history
- immutable contract identity and exact downstream bindings
- clear distinction between draft, contract, exported, and embedded state
- citation/provenance linking brand decisions back to source context where possible
- deterministic policy and confidence boundaries for generated content and contract creation
- fail-closed handling for missing or conflicting identity truth
- no section-by-section approval ceremony or external client-review dependency

## Success Metrics

- time from onboarding to approved brand system
- percentage of downstream products consuming structured brand outputs
- operator approval rate per section without manual rewrite
- number of properties using BrandForge as the authoritative brand source

