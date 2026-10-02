# Phase 5 checkpoint — permissions and calendar recovery

September 16, 2026. Phase 5 remains active across all retained products. This checkpoint records completed local work; client/provider acceptance and the rest of the readiness register remain open.

Calendar and email use now require verified saved permission evidence, even when tokens have not expired. Existing unverified grants require reconnection. Renewal responses retain explicit scopes; an omitted scope inherits only an already verified grant. Reduced or malformed permissions save any rotated credentials under a hold and never return them for use. Permission changes increment the connection revision, fencing delayed work. Google and encoded Microsoft scope formats, web requests and the calendar worker use the same database decision. The console shows specific permission recovery guidance without exposing credentials or raw provider metadata.

Calendar review now accepts a changed duration of 1–240 whole minutes, including duration-only changes, after a fresh provider read and full-interval capacity checks. History records the prior and resulting duration. Unsupported/ambiguous times remain visible holds.

Staff can also restore the console schedule to a moved or removed provider event. The decision requires current membership, booking/observation versions, confirmed permissions, a matching connection revision, a recipient and a fresh provider check. It queues one versioned calendar update, preserves the booking, and records the decision atomically. A missing/cancelled event uses a new durable create identity while retaining the old binding in work/history. Receipt saving updates the actual new provider event ID; restoration remains pending until that receipt is saved. Retrying a lost decision or receipt does not duplicate work. No separate prospect notice is queued; live calendar invitation behavior still needs provider acceptance.

## Local evidence

- 153 service/API checks across nine suites, five real local email persistence journeys with simulated provider responses, and 21 Python worker checks passed.
- 439 PostgreSQL assertions passed across ten rollback-only suites: permission policy 38, calendar credentials 41, email credentials 41, restoration 23, calendar review 35, scheduling 84, delivery recovery 87, tour actions 57, observations 11 and timezone 22.
- Eight distinct browser journeys passed: two permission-health journeys and six calendar review/recovery journeys, including duration history, a lost restoration response, actual receipt persistence and 102-booking pagination. Provider evidence/acceptance was simulated; normal status and read APIs used the local database.
- Full web type checking and targeted lint passed. React review covered derived values, request identity, disabled/busy controls and scoped state. Screenshots were inspected. Local database advisors remain at 1,386 existing WARN/ERROR findings, with no additions or changed findings.

Logs and staging snapshots are in the active workspace under `work/integration-permissions/` and `work/calendar-completion/`. Initial fixture issues are preserved in earlier logs; final runs passed. Earlier provider browser fixtures now explicitly represent verified grants. No historical grant was silently marked verified.

Migrations `20260916213718_phase_five_integration_permissions.sql` and `20260916214830_phase_five_calendar_restoration.sql` were applied only to the local schema. Ship compatible services/worker/UI together at the existing release gate. No hosted migration, provider request/send, deployment, backlog replay, commit, push or model training occurred. Delivery remains paused.

## Continuing work

Complete legacy/manual event binding and active-work account transfer/reconciliation, tenant/provider acceptance, remaining public/system/interaction action capture, then all retained products listed in `P11_PRODUCT_READINESS.md`. Credential renewal has its existing private attempt ledger; this checkpoint does not claim comprehensive shared system-action history. The agency must use complete product journeys and verified outcomes; page observation or emitted events alone do not satisfy a product gate. Existing models remain the default, with training considered only after evaluation demonstrates a need.
