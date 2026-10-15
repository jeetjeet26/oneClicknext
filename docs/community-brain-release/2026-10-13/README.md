# Community Brain staging release candidate

This bundle belongs to the October 13 implementation on `codex/property-intelligence-siteforge-release`. It includes local application/backend changes, 18 additive migrations, isolated SQL/HTTP/browser/parser qualification and a sanitized hash manifest. It does not authorize production migration, provider disclosure, publication or spend. Read the [implementation status](../../COMMUNITY_BRAIN_IMPLEMENTATION_STATUS_2026_10_13.md) for work that remains open.

## Exact components

| Component | Location |
| --- | --- |
| Community workspace | `p11-platform/apps/web/app/dashboard/community-brain` and `components/community-brain` |
| Scoped routes and shared contracts | `p11-platform/apps/web/app/api/community-brain` and `utils/community-brain` |
| Existing generator integrations | BrandForge operations/workflows, ForgeStudio context/generation, SiteForge package source/runner/delivery and LumaLeasing chat |
| Restricted extraction worker | `p11-platform/services/data-engine/community_brain`, `Dockerfile.community-brain`, pinned `requirements-brain.txt` |
| Candidate database delta | `p11-platform/supabase/migrations/20261013233353_*` through `20261014013217_*` in timestamp order |
| Reproducible qualification | `p11-platform/supabase/qualification` and `tests/community_brain_*.test.sql` |
| Generated database contract | `p11-platform/apps/web/types/supabase.ts`, stamp `20261014013217` |
| Cron configuration | Web `vercel.json`: common maintenance hourly at minute 17; connected folders every 15 minutes; existing knowledge refresh every 15 minutes |

The live database baseline ends at `20261007223000`. **Do not push the entire historical local migration directory** into production: its ledger differs from the live project. Apply only the reviewed Community Brain delta to an environment with the reconciled baseline. New migration filenames were created by the Supabase CLI. Nothing in this bundle changes the existing remote migration history.

## Qualification procedure

Use a current schema-only public export from the intended environment and a compatible isolated Auth/Storage runtime. Never copy real private rows into the synthetic harness. The local replay script refuses existing databases, logs its exclusions, applies the delta and executes rollback-only fixtures. It does not reset the developer database.

```sh
python3 p11-platform/supabase/qualification/replay_community_brain.py \
  --public-schema /absolute/path/live-public.sql \
  --system-schema /absolute/path/isolated-system.sql \
  --database community_brain_replay_candidate

python3 p11-platform/supabase/qualification/http_community_brain.py \
  --database community_brain_replay_candidate --web --restore

python3 p11-platform/supabase/qualification/capacity_community_brain.py \
  --database community_brain_20261013
```

The HTTP harness needs the local Supabase containers and the `oneclick-community-brain:20261013` worker image. It clones local service configuration into short-lived localhost-only containers, creates synthetic identities and removes those service containers afterward. The browser uses a separate Next build directory, actual application routes and private fixture credentials; it blocks external browser requests. Restore exercises a real `pg_dump`/`pg_restore` and independent original-byte storage; the fixture dump does not establish a backup policy for customer data or cover every rendition.

A clean database is required for each HTTP fixture run. The scripts intentionally do not reset an existing fixture database. The full web regression and affected backend checks are independent of production credentials.

## Staging configuration

1. Select a non-production Supabase target. Only default `main` existed at the last read; no paid branch was created. Capture its exact migration/catalog state, metadata backup and object backup inventory before applying changes.
2. Apply the eighteen reviewed migrations in order. Verify new privileges and ordinary staff/client denials through Auth, PostgREST and Storage. Refresh the generated types from that candidate and compare against the checked-in candidate contract.
3. Configure `public.community_brain_access_token_hook` as the Supabase custom access-token hook. The migration grants its Auth execution/schema permissions. Create a dedicated worker Auth identity with **trusted app metadata** `community_worker: true`; assign expiring `community_worker_grants` only to the pilot community. Never deploy the worker with a project service-role key.
4. Configure the worker with `SUPABASE_URL`, the publishable/anon key, dedicated worker email/password and required parser sandbox. Its subprocess receives no credentials. The Render Blueprint is not deployed; keep auto-deploy off, verify workspace conflicts, then provision only the reviewed service. The new worker plan is `1c-2g`; local schema validation is not a cost or workspace approval.
5. Use explicit community grants for staff and selected portfolio readers. In **Files and review → Community activation**, an administrator can enable intake first, then private delivery and portfolio access, then each qualified generator and creative feedback. Default-off flags never bypass permissions. Disabling a capability invalidates old scopes; source repair remains available.
6. Configure `OPENAI_API_KEY` and the exact `OPENAI_PROJECT_ID` only for approved provider disclosure. Query embeddings and portfolio synthesis fail to explicit lexical/deterministic behavior when unconfigured. Verify the project's retention controls and deletion receipts; do not infer zero retention from `store:false` alone. Non-OpenAI provider lifecycle coverage still needs qualification.
7. Package processing reservations use `COMMUNITY_BRAIN_PACKAGE_CALL_RESERVATION_CENTS`. Set a reviewed worst-case allowance for the operation, not an invented bill. Unverified costs remain reserved. Media-spend authority stays in its native account/currency/period controls.
8. Configure cron authorization and observe scheduler receipts. Connected folder schedules are opt-in, actor-bound and stop when source configuration or access changes. Each run checks a complete top-level inventory up to 1,000 supported files, imports up to 25 changed originals and respects its time budget. Partial work resumes explicitly. Provider additions, nested folders and unsupported types are not silently treated as complete.
9. Review historical source mappings and rights. The dry inventory does not confer authority. **Rebuild eligible memory** queues at most 100 exact, hash-checked source versions with a saved request/receipt; it cannot approve unreviewed text or infer an absent capture/asset link.
10. Run the selected pilot's format, retrieval, output-fidelity, delivery, attribution and recovery gates before activating its consumer. Current local fixtures do not certify all formats, providers or real estate verticals.

## Rollback and recovery

- Prefer suspending a community/consumer through the recorded activation controls, disabling the relevant scheduler, and stopping new worker claims. Revoke worker grants if processing must cease immediately; existing JWTs cannot bypass that revocation. Do not replace a narrow credential with a service key to recover a job.
- Hold stale/uncertain native generation and publication requests for reconciliation. Do not resubmit a paid request merely because its acknowledgement was lost. A brand request that failed before dispatch is closed; one with ambiguous dispatch remains retained.
- Application rollback must keep the new isolation policies and fail-closed serving behavior. Reintroducing old organization-wide retrieval or a stale injected facts prompt is not an acceptable fallback. Keep explicit compatible published-asset access until its separate rendition migration is reviewed.
- Preserve originals, exact revisions, approval/event history and provider-account bindings. Do not reverse schema migrations by dropping accepted sources. Use forward repair when reversal would lose evidence.
- Restore database metadata **and** independent object bytes. Compare each restored original/rendition SHA-256 and owner/path, then recheck current permissions, withdrawn sources, expired rights, pending jobs and provider bindings. A database-only backup cannot restore files.
- Replay deterministic projections only from current eligible sources and recorded hashes. Reconcile expired leases through supported worker operations; do not replay uncertain provider invocations as extraction jobs.
- Full retention/erasure, legal holds, all rendition restore, concurrent workload targets, alerts/quotas and observed live cycles remain CB17 work. This candidate deliberately does not include a bulk destructive cleanup of customer originals.

## Evidence and limits

The manifest records exact file hashes, the original dirty-file preservation result, live migration baseline, migration replay receipts and sanitized test summaries. Do not add secrets, real prompts, customer text or account credentials to release evidence. Detailed local command logs remain outside the repository.

The live pilot and broader action phases remain open: community/provider/destination selection, all required format consumers, supported channel adapters, verified usage/outcomes, one qualified reversible action and any later bounded sequence. Each action needs its own authority and receipts; no global automation switch was added.
