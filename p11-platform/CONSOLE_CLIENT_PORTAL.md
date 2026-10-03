# Console redesign, client reporting and library refresh

Implementation and verification: September 30, 2026, with the October 1 reporting and October 2 conversation updates below. Installed locally in the oneClick repository. Hosted systems have not been changed.

## October 2: client LumaLeasing conversation history

Clients with LumaLeasing configured for an assigned property now have a **Conversations** tab at `/client/conversations`. They can filter by chatbot property and conversation start date, browse paginated histories and read visitor messages and leasing replies with timestamps. Long transcripts provide earlier-message navigation; paused chatbots retain readable history. Clients without a configured chatbot see an explanatory empty state on a direct visit, and the tab is absent from their navigation.

This is read-only. There are no reply, takeover, archive, export or configuration controls. Only website/widget conversations are included. System messages, internal decisions, API keys, session identifiers and separate lead contact fields are excluded. Contact details voluntarily written in the visible chat remain part of that transcript. Assistant and staff replies share the existing assistant message role, so the sender label says “Leasing assistant / team” rather than claiming all replies were automated.

The GET-only `/api/client-portal/conversations` endpoint verifies the signed-in user, reads current client assignments, limits its queries to assigned chatbot properties and rechecks access after loading. Transcript reads also recheck the parent conversation's property. Responses are private and uncached. The UI clears stale content on failed refreshes, filter changes and access failures. The existing staff conversation APIs remain unavailable to clients.

No database migration or grant change is required. This uses the previously qualified `read_client_portal_scope` and `read_luma_visitor_messages` functions and the existing conversation/message/configuration tables. The relevant production column contracts were checked read-only; the existing 128-migration release dependency still applies before hosted use. The October 1 application archive is an earlier version: include this follow-up's matching application snapshot when preparing the next release.

Verification evidence is in `work/client-conversations-20261002/` in the Codex task workspace: 21 focused boundary tests, 5,346 total passing unit tests (43 skipped), the new chat journey plus both existing client-access/delivery journeys, desktop/mobile accessibility and screenshots, changed-file lint, foundation checks and the production build. Browser fixtures are synthetic and local. No real clients were invited and no provider/model calls or production writes occurred.

## October 1: reviewed monthly reports and delivery outcomes

The client workspace now includes period comparisons, goals, source coverage/freshness and reported inquiry-to-lease outcomes. Applications and leases are staff-reported or imported after review; they are not presented as verified PMS results. Inquiry cohorts count each stored inquiry once per stage and do not imply deduplicated people across systems.

Client report visibility now requires explicit publication from **Operations → Property delivery → Client reports**. Saving an internal BI report alone no longer exposes it to clients. Staff prepare a snapshot, add an explanation and next steps, approve the exact version and publish it. Refresh or revision requires renewed approval; published reports must first be withdrawn. Monthly drafting is optional, disabled by default and never automatically publishes or emails a report. Client scope and read-only restrictions remain enforced.

The new work queue, website evidence sequence, quality/effort review and release evidence are documented in [Competitive delivery implementation](../docs/COMPETITIVE_DELIVERY_IMPLEMENTATION.md). Final local verification passed 5,325 unit tests, both internal/client browser journeys, a production build, all 121 native database suites across the main and companion runs, and synthetic backup/restore. Production comparison remained unchanged. The September verification below describes its earlier milestone.

**Rollback:** preserve the published-only client projection. Reverting to the September server without that protection could expose saved monthly draft snapshots; disable client access first if such a rollback is necessary. Hosted release and real client/provider acceptance remain outstanding.

## Experience

The shared internal workspace now uses a restrained light design with clearer typography, muted P11 accents, grouped product navigation and responsive layouts. Existing property switching, search, account preferences and management destinations remain available. The overview, authentication pages, LumaLeasing and ForgeStudio presentation were refined; shared styles carry through the other product screens. Generated website previews keep their own design.

Clients sign in through the normal email/password flow and go to `/client`. Overview, Performance, Properties and Reports show aggregate marketing results, inquiries, tours, assigned property information and saved report summaries. Filters support one or all assigned properties and 7, 30 or 90 days. Report summaries can be downloaded. Missing or unavailable data is identified rather than fabricated. No MFA or authenticator was added.

Organization administrators use `/dashboard/clients` to create an invitation, choose properties, edit assignments, remove or restore access and withdraw pending invitations. The private invitation link must be copied and shared manually; this implementation sends no email. Links expire after seven days and require a verified matching email address. Existing internal staff permissions are preserved.

## Access boundary

Client identities are separate from internal organization membership. Clients cannot enter staff pages or call staff management APIs. Data is scoped again on the server to current explicit property assignments; direct requests for other properties are rejected. Access removal takes effect on the next request, including existing sessions. Clients retain their own password, recovery, session and sign-out operations.

The migration `supabase/migrations/20260930220324_client_portal_access.sql` adds client accounts, property assignments, invitations and an immutable access decision history. Invitation tokens are hashed at rest. Client accounts retain their identity marker after revocation; a profile guard prevents escalation into an internal organization. Private access tables and decision functions are service-only. Clients can read only their own identity marker via RLS. Access events are excluded from model training.

The migration was rehearsed in an isolated local database, then applied to the active local Supabase database without resetting it. Hosted migration history was not modified. Generated schema types and their version stamp were updated.

## Libraries

Active web and Python service dependency manifests were reviewed against the npm/PyPI registries, updated and locked. Highlights include Next.js 16.3.8, React 19.3.0, Supabase JS 2.117.2, AI SDK 7.0.124, Workflow 5.0.0, Tailwind 4.3.3, Playwright 1.63.0 and Vitest 5.0.3. Python locks cover the data engine plus Google Ads, Meta Ads and WordPress MCP services.

The JavaScript runtime remains Node 24 with npm 11. TypeScript 6.0.3 and ESLint 9.39.5 are intentional compatibility holds: the installed TypeScript ESLint tooling does not support TypeScript 7, and Next's installed import/React/accessibility lint plugins do not support ESLint 10. ESLint 9 is upstream-deprecated; move to ESLint 10 when those peers support it. Node type definitions follow the Node 24 runtime. Strict npm peer resolution is enabled; a clean `npm ci` succeeds without legacy peer bypasses. Required Vite peer and security overrides are explicit. Python hashed locks were installed in fresh Python 3.11 environments.

Compatibility fixes retain the existing behavior: typed Supabase update payloads, the actual `shared_jobs.output` field for provisioning results, and local copies of the previously used social icons with their license after Lucide removed brand icons.

## Verification

- Installed production build and full TypeScript compilation: passed.
- Foundation checks (schema synchronization, RLS guards, trust boundaries, runtime configuration, unit tests, lint and foundation types): passed.
- Web unit tests: 5,300 passed, 43 skipped. Python tests: 447 passed. All three MCP import/registration/schema checks passed.
- Native client access database test: 42 assertions passed, including wrong recipient, cross-organization access, role escalation, invitation expiry, replay, revocation and restoration.
- Complete local browser journey: invitation, verified client sign-in, all four client tabs, property/date filters, report download, error/retry, staff API denial, assignment removal, revocation/restoration and sign-out passed.
- Existing account settings and saved-report browser tests: 20 passed.
- 21 internal pages returned successfully without browser runtime errors; six representative product screens also passed mobile overflow checks.
- Client and internal overview screens passed automated WCAG 2 A/AA and 2.1 AA checks at desktop and mobile sizes, with screenshots reviewed. This is targeted automated accessibility coverage, not a whole-product manual certification.
- Final npm audit and all four Python audits: zero known vulnerabilities. The installed files match the staged and verified manifest.

Foundation lint reports 26 warnings and no errors. Newly enabled React Compiler performance diagnostics are warnings only for a scoped list of existing components whose asynchronous state patterns were preserved. New client components retain strict rules and pass lint. The successful production build still reports the existing middleware-to-proxy deprecation and six dynamic filesystem tracing warnings; these are recorded rather than silently disabled.

## Production drift and delivery status

A read-only production comparison on September 30 found no changes to 2,858 catalog objects or any of the 155 migration versions, names and body hashes compared with the saved September 25 production snapshot. This proves the hosted baseline has not drifted; it does not mean the new local migrations are already deployed. Existing production advisor findings remain separate. New client portal database objects produce no new WARN/ERROR advisor findings; informational notices concern unused indexes and intentionally service-only RLS tables.

Local preview: `http://127.0.0.1:9430`. Verification evidence is in the task workspace under `work/console-redesign-20260930/`: `build.log`, `foundation.log`, `portal-browser.log`, `portal-browser-results/`, `navigation/results.json`, `portal-db-tests.log`, `npm-audit-final.json`, Python audit/test logs and production snapshots.

Synthetic accounts and properties marked `(preview)` are isolated in local design-review organizations for review. Their IDs are recorded in browser fixture files; no real client was invited. Browser tests refuse non-loopback targets. No production writes, deployment, messages, provider/model calls, background activation or git publication were performed.

Before hosted client use, apply the reviewed migration through the normal release process, deploy the app, and repeat client/staff access acceptance checks in that environment with an approved client account. The agency planner remains deferred.

## P11 website brand alignment — September 30 follow-up

The user supplied https://www.p11.com/ as the brand reference. The local console now uses P11's authentic circular logo, primary orange with accessible darker variants, neutral light surfaces, a P11 browser icon and self-hosted Inter Tight headings from the website's published assets. The website's Area/Adobe font kit is not imported; body text retains Geist for application readability. Saved account accent preferences, semantic status colors, generated website designs and all application behavior remain intact.

Reverified after this presentation update: installed production build and TypeScript, the full client-access browser journey, internal/client desktop and mobile accessibility, plus sign-in/signup/password-request screens at both sizes. No new browser errors, contrast violations or horizontal overflow were found in the checked screens. Changed-file lint has zero errors and the two pre-existing dashboard React Compiler performance warnings. Evidence: `work/p11-brand-alignment-20260930/` in the task workspace. Asset sources and font licensing are recorded in `apps/web/public/branding/README.md`.
