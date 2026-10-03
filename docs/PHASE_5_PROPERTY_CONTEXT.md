# Phase 5 — shared property context

September 16, 2026. Locally implemented and qualified. Phase 5 remains active.

The shared console no longer substitutes fictional properties when a request fails or returns an empty organization. It distinguishes loading, unavailable, and a genuinely empty list. Product pages mount only after a real selected property is available. Their client state is remounted when property scope changes. Server authentication and API authorization remain required; the browser boundary is not an authorization boundary and does not prevent Server Component execution.

Property management/onboarding, account profile and team access remain reachable before a property exists. Retrying a failed list request cannot create a property. The provider validates response shape/identities, cancels superseded requests, ignores aborted reads, validates selections, and tolerates blocked browser storage. URL selection, stored selection and the existing switch overlay are retained. Page observations require a nonempty verified property identity.

Onboarding refreshes/selects the actual property after its early save and again after completion. A final read failure preserves saved success, disables onward navigation, and offers a read-only retry without submitting the property again. Property deletion refreshes shared selection. The primary contact initializer is now safe under repeated React effect setup. Document guidance describes grounded answers rather than promising model training.

The properties API distinguishes a failed organization lookup or missing organization access from an actual empty list. Organization scope comes from the authenticated profile, not a supplied query parameter.

Verification: **12 API cases in three files** and **12 browser journeys in three files** passed. Six new browser journeys cover failed/slow/malformed/empty property responses, unavailable stored selection, blocked local storage and actual local first-property onboarding with a deliberately failed final read. The other six protect action-history and initial booking recovery. Full web type checking and targeted lint passed with no errors or warnings. Desktop/mobile states were visually inspected. Local browser fixtures were removed.

Evidence: `work/property-context/` in the active Codex workspace: `api.log`, `browser-final.log`, `types-final.log`, `lint-final.log` and screenshots. The initial runs found an actual duplicate-contact initializer and a missing test step for choosing the knowledge-source mode; neither failed run is counted as passing. The final small copy/disabled-style adjustment is presentational.

No schema change was needed. No live provider send, hosted migration, deployment, commit or push occurred. Comprehensive property-setup transactions/action recording and the other product readiness gates remain open. This increment does not claim full property-onboarding qualification.
