# Vision: SiteForge

Last Updated: March 17, 2026
Document Type: Vision grounded in current implementation

## Mission

SiteForge generates, edits, validates, deploys, and rolls back property websites with strong operator trust and future autonomy controls.

## Role In The Platform

SiteForge is the website execution layer of the agency. It translates brand, property context, and operator intent into a living site that can eventually support supervised and bounded autonomous improvement. The brand input it consumes may come from a net-new BrandForge-generated system or from an existing client brand that was digested through website scraping and knowledge-base uploads.

## Current Implementation Baseline

Materially implemented today:

- generation, analyze, status, preview, edit, deploy, rollback, list, and delete routes in `app/api/siteforge/*`
- WordPress and Cloudways deployment client in `utils/siteforge/wordpress-client.ts`
- operator preview and diagnostics UI in `components/siteforge/*`
- local smoke coverage for simulated generate/deploy/rollback flow

Current reality:

- SiteForge is one of the deepest implemented products in the repo
- deployment and rollback are materially real
- the product still needs closure around deploy-source trust and real-target validation

## End-State Vision

SiteForge should function like a governed website operating system:

- the site blueprint is editable, versioned, and deployable
- preview shows the same truth that deploy will use
- deploys are validated before and after publish
- every deployment is reversible
- operators can understand failures without reading logs

Longer term, SiteForge should support bounded website optimization loops, but only once the deploy surface is fully trustworthy.

## P1 Closure Priorities

- guarantee that edited blueprint state is the exact deploy source of truth
- complete at least one real WordPress deploy and rollback validation path
- reduce placeholder preview surfaces on critical content blocks
- strengthen degraded behavior when upstream brand context is weak or provider calls fail

## P2 Autonomy Contract

Before autonomy can recommend or supervise website changes, SiteForge must provide:

- explicit versioned deployable artifacts
- auditable deploy, rollback, and verification records
- policy boundaries around publish and irreversible changes
- human approval and rollback metadata for high-risk changes
- reviewer support for approve, deny, and modify decisions with preserved textual reasoning about why a proposed site change should be promoted, blocked, or altered
- consistent preview-to-deploy truth with no hidden transformation gap

## Success Metrics

- generate-to-preview completion rate
- deploy success rate
- rollback success rate
- operator time to diagnose failed deploys
- percentage of site changes that can be traced to explicit version history

