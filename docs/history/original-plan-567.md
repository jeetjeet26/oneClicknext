# Recovered original plan

Source: saved conversation, 2026-09-05T18:24:21.581Z; message line 567. Historical plan; later decisions are recorded separately.

**SiteForge remains the first product to finish. Every other product must be finished before agency-wide autonomy begins.** The Supabase audit adds an immediate repair phase because it confirmed exposed access paths and failures affecting shared services.

This is the consolidated plan, retaining the earlier scope and adding the live findings. Each phase has a completion gate; building the interface or recording a successful job is insufficient by itself.

**Phase 0: Close live exposure and repair critical shared dependencies.** Keep this focused so SiteForge remains the main development priority.

- Restrict the elevated SQL function and redesign the analytics feature’s database access around permitted queries and organization scope.
- Protect profile roles and organization membership from self-service changes. Keep ordinary profile preferences editable.
- Correct storage permissions, especially anonymous modification of brand assets and unrestricted authenticated access to documents.
- Align account creation with your current solo-operator model. Review the nine existing accounts and six administrator profiles to identify legitimate accounts and testing remnants.
- Review other exposed privileged functions and the three deployed legacy SiteForge Edge Functions. Secure necessary functions and retire obsolete ones after checking their callers.
- Make production backend authentication fail closed when required credentials are missing.
- Repair the shared email sender configuration, incident alerts, and internal authentication used by knowledge refresh. Resolve SMS configuration for workflows that are intended to send messages.
- Classify accumulated failed actions before enabling delivery. Prevent old test messages or obsolete follow-ups from being sent when configuration starts working.
- Fix success reporting so a job with zero successful deliveries cannot appear healthy without qualification.

**Complete when:** unauthorized access is denied, the operator retains required access, approved test messages and alerts reach their destinations, and historical failures cannot unexpectedly replay.

**Phase 1: Establish SiteForge’s exact completion contract and reconcile its current state.** This prevents further work from expanding in several directions at once.

Preserve the product direction already established:

- Serve rental and for-sale real estate with equal attention.
- Support both supplied brands and BrandForge-generated brands through a consistent brand contract.
- Generate from reliable property facts, with clearly identified placeholders where information is incomplete.
- Support conversational edits that change the requested scope predictably.
- Make the actual WordPress rendering the authoritative preview.
- Keep your final launch decision simple, with one clear Launch action and useful readiness information.

Then reconcile implementation and records:

- Identify the authoritative generation, editing, preview, deployment, and launch paths.
- Map websites and WordPress targets to their actual purpose: development, testbed, preview, staging, or client production.
- Separate Aurora’s demonstrated launch/restore history from qualification of the current runtime v3 journey.
- Reconcile abandoned jobs, old approval requirements, stale incidents, and conflicting website/release statuses.
- Establish one feature checklist covering generation, editing, assets, migration, domains, conversions, monitoring, and reporting. Existing tables or roadmap checkboxes do not establish completion.

**Complete when:** each promised capability has a defined owner-facing flow, an authoritative implementation path, and an observable acceptance test. Scope changes must be explicit.

**Phase 2: Finish SiteForge’s complete delivery lifecycle.** Build on the existing deployment and restore work.

- Finish the path from property setup and brief through generation, WordPress preview, editing, staging, launch, and production verification.
- Qualify that entire journey using the currently supported runtime, including runtime v3 where intended.
- Preserve exact artifact identity across content, assets, theme packages, runtime packages, approvals, previews, and deployments.
- Make generation and deployment survive interruption through durable progress, bounded retries, cancellation, and recovery.
- Investigate the repeated certification heartbeat failures. Fix the execution problem and reconcile the resulting jobs and incidents.
- Complete domain, DNS, HTTPS, redirects, sitemap, and indexing behavior for each environment.
- Fix the missing conversion destination. Prove that a submission reaches the correct lead, CRM, engagement, and follow-up paths exactly once.
- Resolve the engagement upsert/index mismatch. Reconcile the older failed workflow events whose missing-column cause has already been repaired.
- Make rollback restore both the remote website and the platform’s recorded state consistently.
- Verify backups and restoration for the current deployment path.

**Complete when:** a rental example and a for-sale example can each complete the current lifecycle, including a controlled interruption, retry, launch, rollback, and verified restore. Provider acknowledgements and saved records must agree.

**Phase 3: Finish SiteForge’s creative quality, editing, and daily operation.** This is the final SiteForge completion phase.

- Evaluate at least three contrasting briefs across rental and for-sale use cases. Demonstrate meaningful differences in layout, typography, imagery, content hierarchy, and conversion approach.
- Review actual desktop, tablet, and mobile renderings. Use the existing quality scores as supporting signals.
- Complete at least 20 representative conversational edits: text, imagery, spacing, colors, section variants, ordering, navigation, forms, and page changes.
- Make immutable parent versions available for rendered comparisons.
- Fix missing renderer attributes and investigate reported changes outside the intended edit.
- Make an incomplete or unverified edit visibly distinguishable from a verified result.
- Finish the promised asset and existing-site import journeys, including appropriate image handling, redirect mapping, and migration checks.
- Correct monitoring assumptions: treat testbeds appropriately, exclude non-HTML feeds from page accessibility checks, and distinguish unavailable evidence from an actual failure.
- Make incidents actionable and deduplicated, with alerts that reach you and a clear recovery action.
- Complete required connector freshness checks, reporting, and maintenance controls.
- Measure generation time, edit time, provider cost, and the amount of operator intervention needed.

**Complete when:** you can deliver and maintain a client website through the normal interface without routine database intervention or undocumented repair steps. The agreed feature checklist is complete, conversions work, recovery is proven, and no critical delivery defect remains.

**Phase 4: Finish the products supporting your current chatbot and GEO services.**

For LumaLeasing and the associated lead journey:

- Verify widget installation, configuration, property isolation, grounded answers, and knowledge updates.
- Finish human takeover, lead capture, tour booking, calendar integration, CRM handoff, and intended follow-ups.
- Verify permission revocation, expired credentials, duplicate submissions, provider failures, and recovery.
- Apply effective public-endpoint rate limits and cost controls.
- Verify the actual scheduling of calendar/email maintenance and synchronization. Missing audit records alone should not be treated as proof that a scheduler is absent.

For PropertyAudit/GEO:

- Make long-running work resume safely after a worker restart.
- Add appropriate provider concurrency, rate-limit handling, bounded retries, and clear partial-result reporting.
- Preserve the distinction between measurement methods and provider capabilities.
- Ensure reports retain evidence linking recommendations to observations.
- Repair knowledge refresh and competitor-scraping failures.
- Harden website fetching against unsafe destinations and redirects.

**Complete when:** the services you sell can complete their normal client journeys, recover from common failures, and produce trustworthy reports without recurring manual rescue.

**Phase 5: Finish every remaining product and supporting workflow.** SiteForge and the products completed in Phase 4 retain their acceptance checks during this work.

| Product or area | Required completion |
|---|---|
| **BrandForge** | Complete generation and supplied-brand onboarding, reliable progress/recovery, editable outputs, usable exports, and the shared brand contract consumed by other products. |
| **TourSpark** | Complete booking, rescheduling, cancellation, reminders, calendar synchronization, no-show handling, and follow-up. Prevent duplicate bookings and messages. |
| **LeadPulse** | Make scoring reproducible, engagement events reliable, rescoring idempotent, and score explanations understandable. |
| **CRM Sync** | Complete supported provider mappings, validation, synchronization, duplicate prevention, retry handling, and visible reconciliation of failed records. |
| **ForgeStudio** | Complete brief → content → revision → scheduling → publication → outcome measurement for the promised formats and providers. Verify actual published results. |
| **ReviewFlow** | Complete review ingestion, analysis, response preparation/publication where supported, escalation, reputation-case tracking, and provider limitations. |
| **MarketVision** | Repair ingestion and scraping, preserve evidence lineage, produce useful comparisons and briefs, and distinguish current observations from stale information. |
| **MultiChannel BI** | Reconcile imports and connected data, metric definitions, source freshness, filtering, attribution limits, and reports against underlying records. |
| **Knowledge Base** | Complete upload/import, processing, retrieval, refresh, replacement, deletion, source attribution, and property isolation. |
| **Community/property setup** | Complete onboarding, contacts, units/offerings, property facts, brand inputs, and downstream propagation of updates. Resolve ambiguous vertical mappings. |
| **Integrations** | Make connection state truthful. Complete authorization, scope checks, credential renewal, disconnect/revocation, health checks, and recovery for each supported integration. |
| **Reports and search** | Finish real search coverage, filtering, permissions, report generation, exports, scheduled delivery, and meaningful empty/error states. |
| **Pipelines** | Replace simulated runs and random success counts with actual execution, progress, results, failures, and reruns. |
| **Settings, account, and team controls** | Finish the controls required for your operating model, including secure authorization and understandable configuration. |

Empty social-publication, email-thread, inventory-sync, and generic-conversion tables currently mean those paths lack live completion evidence. They must be exercised and verified where they belong to the promised product scope.

**Complete when:** every product has passed its agreed end-to-end journey using real integrations where applicable, including a representative failure and recovery. A product cannot be marked finished by silently removing difficult requirements.

**Phase 6: Pass the whole-platform completion gate.** This establishes that the finished products work together reliably.

- Reconcile local migrations with the live database into a reproducible baseline. Compare resulting schema and behavior rather than treating every different migration name as missing work.
- Keep generated types, database constraints, application assumptions, and deployment configuration aligned.
- Verify database permissions using anonymous, ordinary authenticated, and privileged contexts.
- Run complete application type checks without filtering away unrelated failures.
- Cover critical browser journeys, backend behavior, WordPress runtime compatibility, and integration contracts in the release checks.
- Pin backend dependencies and make builds reproducible.
- Verify every required scheduled job, including its downstream outcome and alerting.
- Establish separate recovery procedures for Supabase data and WordPress sites. The existing WordPress restore drill does not establish database restore readiness.
- Address measured database bottlenecks, duplicate indexes, and expensive policies. Group advisor notices into actual issues before prioritizing them.
- Refactor large modules where their complexity obstructs reliable changes, particularly generation, launch, editing, and workflow processing.
- Run a sustained observation period covering normal operations and the longest relevant scheduled cycles.

**Complete when:** all products have passed, critical shared defects are closed, releases and restores are repeatable, and operational records demonstrate reliable outcomes.

**Phase 7: Introduce agency-wide autonomy.** The existing shared jobs, action attempts, policy decisions, budgets, and outcomes provide a starting point.

Within-product automation remains part of finishing the earlier phases. This phase introduces coordination across products and clients.

- Define which actions may run under standing permission, their spending limits, and which decisions require you.
- Begin with observation and recommendations across products.
- Progress to preparing drafts and proposed work.
- Enable bounded execution for qualified actions with clear limits and recovery procedures.
- Add cross-product sequences only after each participating product and handoff is proven.
- Preserve the intended human launch decision.
- Implement reliable pause, cancellation, escalation, duplicate prevention, and compensation.
- Track client outcomes, cost, quality, and intervention frequency—not just completed agent tasks.
- Expand permissions only when the observed results justify them.

**Complete when:** the agency can execute defined client workflows within your permissions and budgets, recover from expected failures, and involve you at the intended decision points.

**Phase 8: Scale according to demonstrated demand.**

- Optimize cost and throughput using actual client workloads.
- Expand integrations and real-estate specializations where demand supports them.
- Add richer team roles or client access when your operating model requires them.
- Strengthen capacity, isolation, and support processes as client volume grows.
- Use measured autonomy performance to decide which additional responsibilities to delegate.

The immediate implementation sequence is **Phase 0, followed by the three SiteForge phases**. The remaining product work and platform completion gate stay mandatory prerequisites for agency-wide autonomy.
