# Recovered original plan

Source: saved conversation, 2026-09-05T01:58:36.754Z; message line 256. Historical plan; later decisions are recorded separately.

**I’d make SiteForge the main development priority through Phases 1–3.** Other products should receive only fixes needed to protect current clients or support SiteForge until that milestone is complete.

This plan covers the findings from our review. Production configuration and actual provider behavior still need verification; repository documentation alone will not count as completion evidence.

:::writing{variant="document" id="59317"}
# Real Estate Autonomous Agency — Phased Completion Plan

**Objective:** Finish SiteForge as a dependable autonomous web team, strengthen existing chatbot and GEO services, then connect the products into an agency that executes and evaluates work with minimal operator intervention.

**Working rule:** Build on the existing implementation. Prioritize complete, demonstrated workflows over additional features or a platform rewrite.

## Phase 0 — Contain immediate exposure

Keep this phase narrow so it does not become a lengthy detour from SiteForge.

- Verify whether public account registration is enabled. Align account creation with the single-operator model.
- Protect profile `role` and `org_id` from direct user updates. Test the actual database permissions, including the effect of broad grants.
- Make Python authentication reject requests when required credentials are missing. Apply consistent behavior across routers.
- Complete scraping protections for resolved addresses and redirects.
- Add shared rate limits and spending safeguards to exposed, paid-provider endpoints serving current clients.
- Clearly identify or remove simulated Pipelines activity until real execution records are connected.

**Completion evidence:** Attempts to change access privileges, call protected services without credentials, or fetch internal destinations are rejected. Existing client services continue functioning.

## Phase 1 — Give SiteForge one consistent operating model

Resolve the overlap between the current implementation, older approval flows, and the solo-operator vision.

- Establish one current product contract across the roadmap, runbooks, interface, and tests.
- Simplify the journey to: **brief → autonomous preparation and build → finished WordPress preview → targeted revisions → one owner Launch action.**
- Ask for business intent, references, verified facts, assets, and constraints. Infer routine page structure and implementation choices.
- Consolidate obsolete review and approval requirements. Keep machine decision records behind the interface.
- Make generated brands and supplied brands produce the same versioned brand contract.
- Verify rental and for-sale workflows use their appropriate terminology, inventory, and conversion actions.

**Preserve throughout:** Automatic scoped edits, advisory creative scores, graceful image placeholders, informational freshness indicators, factual grounding, brand identity, and verified rollback. Do not introduce additional approval ceremony.

**Completion evidence:** Both property lanes can complete the intended journey without contradictory instructions, intermediate technical decisions, or a second reviewer.

## Phase 2 — Prove SiteForge’s complete delivery cycle

Establish dependable delivery before expanding creative capabilities.

- Verify the runtime versions, feature settings, WordPress targets, credentials, and deployment packages used by the normal product path.
- Exercise real generation, editing, and canonical WordPress preview on disposable test properties.
- Prove that preview, staging, production, and rollback refer to the correct website revisions.
- Verify forms, inventory displays, navigation, mobile behavior, and configured integrations after deployment.
- Exercise backup, promotion, production health checks, and restoration.
- Test provider timeouts, duplicate requests, interrupted workflows, unavailable previews, and partial deployment failures.
- Make jobs resume or recover predictably. Show an actionable explanation when owner input is genuinely required.
- Distinguish saved, rendered, verified, staged, and live states accurately.

**Completion evidence:** A recorded real-provider cycle completes from brief through launch and verified restoration, followed by a successful repeat. No manual database repair or fabricated provider-success records.

## Phase 3 — Finish SiteForge’s creative and editing quality

Use the working delivery path to establish whether SiteForge meets the intended agency standard.

**Creative work**

- Establish three contrasting benchmark briefs: an urban rental community, a suburban rental community, and a for-sale development.
- Evaluate both supplied-brand and generated-brand inputs.
- Assess where the three default composition profiles produce repetitive results.
- Improve composition, storytelling, typography, imagery, mobile layouts, and distinctive interactions using the existing component and extension systems.
- Keep fact and brand constraints intact while allowing meaningful creative variation.

**Evaluation and editing**

- Separate structural checks from judgments about rendered visual quality.
- Compare actual desktop and mobile WordPress renders with the intended references.
- Use screenshot-based critique and bounded corrections to address visible defects.
- Exercise realistic revisions: changing a hero, simplifying navigation, adjusting spacing, replacing imagery, rearranging content, and correcting inventory.
- Verify that edits change the requested area and preserve unrelated content.
- Keep incomplete visual verification visible rather than implying the edit has been confirmed.

**SiteForge completion gate**

- All three benchmark sites complete the real delivery cycle and demonstrate distinct designs.
- At least 20 representative edits preserve unrelated content and accurately report verification status.
- Each benchmark has a demonstrated rollback.
- Forms and conversion paths work in both property lanes.
- Common failure scenarios recover without developer intervention.
- Operator time, generation cost, edit cost, and unresolved issues are recorded.
- You judge the rendered sites suitable for the service you intend to sell. Creative scoring remains advisory.

**SiteForge is the top priority until this gate passes.**

## Phase 4 — Harden the chatbot and GEO services already serving clients

**LumaLeasing, leads, and CRM**

- Verify chat → lead capture → booking → calendar → email → CRM handoff with real integrations.
- Test duplicate requests, webhook retries, rescheduling, cancellation, expired credentials, and provider outages.
- Verify the external schedules for Gmail sync, calendar ingestion, reconciliation, and watch renewal.
- Monitor missed executions and expose failed handoffs in one operator view.
- Improve knowledge refresh and factual answer checks, with clear handling of conflicting information.

**PropertyAudit / GEO**

- Make long-running audits resumable with durable dispatch, checkpoints, and bounded retries.
- Preserve completed results through interruptions.
- Make reports consistently distinguish complete, partial, failed, and missing results.
- Record query sets, models, methods, dates, and evidence so comparisons remain interpretable.
- Verify recommendation and export consistency.
- Treat later visibility changes as observations; establish stronger evidence before attributing improvements to a particular action.

**Completion evidence:** Both services complete repeatable provider-backed workflows, recover from representative failures, and give you clear visibility into unresolved client-impacting issues.

## Phase 5 — Consolidate platform reliability and remaining products

Extend the patterns proven in SiteForge and current client services.

- Connect the Pipelines dashboard to actual job records and execution endpoints.
- Maintain one authoritative inventory of schedules, integrations, credentials, and expected maintenance tasks.
- Standardize job claiming, retries, cancellation, recovery, and terminal failure handling.
- Expand automated checks to Python-only and WordPress-plugin-only changes.
- Add meaningful database authorization tests and browser smoke coverage. Ensure check scripts propagate real failures.
- Make dependencies and runtime versions reproducible; reconcile outdated setup documentation.
- Validate backups, restoration, monitoring, and release procedures for the services in use.
- Break apart oversized files when modifying those workflows, keeping behavior stable.

Complete the remaining product contracts where they support agency operation:

- **BrandForge:** reliable export, knowledge embedding, and downstream brand consumption.
- **BI / MarketVision:** consistent channel identities, accurate imports, provenance, and visible partial data.
- **ReviewFlow / ForgeStudio:** dependable approved publishing, duplicate suppression, provider recovery, and outcome capture.

**Completion evidence:** Operational screens reflect real state, failures have consistent recovery paths, and supported products pass their documented delivery scenarios.

## Phase 6 — Prove agency-wide autonomy

Connect reliable products into complete service cycles.

- Reuse the existing shared jobs, action records, policy decisions, execution budgets, context snapshots, and outcome records.
- Give each cycle an objective, trigger, permitted actions, limits, verification steps, recovery behavior, and measurable outcome.
- Define when the system proceeds automatically and when it needs missing information or an owner decision.
- Preserve SiteForge’s single owner Launch action for new production releases.
- Start with two connected cycles:
  - **GEO:** recurring measurement → supported opportunity → website/content work → permitted execution → verification → later measurement.
  - **Leasing knowledge:** recurring unanswered questions → verified knowledge correction → answer validation → measurement of subsequent conversations.
- Expand into follow-up optimization, reputation responses, and content experiments after these cycles demonstrate dependable execution.

**Completion evidence:** At least two product-spanning cycles run repeatedly, record every action, recover from expected failures, and produce measurable results with reduced operator involvement.

## Phase 7 — Scale the agency

- Add properties only as demonstrated workload and recovery capacity allow.
- Expand automatic action permissions using observed performance.
- Introduce portfolio-level optimization after individual property cycles are reliable.
- Maintain regression evaluations when models, prompts, integrations, or policies change.
- Track client separation and spending limits as automated activity increases.

**Primary scorecard**

| Measure | What it establishes |
|---|---|
| Verified completion without intervention | How much agency work the platform actually handles |
| Operator minutes per property | Whether workload falls as capability grows |
| Automatic recovery rate | Whether failures still depend on you |
| Cost per successful outcome | Whether repeated delivery is sustainable |
| Client-impacting errors | Whether increased autonomy preserves service quality |
| Actions linked to later outcomes | Whether the agency can evaluate its decisions |

Advance phases using demonstrated results. Keep implementation status, local test results, real-provider evidence, and business outcomes separately visible.
:::
