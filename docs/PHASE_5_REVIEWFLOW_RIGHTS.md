# Phase 5 — exact testimonial permissions and checked reuse

September 18, 2026. Locally qualified. The complete Phase 5 product register remains open.

ReviewFlow now saves a manager’s permission against the exact review source version and full approved text, reviewer name, rating, platform and optional original date. Website and social permissions are chosen separately, with retained rights evidence, a reason and optional expiry. Approval and revocation commit with their shared action history. Stable request identities recover lost replies, changed sources and stale permission versions are rejected, and permissions/history cannot be rewritten or reactivated. Revocation works even when the current review is incomplete. Existing unversioned approvals remain recorded but require a fresh rights review before new reuse.

The drawer has current-source evidence, explicit eligibility, exact permission revocation, visible read failures, stable retry controls and paged historical consent. Reloading a changed source clears the attribution acknowledgement. History paging does not silently replace the source currently being approved. Unknown original review dates remain unknown. Source requirements are shown rather than inventing a name, rating or shortened text. A past expiry produces a readable validation error. The shared sentiment badge also now displays “Not classified” for missing classification instead of treating it as neutral.

New reuse requires current exact source evidence, active attribution permission, a matching website/social scope and a valid expiry. ForgeStudio context and its existing approval/schedule/send source checks use that eligibility. SiteForge generation selects eligible website permissions, and loading a saved release rechecks every managed testimonial’s text, attribution, rating, platform and date. A revoked, expired, changed, unqualified or unavailable permission stops that release. A permission ID alone cannot authorize edited content.

Permission changes do not claim to remove already published content, authorize a provider write, regenerate a campaign/site or grant rights beyond the manager’s recorded evidence. Prior public content still needs a separate reviewed removal/replacement decision. Destination-specific requirements remain applicable; the existing SiteForge template, for example, requires an original review date and supported content length. Client/provider acceptance and automatic owner reply publication remain unqualified release gates.

Evidence:

- 690 combined ReviewFlow/ForgeStudio/action and affected SiteForge service/API checks passed in 90 suites. Full web types, changed-file lint and schema stamp passed.
- 30 new rights database assertions and 706 established serial rollback assertions passed, including ForgeStudio source/scheduling protections. The separate dedicated response SQL suite remains unrun and excluded pending the earlier approval request.
- All 31 ReviewFlow browser journeys are verified. The complete run passed 29; an existing case test timed out during login, and the new sentiment assertion matched the identical list and drawer labels. Both passed targeted reruns after scoping the assertion. The three new permission journeys also passed their initial isolated run.
- Exact-source approval, separate scopes, lost saves/revocation, immutable consent, expired rights, source changes, incomplete-source revocation, full history paging, failed reads, property scope and forged website testimony are covered.
- 249 tracked local function bodies match the migrations. Fixture/orphan checks pass. The database retains the same 1,333 WARN/ERROR advisor findings without additions or removals. Mobile permission evidence was visually inspected.

Migration 20260919001404_phase_five_reviewflow_rights.sql is applied only to local Supabase, with local types regenerated and no migration-history mutation. No deployment, external provider/model invocation, message, training or export occurred. Delivery and workflow delivery remain paused and the marketing import worker remains disabled. Evidence is retained in work/reviewflow-rights.

Continue the remaining product register, next MarketVision’s atomic competitor/unit/configuration decisions and complete input-to-outcome journeys. ReviewFlow’s dedicated response SQL qualification, real owner-provider qualification and comprehensive interaction/system capture remain explicit gates. Phase 5 is not complete.
