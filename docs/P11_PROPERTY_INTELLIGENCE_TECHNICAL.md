# Property intelligence — local implementation and qualification

October 7, 2026. This work is implemented in the local oneClick checkout. It has not been pushed or deployed. Production Supabase remains `lmjmutuggvzuadwreqxx`.

## What the team can do

Open **Property intelligence** in the internal navigation. The workspace provides:

- **Property record:** save additional identity, positioning, location, product, conversion, content and discovery facts. Every fact has its source, observation date, review date, optional effective dates, origin, visibility and retained revision history. Approval and locking are separate decisions. Existing typed floorplans, assets, legal copy and neighborhood records keep their current review workflows.
- **Creative direction:** save the designer's concept, typography, color use, imagery, spacing, motion, opening experience, page rhythm, voice, references and deliberate component exceptions. Approve it for the next Astra build.
- **Data sources:** prepare Search Console observations, or upload a reviewed CSV. CallRail and Buildium are deferred and excluded from setup choices and source retrieval. Review the entire normalized JSON download before approval. Draft imports never appear in client analytics.
- **Insights:** see portfolio coverage, recorded inquiry outcomes, device/page/floorplan observations, saved competitor asking rents, same-market comparisons, changes and a concise briefing. Questions compare supported recorded measures or explain observed exceptions. This is a bounded read-only query feature, not an unrestricted AI analyst or forecasting system.
- **Recommendations:** retain the observation, evidence references, confidence, owner, intended measure, expected effect, rollback and Basecamp link. Approval does not execute anything. Implementation links a relevant recorded product action; measurement links a later measurement action plus a result and its limitations. Queueing, preparing or generating a package is excluded from implementation evidence. A server-confirmed record does not independently prove an external release; staff-reported implementation and results remain labelled accordingly.
- **Experiments:** preregister dates, hypothesis, random-assignment evidence, primary measure, minimum sample/effect, guardrails and relevant setup action. Approved plans are frozen. Results require the closed period and reviewed aggregate data; there is no automatic winner, traffic allocation or rollout.

Clients receive an **Insights** page in their existing read-only portal. They see only assigned properties and approved/measured recommendations. Internal evidence references, Basecamp links, owners and source account identifiers are omitted from that API. There are no client mutation endpoints.

## Source and measurement rules

An approved import replaces older observations for the same provider/account within its entire declared date window, including removed rows. Providers, accounts, channels, devices, pages and floorplans remain separate; the application does not silently add competing source totals together. Current PMS inventory is a dated snapshot, not historical daily activity. Missing metrics are not coerced into zero.

Experiment imports must use one source account and a single aggregate row per date/arm/metric: `channel=all`, `device=all`, no page or floorplan, the saved experiment UUID, and `variant=control` or `treatment`. Each date/arm needs both sessions and the preregistered outcome, including an explicit zero when appropriate. Counts must be integers, conversions cannot exceed sessions, and both arms must meet the declared minimum. A Newcombe interval built from Wilson score intervals avoids false certainty at zero or complete conversion. Independence, consent, assignment quality, guardrails and other changes still require human review. Once measured, the retained evaluation does not change when a later import is approved.

Reported signed leases remain the existing reviewed outcome workflow. Buildium `Active` records are explicitly **not** proof of a signed lease, a signature date, or advertising attribution.

## Astra and delivery formats

Each new source bundle includes current approved public facts, approved creative direction and versioned P11 component guidance. Private, expired, future, draft and overdue facts are excluded. Component guidance specifies data bindings, asset classes, responsive/accessibility expectations, conversion intent and event names. New packages must return known guide IDs and versions in `component-bindings.json`.

Changing reviewed information changes the source hash. The team can generate a new package from the new snapshot and see which older packages use previous information. Installed websites are not silently overwritten.

WordPress and standalone source remain full finished-package targets. Webflow receives an approved-content CSV for a CMS collection with **Name**, **Slug** and **Approved content** fields. This does not create a native Webflow Designer project, transfer arbitrary HTML into editable components, or publish to Webflow. Those limitations are displayed in the workspace.

## Deferred account activation

Current scope is Search Console only. CallRail and Buildium adapters are retained for possible future use, but are not offered in the console and cannot be retrieved through its API. No accounts for either service need to be configured.

The server reads `P11_INTELLIGENCE_CONNECTIONS`, a JSON array of property-bound configurations. Never put it in a `NEXT_PUBLIC_` variable or a client bundle.

| Provider | Configuration fields | Current capability and limit |
| --- | --- | --- |
| `search_console` | `propertyId`, `siteUrl`, `accessToken` | Official Search Analytics API; date/device/page search clicks and impressions. Google may omit anonymized/top-row data. Token renewal must be configured during activation. |
| `callrail` (deferred) | `propertyId`, `accountId`, `companyId`, `apiKey` | Official inbound-call API with pagination; counts, answered status, source and reported qualification. Contact details and recordings are discarded. |
| `buildium` (deferred) | `propertyId`, `rentalPropertyId` (number), `clientId`, `clientSecret`, `sandbox` | Official units and leases APIs; current availability, asking rent and active lease counts. No tenant data retained. |

Accounts are bound by property on the server; browsers cannot supply credentials or alternate accounts. Requests use fixed provider hosts and do not follow redirects with credentials. Imports stop rather than retain partial data above 5,000 normalized observations. Source retrieval prepares a review preview and does not publish observations automatically. Native Yardi/RealPage feeds, automated credential renewal/scheduling and other providers are not represented as implemented; reviewed exports are supported while provider-specific onboarding remains deferred.

Provider implementation references: [Google Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [CallRail API](https://apidocs.callrail.com/), [Buildium API](https://developer.buildium.com/).

## Data boundary and verification

Migration `20261007184156_property_intelligence_workspaces.sql` adds two RLS-enabled, service-only tables and one command function. It does not alter existing CRM, chatbot, calendar or lead-delivery tables. Managers are checked against property/organization access at every command. Commands use request identities, expected revisions and a property transaction lock; changes retain before/after snapshots and append confirmed action-history events. No record is training eligible.

Verified locally:

- Full test suite: 5,402 passed, 43 existing skipped; focused checks after final refinements: 45 passed.
- TypeScript, targeted lint, schema/type synchronization, schema-reference checks, RLS-policy guards and production build passed.
- SQL transaction tests: cross-organization denial, idempotent retry, conflicting retry, stale version rejection, lock enforcement, immutable history, private grants, experiment preregistration/freeze/open-period rejection, and evidence requirements, including rejection of queued work as implementation evidence.
- Authenticated HTTP qualification: property/creative/import approval, source visibility, recommendation approval → implementation → measurement, read-only client denial, internal-link redaction, cross-property denial, Webflow export and Astra source preparation. 32 checks passed, including final anonymous-session, same-organization unassigned-property and source-account redaction checks.
- Browser: property save/approve/lock, supported portfolio question, client sign-in and assigned-property Insights. Mobile page width is contained at 390px; the new surfaces retain the requested light styling when the host uses dark mode.
- Real enriched Astra generation `f28e2cbe-f276-4a45-897a-06901e0aa79c` finished and downloaded through the authenticated console API. Its retained source contains the exact approved fact and creative direction; the website visibly renders the saved market value. Both generated component bindings match the source guide IDs/versions. The standalone website was independently opened in a browser with no console errors.
- Provider adapters were tested with representative official response shapes, pagination, private-field stripping, cross-property rejection and redirect rejection. **No live provider account has been activated or acceptance-tested.**

Local qualification scripts create synthetic records only and refuse non-local database/application origins. Interrupted qualification fixtures may remain in local immutable history. They are not client data.

Agency planning/execution, model training, production provisioning, live source activation, historical outcome backfill and the Acacia calendar repair remain deferred. Deployment and live-account acceptance are separate from this local implementation.
