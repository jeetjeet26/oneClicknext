# SiteForge: LLM-Driven Website Development Plan

Last Updated: July 20, 2026
Document Type: Deep analysis + execution plan
Supersedes: the original conversational "site plan" approach (`app/api/siteforge/plan`) as designed
Companions: `.cursor/plans/visions/SITEFORGE.md`, `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`

---

## Part 1: Intent and Vision Analysis

### What SiteForge is actually meant to be

Reading the vision docs, the roadmap, and the implementation together, the intent is clear and consistent:

SiteForge is not a website builder with AI sprinkled on. It is the **website execution layer of an autonomous multifamily marketing agency**. The distinguishing ambition is the full loop:

1. Truth in → **grounded generation**: brand truth (BrandForge's 12-section structured brand book) plus property truth (KB pgvector retrieval) drive every word, color, and photo. Content is never invented from a generic prompt.
2. **The blueprint is the product**: a versioned, editable, deployable JSON artifact. Preview renders the blueprint; deploy serializes the same blueprint. No hidden transformation gap.
3. **Deploys are governed**: validated before and after publish, always reversible, failures diagnosable by an operator without reading logs.
4. Eventually, **bounded autonomy**: the site improves itself through recommendation → supervised approval (approve/deny/modify with preserved rationale) → bounded auto-action, on top of the shared P2 substrate (`shared_jobs`, `shared_approvals`, `shared_action_attempts`).

The governing rule from the roadmap applies directly: *no autonomous write path advances until the surface is stable, observable, test-gated, reversible, and locally reproducible.*

### Where the original approach shows its age

The existing pipeline was designed around the LLM capabilities of its time, and it shows in four structural ways:

1. **The plan is a chat transcript, not an artifact.** `/api/siteforge/plan` is a free-text Claude chat. "Approval" is a keyword scan (`yes`, `looks good`, `go ahead` — so "yes, but change the hero" flips `readyToGenerate`). The approved plan is never parsed; generation receives the raw transcript plus client-side regex-extracted `{style, emphasis}`. A user can approve a specific page list in chat and the Architecture Agent may build something different. This was a workaround for models that couldn't reliably emit structured plans. That constraint is gone.

2. **JSON-by-hope.** Every agent uses a homegrown "jsonMode": assistant-prefill `{`, then a 3-strategy regex repair parser (`base-agent.ts` lines 242–336). No native structured outputs, no schema validation, `max_tokens: 30000` blind. This was defensive engineering for weak models; today it is the primary source of fragility.

3. **Blind and serial agents.** PhotoAgent "analyzes" photos by sending the URL as text — Claude never sees pixels, so photo quality/brand-alignment scores are hallucinated. QualityAgent makes one serial Claude call per section (dozens of calls) and a failing score only logs a warning. The wizard's agent-progress display is threshold theater (progress % mapped to fake agent states), not telemetry.

4. **Model handling is frozen in time.** `claude-sonnet-4-20250514` is hardcoded in five files. No streaming anywhere. A complete parallel Gemini pipeline (`llm-orchestration.ts`, 717 lines) is dead code.

### The finding that changes the plan's shape

**No real SiteForge site has ever fully rendered.** The deploy path is materially real (Cloudways provisioning, WP REST page creation, media upload, post-deploy verification all work), but the rendering chain is broken at the last mile:

- The `oneclick-siteforge` theme registers 14 ACF blocks, but **zero ACF field groups are defined for them** — `acf-json/` contains only a `.gitkeep`. ACF's `get_field('slides')` resolves through registered field definitions; without them, deployed block data cannot hydrate and pages render empty.
- The repeater-flattening logic ACF requires (`slides_0_headline`, `slides` = row count) exists only in the **unused** edge-function parser (now archived at `outdateddocs/archived-code/edge-functions/siteforge-deploy/blueprint-parser.ts`). The wired deploy client (`utils/siteforge/wordpress-client.ts`) drops nested arrays into `data` raw. *(Fixed: flattener ported into the wired client, July 20, 2026.)*
- Navigation is posted to the block-theme `/wp-json/wp/v2/navigation` endpoint, but the theme is a classic theme using `register_nav_menus('primary')` — created navigation never appears.
- `deployThemeAndPlugins()` installs nothing; it only waits for `wp-json` namespaces. A fresh Cloudways WP has neither the Collection theme nor ACF Pro, so the `acf/v3` readiness gate fails on stock instances (which matches the roadmap's note that the last real deploy attempt failed exactly there).

This means the vision's #1 P1 closure item ("complete at least one real WordPress deploy and rollback validation path") is blocked by theme/serializer work, not by LLM work — and any LLM investment before this is polishing a pipeline whose output can't be seen.

### Secondary structural debt (verified in code)

- **Three redundant deploy implementations**: the wired web client, the never-deployed Supabase edge functions, and a Python MCP deploy path whose Gutenberg serializer emits invalid JSON (`str()` on a Python dict). Divergent serialization across all three.
- **The WordPress MCP bridge cannot work**: `app/api/mcp/wordpress/route.ts` shells out with a `--call` flag the Python server never implemented. Capability "discovery" silently degrades to hardcoded Collection-theme fallbacks — and won't run at all on Vercel (`child_process.exec` of a local Python module).
- **Two competing `SiteBlueprint` shapes** (`types/siteforge.ts` vs `orchestrator.ts`), bridged by `any`; `acfBlock` vs `block` naming drift papered over in the preview renderer.
- **Fire-and-forget execution**: generation and deploy run as unawaited promises in the request process. On serverless the function can be frozen mid-run, stranding rows in `analyzing_brand`/`deploying`. `siteforge_jobs` has retry columns nothing uses.
- **Version bookkeeping is inconsistent**: edit bumps `version`, deploy reads `site_blueprint_version` first, `siteforge_blueprint_versions` is never populated, and rollback depends on older whole rows existing — a site generated once and edited many times has nothing to roll back to.
- **Security**: `wp_credentials` (WP admin password) stored plaintext in `property_websites` and returned verbatim by `/api/siteforge/list`.

### What is genuinely strong and must be preserved

- Cloudways provisioning (OAuth, server/app creation, operation polling, credential rotation) is real and tested.
- The brand intelligence chain (`getBrandIntelligence`: BrandForge → KB extraction → generated fallback, with confidence scoring) is exactly the right grounding architecture.
- KB retrieval with citations (`retrieveKbContext`) is solid.
- Blueprint patch editing (`update/add/remove/move_section` applied purely with order normalization) is the right editing primitive.
- P0 hardening is consistent: tenant-safe auth, colocated route tests, foundation gates, simulated smoke coverage, deployment diagnostics with operator remediation tips.

---

## Part 2: The Plan

Five phases, strictly ordered. Each phase has a gate; do not start the next phase until the gate passes. Phases 1–2 close the existing P1 commitments; Phases 3–5 are the LLM-native rebuild the original design couldn't attempt.

### Phase 0 — Consolidate to one spine (prerequisite, small)

One blueprint, one deploy path, one model config. Everything after this builds on a single trunk.

1. **Single blueprint schema.** Define one canonical `SiteBlueprint` as a Zod schema (blueprint → pages → sections, section = `{id, type, acfBlock, content, order, reasoning}`), derive TS types from it, delete the competing shape in `orchestrator.ts` and the `block`/`acfBlock` drift. The Zod schema becomes the structured-output contract for every LLM call in later phases.
2. **Single deploy client.** Keep `utils/siteforge/wordpress-client.ts` as the only deploy path. Port the repeater-flattening logic out of the edge parser into it (with unit tests against known ACF fixtures), then delete `edge-functions/` or archive it explicitly as reference. *(Done: archived at `outdateddocs/archived-code/edge-functions/`.)*
3. **Delete dead code**: `llm-orchestration.ts` (Gemini pipeline), `GenerationWizard.tsx`, `SectionEditor.tsx`, unused `BrandIntelligence` extraction paths.
4. **Fix the secret leak now**: stop returning `wp_credentials` from `/api/siteforge/list`; move WP admin passwords out of plaintext jsonb (Supabase Vault or at minimum a service-role-only table excluded from list transforms).
5. **Centralize model config**: one `utils/siteforge/models.ts` with env-overridable model ids; replace the five hardcoded `claude-sonnet-4-20250514` literals.

Gate: `check:foundation` green; one blueprint type; grep finds zero hardcoded model ids; list route returns no credentials.

### Phase 1 — Make one real site render (deploy truth)

This is the vision's stated P1 closure item and the highest-leverage work in the repo. Nothing about "LLM-driven development" is real until a generated blueprint becomes a visible website.

1. **Author ACF field groups for all 14 blocks** as `acf-json/` definitions in the theme (top-slides, text-section, content-grid, feature-section, links, plans-availability, form, gallery, image, map, poi, menu, accordion-section, html-section). Field names must match what the ContentAgent emits and what the flattener produces. This is the single prerequisite everything depends on.
2. **Fix navigation for the classic theme**: create WP nav menu items assigned to the `primary` location (via a small theme REST extension or options), instead of posting to the block-theme `/navigation` endpoint.
3. **Automate theme + ACF availability.** Two acceptable shapes — pick one and delete the other assumption:
   - bake a real template image/snapshot on Cloudways that ships the theme + ACF Pro pre-installed (make `WP_TEMPLATE_URL` real), or
   - implement actual theme/plugin installation in `deployThemeAndPlugins()` (upload theme zip via the REST/SFTP path Cloudways exposes).
4. **Implement the `siteforge/v1/acf-schemas` endpoint in the theme** so capability discovery has a real source of truth, and replace the broken `--call` MCP shell bridge with a direct HTTP call to that endpoint from the web app (the Python MCP server stays for interactive/agent use only, or is retired).
5. **Run the real validation loop**: one full Cloudways provision → generate → deploy → visually verified render → rollback → verify, against a live target. Capture the diagnostics and add a checklist to the runbook. Extend post-deploy verification to check rendered HTML for expected content (headline text present in the page body), not just slug existence.

Gate: a real URL serving a generated site with hydrated blocks; rollback verified against the same target; smoke test updated.

### Phase 2 — SitePlan becomes a first-class artifact

Replace the transcript-as-plan design with a structured, versioned, approvable plan. This is where "we put together siteplan when the model was weak" gets rebuilt properly.

1. **Define `SitePlan` (Zod)**: sitemap (pages with slug/purpose/priority), per-page section outlines (semantic type + intended ACF block + content brief), content strategy (voice, vocabulary use/avoid, key differentiators to emphasize), photo plan (required shots, available assets, generation needs), and explicit brand references (which BrandForge sections ground which choices).
2. **Planning is conversational, but the artifact is structured.** The plan route keeps its chat UX but every assistant turn also emits/updates the structured `SitePlan` via native structured outputs (tool use with the Zod schema). The UI renders the live plan beside the chat — sitemap tree, per-page outlines — and the operator edits it directly or through conversation.
3. **Approval is an explicit UI action**, not keyword sniffing. Approving stores the plan (new `siteforge_site_plans` table or a typed column on `property_websites`), stamps reviewer identity/timestamp, and freezes the version that generation will consume — aligned with the platform-wide approve/deny/modify-with-rationale contract.
4. **Plan → generation contract.** The Architecture Agent is replaced by a deterministic expansion of the approved plan plus an LLM pass that fills specified gaps. Generation may not add/remove pages relative to the approved plan; deviations are surfaced as diffs requiring re-approval.
5. Schema work follows the schema-truth rules: verify live schema via MCP SQL, migration in `p11-platform/supabase/migrations`, regenerate types, stamp, run all three checks.

Gate: generate from an approved plan and diff the blueprint against it — page set and section types match exactly; keyword-approval code deleted.

### Phase 3 — Modernize the LLM engine

Now that output is visible (Phase 1) and intent is structured (Phase 2), rebuild the generation internals around current model capabilities.

1. **Native structured outputs everywhere.** Every agent call uses tool-use/structured outputs validated against the Phase 0 Zod schemas. Delete the 3-strategy regex repair parser. A validation failure is a retry with the validation error fed back, then a typed failure — never silently degraded output.
2. **Real vision.** PhotoAgent sends actual image content blocks. Photo analysis (subject, quality, lifestyle vs unit, brand fit) becomes trustworthy, which fixes the lifestyle-ratio quality check and photo-to-section assignment. Same fix applies to the roadmap's "document vision analysis" TODO.
3. **One-shot quality, enforced.** QualityAgent scores all sections in one structured call (not one call per section). Below-threshold sections trigger bounded auto-refinement (regenerate the failing section with the critique injected, max 2 attempts), and persistent failures block `ready_for_preview` with an operator-visible reason. The literal "Click to edit and customize" fallback is deleted — a section that can't be generated is a surfaced failure, not shipped placeholder text (no fake-success rule).
4. **Real telemetry, streamed.** Agents write structured progress events to `siteforge_jobs.output_data` (or a progress table) as they run; the wizard renders actual agent state. Delete the threshold-theater mapping. Streaming of content generation into the preview is a nice-to-have after event-based progress lands.
5. **Grounding citations.** ContentAgent records which KB chunks/brand sections grounded each section (the KB vision's "never act on opaque chunks" principle). Stored on the section as provenance; rendered in preview diagnostics.
6. **Prompt-injection hygiene**: KB/vector content is interpolated into prompts today with no delimiting; wrap retrieved content in clearly delimited untrusted-content blocks and instruct models accordingly.

Gate: zero regex JSON parsing in `utils/siteforge`; a generation run produces per-agent event history; a deliberately weak-content run blocks with a visible quality report instead of shipping placeholders.

### Phase 4 — Durable execution and honest versioning

1. **Jobs become real.** Generation and deploy run as claimable jobs (status transitions, `attempts`/`max_attempts` honored, heartbeat, resumable steps), not fire-and-forget promises. Local-first shape: a worker loop that can run natively (`npm run` script or data-engine process) consuming `siteforge_jobs`; align with (don't duplicate) the P2 `shared_jobs` substrate — SiteForge jobs should be the first product migration onto the shared executor if it's ready.
2. **Populate `siteforge_blueprint_versions`.** Every blueprint save (generation, each edit patch, pre-deploy snapshot) writes a version row: blueprint jsonb, parent version, author (operator vs agent), change summary, and the patch that produced it. Rollback targets version rows, not sibling website rows. Reconcile the `version` / `site_blueprint_version` column split into one source of truth.
3. **Deploy records**: each deploy writes an auditable record (version deployed, target, verification results, duration) — the "auditable deploy, rollback, and verification records" the P2 autonomy contract requires.

Gate: kill the worker mid-generation and restart — the job resumes or fails cleanly with a visible state, no stranded `deploying` rows; every historical edit of a test site is individually restorable.

### Phase 5 — LLM-driven development as a living loop

This is the payoff: the operator (and later, the platform) develops the website continuously through language.

1. **Site-level conversational editing.** Extend the patch editor from single-section (`{sectionId, userIntent}`) to site-scoped intents ("make the whole site feel more upscale", "add a pet policy page", "swap all hero imagery to lifestyle shots"). The edit agent plans a patch set across pages/sections (including `add_page`/`remove_page` patch ops), shows a visual diff against the current blueprint, and applies only on operator confirmation. Every applied patch set is a version (Phase 4).
2. **Preview-diff-deploy rhythm.** The UI's core loop becomes: converse → see diff → apply → preview → deploy delta. Deploys become incremental (only changed pages re-pushed), verified per page.
3. **Recommendation mode (P3 entry).** SiteForge starts proposing changes from platform signals — PropertyAudit findings, MarketVision competitor moves, KB updates (new floor plans, changed amenities) — as draft patch sets in an approval queue mapped onto `shared_approvals` with approve/deny/modify + preserved rationale. No auto-publish.
4. **Supervised, then bounded autonomy** — only after the substrate contract is met: policy boundaries around publish (e.g., copy edits below N words auto-applicable to preview, anything touching pricing/legal/nav requires approval), rollback metadata on every autonomous action, and delayed-outcome capture (deploy → traffic/conversion linkage) before any claim of closed-loop optimization.

Gate for entering step 3: Phases 1–4 gates all green — this is exactly the roadmap's rule that autonomy waits for a stable, observable, reversible, reproducible surface.

---

## Sequencing rationale

The instinct with "the models are good now" is to jump to Phase 3/5 — better prompts, structured outputs, autonomous editing. That would repeat the original mistake in mirror image: last time the pipeline was built beyond what models could do; this time it would be built beyond what the deploy surface can show. The brutal fact driving the order is that the last mile (ACF field groups, repeater flattening, theme install) has never rendered a page, so Phase 1 is where trust is created. Phase 2 is next because the structured SitePlan is the contract every later LLM investment consumes. Phases 3–4 make the engine worthy of the contract. Phase 5 is only honest once the others are true.

## Success metrics (extends the vision doc's set)

- A real deployed property site rendering hydrated blocks (Phase 1 — currently zero)
- Plan-to-blueprint fidelity: % of generated sites whose page/section set matches the approved plan exactly
- Structured-output validation pass rate per agent (replaces "did the regex parser cope")
- Quality-gate pass rate and auto-refinement recovery rate
- Edit round-trip time: intent → diff → applied → previewed
- % of blueprint versions individually restorable
- Stranded-job count (target: zero)
