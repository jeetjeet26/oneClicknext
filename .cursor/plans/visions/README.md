# Product Visions

Last Updated: March 17, 2026

## Purpose

This folder is the current vision library for the P11 platform.

These documents are meant to do three things at once:

- preserve the long-horizon product vision
- anchor that vision to the current implementation reality
- define what each product must become before it can safely participate in the `P2` autonomy layer

They are not intended to be simple status docs, and they are not meant to replace detailed runbooks or route-level technical references.

## Portfolio Context

The platform goal is not to ship disconnected AI features. The goal is to build a trustworthy autonomous agency for multifamily real estate in stages:

1. `P0`: stable, local-first foundation with health checks, tracing, tenant-safe auth, tests, and reproducible operator workflows
2. `P1`: materially complete products that humans can trust for repeated local/operator use
3. `P2`: a shared autonomy substrate with jobs, action ledger, approvals, policy evaluation, confidence, rollback, and preserved human decision rationale
4. `P3`: constrained autonomy that starts in recommendation mode, graduates to supervised mode, and only later allows bounded auto-action

The governing rule for every product remains:

No autonomous write path should advance until the underlying product surface is stable, observable, test-gated, reversible, and locally reproducible.

Supervised autonomy also means real human agency: reviewers must be able to approve, deny, or modify proposed actions and leave textual reasoning that is preserved as first-class decision history.

## Portfolio Thesis

This portfolio should be understood as one system with three layers:

- truth products: setup, knowledge, brand, and business context
- execution products: leasing, websites, content, reviews, CRM sync, and reporting
- intelligence products: scoring, audits, market awareness, and performance analysis

What makes the platform strategically interesting is not any single feature. It is the ability to connect:

- what is true about a property
- what work is proposed
- what work was approved, denied, or modified by humans
- what work actually executed
- what happened later in the business

That is the basis for future autonomy. If any of those links are weak, the platform may still be useful, but it is not yet an autonomy substrate.

## Current Portfolio Read

Read the current vision set with the following bias-resistant interpretation:

- the platform is materially real and unusually advanced for its age
- several products already have meaningful operator value
- the portfolio is still closing a few highest-risk provider-backed and trust-critical paths
- the shared autonomy substrate is still the main missing layer
- cross-product orchestration remains downstream of substrate maturity, not parallel to it

## How To Read These Docs

Each vision doc is structured around the same lens:

- `Mission`: why the product exists
- `Role In The Platform`: how it fits the broader agency system
- `Current Implementation Baseline`: what is materially present now
- `End-State Vision`: what the finished product should feel like
- `P1 Closure Priorities`: what must still be hardened or completed
- `P2 Autonomy Contract`: what the product must expose before autonomy can safely act through it
- `Success Metrics`: the outcomes that matter

Across the vision set, `approval` should be read narrowly and explicitly:

- not just a binary yes/no toggle
- support for `approve`, `deny`, and `modify`
- preserved reviewer identity and timestamps
- preserved free-text rationale that future policy, training, and audit flows can reference

Across the vision set, "autonomy-ready" should also be read narrowly and explicitly:

- not "the product has AI"
- not "the product can draft or recommend"
- not "the route tests are green"
- it means the product can participate safely in shared jobs, policy evaluation, action logging, approval workflows, and delayed-outcome measurement

## Non-Goals For Interpreting These Docs

Do not read these documents as support for:

- launching a portfolio-level CEO Agent before the shared substrate exists
- building a separate ML-only control plane outside the shared substrate
- claiming closed-loop optimization where delayed outcome capture is still weak
- treating breadth or model sophistication as evidence that the platform is already autonomy-ready

These docs intentionally distinguish between:

- vision and desired behavior
- current implementation baseline
- closure requirements for autonomy-readiness

## Vision Set

- `COMMUNITY_SETUP.md`
- `KNOWLEDGE_BASE.md`
- `CRM_SYNC.md`
- `TOURSPARK.md`
- `LEADPULSE.md`
- `LUMALEASING.md`
- `BRANDFORGE.md`
- `SITEFORGE.md`
- `REVIEWFLOW.md`
- `FORGESTUDIO.md`
- `PROPERTYAUDIT.md`
- `MARKETVISION.md`
- `MULTICHANNEL_BI.md`

## Source Inputs

These vision docs were synthesized from:

- `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
- `outdateddocs/P0_LOCAL_CONTINUATION_CONTEXT.md`
- `outdateddocs/product-specs/*`
- the current implementation in `p11-platform/apps/web`
- the current implementation in `p11-platform/services/data-engine`
- the repo-wide audit captured in `.cursor/plans/AUTONOMY_FOUNDATION_CODEBASE_GAP_REPORT_2026-03-16.md`

## Companion Documents

- Roadmap and phase gates: `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
- Local-first boundary: `outdateddocs/P0_LOCAL_CONTINUATION_CONTEXT.md`
- Gap analysis and closure risks: `.cursor/plans/AUTONOMY_FOUNDATION_CODEBASE_GAP_REPORT_2026-03-16.md`

