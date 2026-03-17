# Vision: Knowledge Base

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

The Knowledge Base is the agency memory layer for each property. It stores the durable truth that AI products use to answer questions, generate assets, reason about brand, and support operator workflows. It is also the primary ingestion path for existing client brand material when a property is not starting from a net-new BrandForge-generated brand.

## Role In The Platform

The Knowledge Base is not a side feature. It is a cross-product dependency for:

- `LumaLeasing`
- `BrandForge`
- `SiteForge`
- operator setup and refresh workflows
- future autonomy decisions that need current property context

If this layer is stale, duplicated, or weakly managed, every downstream AI behavior becomes less trustworthy.

## Current Implementation Baseline

Materially implemented today:

- upload, paste-text, and ingest routes in `app/api/documents/*`
- website scrape ingestion via `app/api/onboarding/scrape-website/route.ts` and `app/api/community/scrape-website/route.ts`
- retrieval usage in `app/api/chat/route.ts`
- `documents` and `knowledge_sources` tables with embeddings-backed retrieval

Current reality:

- ingestion exists and retrieval is real
- uploads and website sources do not yet behave as one unified managed-source system
- refresh semantics are not yet robust enough for high-trust autonomous use

## End-State Vision

The Knowledge Base should behave like a managed, property-scoped memory system:

- every source is first-class and inspectable
- every source has freshness, sync history, failure state, and provenance
- refresh is idempotent or versioned, not additive corruption
- the operator can see what knowledge is trusted, stale, duplicated, or failed
- every downstream product can cite what source informed a decision or artifact

The finished product should support:

- website source sets with preserved page scope
- uploaded documents with file provenance and source lifecycle
- pasted/internal text as managed structured sources
- brand-source ingestion that allows existing client websites, guidelines, and uploaded brand documents to become structured platform truth
- source-level refresh, replace, archive, and rollback behavior

## P1 Closure Priorities

- make uploads create first-class `knowledge_sources`, not just document chunks
- close property-safe auth gaps in document management
- preserve exact source provenance for multi-URL website ingests
- support explicit brand-source classification so existing brand materials can be separated from generic property knowledge and consumed cleanly by BrandForge and downstream products
- prevent failed refresh from corrupting or duplicating prior knowledge state
- add one deterministic happy path covering scrape, paste-text, upload, refresh, and retrieval

## P2 Autonomy Contract

Before autonomy can depend on this system, the Knowledge Base must provide:

- source-level trust metadata
- refresh-safe and retry-safe ingestion behavior
- source provenance that can be cited in decisions
- explicit support for brand-origin provenance so autonomy can tell whether brand truth came from client-provided material, generated material, or both
- explicit stale/fresh/failed state
- property-safe boundaries that prevent cross-tenant leakage

Autonomous systems should never act on opaque chunks alone. They should act on managed knowledge sources with state, provenance, and operator visibility.

## Success Metrics

- percentage of knowledge sources with explicit freshness state
- percentage of refreshes that complete without duplicate or orphaned content
- retrieval quality for chat, brand, and site generation tasks
- operator time to diagnose a bad or stale source

