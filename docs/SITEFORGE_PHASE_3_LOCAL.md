# SiteForge Phase 3 — scoped revision qualification

Current status: [all remaining identified local Phase 3 work is complete; connected acceptance remains pending](SITEFORGE_PHASE_3_COMPLETION.md). This document retains the earlier increment and its dated next-step context.

September 15, 2026. **Local increment complete; Phase 3 overall remains open.**

The next step in the oneClick improvement plan now includes revision boundaries in the console brief, reusable source-comparison support in the personal SiteForge skill, and 20 locally verified revision scenarios across three existing examples. These projects are representative test cases; their names do not make them mandatory client launches.

## What changed permanently

- The console brief has optional **What should stay unchanged?** and **Version to compare with** fields. Their exact values travel into preview, clipboard and download output, and clear when switching properties. A version note does not claim that a backup already exists.
- The personal skill has a short revision workflow, optional record and `revision_scope.py`. It captures source hashes/sizes, detects additions/removals/edits outside declared paths, refuses to overwrite parent records, and leaves rendered verification explicitly unperformed. It does not generate sites, edit source, restore backups or inspect CMS data.
- Persimmon's standalone builder now validates the required routes instead of rejecting every site with more than 11 HTML pages. A legitimate added page builds; removing an existing required page still fails and preserves the previous complete output. The only permanent client-source changes are `scripts/build.mjs` and the new `tests/routes.test.mjs`. No trial copy, image, price, status, page or redirect was installed into the original client content.

## Three distinct examples

| Example | Existing brief and visual direction | Tested delivery surface | Different visitor emphasis |
| --- | --- | --- | --- |
| Gable House | Rental leasing; geometric sans typography, large open heading, clipped architectural imagery, green sectional backgrounds | Isolated WordPress 7.1 / PHP 8.2 installation with the native content plugin | Explore residences, amenities and leasing inquiry |
| Persimmon | For-sale townhomes; strong navy/lime identity, image-led hero, prominent facts, floor plans and dated inventory | Existing standalone HTML/assets build | Compare plans and homesites, retain selection into inquiry |
| Alder & Tide | Fictional coastal for-sale concept; serif/italic headlines, restrained green/cream colors, large photography and a shorter editorial homepage | Rebuilt native WordPress distribution rendered through its existing offline preview; separate framework build also passed | Explore a fictional collection and use an explicit demo inquiry |

This evaluates existing contrasting briefs and designs. It does not claim three newly generated sites, owner design acceptance, or a fresh native WordPress activation of Alder & Tide.

## Revision scenarios

All scenarios below were authored by the agent for local qualification, performed in separate copies, checked in Chromium at **1440 × 1000 and 390 × 844**, and restored. They are **20 scenarios / 40 final browser views**, not 20 owner conversations. Client acceptance remains separate.

For each scenario, evidence records the requested change, source comparison, outside-scope check, rendered check and restored parent. Gable House also compares all recorded content fields against the CMS parent, allowing only the declared fields to differ. Rendered comparisons exclude the requested element and its explicitly affected derived content; they do not prove every semantic property or pixel is unchanged.

| # | Example | Scenario | Final outcome |
| --- | --- | --- | --- |
| 01 | Gable | Change only the rental homepage heading. | Passed / restored |
| 02 | Gable | Shorten only the rental homepage introduction. | Passed / restored |
| 03 | Gable | Use the existing sky-deck image in the homepage hero, retaining its illustrative description. | Passed / restored |
| 04 | Gable | Change only the homepage button label to Explore residences. | Passed / restored |
| 05 | Gable | Clarify only the hero image caption. | Passed / restored |
| 06 | Gable | Clarify the first gallery caption; preserve gallery navigation and other images. | Passed / restored |
| 07 | Persimmon | Revise only the supporting hero line. | Passed / restored |
| 08 | Persimmon | Move only the hero image crop down slightly. | Passed / restored |
| 09 | Persimmon | On the homepage, rename the Gallery navigation link Photos and retain its destination. | Passed / restored |
| 10 | Persimmon | Rename only the homepage link into all floor plans. | Passed / restored |
| 11 | Persimmon | Trial only: mark homesite 11 Reserved as observed today; keep the other 35 observations unchanged. | Passed / restored |
| 12 | Persimmon | Trial only: add a clearly labeled local review page with a working floor-plan link. | Passed / restored |
| 13 | Persimmon | Trial only: map an old local path to floor plans without changing any page. | Passed / restored |
| 14 | Alder | Revise only the first hero headline line. | Passed / restored |
| 15 | Alder | Use the existing coastal photograph for the hero and update its image description. | Passed / restored |
| 16 | Alder | Increase only the gap between the welcome paragraphs. | Passed / restored |
| 17 | Alder | Give only the header call-to-action a deep terracotta background. | Passed / restored |
| 18 | Alder | Move the welcome section above the facts strip, retaining the section content. | Passed / restored |
| 19 | Alder | Use a stacked welcome section on desktop, while keeping mobile readable. | Passed / restored |
| 20 | Alder | Simplify only the optional message label on the inquiry form, retaining labels, limits and demo behavior. | Passed / restored |

## What verification caught

- A fixed page-count requirement prevented adding a valid page; the permanent route-check change fixes that limitation and checks required route identities more strictly.
- The initial crop edit changed a rule that was overridden later. The corrected trial edits the effective homepage rule and verifies computed positions.
- The initial Alder image edit changed a fallback while the offline preview supplied its own hero image. The corrected trial changes the preview's actual image configuration and the description. It qualifies that local preview path, not a live WordPress media edit.
- Supporting check corrections handled WordPress's string-valued metadata, a closed mobile menu, inventory counts derived from the available-only filter, and the deliberately hidden Reserved row. Failed attempts remain saved instead of being rewritten as passes.
- Three visual captures were improved to show the affected welcome section and avoid horizontal scrolling caused by centering an oversized image during capture.

There were 6 saved failed attempts across the initial and corrective runs. Final scenario results all passed. Per-scenario automated execution time is recorded; the sum for the latest passing attempts is 37.693 seconds. This excludes scenario design, setup, agent reasoning, debugging, manual visual review and the rest of this task. Original generation time, human/operator effort and attributable provider costs are **unavailable**, not zero. Do not use this number as an end-to-end delivery benchmark.

## Additional verification

- Three restored homepages at **1440 × 1000, 768 × 1024, 390 × 844 and 320 × 844**: 12 baseline views, no horizontal page overflow, failed loaded images or JavaScript page errors. Desktop/tablet/mobile compositions and representative changed states were visually inspected. Lazy images were explicitly loaded before the final baseline captures.
- Three restored mobile-homepage accessibility scans: zero automated violations in the covered WCAG A/AA rule set; **color-contrast incomplete results retained for every example**. This is not a WCAG certificate, a whole-site audit, assistive-technology review or a legal review.
- **32 Python + 11 JavaScript personal-skill regression cases passed**, including the 10 new source-scope cases. Skill metadata validation passed.
- **11 Persimmon inventory/build cases passed**, including three new route cases. The actual restored standalone output also passed **386 local link/fragment checks over 11 HTML pages**; 120 external references were skipped.
- **11 console unit/render cases + 6 browser cases passed**. Copy/download, blank optional values, property isolation, clipboard failure, empty-property handling and phone layout remain covered. Full web type checking and targeted lint passed.
- Alder's existing WordPress/offline build and Sites framework build passed. No dependencies, lockfile or hosting identity were replaced. Its original source remains unchanged.

## Source and evidence

The original client projects remain authoritative. Each client's isolated copies, parent archives, CMS records where applicable, trial requests, comparisons and screenshots remain in that client's `work/phase-three/` folder. Original source archives and parent records are private local recovery/evidence files, not downloadable theme assets. Per-client `PHASE_3_REVISION_TRIALS.md` files index the latest passing evidence and retain earlier failed runs.

oneClick source changes are limited to the brief builder, its component and existing tests, plus current plan/handoff documents. The personal skill remains outside oneClick. Existing unrelated work is preserved; nothing was committed, pushed or deployed.

Persimmon's unchanged inventory still has 36 observations dated September 8 and due for reconfirmation on September 15 under the provisional seven-day interval. The temporary homesite update was restored; this work did not refresh client facts or shared price banners.

## Remaining Phase 3 work and next step

**The next local monitoring increment is now implemented:** see [monitoring evidence and remaining gates](SITEFORGE_PHASE_3_MONITORING.md). It separates testbeds/review targets, excludes feeds from HTML scans, keeps unavailable evidence distinct, preserves incident ownership and holds uncertain alert delivery. Continue with existing-site import, asset-transfer and redirect qualification in isolated client copies. Actual monitoring cycles, alert receipt and client maintenance ownership remain open.

Carry these gates forward:

- Actual owner-requested conversational revisions and acceptance, representative import/migration journeys, real redirect execution on the chosen host, and measured routine operating effort/cost.
- Target-specific production identity, approved current facts, real inquiry recipient and receipt, domain/indexing state, hosted deployment and restoration, and normal schedule-cycle observation.
- Persimmon's actual hosted ACF runtime remains unqualified by these standalone trials. Phase 2's fresh local Persimmon fixture did not include ACF Pro; prior ACF evidence remains historical.
- Alder & Tide stays a fictional concept. Its offline bundle and framework build do not qualify native WordPress activation, real property claims, live inquiries or the Phase 2 durable form lifecycle.

No hosted migration, external message, real inquiry, provider change, backlog replay or deployment occurred. Phase 0 live gates and the rest of the retained product plan remain unchanged.
