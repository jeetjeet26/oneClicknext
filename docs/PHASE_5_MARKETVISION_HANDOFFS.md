# Phase 5 — MarketVision saved draft handoffs

September 22, 2026. Qualified locally; Phase 5 and production/client acceptance remain open.

A considered pricing comparison can now produce an exact saved ForgeStudio draft intent. The operator chooses a title, objective, channel and format and records a reason. A current manager reviews the retained draft and approves its creation; the requester can withdraw it, and managers can reject it. Source-coverage repair prompts cannot become marketing drafts.

## Saved decision and evidence

Private `marketvision_handoffs` retains the exact report/recommendation/review identity, input, source/report/draft hashes, shared context, attempt, target identity and immutable final receipt. Preparing the handoff creates no downstream draft. The source facts come from the saved report on the server; clients cannot supply recommendation evidence or execution payloads. The comparison is advisory for topic, timing and format. It is not an approved advertising claim, rent instruction, forecast, confidence estimate or reward.

Approval rechecks current property/organization access, manager role, original requester access, the latest recommendation review and the complete source fingerprint. Stale or unavailable evidence requires a new reviewed brief and handoff. The dedicated transaction creates the draft through the qualified ForgeStudio command, then stores approval, policy, job, attempt, receipt and both products’ confirmed action events. A receipt failure rolls back everything. Stable request and target identities make lost-response retries nonduplicating; a second preparation identity cannot duplicate an active handoff for the same review. Rejection and withdrawal never create drafts.

The original draft, decision reasons and older handoffs survive reloads. Cursor pagination reaches all saved handoffs, and failed reads remain visible. The ForgeStudio destination opens the exact saved draft with property and organization scope, independently of its recent-drafts list. A separate explicit generation request uses that saved draft; creation does not start generation, delivery or publication.

## Closed bypasses

The legacy proposal POST now returns authenticated/property-scoped 410. Existing proposals remain historical records. Legacy MarketVision generic dispatcher execution is removed; generic approval/replay cannot execute these handoffs. Database guards also prevent generic job/attempt/approval changes from bypassing the dedicated decision transaction. Normal ForgeStudio publishing dispatch is preserved.

## Local evidence

- 415 service/API checks across 50 suites; 41 new handoff SQL assertions.
- 242 MarketVision, 29 shared action-history and 38 ForgeStudio editorial rollback assertions: 309 total, run serially.
- Three browser journeys passed: lost preparation/approval replies and exact destination/reload; changed reviews/sources with rejection/withdrawal; failed reads and 22-row history pagination. The exact destination journey passed again after organization-boundary refinement.
- Application types, touched-file lint and schema stamp pass. All 297 checked SQL function bodies match saved migrations. No fixture/orphan residue; tested local migrations remain absent from migration history because they were applied as local validation transactions, not presented as hosted deployment.
- Supabase WARN/ERROR findings remain at the existing 1,333 baseline with no additions. Mobile draft layout was inspected.

Migration `20260922195546_phase_five_marketvision_handoffs.sql` is local only. No provider/model call, hosted mutation, training, real delivery, commit, push or deployment occurred. The normal preview keeps delivery paused and has no encryption key. The dedicated ReviewFlow response SQL suite remains excluded pending its earlier approval; these checks do not replace it.

## Remaining Phase 5 work

MarketVision runtime monitoring, discovery/intake and broader provider paths still need qualification; legacy unqualified automatic writes remain paused. Cross-product BrandForge/SiteForge recommendations are not offered as executable handoffs. Complete meaningful operator/system interaction coverage and live client/provider acceptance remain open across the product register. Agency permissions, budgets, interventions and measured outcome evaluation follow those gates. Existing models remain the default; training stays off until an evaluated need and approved dataset exist.
