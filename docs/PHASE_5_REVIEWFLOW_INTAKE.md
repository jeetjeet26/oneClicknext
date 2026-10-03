# Phase 5 — ReviewFlow source settings and saved imports

Locally qualified September 18, 2026. This closes the recorded source/intake increment, not the complete ReviewFlow or Phase 5 gate. No provider/model was called, no hosted data changed, no deployment occurred, and training remains disabled.

## Behavior

Response preferences and Google/Yelp source settings now require exact versions, current property/manager authorization, a stable command and a reason. Failed reads and lost saves stay visible. Source identity replacement is explicit; disconnect retains history and does not claim provider revocation. The saved default tone now reaches new response drafts. Only consumed preferences are shown; preserved legacy automatic-response/notification fields are not presented as working controls.

Browser access to credential-bearing source rows and direct configuration/review writes is revoked. Server responses use explicit safe fields; stored API/access/refresh strings are retained privately and cannot be overwritten by the new settings payload. Public review collection uses managed server credentials. A configured source does not establish a verified Google owner-publication capability.

Manual entries, CSV files and provider results use a saved source receipt, validated preview, explicit application and private before/after observations. Quoted/multiline CSV, exact duplicate handling, source identity, malformed dates/ratings, 2 MB/500-row bounds and legacy fingerprint compatibility are checked. Invalid source rows hold the entire import without silently skipping or partially changing reviews. Previews page every saved row; stale review heads require an explicit rebuild from the same receipt. Application commits reviews, cases, observations, success counts and semantic history together. Saving/importing never starts analysis or publication.

Provider execution records one fetch intent, saves the bounded raw result before normalization, refuses redirects/changed configuration, and retries only receipt persistence. Stops retain late receipts without applying them. Paused execution still permits manual import and recovery of saved output. Source health advances only after confirmed application. Google/Yelp API coverage is recorded as a sample; a bounded collection cannot claim complete provider coverage. See [Google Places review contract](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) and [Yelp review contract](https://docs.developer.yelp.com/reference/v3_business_reviews).

Hourly/daily checks use exact source version, explicit current scheduling authority and stable UTC bucket identity. Unfinished/held imports prevent another automatic fetch; reviewed disconnect fences queued work. Scheduled checks save previews for manager review instead of applying rows automatically. Automatic outcomes use a real `reviewflow.intake` service principal with a nullable human actor, separate from the person who requested or applied the import. The activity screen identifies the service. This is an implemented system recording path for intake, not comprehensive cross-product system coverage.

Legacy direct import/sync entry points share the strict saved-request contract; arbitrary review writes are retired. Unused direct provider/persistence helpers were removed. Existing saved reviews and their response/case histories remain intact.

## Verification

- 212 ReviewFlow/action/scheduler service and API cases across 31 suites passed.
- 52 new rollback assertions passed; 586 assertions passed across the established shared-action, ForgeStudio, analysis, case, publication and intake suites. The separately pending `reviewflow_responses.test.sql` remains excluded and has not been run.
- All 19 ReviewFlow browser journeys are verified, including four new source/import journeys. The combined run passed 18 and encountered a local `ECONNRESET` on the remaining existing history check; its targeted rerun passed. The initial intake-only run found an incorrect test assumption that property switching preserves the Settings tab; it was corrected to reopen Settings and passed. These were not silently counted as clean first runs.
- Full application type checking and targeted lint passed. The schema stamp passed at `20260918131403` before creating the next empty batch migration scaffold. Saved function definitions match local Supabase; fixture/orphan checks passed. Database advisors remain at 1,333 WARN/ERROR entries with no additions.
- The mobile saved-import preview was visually inspected; no horizontal overflow was detected. Error/reload, duplicate lost acknowledgements, multiline CSV/row paging, stale-source rebuilding, preferences/default tone, paused source request/stop and property isolation were exercised against isolated local fixtures.

Migration `20260918131403_phase_five_reviewflow_sources.sql` is applied to local Supabase only, without stamping hosted migration history. Generated types preserve the local nullable RPC contracts and PostgREST version annotation. Logs and the reviewed image are in `work/reviewflow-intake/` in the task workspace.

## Remaining product and phase gates

Continue exact full-property analysis selection/recovery, verified Google owner publication/credential renewal and readback, testimonial rights lifecycle, truthful insights and comprehensive operator/system interaction coverage. ReviewFlow's response-specific SQL qualification still awaits the requested approval after automatic permission-review timeouts. All other retained product journeys and real-client/provider release gates remain open in `P11_PRODUCT_READINESS.md`. Intake recording neither trains a model nor grants autonomous execution permission.
