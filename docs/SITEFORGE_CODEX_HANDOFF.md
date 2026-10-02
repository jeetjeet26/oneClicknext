# SiteForge: Codex workflow and console handoff

Current continuation: [all identified local Phase 3 work is implemented and verified](SITEFORGE_PHASE_3_COMPLETION.md). The owner explicitly directed work to advance to [Phase 4](PHASE_4_CHATBOT_GEO.md) on September 15 and said real-client acceptance can wait. Actual client ownership, accepted revisions, recipient receipt and normal operation remain in the SiteForge acceptance ledger. Continue independent Phase 4 work; no live release or external send is authorized by these local trials. Earlier increments below are dated evidence.

September 12, 2026. Local implementation in the existing oneClick checkout.

## Recovered direction

The owner explicitly changed SiteForge on September 8 after building Alder & Tide directly in Codex. The personal skill lives outside oneClick at `/Users/jasjitgill/.agents/skills/siteforge/`. Each client retains its own project, source, assets, facts and editing workflow. The current agent performs design and implementation. The owner rejected moving the shared skill into a oneClick kit and did not ask for another generator or agent runtime.

Context reviewed: “Analyze project insights” (including its saved September 8–12 messages omitted by the app's task reader), “Create real estate website,” “Find Persimmon site chat,” and “Build accessible WordPress site.” The September 11 implementation handoff and the Persimmon/Gable House editor audits informed the requirements. Only user and assistant conversation messages were used for historical decisions; credentials were not copied into repository documents.

The [current full implementation plan](P11_IMPLEMENTATION_PLAN.md) preserves all nine phases, the original detailed plans, the September 11 progress and the September 12 amendment. New website work follows the Codex direction. Existing application-managed SiteForge clients retain their current routes until their dependencies and migration needs are reviewed.

## Implemented

- `/dashboard/siteforge` prepares a portable brief with the selected property, requested work, source notes and delivery target. The owner can preview, copy or download the exact Markdown brief and use it in the client project.
- The brief includes WordPress editing expectations learned from actual delivery: populated controls, visible gallery images and related collections, shared content, working private previews and revision recovery. It also preserves design fidelity, scoped changes, accessibility review, factual sources, dated inventory, inquiry context and the owner's publishing authorization.
- The form is an ephemeral handoff and says so. It does not create a Codex task, start generation, save a shared client database, sync sites or grant publishing permission. No fixed model, local user path, credentials or private account configuration is inserted into generated briefs.
- The earlier project list was extracted without changing its list API or detail routes. It identifies earlier console records, cancels obsolete requests, reports failed loads distinctly from an empty list, and supports refresh. Existing records remain accessible.
- The new entry no longer posts to `/api/siteforge/projects` or responds to an old `regeneratePropertyId` link by creating a generator project. The earlier automatic three-minute-generation promise was removed.
- SiteForge uses an explicit flag from PropertyContext to distinguish loaded records from its historical demo fallback. An empty or failed property load cannot generate a brief for a fictional default property. Other console consumers retain their previous behavior.
- The repository README files, old SiteForge vision, old implementation plan and always-applied model doctrine now identify the superseding Codex direction. The personal skill remains outside this repository.

## Verification

- Nine tests passed for brief serialization, exact property/request preservation, nested Markdown fences, target-specific instructions, missing facts, filename handling and loading/fallback rendering.
- Five dedicated Chromium scenarios passed against the authenticated local console: exact clipboard/download output with no generation mutation (including the old regenerate query); property switching and stale responses; error/retry behavior; clipboard-denial fallback; and no export from an empty property response.
- The existing SiteForge entry smoke was updated to the handoff flow. Other generator/provider lifecycle tests remain as coverage for retained application-managed websites.
- Full application TypeScript checking and targeted lint passed. React and installed Next.js guidance were applied; no new packages were installed.
- Native browser inspection confirmed the dark-theme page at desktop and 768-pixel tablet width, with no horizontal overflow in the SiteForge content at those sizes. The earlier seeded console project still opens its existing detail route. This is not a whole-console accessibility audit or a claim of phone-layout qualification.
- Browser tools and tests used the existing local test login. No hosted migration, provider reconnection, real inquiry submission, client content change, queue replay, push or deployment occurred. The existing Phase 0 files were not edited by this increment.

To rerun the dedicated browser checks with the existing local server:

```sh
cd p11-platform/apps/web
PLAYWRIGHT_BASE_URL=http://127.0.0.1:9430 ACACIA_READONLY_EXTERNAL_ONLY=1 \
  node node_modules/@playwright/test/cli.js test e2e/siteforge-codex.spec.ts --workers=1
```

The dedicated suite refuses to use its local test credentials at a non-loopback host. It uses browser-local fixtures for error/switch scenarios, rather than creating client records.

## Superseding Phase 1 work — September 14

The original brief handoff is extended with optional current-project, content-owner and inquiry-destination notes. The personal skill now includes an adaptable delivery record. Read `SITEFORGE_PHASE_1_CONTRACT.md` and `SITEFORGE_TARGET_REGISTER.md` for the current acceptance contract, latest client source versions and legacy-state reconciliation. Unknown client delivery details remain attached to their own connected-test step; they do not block independent local work.

The owner directed the plan to advance while Phase 0's live release is deferred. Continue with Phase 2 local delivery and maintenance trials. Preserve the client's actual editing framework, including Persimmon's later ACF 3.0.1 source and Gable House's native content plugin. No production target, live recipient, replay or publication is authorized by this handoff. The original production/recovery, three-brief/20-edit and platform completion gates remain.

Local preview while the dev server is running: http://127.0.0.1:9430/dashboard/siteforge
