# oneClick community brain architecture review

October 13, 2026. Rechecked against live Supabase on October 13; vector inventory at 22:29 UTC, storage configuration at 22:37 UTC, and a final catalog/relationship sanity check at 23:09–23:14 UTC. Application evidence includes the uncommitted working tree.

Execution handoff: [technical implementation plan](/Users/jasjitgill/oneClick/docs/COMMUNITY_BRAIN_IMPLEMENTATION_PLAN_2026_10_13.md), with ordered work packages, code/schema targets, migration procedures and acceptance gates.

## Recommendation

Keep Supabase Postgres, pgvector, and Supabase Storage. Build a shared community knowledge service on top of the existing property, brand, asset, approval, and analytics records. Make that service responsible for deciding which information each product can use, returning its sources and versions, and propagating approved changes.

**Required constraint, added October 13: preserve the highest practical data fidelity per community, with zero unauthorized cross-community knowledge access, mixing, or writeback. This includes communities within the same organization. Isolation is a release-blocking requirement, not an optimization target. The shared-platform recommendation is conditional on enforcing and verifying the boundaries below; the existing system is not certified to meet this requirement.**

**Authorized internal portfolio access is also required.** An internal team assistant may retrieve and compare information and assets across an explicitly resolved set of communities the team member is permitted to access. It must preserve each source's community identity and retain combined answers in a separate internal workspace. This grants controlled cross-community reading and synthesis; it does not merge community KBs or authorize cross-community writeback.

The necessary architectural change is to make RAG one retrieval method within the community brain. A vector index cannot by itself serve as the authoritative record for prices, availability, brand decisions, image permissions, or campaign performance. Those need structured records and explicit relationships. Documents, crawls, and creative examples benefit from semantic retrieval. Original images and files belong in object storage.

The current platform contains substantial reusable foundations. The largest gaps are inconsistent context assembly across products, incomplete adoption of the newer review workflows, weak classification at the vector retrieval boundary, and a newer knowledge-monitoring scheduler that cannot provide continuous coverage at the intended scale. Other ingestion paths have retained recent observations. Replacing the database would leave these gaps unresolved.

The recommendation is based on read-only inspection of the live **oneClick** Supabase project, `lmjmutuggvzuadwreqxx`, the complete local working tree including **14 uncommitted application/test files**, and current primary documentation. The live database catalog, function definitions, grants, triggers, and actual rows take precedence over migrations, generated types, or older implementation notes when describing installed database behavior. Local code shows the candidate application behavior; it does not establish which application commit is deployed. Database records establish what is stored, not whether an old price or scraped claim is still factually current. No application code, live data, schema, or deployment was changed during this review. This is an architecture assessment, not a measured capacity certification.

The recheck materially corrected the first inventory: there are **three vector-bearing tables**, including a separate competitor corpus previously omitted. The two text corpora contain **571 rows and 229 populated vectors**, not just the 132 general document rows. It also confirmed newer database review functions are installed while their associated workflows remain largely unpopulated. The migration plan below therefore starts with reconciling legacy storage and adopting existing review paths, rather than rebuilding those capabilities.

## Final sanity check

The recommendation survives the additional research, with several material refinements:

- **Prefer exact community-scoped vector search at today's size.** If approximate search becomes necessary, evaluate community-specific partitions/indexes so another community's vectors do not affect search recall. This is separate from authorization and does not require a separate database project per community.
- **An exact-file handoff defect is reproducible.** A floorplan with an explicit approved asset ID can also be associated with an older approved asset through its legacy URL. The live data currently has no instance of that conflicting combination. Fix the association before relying on the package manifest as an authoritative drawing map.
- **Current links are consistent, but universal ownership enforcement is incomplete.** No mismatches were found in the one saved floorplan asset link, 81 website-to-library asset links, or 1,659 job-to-context links checked. Several relationships still have ID-only foreign keys, and the website source-asset field has no foreign key. Correct records today do not establish that every future writer is constrained.
- **Private access extends beyond database rows.** Signed download links, cached files, model-provider files/responses/containers, and saved internal answers need their own scoped lifecycle. Revoking a membership cannot recall already viewed/downloaded data or guarantee immediate cancellation of an outstanding signed link.
- **Feed completeness needs evidence of delivery.** The legacy ad runner can report success after an inner pipeline returns without importing data; its Google account lookup also collapses a database error into an empty result. The newer tracked importer has stronger account and write confirmations. Establish which path runs in deployment and use the tracked contract; do not classify all importers as equally deficient.

The last check passed **114 existing tests across nine files**, partially overlapping the earlier test runs. Separate isolated reproductions demonstrated the floorplan association defect and legacy runner behavior using actual functions with mocked dependencies and no network/database writes. These checks are not a live isolation certification. The findings, qualifications and rollout gates below incorporate both passing tests and uncovered cases.

## Expanded assessment: the complete marketing platform

The final sweep broadens this recommendation: **the community brain should serve a marketing operating cycle that connects goals, current offerings, planning, generation, approval, delivery, and measured business outcomes.** The shared identity for an initiative must connect its source facts and assets to its website, social/ad creative, provider campaign, inquiry, and eventual outcome. A vector database does not provide that coordination.

The [platform and ingestion companion review](/Users/jasjitgill/oneClick/docs/REAL_ESTATE_MARKETING_PLATFORM_AND_INGESTION_REVIEW_2026_10_13.md) contains the full capability matrix, file/source support matrix, and broader implementation sequence. It qualifies several assumptions that matter before implementation:

- **Existing orchestration is narrower than its names imply.** Agency plans are proposal-only; the installed agency executor is restricted to a local rehearsal database and cannot execute on the live `postgres` database. There are useful dedicated delivery workers and a wired SiteForge autonomy policy. Extend their common action contracts rather than treating the platform as either fully autonomous or devoid of execution infrastructure.
- **Ingestion is not complete.** Community image upload and exact floorplan asset handoff exist, but scanned-document OCR, PDF-to-floorplan handling, office files, and richer media processing need work. The newer reviewed unit-data contract does not carry the older guided flow's image-asset binding. Of 40 live unit records, seven have image URLs and one has an image asset ID.
- **A live compatibility defect needs repair.** The generic media uploader accepts MP4/WebM up to 100 MiB but uses `property-assets`, whose live policy excludes those MIME types and caps files at 50 MiB. SiteForge's source package has a separate 5 MB per-file and 35 MB total limit, below supported upload sizes. Storage acceptance, processing, and agent handoff need one explicit capability contract.
- **Campaign execution and learning need additional qualification.** Inspected paid-ad tools primarily read/report. The live marketing facts remain old and currency-less; newer delivery/outcome workflows are largely empty. Eight shared experiment outcomes do exist, but describe SiteForge metrics with neutral/unknown status in August, not verified current improvement in leasing outcomes.
- **The local reporting improvements should become shared semantics.** They already handle missing data and uncertain attribution more carefully. The older campaign analytics endpoint still converts missing measures to zero and lacks currency handling; decision-making agents must not use conflicting metric definitions.
- **Support the real estate business model explicitly.** Existing vertical contracts already distinguish rental, for-sale, commercial, senior care, and other offerings/conversion intents. Reuse those distinctions as the platform grows beyond a rental-only pilot.

The recommended first implementation now includes foundational OCR/floorplan intake and input/handoff repairs alongside the shared context and source-policy work. These are prerequisites for onboarding, not optional visual-search enhancements. Follow with one measurable, operator-approved marketing initiative end to end, then expand autonomous execution by qualified action type. An additional **114 existing tests across 13 files passed** during this sweep; external storage/providers are mocked in those tests, so this does not establish live end-to-end readiness.

## What is running and what already exists

### Live database inventory

These are exact counts from read-only aggregate queries, rather than dashboard row estimates. Property records can include test or demonstration communities.

| Area | Observation | Implication |
| --- | --- | --- |
| Properties | 9 rows; 7 properties have document chunks | Coverage is uneven, and present volume is small. |
| Knowledge sources | 24: 7 websites, 6 intake forms, 8 competitor intelligence, 2 documents, 1 manual | Multiple source types are already supported. |
| General retrieval documents | 132 rows; 123 have vectors | Small corpus; includes legacy text and 9 media references. |
| Competitor retrieval documents | 439 `competitor_content_chunks`; 106 have vectors, 333 do not | Separate text corpus across 18 competitors; must be included in the migration. |
| Vector configuration | pgvector 0.8.0; both text tables use `vector(1536)`; assets use `vector(512)` | Inspected text writers use `text-embedding-3-small`, but dimensions alone do not prove the model used for historical rows. |
| Document indexes | Primary key only; no property filter, full-text, HNSW, or IVFFlat index | Add filter indexing and measure before choosing an approximate index. |
| Competitor indexes | B-tree filters and uniqueness indexes; IVFFlat cosine index with 100 lists | Approximate search already exists here. Benchmark its recall against exact search before retaining or replacing it. |
| Nonembedded document rows | 6 photo references and 3 floorplan references | These are not automatically retrievable through vector search. They need asset-specific handling; their null vectors are not proof of failed text ingestion. |
| Shared media library | 14 `content_assets`; none has an embedding | Asset vector search is not populated. The existing asset vector column is 512-dimensional, unlike the text index. |
| Website assets | 224 `website_assets` | Website delivery records and the reusable media library are separate inventories. |
| Structured inventory | 40 active `property_units`, all marked approved; 0 unit review workspaces | Preserve typed records. An approval field does not prove adoption of the newer recorded review process. |
| Brand | 1 approved completed `property_brand_assets` record; 1 legacy `brand_books` record; 13 brand-book document chunks | Reconcile the distinct representations against the current approved brand contract. |
| Chatbot context | 5 saved contexts, marked current, averaging 2,893 characters | A compact facts prompt is practical at current size. “Current” does not establish recent verification. |
| Context dates | Last generation ranges from May 27 to August 17, 2026 | Freshness policy needs to distinguish stable identity from volatile inventory. |
| New knowledge workflows | 0 `knowledge_materials`, `knowledge_files`, `knowledge_web_captures`, and `assistant_fact_versions` | These newer tables exist but are not populated in this project. |
| New property intelligence | 0 `property_intelligence_documents` | The newer canonical facts and creative-direction design is not populated here. |
| Reviewed competitive evidence | 0 `marketvision_brand_requests` and 0 `marketvision_brand_reviews`; 0 eligible reviewed competitor evidence rows | The installed reviewed BrandForge context path has no evidence to serve yet. |
| Market captures | 52 retained website captures; newest October 13, 2026 | Recent observations exist independently of older vectors and the empty reviewed brand workflow. |
| Shared context history | 1,894 `shared_context_snapshots` | Reuse existing history; it includes SiteForge, ad-sync, review-sync, and market-ingestion snapshots, not only generation manifests. |
| Marketing observations | 43 `fact_marketing_performance` rows, November 1–December 19, 2025; all 43 lack currency | Stored data does not yet support a claim of current campaign learning. Reconcile feeds and currency before monetary conclusions. |

The live documents table occupies about 1.4 MB including associated relation storage. All 132 rows lack the newer `knowledge_source_id`, `knowledge_material_id`, and `version_id` metadata links used by the installed assistant snapshot function. They also lack `embedding_model` and `content_hash` metadata. This does not mean they have no provenance: many retain URLs, run IDs, titles, timestamps, or brand/competitor IDs, and 22 retain an original-file path or URL. Recover those relationships where evidence supports them; preserve unknown provenance as unknown. The 13 brand chunks date to December 11, 2025 and coexist with no `brand_book` knowledge-source row. One same-property exact-text duplicate group contains one excess row. No missing property or competitor parent was found in these two text tables.

### Legacy storage that needs reconciliation

| Live evidence | Meaning for the migration |
| --- | --- |
| 312 competitor chunks have no capture link, including 40 populated vectors | Treat as legacy external observations; do not manufacture capture identity or current approval. |
| 127 competitor chunks have a capture link: 66 embedded and 61 unembedded | Validate capture freshness and permitted use before indexing. All linked captures agree with the chunk's competitor and owning property. |
| 9 chunks belong to inactive competitors; 19 chunks have newer captures for the same competitor/property | Current semantic matching does not exclude inactive competitors or select a current capture. Newer captures do not automatically refresh this vector corpus. These groups can overlap. |
| 3 embedded general-document rows are generated `property_units` pricing summaries | Replace their serving authority with current structured inventory. Preserve historical text without letting it override live prices. |
| 11 embedded competitor-intelligence summaries also exist in general `documents` | The separate competitor corpus does not eliminate competitor contamination of the general corpus. |
| 9 general-document rows are unembedded photo/floorplan references | Resolve them into the asset registry. Null vectors here are not a failed text-ingestion queue. |
| Only 8 of 14 media-library rows have both storage bucket and key; 9 have hashes | Reconcile existing URLs, originals, and identities before describing the library as uniformly canonical. The 224 website assets are a separate delivery inventory, not automatically 224 missing library assets. |

The installed `guard_managed_knowledge` protects rows participating in the newer material workflow; legacy documents without its material marker are not automatically adopted. The installed `guard_obsolete_unit_documents` blocks old generated pricing writes only after an applied unit workspace exists for that property. There are currently no such workspaces. These are real compatibility boundaries in the live database, not evidence that every old record already benefits from the new controls.

Do not run a blanket “embed all missing rows” job or delete/recreate the KB as the first step. Capture a recoverable inventory, classify each source, reconcile references, review candidates for current use, and then build derived indexes for eligible versions. The existing competitor writer deletes a competitor's old chunks before inserting replacement batches; move that path to retained capture versions with an atomic active-version switch so a partial failure cannot erase the last usable index. See [competitor storage and embedding implementation](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/scrapers/brand_intelligence.py:409).

### Uncommitted local work included in this assessment

All nine modified tracked files and five new application/test files were read, including the full diffs and the new files. The checked HEAD was `b07cdc170ff40b5d85baf0164a77b302777f062f`; the assessment uses the working tree on top of it.

| Local changes | What already exists and should be reused |
| --- | --- |
| [ClientPortal.tsx](/Users/jasjitgill/oneClick/p11-platform/apps/web/components/client-portal/ClientPortal.tsx), [portal contracts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/client-portal/contracts.ts), [portal server](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/client-portal/server.ts) | Exposes incomplete marketing records, removes missing-value-to-zero normalization, and suppresses comparisons with incomplete current/prior records. |
| [report-quality.ts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/analytics/report-quality.ts), [its test](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/analytics/report-quality.test.ts) | Shared complete, finite, nonnegative record filtering while retaining actual zeros. |
| [reporting.ts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/reporting.ts), [its tests](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/reporting.test.ts), [analysis.ts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/analysis.ts), [portfolio.ts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/portfolio.ts) | Source/account-aware totals and latest snapshots, explicit ambiguous snapshots, descriptive funnel/spend ratios, verified imported lease attribution with outcome deduplication and unknown/conflict counts, plus capture-linked competitor observations. |
| [intelligence contracts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/contracts.ts), [CSV import](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/import.ts) | Move-ins and market metrics; required units, definitions, and references for market observations; stable outcome IDs and explicit attribution model for source-confirmed leases. |
| [InsightsView.tsx](/Users/jasjitgill/oneClick/p11-platform/apps/web/components/intelligence/InsightsView.tsx), [IntelligenceWorkspace.tsx](/Users/jasjitgill/oneClick/p11-platform/apps/web/components/intelligence/IntelligenceWorkspace.tsx), [ReportingDetail.tsx](/Users/jasjitgill/oneClick/p11-platform/apps/web/components/intelligence/ReportingDetail.tsx) | Reporting UI distinguishes period observations from inquiry cohorts, shows source dates and caveats, and exposes the expanded import workflow. |

These are already local implementations, not missing features to rebuild. The live `decide_property_intelligence` function stores versioned JSON payloads and enforces authorization, revision checks, approval transitions, and event evidence. It is installed; its document table is empty. Its database-level payload validation is generic, while the expanded metric semantics live in application validation. Preserve that validation at every writer when wiring ingestion into the brain. A successful database write alone does not establish semantic validity.

Focused validation passed **23 tests across three files**: report quality, intelligence reporting, and intelligence analysis/import behavior. This verifies these local unit-level cases, not deployment or end-to-end provider synchronization.

The migration history is not a byte-for-byte representation of the live system: there are 275 local migration files and 288 live ledger entries, with 144 exact version matches and 240 matching names. Many historical changes have different timestamps or were consolidated. The latest eight versions, through `20261007223000`, match, including property intelligence. A name/version mismatch is not proof a feature is absent; do not replay old migrations blindly. The live definitions were used to resolve the relevant behavior in this report. Older notes saying a feature was not deployed are not evidence of current database state.

The companion [audit evidence file](/Users/jasjitgill/oneClick/docs/COMMUNITY_BRAIN_AUDIT_EVIDENCE_2026_10_13.json) retains aggregate results, read-only query text, relevant live-function hashes, migration comparison, and fingerprints of all 14 uncommitted application/test files. It excludes raw source passages, vectors, customer conversations, and credentials. Database aggregates were collected over several read-only calls, not one transaction-wide snapshot.

### Current product paths

| Product or workflow | Inspected behavior | What to retain or change |
| --- | --- | --- |
| LumaLeasing chat | Loads the saved property context on each in-scope chat request and interpolates it into the system prompt. The route does not call vector search. | Retain a compact core profile; add question-specific retrieval and structured live lookups. It is refreshed per request in this code, not only when a session opens. |
| Assistant facts | A live serving function supports legacy contexts and reviewed versions. Changed or withdrawn reviewed facts can be withheld. Age alone produces a reminder. | Reuse version checks, but move toward field-level freshness so one changed document does not withhold all useful facts. |
| ForgeStudio | Builds a context bundle from property fields, approved brand, legal policy, units, selected assets, KB search, and business signals; persists source records and a context hash. | This is a strong starting point for a shared context contract. |
| SiteForge legacy utilities | Query the shared `match_documents` function; a separate brand semantic-search path has an unimplemented embedding helper. | Consolidate callers and eliminate misleading fallback capabilities. Do not infer that every old path is active in production. |
| SiteForge package generation | Packages approved structured information, brand, media, floorplans, legal content, neighborhood data, and newer canonical information. Records source and byte hashes. | Generalize this exact-source-manifest approach across products. |
| BrandForge | Explicit publication embeds the approved contract and sections. Newer database code replaces the published brand chunks transactionally. | Extend this pattern to other approved outputs, preserving their meaning and authority. |
| Competitor intake | Embeds competitor content into the same property-scoped documents pool, with competitor IDs and `chatbot_prompt_injection=false`. | Make subject identity and permitted use enforceable retrieval conditions. |
| Competitor semantic search | Uses the separate `competitor_content_chunks` table and live `match_competitor_content`; property and competitor filters are optional. | Require server-resolved scope and eligible capture/competitor filters. Preserve this corpus in the reconciliation. |
| Reviewed competitive positioning | The local BrandForge adapter calls live `read_marketvision_brand_context`, which selects the latest published review for active competitors with current captures. There are no published review rows here yet. | Reuse this stronger source-selection contract. Do not equate old semantic-search results with reviewed positioning evidence. |
| Website monitoring | Captures changes for review; explicitly publishes zero sources automatically. | Preserve reviewed publication, but separate ongoing observation from the publication lifecycle. |
| PDF ingestion | Extracts ordered text through an isolated parser worker; no OCR or image understanding. | Add an OCR/visual extraction path for scans and diagrams while retaining the exact original. |
| Asset handling | Has centralized storage, image analysis, approval fields, rights metadata, hashes, and curation. | Reuse these rather than building a second media system. |

Repository evidence: [chat route](/Users/jasjitgill/oneClick/p11-platform/apps/web/app/api/lumaleasing/chat/route.ts:640), [context serving](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/services/chatbot-context-editor.ts:420), [ForgeStudio assembler](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/forgestudio/context-assembler.ts:142), [SiteForge package source](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/source.ts:15), [brand publication](/Users/jasjitgill/oneClick/p11-platform/apps/web/app/api/brandforge/embed-to-kb/route.ts:82), [competitor ingestion](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/routers/competitor_intake.py:440), and [property intelligence implementation notes](/Users/jasjitgill/oneClick/docs/P11_PROPERTY_INTELLIGENCE_TECHNICAL.md:1).

## The most consequential gaps

### Retrieval knows the owning community but not enough about the subject

The live `match_documents` function filters only by `property_id` and similarity, then returns the closest chunks. It does not enforce source category, approval, effective dates, sensitivity, or permitted use. It is a `SECURITY DEFINER` function, but its current execution grants are restricted to `postgres` and `service_role`; it is not presently an anonymously callable search endpoint.

There are 11 embedded competitor-intelligence chunks in the same index. Their metadata says not to inject them into the chatbot, but the matching function does not interpret that flag. ForgeStudio's KB adapter labels every retrieved chunk as public, curated, and eligible for factual claims and topics. That creates a route for competitor information to be treated as community evidence. This is a confirmed policy gap, not evidence that a specific published output contains a wrong claim.

The separate live `match_competitor_content` function also lacks active-competitor, capture-currentness, approval, and purpose checks. It is a security-invoker function, so its broad execution grants do not by themselves bypass RLS. Its underlying policies are organization-scoped. In service-role callers, enforce property scope before search; an omitted optional property filter must not become an all-tenant retrieval request. For current approved competitive positioning, prefer the existing reviewed-context function over treating raw semantic matches as reviewed claims. See [reviewed BrandForge adapter](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/marketvision/brandforge-competitive-snapshot.ts:137).

There is a related issue in the newer assistant workflow before retrieval: live `assistant_source_snapshot` includes every general-document row for the property, and `assistant_fact_text` appends every retained document without applying `chatbot_prompt_injection`, subject, or audience filters. It labels legacy material separately, but labelling is not exclusion. Filter source eligibility before preparing a reviewed facts draft as well as at query time. Because `assistant_fact_versions` is empty, this is a latent adoption issue, not evidence that a reviewed facts publication has already leaked competitor claims.

Every item needs two separate concepts: **the community that owns access to the information** and **the entity the information describes**. A competitor's pool belongs in the community's competitive research, but it must never establish that the community has a pool.

### Approval, authority, and freshness are different

Approval currently exists in several domains, but a common serving contract does not consistently carry it through the index. A source can be approved for creative reference, approved for publication, or approved as a statement of fact. These have different consequences.

Likewise, a saved record marked current can contain old information. The context-serving code treats elapsed age as advisory. That may be appropriate for a community name or brand story, but it is unsuitable as the only freshness rule for rent, inventory, offers, and appointment availability.

Some existing asset rules deliberately treat rights and expiry as advisory under a solo-operator policy. Record that choice explicitly when expanding to teams and clients. Do not assume a general approval means the file is cleared for every channel forever. See [asset usability policy](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/assets/curation.ts:34).

### Website checks are not a continuous refresh loop

Both repository deployment configurations schedule knowledge refresh every six hours. The worker and live dispatch function allow at most five captures per sweep. **If deployed and run only on that schedule**, the configured ceiling is 20 new automatic captures per day before failures or runtime limits. This is not a measured production rate: the newer capture table is empty, deployed scheduler configuration was not attested, and additional invocations could change throughput. Three hundred sources needing one daily check would require fifteen times that configured capacity.

The live dispatch function also skips a source once a capture exists for the same policy revision and active source version. There is no time condition on that skip. Thus, that source is not repeatedly checked under the same version/policy, even after the next interval. It needs a new version or policy revision to become eligible again. This behavior fits a bounded review workflow, but not continuous monitoring.

Create separate `next_check_at`, observation, content-change, and publication states. Rechecking unchanged content should advance the observation timestamp without manufacturing a new fact version or requiring another approval. See [scheduler](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/knowledge/web-policy-store.ts:5) and [dispatch migration](/Users/jasjitgill/oneClick/p11-platform/supabase/migrations/20260923044433_phase_five_knowledge_monitoring.sql:118).

### Different generators assemble different versions of community knowledge

ForgeStudio, the chatbot, SiteForge packages, older site agents, and the newer intelligence workspace each implement part of the desired brain. They differ in source selection, truncation, freshness, and failure behavior. The legacy chatbot compiler reads at most 24 recent document excerpts. The newer facts workflow can retain a complete reviewed publication, but it has no live version rows in this project.

Consolidate the serving contract, rather than adding another product-specific knowledge table or growing the chatbot prompt indefinitely.

## The proposed community brain

The brain should be one logical service with several types of memory. It does not need one database, model, deployment, or agent per community.

| Memory | Examples | Storage and retrieval |
| --- | --- | --- |
| Authoritative facts | Name, address, amenities, pet rules, floorplan specifications | Existing typed Postgres records; versioned additional facts; exact queries |
| Brand and creative decisions | Approved logo, palette, voice, photography direction, restrictions | Structured brand contract plus approved creative versions; exact lookup |
| Evidence | Brochures, FAQs, approved source documents, crawled pages | Immutable originals and captures in Storage; text/OCR chunks in Postgres; hybrid retrieval |
| Media | Photos, logos, floorplan images, video, fonts | Original files and renditions in Storage; searchable metadata and optional visual embeddings |
| Approved work | Approved site copy, social captions, campaigns, reusable components | Versioned artifacts with approval scope and source lineage; retrieve as creative examples |
| Measurements and learning | Spend, conversions, tour outcomes, tested hypotheses | Structured observations and deterministic calculations; approved narrative summaries where useful |

All products request a task-specific context bundle from the service. The bundle contains permitted facts, relevant evidence, brand rules, asset references, applicable measurements, warnings, and an immutable manifest of source revisions.

Examples of requests include a public leasing answer, a website build, a social campaign brief, a brand revision, and an internal competitive analysis. Their source pools differ. Public chat should not receive internal acquisition strategy or raw campaign data. An internal competitor brief should deliberately receive competitor evidence. Website generation should always receive exact approved logos and design tokens without hoping those records rank in the top six vector results.

Use existing records as the source of truth. Extend `property_intelligence_documents` for supplemental reviewed facts and creative direction; retain numeric inventory in `property_units`, brand decisions in the brand contract, and analytics in the measurement layer. The shared service can expose a unified view without copying every field into a competing master JSON blob.

### Data contracts to add or standardize

These are logical responsibilities; implementation should reuse existing tables wherever they already meet the contract.

| Contract | Required information |
| --- | --- |
| Source and source version | Owner organization/community; described entity; source type and URL; immutable version/hash; original file; observation time; authority; visibility; allowed uses |
| Current fact | Entity, field, typed value, unit/currency when applicable, authoritative source/version, approval, effective interval, review deadline, superseded version |
| Retrieval chunk | Source-version ID; section/page/coordinates; exact text; contextual label; text-search field; embedding model/dimensions/recipe; content hash |
| Asset and asset version | Stable ID; storage bucket/key; hash; original and renditions; depicted entity; role; real/generated/illustrative status; caption/OCR/tags; approval and usage conditions |
| Generation manifest | Task, community, audience, source revisions, asset versions, brand version, retrieval recipe, model/prompt version, output hash, approval decision |
| Dependency and update event | Which fact/source/asset a generation used; change type; transactional event ID; processing state; deduplication key |

Promote fields used for access, subject filtering, validity, and publication into typed columns or rigorously validated indexed projections. Arbitrary JSON tags alone are too easy for one consumer to ignore. Reuse the installed material/source/version identities: the current publication and snapshot contract uses `knowledge_source_id`, `knowledge_material_id`, and `version_id`; competitor evidence uses `capture_id`. Normalize those through an adapter instead of introducing another disconnected `source_id` convention. Enforce matching organization/community on relationships, including cross-table asset references. Keep separate embedding representations for incompatible models or modalities.

A useful first shared interface is `getCommunityContext(propertyId, actor, audience, purpose, query, asOf)`. The server resolves authorization and permitted source categories; a model or browser must not be allowed to choose arbitrary tenant scope. Return machine-readable source IDs, versions, allowed uses, and confidence labels alongside the model-facing text.

## Retrieval and the chatbot

Keep the compact community profile. The current approach is reasonable for a small, reviewed set of stable information. The goal is to stop forcing all kinds of knowledge through that one prompt. Anthropic's context guidance supports selecting information for the current task, while its retrieval research also recognizes that a small corpus can be supplied directly. Neither approach eliminates the need for freshness and source authority. [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval).

For each chat request:

1. Resolve the widget/community and the visitor's permitted audience on the server.
2. Include a small approved profile and behavior rules.
3. Route exact questions to typed tools: current availability, prices, floorplan details, office hours, and tour slots.
4. Retrieve approved public evidence for narrative questions such as pet rules or amenity details.
5. Supply the selected evidence as data with source identifiers, separate from the system's behavioral instructions.
6. Generate an answer and verify sensitive numbers, links, and cited sources against the returned evidence.
7. Record the context manifest. If evidence is missing, conflicting, or expired, explain the specific gap and offer an appropriate handoff while answering unaffected parts.

An available tool should not become a mandate to call a model repeatedly. Deterministic routing for common intents, followed by bounded tool use where needed, is a sensible starting point. Recheck volatile values and withdrawn sources on each relevant turn. Conversation history is not a source of authority for old prices or offers.

For document retrieval, implement **full-text plus vector search**, combine rankings, deduplicate by source/version, and optionally rerank a bounded candidate set. Native Postgres full-text ranking is not BM25; begin with the built-in capability and add a separate BM25 implementation only if evaluation demonstrates a need. Supabase documents hybrid retrieval and reciprocal rank fusion. [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search).

Chunk by document structure: section headings, FAQ pairs, policy clauses, and table rows with their headers. The current newer ingestion recipe splits losslessly at 4,096 UTF-8 bytes; that preserves text but can split meaning. Keep the original lossless extraction and derive a separate retrieval representation with page/section references. For difficult documents, test short contextual labels before embeddings and test reranking against a baseline. Published vendor benchmark gains should not be assumed to transfer to oneClick. [Contextual retrieval research](https://www.anthropic.com/engineering/contextual-retrieval).

Apply ownership, audience, source-purpose, active-version, and validity restrictions to both lexical and vector candidates. Rank relevance only among eligible evidence. A high similarity score must not override an expired offer or turn a competitor fact into a community claim.

## Image and file storage

**Use Supabase Storage as the default canonical store for the community's owned, licensed, or generated original files. Keep metadata and relationships in Postgres. Make selected representations searchable.** Supabase Storage and pgvector are different parts of that design.

An image embedding is a numeric search representation. It is not the image, an authoritative description, or a replacement for passing the actual selected image to a multimodal model.

For each image, retain:

- The immutable original and content hash, plus optimized renditions, dimensions, aspect ratio, and focal point.
- A stable asset ID and explicit links to its community, floorplan, brand role, or campaign.
- A reviewed or confidence-labelled caption, useful tags, and OCR where relevant.
- Whether it is actual property photography, a rendering, an AI-generated concept, a brand reference, or a competitor asset.
- Approval, permitted channels, source/license information, replacement state, and usage history.

Start by embedding captions and descriptions with the text retrieval model. Structured filters can already answer “approved landscape pool photo suitable for a homepage.” Add a separate multimodal embedding index if evaluation shows a need for visual similarity, composition, or aesthetic matching. Multimodal models can represent text and images for cross-modal search, but they require compatible query and document encoders. [Cohere multimodal embeddings](https://docs.cohere.com/docs/multimodal-embeddings).

The current `content_assets.embedding` is `vector(512)`. It cannot accept the existing 1,536-dimensional text embeddings. Add explicitly versioned text and visual representations rather than silently changing the meaning of that column. Even equal-sized vectors from unrelated models are not interchangeable.

Before embedding the media library, reconcile its existing approval and identity fields. The live curation state is 9 approved and 5 needing review; broader approval fields are not interchangeable with curation approval. Populate stable bucket/key/hash references where recoverable, bind website delivery assets to source versions where a real relationship exists, and retain external-only references honestly. Copying every externally crawled image into the owned asset library would blur provenance and reuse permissions.

The final live check found **81 of 224 website assets already linked to library assets**, with no missing parent or wrong-property link among those 81. Preserve and validate these relationships; do not rebuild them as though all website assets were unlinked. The remaining rows require source-aware reconciliation, not automatic classification as errors.

For logos, retrieve the approved logo variant by exact role and ID. Supply the actual SVG/PNG and brand contract to generation. For floorplans, use the approved drawing plus reviewed structured dimensions and room counts. A visually similar floorplan is not a substitute for the correct plan. Any generated illustration stays labelled as a concept and does not establish architectural facts.

There is a concrete exception to the current package's exact-identity behavior: [source assembly](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/source.ts:62) associates an asset when **either** its ID matches the plan's asset ID **or** its URL matches the plan's legacy URL. When these identify different approved assets, both enter the manifest with the same plan ID. An isolated execution reproduced this with current/old drawings; the existing source tests only exercise an old URL without a matching second approved asset. Make explicit asset ID authoritative in every association, permit legacy URL resolution only when that ID is absent, and reject ambiguous legacy matches. The 23:14 UTC live query found zero currently eligible conflicting combinations, so this is a reproduced code defect rather than an observed production drawing substitution.

The current support boundaries and upload-to-generation incompatibilities are documented in the [ingestion matrix](/Users/jasjitgill/oneClick/docs/REAL_ESTATE_MARKETING_PLATFORM_AND_INGESTION_REVIEW_2026_10_13.md). Do not interpret this target architecture as confirmation that all file types already work. In particular, the current PDF extractor has no OCR, and the actual live bucket rejects video types accepted by the generic library validator.

Keep private originals and draft results private; expose deliberate publication renditions for websites and social distribution. Existing public `brand-assets`, `content-assets`, and `property-assets` buckets may be appropriate for published media, but their URLs grant download access independent of a row's approval flag. Migrate URLs carefully so existing sites continue working. [Supabase bucket access models](https://supabase.com/docs/guides/storage/buckets/fundamentals).

**Private downloads need an explicit revocation contract.** Supabase signed URLs use a separate signing key and are unaffected by Auth key revocation. Its Smart CDN documentation also says a cached signed response can outlive token expiry. Membership checks when issuing a URL therefore cannot guarantee that an existing URL immediately stops working. [Signed URL behavior](https://supabase.com/docs/guides/storage/serving/downloads), [signed URL caching](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

For restricted internal originals and portfolio bundles, prefer an authenticated download service that rechecks current community permissions on each request, streams authorized bytes without public caching, and does not redirect the browser to a reusable bearer URL. Large-file/range delivery must preserve those checks. Existing short-lived links can serve use cases that explicitly accept their access window; current [editor attachment signing](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/editor/attachments.ts) uses 15 minutes. Do not delete canonical originals as an access-revocation mechanism. Already delivered bytes cannot be recalled; define and test cancellation/propagation behavior for in-flight operations as well as subsequent requests.

Use the storage bucket/key and asset version as permanent identity; generate temporary URLs when needed. Retain portability through the existing storage service rather than embedding vendor-specific URLs everywhere. An S3-compatible store, dedicated image CDN, or media platform becomes an option if measured egress, transformation, or video requirements justify it. There is no evidence here that moving current originals would improve the brain.

Include object backup/export and restore testing. Supabase's database backups contain storage metadata but do **not** back up the stored file objects themselves. [Supabase backup scope](https://supabase.com/docs/guides/platform/backups).

## How approved work feeds back

Approved work should update memory automatically within the scope of that approval. It should not require a second routine “send to KB” action. The update must distinguish what the approval actually establishes.

| Approved result | What becomes reusable | What does not follow automatically |
| --- | --- | --- |
| Brand contract or logo | Current brand decision, tokens, voice, exact approved assets | Property amenities or factual claims inferred from creative wording |
| Website copy or social post | Approved expression, topic, format, and source-linked claims | Every sentence becoming an independent factual source |
| New floorplan record | Approved structured specifications and linked drawing | Availability or pricing staying current indefinitely |
| Crawled external page | Dated external evidence and any separately accepted claims | Permission to overwrite a reviewed community fact |
| Generated photo | Reusable approved creative asset with generated status | Proof that the pictured amenity exists |
| Campaign performance | Dated measured observations with metric definitions | Proof that a creative choice caused the result |
| Reviewed insight | A hypothesis or learning with scope, evidence, and limits | A permanent rule that overrides later evidence |

The feedback sequence should be: save the exact output version; record its approval scope; write a durable update event in the same transaction; update relevant structured projections; index eligible text/assets; invalidate dependent cached context; and identify previously generated material affected by changed facts or assets.

A change to approved creative wording can become reusable immediately. A new factual assertion inside that wording needs supporting evidence or an explicit fact decision. Existing supported claims should point back to the original fact versions instead of creating copies of those facts.

Prevent circular confirmation. If oneClick generates a page, later crawls that page, and generates social copy from it, those are descendants of the original source. They are not three independent confirmations. Track origin, parent artifact, source versions, and content hashes; deduplicate descendants during retrieval and keep generated descendants out of evidence used to revalidate their own ancestors.

A practical example: a verified pet-policy change creates a new policy version. The chatbot receives the current rule. Related FAQ and ad drafts are flagged for revision. Their previously approved wording remains in history but is no longer eligible to answer the current policy question. Updating the knowledge index does not silently republish those websites or advertisements.

This is retrieval and decision-memory improvement. It does not require training a separate model for each community. Fine-tuning could later improve a stable output style, but it is a poor default mechanism for frequently changing prices, inventory, permissions, and sources.

## Ingestion and continuous updates

Use a durable event and job pipeline with adapters for uploads, crawls, property edits, brand approvals, generated outputs, and metrics imports. Preserve the platform's existing request IDs, claims, receipts, revision checks, and shared action history. Choose one authoritative queue mechanism rather than maintaining overlapping job systems for the same operation.

The pipeline should:

1. Capture the original and source identity.
2. Detect changed content using hashes and supported conditional HTTP requests.
3. Extract text, OCR, visual descriptions, or typed observations as appropriate.
4. Propose changes with source citations and conflict detection.
5. Apply the configured source and approval policy.
6. Build indexes asynchronously for the exact eligible version.
7. Switch the active version atomically when required projections are ready.
8. Invalidate affected context and expose lag or errors to operators.

Use idempotency keys such as source version plus extraction/embedding recipe. Retries must not duplicate chunks, approvals, or paid calls unnecessarily. If a provider outcome is uncertain, reconcile its retained receipt before starting replacement work. Support retries with backoff, explicit terminal failures, cancellation, and per-community budgets. A failed extraction must not partially replace the last usable publication.

For monitoring, separate “checked successfully and unchanged” from “changed and awaiting review.” Track last attempted check, last successful observation, last content change, last approved version, and next due check. Schedule by risk and source capability: volatile inventory may need webhooks or frequent pulls; stable brand documents generally need updates when edited. Cadences must match the provider's actual freshness and limits.

Supabase documents an asynchronous embedding pattern using database events, queues, and workers. Supabase Queues is a viable option if the existing shared jobs/outbox are insufficient; `pgmq`, `pg_cron`, and `pg_net` were not installed in the inspected project, so that native pipeline is not already present. Existing external schedules can still run jobs. [Automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings), [Supabase Queues](https://supabase.com/docs/guides/queues).

Use a separate worker process for substantial crawling, OCR, image processing, and video. Keep request handlers short. Supabase Edge Functions have bounded CPU, memory, and execution time, so they should not be selected by default for every media workload. The existing data-engine service offers a starting point. [Edge Function limits](https://supabase.com/docs/guides/functions/limits).

## Performance data and learning

Query numeric performance through the existing analytics layer. Keep property, provider, account, campaign/ad/creative IDs, date range, timezone, currency, attribution method, metric definition, observation time, and completeness. Calculate totals and ratios deterministically. Vector similarity cannot reliably answer how much was spent or whether cost per qualified tour changed.

Link generated creative IDs to platform ad/post IDs and subsequently to observations. Otherwise, the platform can remember that performance improved without knowing which approved creative was used. Preserve the distinction between platform-reported conversions, recorded tours, and verified business outcomes.

Store a learning as a scoped, revisable claim: for example, a pool-focused creative had a lower observed cost per qualified tour during a particular period, audience, and spend level. Include the comparator and sample size. Label observational associations and controlled experiment results differently. Do not let a high click-through rate rewrite brand rules or become evidence of improved lease conversion.

The newer intelligence workspace already separates recommendation, implementation, measurement, and experiment evidence. The uncommitted reporting work adds source/account grouping, snapshot semantics, explicit attribution models, outcome deduplication, and incomplete-data handling. Reuse these functions in the shared context service. Attribution coverage is coverage of the provided export, not proof of coverage of every lease. Funnel ratios compare separately observed stages and do not prove person-level conversion or causality.

The live 43 marketing rows contain no missing or negative core measures, but all lack currency and the newest is from December 2025. The incomplete-row protection therefore solves a real class of future errors, not an observed missing-measure defect in this sample. Existing `buildBiReport` already withholds spend when currency is unconfirmed, with an explicit exception for zero-spend GA4 observations; keep that behavior. Do not fill currency or missing recent dates by inference. Recent ad-sync snapshots are not proof that current marketing facts were successfully delivered. Verify source accounts, fetch outcomes, metric definitions, reporting windows, and feed completeness before using these records to drive creative learning. See [report calculation rules](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/analytics/report-data.ts:43).

The final source check identified a specific legacy failure mode: [the runner](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/run_pipelines.py:131) records Google import success whenever the inner function returns normally, even though that function returns early on missing credentials, fetch failure or no data. Its `records` field stays zero. Separately, [account lookup](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/pipelines/google_ads.py:74) converts a database exception to `[]`, which the caller can treat as permission to use the environment-based property/account fallback. Isolated executions reproduced both behaviors. They do not prove the legacy runner is deployed or that it has misattributed live rows.

The [tracked importer](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/pipelines/mcp_marketing_sync.py:92) instead scopes accounts to the requested property, records channel outcomes, confirms stored row counts, and updates account freshness after confirmed writes. The untracked bulk HTTP endpoint is disabled. Reuse these stronger semantics and retire or align any active legacy scheduler. The live fact uniqueness key already includes community, provider channel, account, campaign and day; preserve it. Require per-account/window coverage receipts with failed, incomplete, complete-empty and complete-with-data states. A successful job or a complete read of stored rows does not prove all expected provider pages/accounts/dates arrived. The current reporting layer intentionally accepts only confirmed USD spend (plus its GA4 zero-spend exception); currency conversion is additional work, not an existing mixed-currency aggregation feature.

The intelligence document table is empty, so activating its reviewed imports and sources is part of rollout even though its database functions are installed. Portfolio learning should use permitted aggregate patterns, with tenant boundaries preserved; another community's private copy or data must not silently become this community's memory.

## Scaling to hundreds of communities

Use shared tables with enforced organization/community scope as the default starting point, conditional on the release gates below. A separately trained model is unnecessary; the same model can serve independently scoped requests. Separately credentialed community infrastructure is justified when the required compromise-containment, residency or contractual boundary demands it, or measured workloads warrant it.

Index the structured filters used by retrieval and access checks. **Prefer exact distance search over eligible community rows at the current corpus size.** The existing competitor index has 100 IVFFlat lists but only 106 populated vectors; establish an exact-search baseline and inspect plans before retaining or replacing it. No latency or recall failure was measured in this audit.

pgvector's guidance explicitly distinguishes a shared approximate index from tenant-specific indexing: other tenants' vectors can affect recall and speed, and filtering after approximate candidate selection can leave too few results. Iterative scans, available in the live 0.8.0 version, mitigate this but stop at configured limits. When approximate search is justified, benchmark community list partitions with separate indexes against exact search, especially for small communities beside large ones. This provides independent candidate indexes within the same Postgres database; it does not establish authorization or isolate a broad service credential. [pgvector filtering and multitenancy](https://github.com/pgvector/pgvector#filtering).

Avoid creating hundreds of partitions solely because hundreds of communities exist. Measure pruning, planning and maintenance costs against representative single-community and portfolio queries; PostgreSQL documents the tradeoffs. [PostgreSQL 17 partitioning](https://www.postgresql.org/docs/17/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE-BEST-PRACTICES).

Illustrative sizing, not a forecast or benchmark:

| Assumption | Result before indexes, metadata, originals, backups, and replicas |
| --- | --- |
| 300 communities × 1,000 text chunks × 1,536 float32 values | 300,000 vectors; about 1.84 GB of numeric payload |
| 500 communities × 2,000 text chunks × 1,536 float32 values | 1 million vectors; about 6.14 GB of numeric payload |
| 300 communities × 500 image originals × 4 MB | About 600 GB of original images |

The number of communities alone is not a useful capacity estimate. Per-community corpus size, retrieval concurrency, update rate, index memory, and media delivery are decisive. Size workers, storage, database compute, and budgets from a representative workload replay. Images, repeated generation, OCR, crawling, and egress may matter more financially than text embeddings; measure each separately.

Cache stable context by organization, community, audience/permissions, purpose, policy revision, and source revision. Scope query-embedding and retrieval caches containing community queries to the same community. Re-embed changed chunks only. Do not put current availability behind a long-lived generic prompt cache. Keep analytics scans and bulk ingestion from starving chat requests; use bounded work queues and database connection pooling.

Monitor p50/p95/p99 context latency, database query time, retrieval recall, empty-result rate, publication-to-search lag, overdue sources, queue age, provider failures, media delivery costs, and spend per community. Explicitly test a large community next to many small ones.

## Tenant access and source trust

### Current enforcement does not yet establish strict community isolation

A fresh read-only live catalog check at **23:02 UTC on October 13** confirmed RLS is enabled for `documents`, `competitor_content_chunks`, `content_assets`, and `knowledge_sources`, but their user policies authorize by organization membership rather than assigned-community access. The shared `validatePropertyAccess` helper likewise checks organization ownership. An operator may legitimately manage multiple communities, but that permission must not make every community's knowledge eligible for a task concerning just one. This is an enforcement gap against the newly explicit requirement, not evidence that a particular response leaked data.

The live competitor search accepts `filter_property_id = NULL`, which broadens search to rows available to the caller. It is a security-invoker function and does not itself bypass RLS. The general document search requires a property but is a definer function callable only by `postgres` and `service_role`; it does not establish the end user's property authority. Both need to participate in the same mandatory, server-bound community contract. Requiring an arbitrary caller-supplied property ID is insufficient authorization.

The 23:09–23:10 UTC catalog/row check found ID-only foreign keys for floorplan-to-asset, asset-to-source/duplicate/replacement, and job-to-context relationships; `website_assets.source_asset_id` has no foreign key. Selected import functions and domain triggers already validate ownership, including floorplan import and asset replacement checks. These are valuable, but not a universal invariant across writers. All 14 library assets and 40 unit records had matching organization/property ownership; the one linked plan used an approved floorplan asset; 81 website asset links and 1,659 job/context links had no checked owner mismatch. There were no populated asset source/duplicate/replacement links to exercise. Add missing ownership constraints or equivalent database validation without discarding the guards already installed.

The live `property-assets`, `content-assets`, and `brand-assets` buckets are public; `knowledge-originals` is private. Existing public files must be classified as public delivery artifacts or migrated to private storage with deliberate URL replacement. A private metadata row cannot revoke a public object URL. Public website files will necessarily be downloadable; public delivery does not make them eligible as another community's private KB evidence. [Supabase storage access](https://supabase.com/docs/guides/storage/buckets/fundamentals).

### Required boundaries

The invariant for ordinary community work is: **the authorized request community, job community, source owner, related asset/fact owner, output owner, and writeback destination must match.** The described subject may be an explicitly labelled competitor, but its evidence owner remains the requesting community. Unknown ownership blocks serving or publication.

| Boundary | Required enforcement |
| --- | --- |
| Request and identity | Resolve actor, community, audience, and purpose on the server. Bind public chat to the widget's approved community/public corpus. Reject missing, conflicting, or unauthorized scope. A model's tool argument, uploaded metadata, or retrieved instruction cannot change that binding. |
| Database access | Use community-aware membership/capability checks and RLS for ordinary reads/writes, plus operation-specific grants. Review all permissive policies so an older organization-wide policy cannot reopen access. Test tables, RPCs, views and exports directly, not just UI routes. |
| Relational integrity | Require community ownership on source versions, chunks, assets, generations and derived records. Use composite ownership constraints, or equivalent database validation, to prevent an asset/source from another community being attached through a valid foreign ID. Validate existing rows before enforcing new constraints; quarantine ambiguous records. |
| Privileged execution | Remove general-purpose service-role access from routine generation/retrieval where practical. Use a constrained execution identity or narrowly exposed, authorization-checking operation. Administrative maintenance remains separately privileged and audited. Workers must validate a saved, immutable community/job binding before reading, claiming and committing work. |
| Retrieval | Apply community, audience, source-purpose and validity restrictions in the database access path for lexical, vector, exact and fallback lookups. Never load a global candidate pool into an agent and rely on instructions to discard other communities. No missing-scope or empty-result fallback may widen the search. Recheck returned ownership before constructing the context. |
| Files and media | Use private originals with authorized downloads. Bind upload destinations, asset IDs, extraction results and generator file handles to the community. Approve public renditions explicitly. Storage paths containing a community ID are naming conventions until access policy verifies them. |
| Agent state and caches | Separate community conversations, memory, model-provider threads/file stores, temporary workspaces, retrieval results and generated artifacts by community. Internal portfolio sessions use a distinct scope containing their authorized community set and permissions; they cannot be reused as community generation sessions. Include scope, audience/permission and policy/source revisions in cache identities. Reset pooled execution context; a caller-editable context variable alone is not an authorization boundary. |
| Events and integrations | Scope job IDs, deduplication keys, source-provider IDs and account bindings by community. Verify webhook/provider ownership from saved bindings. Retries, late callbacks and restores cannot choose a new destination from an untrusted payload. Keep traces and exports under equivalent access controls. |
| Approval and writeback | Check the entire source manifest and current eligibility before generation handoff, approval and publication. Approved outputs update only their own community. A wrong-owner dependency blocks the operation even if an administrator can access both communities. |

RLS and grants are complementary; a broadly privileged service role bypasses RLS. Database enforcement must therefore include the actual execution identity, not just the presence of policies. Supabase recommends testing allowed and denied operations for the roles exposed by the application. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Internal portfolio assistance is a separate, explicitly authorized capability. It may return permitted facts, source excerpts, exact assets and collated insights to an authorized operator, as specified below. Its combined context must not become a community generation session or feed raw evidence into a community KB. Private community examples and learned preferences are not a global shared training/retrieval corpus. Independently maintained platform templates can be shared without incorporating another community's private data.

### Fidelity within the community

Isolation prevents the wrong owner's data entering the workflow. Fidelity also requires the correct subject, source, version and meaning. Preserve immutable originals, exact asset IDs, extraction/page evidence, typed units/currency, effective dates, review decisions and source hashes. Conflicting or uncertain facts stay explicit; critical facts such as pricing and floorplan identity use reviewed structured records. Generated summaries retain lineage and never become independent corroboration of their own source. Missing eligible evidence yields an unknown/held result rather than a guess or another community's content.

Source fidelity and output fidelity are distinct acceptance checks. The package [archive validator](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/archive.ts) verifies source inclusion, floorplan identifiers and artifact contracts; that alone does not establish that generated visible prices, bedroom counts, amenity claims or drawing associations match the source. Render critical numerical fields and plan-to-drawing mappings from reviewed records where possible. Check actual rendered output against those records, retain claim-to-source links, and use human review for uncertain extraction and unsupported prose. A model-written citation or build report is not independent proof of factual correctness.

### Model-provider state is part of the boundary

The current [SiteForge package runner](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/runner.ts:68) uploads a source ZIP with a one-day file expiry, requests background responses with `store: true`, and may reuse a response/container for repair. It deletes the input file after a ready package on a best-effort basis. The initial container has network access disabled, which is a useful existing control. Input-file expiry/deletion does not itself account for every response, output and container lifecycle.

OpenAI says API data is not used for training by default, but storage is a separate question: stored Responses ordinarily retain application state for at least 30 days, subject to the documented account controls and exceptions. Files and hosted containers have their own lifecycle. Actual account retention settings were not inspected, and `store: false` alone would not establish a universal zero-retention promise. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Bind every provider file, response, conversation and container identifier to its community/job or explicit internal portfolio scope. Validate that binding before reuse or download; never pool a portfolio conversation into community generation. Record the selected provider's retention configuration, expiries, deletion attempts and reconciliation outcome. Recheck source eligibility and user access before model dispatch and final release; invalidate or cancel affected pending work after withdrawal. This extends the same isolation contract to providers rather than assuming all relevant state stays in Supabase.

### Shared storage versus physical separation

Shared Postgres can enforce community-scoped access, but a project-wide administrator or compromised broad service credential remains a shared trust boundary. A separate vector collection, table, schema, partition, or bucket does not remove that boundary if the same credential can reach all of them.

If the required threat model includes containing a compromised privileged community worker, use separately credentialed community data environments—potentially separate Supabase projects covering facts, vectors and private assets—with workers that receive access only to the selected community. This reduces the reach of such a compromise, while increasing provisioning, migration, backup and monitoring work. Shared control-plane administrators and routing still require protection; physical separation does not excuse application checks or source-fidelity tests.

Accordingly, retain Supabase as the stack, make strict scoped access mandatory, and keep community data routing capable of selecting an isolated environment. Choose shared versus dedicated deployment against an explicit threat model before rollout. Do not claim that a shared service key plus a `property_id` filter achieves the strongest isolation level.

### Release gate

Run database and end-to-end denial tests with two communities in the same organization and one in another organization, using deliberately distinct facts and assets. Cover authenticated clients, public widgets, workers and privileged operations; missing/forged community IDs; foreign source/asset references; cache hits after switching communities; reused model sessions; interrupted jobs and late callbacks; withdrawals; storage downloads; exports; and approval writeback. Verify both that unauthorized reads return no protected data and that unauthorized writes create no changes. Search must retain useful within-community recall without widening its scope.

Any cross-community access or contamination failure blocks rollout of the affected path. Record the denied operation with safe identifiers, alert the operator, and stop that path pending investigation. Repeat the isolation suite for every policy, retrieval, cache, worker or provider-binding change. The earlier 137 passing unit tests are not a substitute for this database/provider-boundary qualification, which has not been performed in this review.

For portfolio assistance, test permitted combined reads as well as denials: authorize A and B, request A/B/C, and verify that no protected C information reaches retrieval results, the model, caches, previews, exports or the answer. Show the accessible portion as partial rather than silently treating it as the whole portfolio; do not expose unauthorized community metadata. Revoke B mid-conversation and verify new turns, history reads, stored summaries and asset downloads enforce the changed access. Validate that portfolio context cannot be attached to an ordinary community generation job.

Treat crawled text, uploaded files, OCR, and retrieved passages as evidence data, never as instructions that can change tools or access scope. Keep provenance and document boundaries visible to the generator. Validate retrieved references and tool arguments independently of model text.

The security advisor returned informational notices for RLS tables without policies, including the service-only intelligence tables. No-policy RLS can intentionally deny direct client access; it is not by itself proof of exposure. The advisor also returned broader warnings for an extension in `public`, an authenticated-executable definer function, and leaked-password protection. These warrant separate review and do not change the architecture recommendation. [No-policy explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [definer-function review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Internal portfolio assistant

Provide one internal conversational entry point for cross-community research, asset retrieval and performance analysis. It uses the same source-of-truth services as community products, with explicit permission to gather results from several communities. A single coordinating LLM is sufficient initially; additional agents are optional implementation choices, not required for community isolation.

### Resolve scope and capabilities before retrieving

The server authenticates the staff member and resolves the requested community names into an authorized set. Allow a deliberately granted all-portfolio staff role and narrower assigned-community roles; being labelled internal does not by itself grant every permission. Check both community access and the requested operation, such as reading knowledge, viewing assets, downloading originals, or reading campaign metrics. Raw lead details require separate access and are unnecessary for ordinary portfolio summaries.

Show the selected communities and reporting period in the interface. Requests such as “these communities” inherit the visible selection; “all my communities” expands only to the caller's authorized set. Clarify ambiguous names instead of guessing. If a named selection cannot be fully served, provide the authorized portion with an explicit coverage limitation and no unauthorized metadata. Sensitive reads recheck access before returning the response or issuing an asset download.

For an ordinary task, the allowed set contains one community. For a portfolio task, the parent request contains the authorized set, and each underlying source read remains community-bound. This can use constrained set-based queries on shared Postgres or bounded parallel reads through dedicated community environments. The same permission contract applies to both deployment options. The model receives scoped tools, not project-wide database credentials or an unrestricted SQL interface.

Read-only database tools do not eliminate disclosure through other channels. Give this private-data assistant narrowly defined retrieval/calculation tools; do not attach unrestricted web requests, third-party exports or messaging to the same context. If public research is needed, use a separate public-research task with only the explicitly permitted query information. Validate citation and asset IDs server-side, and prevent model-written remote image URLs or active HTML from causing automatic outbound requests in the answer renderer. This is an architectural application of environment and egress controls, not a claim that prompt instructions alone contain an agent. [Anthropic's containment guidance](https://www.anthropic.com/engineering/how-we-contain-claude).

### Choose retrieval according to the question

| Team request | Retrieval and computation | Response |
| --- | --- | --- |
| “Find the floorplans for A, B and C.” | Query each community's structured plans and exact linked assets. Resolve the requested current/approved version, then authorize previews or downloads. | Grouped plan cards with community, plan name, verified specifications, image/PDF preview, source version and download action. Report missing drawings or unverified links; never substitute a similar plan. An optional download bundle retains per-community folders and a source manifest. |
| “How are campaigns across X, Y and Z doing?” | Read structured campaign facts for a defined period and comparable accounts/channels. Compute totals, changes and rates in the reporting layer. | A comparison table, source dates and coverage, concise observations, and evidence-backed recommendations. Separate currency/attribution definitions and distinguish channel-reported conversions from verified tours or leases. |
| “Which communities have approved pet amenities?” | Read reviewed structured facts first, then retrieve eligible supporting documents within each requested community. | A source-cited list with effective/review dates, conflicting evidence and unknowns. Missing evidence is not a negative fact. |
| “Show approved pool photos across these communities.” | Search authorized asset metadata/captions, with optional compatible visual retrieval; retain source asset IDs and community ownership. | Community-labelled previews and access-controlled files. Seeing an asset in this assistant does not approve its use for a different property. |
| “What patterns or opportunities do you see?” | Assemble comparable structured measures and relevant, community-labelled evidence. Evaluate data coverage and distinguish observations from hypotheses. | Collated insights with supporting communities, limitations, and suggested next investigations. No unsupported causal claims or automatic operational changes. |

For comparisons, compute aggregate rates from compatible numerators and denominators rather than averaging community percentages. Keep different currencies separate unless an explicit conversion basis is supplied. Account for reporting windows, timezones, late-arriving conversions, duplicate identities and snapshot/event semantics. Preserve per-community rows even when an overall total is available so the explanation cannot obscure which community contributed a result.

For document/asset discovery, avoid a single global top-k that silently excludes smaller communities. Use per-community retrieval budgets or coverage checks, paginate complete inventory requests, and report which communities were searched successfully. Distinguish zero matching assets from failed, incomplete or unavailable retrieval. Broad portfolio work should run as a bounded job with progress and an explicit coverage manifest.

### Preserve provenance through synthesis and storage

Every tool result includes community ID/name, record or asset ID, source version, source/observation dates, retrieval time, and eligibility limitations. Each material factual claim in the answer links to its supporting evidence. Generated recommendations are labelled as recommendations and retain their measured basis. Calculations and evidence selection are inspectable independently of the LLM's prose.

Store the conversation, saved report or asset collection under an internal portfolio scope, retaining its contributing community set and permissions. A saved portfolio answer inherits the access requirements of its source material. Recheck those requirements when reopened or shared; do not rely only on the creator's access at generation time. If access shrinks, withhold or regenerate affected combined summaries and start the next model call with an authorized context. Removing citations while retaining restricted facts in prose is insufficient. Previously downloaded or already viewed information cannot be recalled. Apply the authenticated download and outstanding-link limitations in “Image and file storage”; an authorization check when creating a signed URL does not guarantee later revocation of that URL.

Cache identities include the actor or equivalent permission scope, resolved community set, audience, filters, date window, source revisions and policy revision. Shared internal sessions and exports require authorization for all included material. Community generators never inherit the master assistant's conversation memory or its combined evidence package.

The first version is a read-only assistant capable of finding, comparing and retrieving. If a user later requests changes, split the request into separately scoped community proposals, rebuild each proposal's source bundle, and apply that product's approval/execution rules. An internal cross-community answer never automatically becomes accepted community knowledge.

### Reuse in the current codebase

The local [portfolio reader](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/portfolio.ts) already combines per-community marketing facts, reviewed observations, delivery evidence and benchmark calculations. It processes communities in groups of five and rechecks access before returning. The staff path currently selects organization properties, the client path uses assigned scope, and the interface supports an optional single property rather than an arbitrary selected set. Extend it with explicit staff capabilities, selected community sets, pagination and typed evidence results. Its current 100-property cap must become visible batching/coverage behavior for larger portfolios, not silent omission.

Reuse the [asset packaging foundation](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/source.ts) after repairing the explicit-ID/legacy-URL conflict, together with the [reporting semantics](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/reporting.ts) and community source contracts. Add portfolio tools around those services instead of a second global KB or a duplicate metric implementation. The generic [legacy chat route](/Users/jasjitgill/oneClick/p11-platform/apps/web/app/api/chat/route.ts) currently returns HTTP 410; this sweep does not establish an existing working master assistant. Build an explicitly internal entry point with its own permission and conversation boundaries.

## Alternatives considered

| Option | Where it helps | Decision for oneClick |
| --- | --- | --- |
| Expand the existing prompt | Small stable facts, low complexity, easy review | Retain for a bounded core profile; insufficient as the whole brain. |
| Supabase Postgres with pgvector and object storage | Relational truth, approval transactions, source joins, permissions, semantic search in the current stack | Recommended default. |
| Dedicated vector service | Independent retrieval scaling, specialized indexing, very large or uneven workloads | Reconsider when representative benchmarks show Postgres retrieval harms latency/cost or core transactions. It would still be a derived index. |
| Supabase Vector Buckets | A separate vector-storage option for large collections | Current docs label it alpha. Avoid making it the critical serving dependency now. |
| Knowledge graph or GraphRAG | Complex entity relationships and corpus-wide synthesis | Begin with explicit relational links and lineage. Add graph retrieval only for demonstrated questions that joins and hybrid search cannot answer well. |
| Per-community fine-tuning | Potentially stable tone or formatting after sufficient examples | Defer. It does not solve source freshness, exact assets, or permissions. |
| Vendor-hosted retrieval as the master KB | Fast prototypes and reduced index operations | Poor default for this platform's cross-product structured data, exact source manifests, and media governance. Could serve a bounded secondary use case. |

Pinecone documents tenant namespaces, and Qdrant documents multitenancy and tiered isolation; they are credible alternatives if measured retrieval requirements justify a move. Keep a retriever interface and source IDs that permit migration without moving canonical truth. [Pinecone multitenancy](https://docs.pinecone.io/guides/index-data/implement-multitenancy), [Qdrant multitenancy](https://qdrant.tech/documentation/manage-data/multitenancy/).

Supabase distinguishes Vector Buckets from ordinary file storage and pgvector and currently marks the feature alpha. [Vector Buckets](https://supabase.com/docs/guides/storage/vector/introduction). Microsoft's GraphRAG adds graph extraction, community hierarchies, and summaries. Those are useful additional processing stages, not prerequisites for a community-specific information service. [GraphRAG architecture](https://microsoft.github.io/graphrag/).

## Migration sequence

### Gate 0 Enforce and prove community isolation

Adopt the mandatory community contract above across the database, retrieval, assets, caches, agent state and workers. Reconcile organization-wide legacy permissions, constrain privileged paths, and validate ownership links. Run direct-database and end-to-end isolation tests before enabling new shared-context serving or broader automation. Source fidelity and isolation take precedence over corpus recall and generation availability. This gate does not authorize changes to live access policies without implementing and verifying a compatible migration.

Include the explicitly authorized internal portfolio capability in the access model: allow permitted A/B comparisons and asset retrieval while denying unauthorized C access and all implicit cross-community writeback. After this gate, deliver the internal assistant first with exact floorplan retrieval and deterministic campaign comparisons, then add broader evidence synthesis.

### Phase 1 Establish the shared truth and baseline

Map every generation entry point to its current data sources and deployed version. Inventory all three vector-bearing tables, the 571 general/competitor rows, and their canonical source/asset records. Classify by subject, authority, audience, allowed use, freshness, and provenance quality. Separate the 9 general-document media references from text evidence. Reconcile the 312 capture-less competitor chunks, old unit pricing summaries, brand copies, duplicate text, and asset references before any embedding backfill. Preserve unknown provenance as unknown. Verify the live catalog when a migration or old document disagrees with it. Establish a common context bundle and migrate one product adapter at a time.

Immediately prevent competitor and unclassified internal evidence from becoming public property claims, including during assistant facts draft construction. Retain exact brand and floorplan bindings. Review property assignment policies and privileges. Add the property/source filter indexes justified by the selected schema and evaluate the existing competitor IVFFlat index. Build a small representative evaluation set before replacing serving behavior.

Repair the confirmed upload/bucket mismatch and inconsistent upload/package limits. Define selected renditions and a common file capability contract. Converge floorplan image linking with reviewed unit facts; retain brand-source originals. Include basic scanned-document and PDF-floorplan processing in the pilot scope.

**Exit condition:** every tested source has a known use policy, and the same fact resolves consistently across the chatbot, social generator, and site source bundle.

### Phase 2 Deliver one complete community workflow

Adopt the installed reviewed-facts, materials, unit-review, and competitive-review workflows for a pilot community; do not recreate their tables and decision functions. Add structured inventory tools, hybrid document retrieval, and generation source manifests, extending existing context snapshots. Keep a source-policy-safe compatibility path behind a controlled rollback switch while comparing outputs offline or in shadow mode; rollback must not re-enable excluded evidence. Seed media descriptions and exact asset links.

**Exit condition:** upload a document, scanned brochure, floorplan, logo, and photos; review the proposed facts and asset links; demonstrate that a relevant chatbot answer, social draft, and site source package use the exact approved versions. Revoke a source and verify all three stop using it. Tie the outputs to a shared marketing initiative and demonstrate one qualified channel's confirmed delivery and an inspectable outcome trail, including any missing outcome evidence.

### Phase 3 Automate approved feedback and source monitoring

Use transactional update events for every relevant approval and source edit. Build continuous observation scheduling, deduplication, conditional recrawls, bounded retries, and queue visibility. Approved generated copy becomes reusable creative memory; supported facts keep their original lineage. Changed facts identify downstream content needing revision.

**Exit condition:** worker interruptions and retries do not duplicate work or publish partial updates; unchanged websites can be rechecked repeatedly; a replaced logo identifies every dependent artifact.

### Phase 4 Add visual retrieval and measured learning

Extend the foundational OCR introduced in the pilot and add selective multimodal retrieval after assessing text/metadata search. Connect creative IDs to campaign and social measurements. Adopt the existing recommendation/experiment record semantics and qualify broader actions and media-spend controls before autonomous optimization. Run load tests using representative tenant sizes and concurrency, then tune exact search, HNSW, partitioning, and worker capacity as indicated.

**Exit condition:** demonstrate a source-to-creative-to-outcome chain, measure retrieval and response quality, and meet agreed latency/freshness/cost targets at the intended workload.

A sensible first implementation slice is the common context contract plus the competitor/authority filters and one end-to-end pilot. Starting with a database migration to another vendor, a universal graph extraction pipeline, or per-community model training would delay the more consequential work.

## Evaluation and rollout criteria

Build a versioned test set across real source formats and community types. Include exact plan names, numerical questions, paraphrases, ambiguous requests, stale offers, missing data, conflicting sources, competitor facts, same-organization restricted properties, scanned brochures, and generated imagery.

Measure retrieval and generation separately. Retrieval needs relevant-source recall, precision, correct subject, and valid versions. Generation needs factual support, numerical accuracy, appropriate abstention, brand adherence, and correct asset selection. Frameworks such as Ragas can support automated assessment, but human review and deterministic checks remain necessary for critical facts and tenant isolation. [Ragas research](https://arxiv.org/abs/2309.15217).

Proposed acceptance criteria to agree before rollout:

- Zero cross-community or internal-to-public disclosure in the adversarial test suite; any failure blocks rollout.
- Zero expired offer, wrong-property amenity, or wrong-floorplan substitution in the critical regression set.
- An explicit floorplan asset ID wins even when its legacy URL points to a different approved asset; ambiguous URL-only matches are held for reconciliation.
- Complete source/version manifests for generated factual claims and used assets.
- Rendered critical facts and drawing mappings match reviewed records; source inclusion and model-authored citations alone do not pass this check.
- Membership revocation blocks subsequent authenticated private downloads and internal-history access, with documented outstanding-link, cache and in-flight limits. Provider state cannot be reused across incompatible scopes.
- Import failures, partial account coverage and valid empty reports remain distinguishable; no database/account lookup failure silently activates an environment-based ownership fallback.
- A selected relevant source appears in the retrieval candidates on at least 95% of the labelled retrieval cases; report per-category results and sample size.
- Provisional p95 context assembly below one second for chat, measured separately from answer generation; adjust against an actual product latency budget.
- Approved small text updates become searchable within a provisional two-minute target under the chosen load; heavy media has separate targets.
- Withdrawals immediately become ineligible at the serving layer even if asynchronous vector cleanup is still pending.
- Duplicate events, stale worker completions, index outages, and provider failures preserve the last safe usable state and surface specific errors.

These are proposed engineering targets, not observed results. The read-only assessment did not exercise paid generation, live writes, production load, or end-to-end browser behavior. The next phase should establish those measurements in an isolated test environment and a controlled pilot.

## Code areas for the implementation

| Responsibility | Existing implementation to extend |
| --- | --- |
| Shared context contract | [ForgeStudio context assembly](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/forgestudio/context-assembler.ts) and [business context bridge](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/substrate/business-context-bridge.ts) |
| Canonical supplemental facts | [Intelligence contracts](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/contracts.ts) and [canonical serving](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/store.ts:193) |
| Reviewed source lifecycle | [Knowledge material store](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/knowledge/material-store.ts), [file extraction](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/knowledge/file-extraction.ts), and [web policy store](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/knowledge/web-policy-store.ts) |
| Chatbot serving | [Chat route](/Users/jasjitgill/oneClick/p11-platform/apps/web/app/api/lumaleasing/chat/route.ts) and [facts context editor](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/services/chatbot-context-editor.ts) |
| Search and embeddings | [SiteForge KB utility](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/kb.ts), [chunk recipe](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/knowledge/material-model.ts), [competitor search](/Users/jasjitgill/oneClick/p11-platform/services/data-engine/scrapers/brand_intelligence.py:905), and live `match_documents` / `match_competitor_content` RPCs |
| File identity and reuse | [Asset storage service](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/storage/asset-service.ts), [image analysis](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/assets/image-analysis.ts), and [curation](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/assets/curation.ts) |
| Source manifests | [SiteForge package source](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/siteforge/packages/source.ts) and ForgeStudio's retained source records |
| Approved-output publication | [BrandForge publication](/Users/jasjitgill/oneClick/p11-platform/apps/web/app/api/brandforge/embed-to-kb/route.ts) and its transactional brand-operation migration |
| Performance evidence | [Intelligence evidence semantics](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/evidence.ts), [local reporting implementation](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/intelligence/reporting.ts), [record quality filter](/Users/jasjitgill/oneClick/p11-platform/apps/web/utils/analytics/report-quality.ts), existing marketing facts, and ForgeStudio measurement/attribution records |
