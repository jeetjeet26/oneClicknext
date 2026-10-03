# SiteForge Phase 1 — delivery contract and current-state reconciliation

Phase 1 snapshot: subsequent local source versions and verification are recorded in [the September 14 Phase 2 handoff](SITEFORGE_PHASE_2_LOCAL.md). Its remaining live gates still apply.

September 14, 2026. The owner directed work to move to the next phase while the Phase 0 live release remains held. This changes the work sequence; it does not mark the hosted Phase 0 gates complete.

The Phase 1 definition work is complete: the supported delivery path, responsibilities, acceptance checks and current target records are documented, the personal skill has a reusable delivery record, and the console exports known editing/destination context. Client launch decisions and live qualification remain explicit dependencies of the affected Phase 2/3 work.

## Supported delivery path

The current Codex agent builds and revises in the client's project using the personal SiteForge skill. Client source, assets, facts, credentials and evidence remain with that project. The oneClick console supplies property context and a portable brief and retains access to earlier application-managed websites. Exporting a brief does not create an agent, submit a generation job, synchronize a site or grant publishing permission.

WordPress is the existing default for a new site when the brief does not establish another target. Preserve a client's established platform and editing framework. Use supplied brands or an approved generated brand; serve rental and for-sale sites with the same delivery requirements. Match the brief's requested design fidelity, including whether a supplied PDF is a layout requirement or a reference.

For WordPress, the actual theme/plugin output and populated editing screens are the authoritative runtime evidence. For standalone sites, the source and built distribution are separate from any WordPress copy. One site can have several review targets, but each needs its own source, purpose, editing ownership and dated verification.

The skill's `assets/delivery-record.md` is an adaptable client-project handoff. Existing equivalent records are valid. Small revisions update only affected evidence; ordinary local work does not wait for every launch field to be filled. There is no new application schema, generator, fixed model or mandatory proprietary page format.

## Responsibility and acceptance contract

“Operator” means the person requesting delivery. “Client content owner” means the actual person who confirms the facts; no owner is invented when this is unknown. Codex implements and verifies the authorized scope. A provider or host owns its delivery response; the intended recipient confirms actual receipt.

| Promise / owner-facing flow | Authoritative implementation path | Evidence required to pass | Responsibility / affected gate |
| --- | --- | --- | --- |
| Start a new site or request a scoped revision | Console brief → client's project → personal SiteForge skill | Correct client and requested scope; supplied references retained; independent target/owner notes; no unintended generation mutation | Operator supplies scope; Codex preserves it. Phase 1 contract defined; new brief flow verified locally. |
| Supplied or generated brand; rental and for-sale briefs | Approved client brand/assets and native source | Identify approved inputs; compare requested layouts and all required routes; label assumptions and placeholders | Operator approves direction; Codex implements. Phase 2 build / Phase 3 creative review. |
| Read and navigate the real website | Native WordPress runtime or built standalone distribution | Direct routes, navigation, gallery, residence/plan viewers, downloads and phone reflow work; empty/error states visible | Codex. Development-preview success alone does not pass distribution/runtime testing. |
| Edit page copy, images and shared details | Existing CMS fields and collections, or documented source edit/build | Open populated editors; change text/image; observe actual rendered changes; preserve unrelated content; restore prior value | Client editor uses documented path; Codex proves connections. Phase 2 editing. |
| Maintain gallery, plans, news and related collections | Current content types/field framework and their rendering code | Add, reorder, hide/remove and restore entries; thumbnails and public summaries appear in relevant page editors; no hidden reseeding | Client editor / Codex. Phase 2 editing and regression. |
| Private preview and revision recovery when promised | Actual CMS preview/revision implementation | Unsaved preview is private and scoped; published page unchanged; expired/unauthorized preview denied; saved version restored | Codex. Phase 2 target-runtime evidence. |
| Update inventory, prices and property claims | Named source, update method and observation dates | Update one record; retain other dates; validate IDs/types; handle stale/empty data; reconcile dependent claims without inventing a live feed | Client content owner confirms facts; Codex verifies mechanics. Missing ownership blocks factual sign-off, not local mechanics. |
| Receive an inquiry with selected plan/home context | Client server handler and explicitly configured destination | Validated fields/consent, spam controls, duplicate protection, bounded retries and visible failures; provider ID plus actual authorized destination receipt | Operator confirms recipient/CRM and test scope; Codex tests local failure paths first. Phase 2 delivery. |
| Connect chatbot, CRM, analytics or supported inventory service | Existing supported client/provider integration | Exact property/destination, authorization/scopes, source lineage, disconnection/failure behavior, observed event reconciliation | Operator/provider/Codex. Phase 2 integration; missing credentials block only that connection. |
| Migrate an existing website | Source inventory, client-approved mapping, native target | Required content/assets and rights accounted for; established editors preserved or deliberately migrated; old routes and redirects verified; destructive changes approved | Operator approves affected production changes; Codex prepares local candidate. Phase 2 migration. |
| Deliver accessible pages and appropriate housing content | Actual pages, dialogs, forms, documents and embedded tools | Affected keyboard/focus/labels/reflow/contrast/alternatives checks and housing-content review; retain manual findings and target scope | Codex performs implementation checks; client/qualified reviewers resolve content and formal review needs. Phase 2/3, no scan-only certification. |
| Package, stage and publish | Reproducible client build/package → exact approved target | Source/package identity, runtime compatibility, installation, cache behavior and critical routes verified; target/scope authorization recorded | Codex prepares; operator authorizes publishing. Phase 2 release. Prior permission is reused only where it actually applies. |
| Configure domain, HTTPS and discovery | Intended production host, DNS, redirects and metadata | Correct certificate/host/canonical/redirects; intended indexing and sitemap state; review site remains distinct | Operator/host/Codex. Phase 2 launch; no DNS or indexing changes in Phase 1. |
| Recover after bad edits, interrupted work or deployment | Preserved source/package plus relevant database/uploads/hosting backup | Stop safely; resume or restore without duplicate effects; verify actual restored target and form settings | Codex/operator. A local source restore or content export does not prove full hosted restoration. Phase 2 recovery. |
| Maintain, monitor and report | Named update owner, supported checks and approved alert/report destinations | Useful failure signal and deduplication, actual approved alert receipt, dated source freshness, scoped repeat edits and recovery evidence | Operator/Codex/provider. Phase 3 operation; original three contrasting briefs and 20 measured edits remain. |

Record each applicable promise as **passed, failed, not run, or blocked**, with date, tested version/target, evidence and next action. An excluded feature needs an explicit scope reason. A failed or unrun check cannot become a pass because a page renders or an old application status says “complete.”

## Reconciled client targets

The current target register is in `SITEFORGE_TARGET_REGISTER.md`. The client documents and package/source checks were reviewed September 14; their hosted verification dates remain September 8–11. No fresh client-host browser check or deployment occurred in this phase.

- **Persimmon WordPress:** the latest supplied record is theme **3.0.1 with ACF Pro 6.8.6**, superseding the 1.x/2.x editor descriptions in earlier handoffs. Both the original client source and ACF working copy identify 3.0.1. The editing guide records 17 ACF groups, 124 page fields and 61 gallery entries; license activation remains pending. Preserve this framework. It is a hosted review target, with online delivery disabled and production designation/content ownership still to confirm.
- **Persimmon standalone:** a separate Vercel review project with independent HTML/assets and `content/inventory.json`. The September 11 inventory maintenance changes are local; the README identifies the earlier hosted deployment. WordPress edits do not reach this target. Do not rerun the one-time conversion over later source changes.
- **Gable House:** the supplied WordPress review installation uses theme 1.0.0 and its native content plugin 1.0.2. Preserve its existing fields and content types; do not replace them with ACF merely because Persimmon uses ACF. The review record covers 28 editing screens and 19 local checks. Design fidelity to the PDF remains a specific open decision; inquiry delivery remains in preview mode.
- **Alder & Tide:** a fictional for-sale demonstration with six pages, native WordPress package and standalone/offline output. The recorded browser checks demonstrate parts of UI quality; actual WordPress activation and real destination delivery remain unqualified. Demo facts are not production evidence.
- **Retained console websites:** a fresh read-only database inventory found 52 website records, 15 legacy queued jobs from the Phase 0 audit, and conflicting Aurora lifecycle/release pointers. These belong to the earlier application-managed path. No state was rewritten, job replayed, incident resolved or website reassigned. Independent Codex client sites are not gated on reviving that generator.

## Open decisions attached to their actual gate

| Decision / conflict | Evidence and default handling | Step that needs resolution |
| --- | --- | --- |
| Which Persimmon target is authoritative for ongoing client production? | Keep WordPress and Vercel separate. The working contract supports both; do not infer synchronization or discard either source. | Target-specific Phase 2 publication and maintenance ownership. |
| Who confirms current inventory, price claims and review intervals? | Keep known observation dates and existing provisional intervals; do not refresh dates merely by building. | Factual sign-off and ongoing maintenance; local update/restore trials can proceed. |
| Which actual inbox, phone or CRM receives a test? | No destination inferred from credentials, public contact text or legacy defaults. Local mocks and visible preview states remain useful. | Connected delivery and actual receipt. |
| Does Gable House require closer PDF reproduction? | Latest task acknowledges interpretation. Preserve current work and compare actual pages against supplied requirements before changing scope. | Design acceptance, not unrelated technical checks. |
| What currently serves on Aurora's shared legacy hosts? | Stored “production_live” coexists with a later rollback record and differing artifact pointers. Preserve all evidence and mark unresolved. | Any legacy edit/deploy/retirement; inspect exact host/artifact and caller dependency under the applicable authorization. |
| Which legacy incidents/jobs are still actionable? | Retain historic records and the Phase 0 hold; counts are not verified current outages or permission to replay. | Individual operational disposition, not new client generation. |

## Phase 2 entry point

Use the latest native WordPress client project for local editing, integration failure, packaging and recovery trials; Persimmon's 3.0.1 source and Gable House's existing content plugin provide the strongest recorded editing evidence. Keep each client scope separate. Begin with reproducible local trials and the documented disabled/preview delivery path; ask for a real destination only when the prepared connected test actually depends on it. Do not stall unrelated console or client work behind that decision.

No phase change grants deployment or message permission. The deferred Phase 0 live gate and every later product/platform/autonomy gate remain explicit. Phase 1 defines what must be demonstrated; Phases 2 and 3 perform the remaining delivery and operating qualification.

## Phase 1 verification — September 14

Ten brief/page unit tests and six browser scenarios passed on the local console. Coverage includes exact context and file export, Markdown-fence handling, unknown destinations, no generation mutation, clipboard fallback, property isolation, missing-property behavior and the phone layout. Full web TypeScript and targeted lint passed. The updated skill passes its structure validator and its template links resolve. The preserved Persimmon 3.0.1 ZIP matches its recorded SHA-256. The new inputs were visually inspected; no client-host changes or messages occurred.

Source evidence reviewed: the original plan and September 12 amendment; the saved tasks “Analyze project insights,” “Create real estate website,” “Find Persimmon site chat” and “Build accessible WordPress site”; the latest Persimmon ACF guide and audit, standalone README/maintenance handoff, Gable House handoff/CMS audit, and Alder & Tide validation record. The app's old task reader omits some later history, so the dated client deliverables remain the evidence for those later changes. No credentials or private tool logs were copied into the reusable skill or contract.
