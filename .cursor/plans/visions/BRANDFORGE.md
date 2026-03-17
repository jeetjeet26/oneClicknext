# Vision: BrandForge

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

BrandForge establishes the strategic brand system for a property: positioning, audience, visual direction, messaging principles, and reusable brand artifacts that other products can consume. It must support two primary use cases: creating a net-new brand when one does not exist, and digesting an existing client brand from website scraping, uploaded documents, and knowledge-base inputs so the platform can operate from that truth.

## Role In The Platform

BrandForge should be the platform layer that normalizes brand truth for:

- SiteForge
- ForgeStudio
- Knowledge Base enrichment
- future creative and messaging autonomy loops

That brand truth may originate in two ways:

- BrandForge generates a new brand system for the property
- BrandForge ingests and structures an existing client brand from website scraping and knowledge-base uploads

It is the layer that turns raw property and client brand context into a coherent brand operating system.

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
- operator-reviewable sections with version history
- exportable artifacts for human use
- knowledge-base-ready content for cross-product retrieval
- a living brand system that can evolve without losing auditability

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
- clear distinction between draft, approved, exported, and embedded state
- citation/provenance linking brand decisions back to source context where possible
- confidence and approval boundaries for regenerated or auto-applied brand changes

## Success Metrics

- time from onboarding to approved brand system
- percentage of downstream products consuming structured brand outputs
- operator approval rate per section without manual rewrite
- number of properties using BrandForge as the authoritative brand source

