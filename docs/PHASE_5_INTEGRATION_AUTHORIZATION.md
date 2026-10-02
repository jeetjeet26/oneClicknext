# Phase 5 — atomic integration authorization

September 16, 2026. Qualified locally; Phase 5 and the holistic product plan remain active.

Google and Microsoft calendar/email connections now use a saved, private authorization request. It pins the selected property, provider, capabilities, signed scope evidence, authorizing operator or invitation, callback destination and existing connection snapshot. Only one callback may start the provider exchange. A completed callback recovers its saved result without exchanging the code again. An uncertain claim/exchange requires a fresh request; only an identical database finalization is retried.

The final transaction rechecks current property membership, invitation token hash/provider/capabilities/creator, expiry/revocation/consumption and the saved connection snapshot. Calendar credentials, email credentials, the widget email binding, invitation consumption and the completed authorization event commit together or roll back together. Competing or stale callbacks cannot replace a newer connection. Calendar and email disconnect cancel pending authorization requests even when no connection existed yet. Email removal now clears credentials, disables its widget binding and records one recoverable action atomically.

Account changes are held explicitly. Reauthorization of the same provider subject/account can succeed. A different account/provider, multiple legacy connection rows or legacy linked bookings/mail without verified subject identity require review, preserving the existing records. A deliberate account replacement/rebinding interface is still to be implemented. Provider subject comes from the authenticated account endpoint; this is not a claim of complete Microsoft tenant-policy qualification.

The calendar/email compatibility entry points now route to the common saved-request flow. Pre-ledger Google callbacks cannot prove the snapshot they would replace and return a fresh-request message without calling the provider. Hosted release must register/verify the unified Google callback URL and coordinate UI/API/schema rollout. Existing credentials are not erased by this local migration.

## Recorded evidence

`integration.authorization.completed` and `email.disconnected` join the shared activity history. Their mutations roll back if recording fails; replay retains one event. Events exclude provider credentials and account email, and remain training ineligible. For an external invitation, `actor_id` identifies the sponsoring operator and `request.authorizer=external_account` identifies who performed authorization; the UI explicitly displays an invited external account, not “You.” The private authorization ledger records request state and hashes, not a second copy of provider tokens. Failed/denied/start/invite-creation decisions are not yet comprehensively represented in shared activity.

Browser roles no longer have direct access to email credentials, invitation authority or the new authorization ledger. Existing authenticated server routes remain the access path. This does not qualify the older email token-renewal worker; its independent refresh/disconnect races are a next step.

## Verification

- **137 service/API checks** passed across 13 suites: consent, signed state, exact final-save retry, callback acknowledgement, authentication/property access, compatibility routes, timezone handling, calendar/email removal and activity reads.
- **175 database assertions** passed: 48 authorization/removal, 41 credential, 57 tour action-history and 29 Luma configuration checks. Coverage includes competing callbacks, invite revocation/expiry/capability change after claim, membership change, initial-empty disconnect, account replacement holds, exact replay, private privileges and rollback when action recording fails.
- **Four actual local callback/database journeys** passed with simulated provider replies: rejected consent preserves the connection, valid consent saves exact permissions, partial combined consent cannot partially save, and Microsoft omitted-scope evidence is retained.
- **Six browser journeys** passed: real saved-request initiation and callback replay, email removal followed by a rejected old callback, invited authorization with correct activity attribution and single-use link, plus four prior consent/credential regressions. Provider exchanges were fixture evidence passed to the real local transaction; the callback replay exercised the real HTTP route. Screenshots were inspected. No live provider acceptance is claimed.
- Full web type checking, targeted lint and tracked whitespace checks passed. Local advisors remained at 1,386 existing WARN/ERROR with zero added. Temporary fixtures were removed.

Evidence is in `work/integration-authorization/` in the active Codex workspace: `web-final.log`, the four database suite logs, `persistence.log`, `browser-final.log`, `types-verified.log`, `lint-final.log`, `advisor-delta.json` and inspected screenshots. Earlier database fixture failures involved protected tenant-history changes; final fixtures use isolated identities. The initial browser run found missing local OAuth configuration; the successful run used temporary fake credentials, then restored the ordinary preview with delivery paused. No environment files were changed for those fixtures.

Migration `20260916162110_phase_five_integration_authorization.sql` is applied only to the local schema, without migration-history changes. No hosted migration, live OAuth/provider request, send, backlog replay, deployment, commit, push, dataset export or model training occurred.

## Next scope

Qualify email credential renewal, then deliberate account replacement and legacy booking/mail binding, invitation creation/revocation UI and complete action recording, operational scope/tenant health, calendar restoration/changed-duration/manual binding and legacy delivery. Expired authorization-request retention remains a platform qualification item. All remaining retained product journeys and public/system action coverage remain required; these improvements do not complete TourSpark, integrations or Phase 5.
