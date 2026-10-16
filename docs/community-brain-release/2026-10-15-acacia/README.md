# Acacia production adoption

This release includes the Community Brain implementation and the existing local analytics/reporting work recorded in the October 13 release manifest. It upgrades Acacia through an explicit, audited per-community switch. Other communities retain their reviewed legacy chat context until separately adopted.

## Reviewed Acacia data

- Production Supabase: `oneClick` / `lmjmutuggvzuadwreqxx`.
- Community: `2f0de51e-2b63-4b4a-80c8-29855647fed0`.
- Existing widget configuration: `46f678f9-2700-4b45-ab2e-d87a4102ae1a`; keep its credential and embed unchanged.
- Five reviewed sources establish community/contact details, features, FAQ caveats, the original Plan 2 drawing, and the operator's commercial-information hold. See `reviewed-sources.json` and `adoption.manifest.json`.
- **Availability, pricing and incentives are unconfirmed; refer visitors to sales.** Fresh official inventory and marketing pages conflict. The user explicitly selected this policy.
- Preserve all five legacy source rows and twenty legacy chunks. They are historical evidence, not approved public facts. Preserve the previous saved prompt, property fields and three unit rows in an immutable, private adoption receipt.
- Hold the three old unit records pending reconciliation. Withhold the unsupported property-level Spa amenity while preserving its original value in the adoption receipt. Do not assert a pool, fitness center or nearby business as an owned community amenity.
- The published Plan 2 PDF is an original master drawing. Homesite 5 is marked Reverse Plan; do not bind this drawing as its exact mirrored plan.
- Source review expires November 14, 2026. Renewal requires source review, not automatic approval of a crawl or generated content.

## Release protections

The nineteenth candidate migration records sticky chat adoption: pausing an adopted community withholds facts and never restores its old prompt. Model execution checks current release state and evidence before and after generation. Completed-answer retries also check current evidence. Matching conversation text alone no longer permits reuse of an older answer.

Migrated canonical facts reference their precise evidence. Source withdrawal or replacement immediately removes dependent facts. Public prompts retain complete canonical facts and only whole evidence items that fit the context limit; oversized canonical context is withheld.

`adopt_reviewed_community.py` prepares an atomic, idempotent data transaction. It compares the actual property, context, units and source snapshots before writing and refuses concurrent edits. It does not fabricate embedding or parser receipts. Its generated SQL contains the private rollback snapshot and belongs outside Git.

`retain_community_files.py` retains original bytes through native file decisions, verifies hashes after upload and optionally queues extraction. It never overwrites originals or automatically approves asset rights. The parser worker uses a dedicated expiring Auth identity, live per-community grants and a Linux network sandbox, with no service-role or model credential.

## Verification before deployment

- Fresh production public schema export and actual 288-entry migration ledger used as the baseline; obsolete local ledger entries excluded.
- All 19 candidate migrations replay successfully; four Community Brain SQL suites pass, including chat cutover and current-answer replay tests.
- Actual Acacia source-only fixture migrated successfully. Eight additional assertions cover retained history, current facts, the commercial hold, canonical allowlists, cross-community rejection and immediate source withdrawal.
- 68 focused Community Brain/Luma web tests pass; TypeScript check passes.
- Earlier full implementation qualification is retained in the October 13 and October 14 release directories; these counts are not represented as rerun in this adoption.

## Deployment sequence and recovery

1. Commit the complete reviewed local release. Apply only the 19 candidate migrations using the fetched production ledger.
2. Retain Acacia originals and raw captures privately. Apply the reviewed data transaction while the existing app continues serving; its saved legacy prompt is updated to the same safe current facts for app rollback.
3. Deploy the app to a staged **production** build without domain assignment. Provision the isolated worker and verify actual file extraction/queue processing.
4. Enable only the Acacia capabilities that have been verified. Test the existing widget against the staged build, then promote that same build to `hellop11.com` and repeat the chat smoke tests.
5. Record actual deployment IDs, commits, counts and any remaining limitations below.

Previous production app: `dpl_EiVDZCTWK7j4K4eyeRnmUusb2UGd` (`b07cdc170ff40b5d85baf0164a77b302777f062f`). App rollback retains the updated safe legacy context. Do not restore obsolete pricing or incentives. The schema migration is additive; do not attempt an unreviewed schema rollback. Pausing Brain after adoption is a deliberate information hold.

## Deployment evidence — October 15, 2026

The Acacia upgrade is deployed to production. The deployed web source is `e8fc1573791d046d89cb0a7bf76f0cb192cda004` on `codex/property-intelligence-siteforge-release`. Later changes in the primary working directory were preserved and excluded from this separately qualified release.

### Services and rollout

- Web: Vercel `dpl_HivACnj1zQZydHF9Gp8LqR6j6Cpy`, promoted to `https://hellop11.com`. The ready build and live domain both resolve to the tested source release.
- Supabase: all 19 candidate migrations applied successfully; production ledger contains 307 entries, ending at `20261015214530`.
- Ingestion worker: Render `srv-db8ktcs9v7es73el3veg`, deployment `dep-db8ktdk9v7es73el4230`, live at `4b63f19ea2226dd3f062d20e6a4c0d85f5fc6f93`. Later commits do not change its source.
- Data engine: Render `srv-d5rqmn8gjchc73cfsc3g`, deployment `dep-db8l0ami0phs73btd10g`, live at `64b1c828da6260893fafe7fa99a0d632fa5a7339`. Later commits do not change its source. Public health check returns HTTP 200.
- Acacia: context and ingestion enabled; consumer `chat` only; release mode `brain`, policy revision 3. All other communities remain unactivated.
- Portfolio queries, private asset delivery, generated-content feedback, and site/social/brand consumers remain disabled pending their own data and channel qualification.
- The approved Supabase access-token hook is enabled. Worker sign-in and token refresh issue a role limited to assigned communities with a maximum one-hour lifetime; direct application-table access and a foreign-community object request were denied. The ordinary-user hook path preserves existing claims.

### Preservation and approved updates

No files, database records, or older deployments were deleted. All five original knowledge-source rows and twenty original chunks were compared field by field and remain unchanged. The original property, saved context, and unit state remain in a private immutable adoption receipt. Older fact revisions are retained in native review history; superseded migration facts were withdrawn from use.

Eleven originals and raw captures are retained in private storage with checked hashes. Four file extractions succeeded and produced seven renditions. The logo SVG is retained but held because the parser rejects its inline styling (`active_svg_content`); the extraction job records that hold as a failure. Asset reuse and delivery remain unapproved until rights and exact plan variants are reviewed.

Five current fact records use native editor fields and retain their source evidence and hash when edited. The editor now accepts PostgreSQL evidence identifiers without imposing an RFC UUID-version constraint. Approvals and corrections completed thirty memory-projection jobs. Historical chunks were not relabeled as newly qualified vector data, and no embedding or extraction receipts were fabricated.

The widget keeps its existing credential, identifier, and embed. Obsolete floor-plan and availability links were corrected. The release revision prevents replay of previously completed answers containing obsolete links. Unconfirmed commercial details and amenities lead to a sales referral; neither an amenity's presence nor its absence is invented.

The committed source-review files remain the original adoption inputs. Subsequent amenity clarification and native-editor normalization are recorded in production's review history; the current database is the source of truth. Review expires November 14, 2026 and requires an actual source review to renew.

### Verification

- Full patched web suite: **5,500 passed, 44 skipped** across 798 passing and 6 skipped files. TypeScript check passes.
- Changed backend adapters: **103 passed**. The database migration replay and SQL suites described above passed before production application.
- Production file ingestion and approved-fact projection verified on the deployed worker.
- Staged and live chat checks verify Plan 2 facts, unconfirmed commercial information, amenity uncertainty, rejection of another community's session, and exact current-request replay. The test sessions created no leads. An obsolete completed answer was refused after its release revision changed.
- Existing widget script loads from `hellop11.com`; the official Acacia site still uses that host. The final deployment returned no error-level runtime log entries during the ten-minute verification window.
- The final deployment is built from an exact Git archive. Its uploaded source tree is checked for absence of the private production-data fixture. That fixture remains preserved locally and was never committed or pushed. An earlier deployment's protected source package contained it; that older deployment is retained under the instruction not to delete anything.
- Runtime dependency audit reports **zero findings** after compatible updates to `http-cache-semantics` 4.3.0, `sharp` 0.35.5 (librsvg 2.63.2), and `source-map-js` 1.2.2. A basic SVG-to-PNG conversion also passes. The findings are documented in the [cache advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), [image-library advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), and [source-map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- Five audit entries remain in the development-only ESLint/fast-glob/micromatch/braces dependency chain. They are not included in the runtime audit; npm's suggested forced change would downgrade the framework lint configuration and was not applied.

Private operational receipts, source snapshots, credentials, and production-derived test data remain outside the public repository. Public regression tests use synthetic records.

### Future release packaging

For CLI releases, export the chosen committed revision into a fresh deployment directory with `git archive`, provide only the Vercel project-link metadata, and verify the uploaded source tree before promotion. Do not deploy directly from a checkout containing production snapshots or qualification artifacts. The root Git ignore rule did not prevent Vercel from uploading the locally ignored fixture in the earlier build. Preserve operational artifacts outside the upload directory.

## October 16 correction: file access, fact detail and native-source indexing

The staff Files screen returned HTTP 400 because the Community Brain scope contract used RFC UUID validation for identifiers returned by PostgreSQL. The seeded organization identifier and some deterministic evidence identifiers are valid PostgreSQL UUIDs without RFC version/variant bits. Community Brain contracts and request schemas now validate GUID shape; exact actor, purpose, community membership and current-access checks remain mandatory. A malformed server scope now produces a service error rather than a misleading invalid-input message.

The web fix is commit `4d71e55889d49fee1ffa0aeaf4bd13a6ba27fcaf`, deployed as `dpl_3zhCqmLeocYnFyadeZnpumFBXkwo` and promoted to `hellop11.com`. This release includes all preceding committed UI changes through `cb3484e`. It was built from a clean Git archive; the uploaded file tree excludes private production fixtures.

Acacia's private-delivery flag was enabled through the audited rollout operation (policy revision 4) for existing authorized staff. Its storage bucket remains private and existing grants are unchanged. Original downloads still require a current download scope, exact community/file ownership, source validity and matching byte hashes, with a second permission/source check after reading storage. Asset reuse approval, portfolio access, generated feedback and the other generation channels remain separate and unactivated.

The initial fact migration over-compressed useful source detail. Nine active, approved native fact sections now preserve detailed finishes, appliances, energy and smart-home features, school references with enrollment caveats, FAQ information, community amenities, neighborhood context, parking, the verified Plan 2 reference and the commercial-information hold. The new FAQ reference was captured and retained as an additional private original. Only public source facts were sent for embedding; internal review notes and record metadata stayed in Supabase. Native decisions retain previous fact revisions. The complete canonical chat context remains below its 16,000-character bound.

Publishing that native source exposed a second integration defect: the projection worker attempted to link validated native vectors without the material scope required by the managed-document guard. Migration `20261016203038_community_brain_managed_projection_scope.sql` scopes that exact update to its material and restores the caller's previous scope afterward. It also checks the material identity on indexed chunks. It changes no access grants, does not disable the managed-document guard and removes no records. Previously stalled jobs completed automatically on their normal lease recovery, with real validated embeddings linked to their approved evidence.

Verification on October 16:

- Web: **5,554 passing tests**, 44 skipped; 808 passing files, 6 skipped. Type checking passes. New route tests use the real scope validator and test listing, exact original delivery, foreign ownership, expired access and changed bytes.
- Database: all five Community Brain SQL suites pass, including a new native-publication regression that fails on the old function and passes with the repair. It checks unchanged source text/vectors, no duplicate chunks, completed jobs, restored caller scope and continued rejection of direct managed-content writes.
- Signed-in production browser: all 12 retained originals list successfully; Plan 2 review opens; its exact drawing renders; the original PDF downloads with the retained SHA-256 checksum.
- Live chat: Plan 2, commercial uncertainty, amenity uncertainty, detailed appliance/EV questions and school-reference caveats verified. The final EV answer treats charger inclusion as unconfirmed. Another community's session returns 404; completed-request replay remains exact. Test sessions created no leads.
- Preservation: all 5 original source rows and all 20 original chunk texts remain; the original 7,822-character prompt remains in the immutable adoption receipt. No files, source records, deployments or worktrees were deleted.
- The recent production error scan showed only the existing outbound-workflow pause response, not a Community Brain file-access error. Outbound delivery was not resumed.

Remaining holds are deliberate review states: three legacy homesite records still combine historical commercial claims with plan variants, and asset reuse still requires rights and exact drawing association review. Old Plan 4/4X public PDF URLs found in search no longer downloaded successfully; cached search text was not promoted as a newly retained, verified drawing. Older withdrawn object-shaped adoption records remain retained; the current native fact fields are the approved, editable records. Review dates remain November 14, 2026.
