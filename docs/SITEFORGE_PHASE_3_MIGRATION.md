# SiteForge Phase 3 — local migration qualification

Current status: [all remaining identified local Phase 3 work is complete; connected acceptance remains pending](SITEFORGE_PHASE_3_COMPLETION.md). This document retains the earlier increment and its dated next-step context.

September 15, 2026. **The local full-site transfer, asset and redirect increment is complete. Phase 3 remains open.** Gable House and Persimmon are representative existing projects for qualification, not required launches or new console clients.

## What changed

The personal SiteForge skill now includes `references/migrations.md` and a read-only `scripts/migration_check.py` audit. It records public-file identities, compares transfers (including explicit renames), and checks literal same-origin redirect maps for duplicate sources, loops, chains, missing destinations and shadowed existing files. Changed, missing or unexpected files fail. Symlinks and recognized private/development inputs are rejected; this is not a secret scanner. Evidence files cannot overwrite earlier evidence or be written inside the inspected tree. The helper does not copy, fetch, execute redirects or publish anything, and explicitly leaves runtime verification unperformed.

The workflow distinguishes full transfers from merges and rebuilds; preserves the actual editor, settings and relationships; requires serialization-aware WordPress URL changes; and carries hosted verification and owner acceptance separately. No generator, client database or shared site kit was added to oneClick.

## Trials and evidence

| Path | Local transfer and recovery result |
| --- | --- |
| Gable House, WordPress | Copied the local source database and theme/plugin/uploads to a fresh isolated WordPress instance. All 100 content records, 1,440 metadata rows and 116 files matched. All six `gh_` options and four taxonomy/relationship rows matched. The native content editor was retained, used to save a visible homepage edit, then restored from the parent backup with zero duplicate content records. The source remained unchanged. |
| Persimmon, standalone | Copied authored source without hosting credentials/project identity; rebuilt both copies; verified all 218 public files, including assets. Removed and corrupted an image in the destination to verify detection, then restored it. A destination source edit rendered correctly; restoring and rebuilding returned all 218 files to the parent bytes. All 449 inventoried original-source files remained unchanged. |

**104 local browser/HTTP/edit/recovery assertions passed**: 95 in the main run plus nine standalone roundtrip/download checks. The main run loaded all 12 WordPress and 10 standalone visitor routes at 1440 and 390 pixels, checking successful direct routes, loaded images, one H1 and no horizontal overflow. All four homepage screenshots were visually reviewed. Both galleries opened real images and closed by keyboard. Selected residence/plan context reached the contact page. Persimmon retained its phone fallback and disabled online inquiries; no inquiry was submitted.

Four WordPress fixture redirects returned 301; five standalone fixture redirects returned 308. GET and HEAD preserved the tested encoded query and reached the final 200 page in one hop; one standalone alias also contained an encoded space. Both missing URLs returned 404. All four transferred standalone PDF downloads returned PDF bytes and content types. No old-origin request, failed local resource or page script error occurred. The external Google Maps iframe was blocked and remains unqualified.

WordPress redirects executed in local Apache/PHP through a fixture-only must-use plugin. Standalone redirects executed in a local preview server that models the destination-only Vercel configuration. Neither proves hosted Cloudways/Vercel behavior. Aliases are synthetic; no client URL was declared retired. WordPress used WP-CLI 2.12.0 with a dry run and serialization-aware URL replacement, skipping GUID columns. Source database backups are private local evidence, not public deliverables. Destination mail, cron and external WordPress HTTP were disabled during the trial.

The initial browser attempt assumed Persimmon still had a form input; inspection confirmed its intentionally disabled form and phone fallback. The final check tests that current behavior. Failed attempts are retained in the local work folder. No product change was needed for that assertion.

**Regression verification:** all 52 personal-skill Python cases, 11 personal-skill inventory cases and 11 standalone project cases passed. Skill structure validation passed. This includes 20 new audit cases for transfer failures, map conflicts, encoded paths, private inputs and symlinks. No application runtime code or dependency changed in this increment.

## Reproduction and artifacts

- Shared audit and regression tests: personal skill `scripts/migration_check.py` and `tests/test_migration_check.py`.
- Gable House: `/Users/jasjitgill/Documents/Codex/2026-09-11/us/work/gable-house/phase-three-migration/`; destination was `http://localhost:8098`.
- Persimmon: `/Users/jasjitgill/Documents/Codex/2026-09-04/ana/outputs/persimmon/work/phase-three-migration/`; destination was `http://127.0.0.1:9671`.
- Orchestration and results: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-three-migration/`. `browser-trials.cjs` performs the main trial and restores the WordPress destination; `standalone-roundtrip.cjs` edits/restores only the copied standalone project; `expanded-wordpress.py` compares related settings and taxonomy. Do not replay setup/import scripts against original clients.
- Client evidence includes `browser-results.json`, `network.json`, desktop/phone captures and `restoration.json`. WordPress includes `expanded-integrity.json`; standalone includes transfer, deliberate asset-failure, source-preservation and roundtrip records.

## Remaining Phase 3 work

Full database replacement is qualified only for disposable local destinations here. It does **not** establish safe content merging into an edited CMS, duplicate-free incremental import, arbitrary custom/plugin tables, ACF migration, cross-platform conversion or provider-backed integrations. Replacing a database can erase later edits. The next independent local step is a representative content-merge trial with stable source identities, conflict handling, interruption/retry and recovery, preserving destination-only edits.

Actual owner-requested revision acceptance, maintenance ownership, approved real alert/inquiry receipt and normal scheduled operation remain open. Facts and inventory observation dates were not refreshed; Persimmon's recorded factual review date remains September 15. Carry forward Phase 2's actual hosted runtime/ACF, DNS/TLS/cache/redirect/indexing, approved target deployment and hosted restoration gates. Asset hashes establish byte preservation, not licensing approval or renewed factual accuracy. No original client code/content, hosted database, provider configuration, live site or inbox was changed. Nothing was committed, pushed or deployed.
