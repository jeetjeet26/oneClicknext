# Phase 5 — saved full-property ReviewFlow analysis

September 18, 2026. Locally qualified; Phase 5 remains active across every retained product.

The Reviews tab can save all current review versions lacking current analysis, page through that fixed selection and approve an exact maximum number of model analyses. Later arrivals require another selection. The former first-100 endpoint no longer silently truncates work. Saved model recipes and source versions are immutable.

Only a current property manager/admin can approve, stop or recover a queue. Each owned child uses one stable analysis intent and one model claim. Repeated workers reuse evidence; unknown model calls are never reinvoked. Independent requests retain their own execution owner and cannot starve later queued items. Changed sources, revoked authority and invalid results are held explicitly. Stopping retains completed/staff-review/held counts and late evidence while stopping only owned unfinished children. Cases remain separate from analysis completion.

Human selection/approval/control records commit with their decisions. Automatic child creation, model results and progress use their actual service principal; the human execution authority is separate. Private source/model evidence is not exposed in the browser or shared action payload. The saved analysis worker is wired into the existing cron configuration with configured authentication, pause controls and bounded ticks. Its deployment and real model execution are not qualified by local tests.

Verification:

- 235 ReviewFlow/action/scheduler service/API cases across 33 suites passed.
- 42 new rollback assertions passed, with 628 passing assertions across established shared-action, ForgeStudio and ReviewFlow analysis/case/publication/intake/batch suites. The separately pending response SQL suite remains excluded and unrun after automatic permission-review timeouts.
- Three new browser journeys passed, including 105-review paging, lost selection/approval/stop replies, saved-result recovery, reload, scoped errors and property switching. All 22 distinct ReviewFlow journeys are verified. The combined existing run passed 15 and timed out opening one fixture review; the targeted case rerun passed alongside all three manual-publication journeys. That interruption is retained in the logs.
- Full application type check, changed-file lint and local schema type stamp passed at 20260918150256, before the next insights migration scaffold. 235 saved function bodies matched local Supabase, with no fixture/orphan residue. Advisors remain at 1,333 WARN/ERROR findings with no additions or removals.
- Mobile queue review was visually inspected and horizontal overflow checks passed.

Migration 20260918150256_phase_five_reviewflow_batch.sql is applied only to local Supabase; no hosted schema/history, deployment, model invocation, provider call or training occurred. ReviewFlow still requires the pending response SQL qualification, verified owner publication/renewal/readback, testimonial rights, trustworthy insights and remaining interactions. The wider product gates remain in P11_PRODUCT_READINESS.md. Queue qualification is not a whole-phase completion claim.
