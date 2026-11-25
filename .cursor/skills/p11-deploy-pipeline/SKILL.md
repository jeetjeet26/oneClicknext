---
name: p11-deploy-pipeline
description: Commit oneClick changes directly to GitHub main and release P11 Console through the Vercel and Render CLIs. Use for commits, pushes, deployments, release verification, rollbacks, CLI access failures, and community product or ad import release problems in this repository.
---

# P11 release workflow

Use GitHub `jeetjeet26/oneClicknext` and its `main` branch as the single release source. Release the web app with Vercel project `web` on team `jeetjeet26s-projects` at https://hellop11.com. Release Data Engine with the existing Render web service `oneClick` (`srv-d5rqmn8gjchc73cfsc3g`) rooted at `p11-platform/services/data-engine`. Its public health check is https://oneclick-ls9k.onrender.com/health.

Use the installed Vercel and Render CLIs as the primary release interfaces. Reuse their existing authenticated sessions and confirm command syntax with the installed CLI help. An authorized release includes committing its tested changes, staging, promotion, monitoring, and production verification. Continue those steps without asking the owner to repeat approval for the same release. A read-only audit stays read-only.

## Check access from the current session first

Run fresh, read-only probes at the start of release work using the same shell that would deploy. Use the actual authenticated CLI results to choose the deployment path. The CLI and HTTPS can succeed through the configured proxy while raw DNS probes fail. Judge access using real provider requests. Keep Vercel CLI credentials, Render CLI credentials, connector OAuth, and browser sessions distinct when diagnosing a failure.

```bash
GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code origin refs/heads/main
vercel --scope jeetjeet26s-projects project inspect web
vercel --scope jeetjeet26s-projects inspect hellop11.com
```

- **Both Vercel CLI checks pass.** Use the CLI from this session to stage and promote the release. Continue even if the Vercel connector cannot see the project. Do not hand the upload to the owner.
- **The CLI reports missing or expired credentials.** Check the identity with `vercel whoami`. Start `vercel login` in that same execution environment and ask the owner once to approve the official Vercel device login. Resume when approved and rerun both scoped checks. Use the login link shown by the CLI and keep tokens and login codes out of project files.
- **The CLI reaches Vercel but returns a project or scope error.** Check the account, explicit team, existing project link, and project permissions. A connector 403 or 404 is evidence about that connector only. Team consent and CLI device login authorize different clients.
- **The CLI reports DNS, timeout, or fetch failure.** Treat connectivity as the first suspect. Recheck via a read-only probe after an environment change. If a staging upload reported an error, check the deployment history for the release SHA before retrying. Use the signed-in dashboard to inspect builds and promote when the CLI cannot reach Vercel. Ask the owner to run one exact staging command only if the current session still cannot upload through an authorized path. Locate the resulting deployment and finish the release yourself.

For a Render release, also run the following read-only probes and inspect the intended service in the returned workspace.

```bash
render --version
render whoami --output json
render workspace current --output json
render services --output json
render deploys list srv-d5rqmn8gjchc73cfsc3g --output json
```

- Reuse the configured Render workspace after verifying the service ID, repository, root directory, and linked branch. Discover worker and cron service IDs from the active workspace when those components are affected. Resolve an ambiguous workspace before a mutation.
- On a Render 401 or expired-token response, check whether `RENDER_API_KEY` is set without printing its value. That variable overrides the saved CLI login. When that variable is set, test the saved login with `env -u RENDER_API_KEY render whoami --output json`. Use an existing valid authorized secret when available. If the saved login needs renewal, run `render login` with the invalid override absent and finish its normal authorization flow. Apply the same environment choice to every subsequent Render command, then repeat the workspace and service checks. Keep tokens out of code, skill files, command arguments, and logs.
- Diagnose a connector that lists the team but returns no projects or a 403 as a separate connector-access failure. Continue through a working CLI. Reconnect a connector only when that path is actually needed and its failed authorization has been established.
- After a DNS, timeout, or fetch failure, make one fresh provider request before a Terminal handoff or a claim that deployment is blocked. Repeat it after an execution-context or network change. If connectivity recovers, resume the release from the last verified step.
- After an interrupted upload, deploy, or promotion, look up the deployment by release commit and deployment ID before retrying. Adopt an existing matching deployment and monitor it to completion. Request a user action only for a concrete remaining access requirement, then finish monitoring and verification yourself.

## Establish and test the release source

1. Confirm `origin` is `jeetjeet26/oneClicknext`, record the remote `main` SHA, and inspect local status. Record the current deployment IDs and revisions for affected services so rollback is unambiguous. If production contains runtime changes absent from `main`, reconcile that verified live code into `main` before preparing the release.
2. Prepare the change on top of freshly fetched remote `main`. Keep routine work and releases on `main`. The owner is the sole contributor and wants direct commits without feature branches or pull requests. When the active checkout is dirty, on another branch, or behind, preserve it and use an isolated clean clone of remote `main`. An independent clone can also use the local branch name `main`. Inspect the actual working-tree and remote state before choosing a checkout. Never copy a dirty tree into a release or use a force push.
3. Stage only the intended task files and inspect the full diff, including new files. Include previously authorized related changes after verifying them against current `main` and production. Keep unrelated local changes intact. Test affected surfaces before advancing `main`. Run a production web build for web changes. For schema changes, verify the live Supabase contract and run the web schema checks. For Data Engine changes, test the affected Python paths, including campaign scope and import recovery when relevant.
4. Re-read remote `main` before updating it. When Git transport works, fast-forward it with `git push origin HEAD:refs/heads/main` from the reviewed checkout. Multiple chats can advance `main` even with one contributor. If the remote advanced or Git rejects a non-fast-forward push, pause deployment, fetch the new head, reconcile the unpublished task commits on top of it, and rerun affected checks before another ordinary push. Resolve routine conflicts within the authorized task. Preserve both chats' changes and ask the owner only when their intended behavior genuinely conflicts. Re-read remote `main` after the push and confirm the remote commit and tree match the tested release.
5. Deploy only affected runtime components. Include shared build inputs and dependencies in the comparison. A documentation-only commit can advance `main` without a redeploy. Report the current GitHub head and live release revisions accurately in that case. Keep automatic Git deployment triggers disabled and trigger each qualified deployment and promotion explicitly through the CLI. Complete and push authorized task changes to `main` before releasing. Treat a GitHub commit, a successful upload, a Ready build, and a verified live release as separate checkpoints.

When Git transport cannot reach GitHub, use the GitHub connector. Verify the base ref, preserve file modes and the exact tested tree, perform a non-force update, and re-read the ref. A Vercel CLI upload can show a different local commit from remote `main`. Accept it only after verifying identical Git tree hashes and recording the remote release SHA and deployment ID.

Immediately before each deployment or promotion, re-read remote `main`. If another chat advanced it, inspect the intervening changes and coordinate the release using the latest qualified runtime code. Recheck the current production deployment so an older candidate does not replace a newer live release. A documentation-only advance can retain the already qualified runtime deployment when the runtime tree is unchanged. Record the actual GitHub head and live release commit in that case.

## Stage and promote the web app

1. Confirm the Vercel probes resolved the existing team, project, project root `p11-platform/apps/web`, and live production alias. Confirm automatic production domain assignment is off before staging.
2. Use the declared Node and npm versions and the checked-in lockfile. If a local build requires an offline fixture or other qualification-only setting, disclose that limitation and require the ordinary remote production build to pass. Keep qualification-only environment settings out of deployment configuration. In the clean release checkout, ensure the approved, checksum-matching ACF Pro archive is available at `p11-platform/apps/web/runtime-assets/advanced-custom-fields-pro.zip`. Keep the archive private and out of Git. Run `npm --prefix p11-platform/apps/web run siteforge:deployment-assets:verify`. Keep the release checkout linked to the existing Vercel project and retain the repository-root upload.
3. Run `bash p11-platform/apps/web/scripts/stage-production-release.sh` from the linked checkout of `main`. The script validates remote `main` and stages with `--prod --skip-domain --archive tgz` and release metadata. It uploads from the repository root and passes the web app's Vercel config. The repository-root upload includes SiteForge's shared WordPress build inputs while Vercel builds from the configured web app directory.
4. Record the staged deployment ID and URL returned by the CLI. Inspect and wait for that exact candidate, checking the returned state even when the CLI command exits successfully.

   ```bash
   vercel --scope jeetjeet26s-projects inspect "$staged_url" --wait --timeout 60s
   vercel --scope jeetjeet26s-projects inspect "$staged_url" --logs
   ```

   Continue checking an in-progress candidate after a wait timeout. A timeout alone does not establish build failure. Wait for **Ready**, review the ordinary production build output, and check the staged URL and affected routes. Confirm protected routes handle sign-in correctly. Use an authorized session for authenticated checks. When staging auth is unavailable, report the gap and run any remaining checks immediately after promotion if the checks completed before promotion satisfy the release requirements.
5. If the staged build fails or does not pass qualification, stop before promotion. Verify that hellop11.com still points to the recorded previous deployment. Diagnose the failure, qualify the fix, and stage a verified candidate.
6. After qualification and the fresh GitHub/production recheck, promote that same deployment through the CLI.

   ```bash
   vercel --scope jeetjeet26s-projects promote "$staged_url" --yes
   vercel --scope jeetjeet26s-projects inspect hellop11.com
   ```

   Confirm hellop11.com resolves to the staged deployment ID. Rerun the affected authenticated flows on the production domain, including the original failing request or UI action. A page rendering successfully does not establish that its underlying operation works. Use the recorded previous deployment with `vercel --scope jeetjeet26s-projects rollback <previous-deployment> --yes` if production verification identifies a release regression. Verify the restored domain and affected flow.

For an already verified, tree-identical checkout when the checked-in staging script cannot run, use the same upload with the confirmed checkout path and remote `main` SHA. Verify the private runtime assets and linked project first.

```bash
vercel --cwd "$release_checkout" \
  --local-config "$release_checkout/p11-platform/apps/web/vercel.json" deploy \
  --prod --skip-domain --archive tgz --no-wait --yes \
  --scope jeetjeet26s-projects \
  --meta "p11ReleaseCommit=$verified_main_sha" --meta p11ReleaseBranch=main
```

## Release the Data Engine

Keep the existing Render service linked to GitHub `main` with automatic deploys off. Confirm the active workspace, service ID, repository root, target commit, previous live deployment, and recent ingestion evidence before an import release. Include affected worker or cron services when their source, dependencies, or shared inputs changed. Preserve unrelated services.

After the tests pass and GitHub confirms the release SHA, create the deployment through the CLI with the full immutable commit.

```bash
render deploys create srv-d5rqmn8gjchc73cfsc3g \
  --commit "$verified_main_sha" --wait --confirm --output json
render deploys list srv-d5rqmn8gjchc73cfsc3g --output json
curl --fail --silent --show-error https://oneclick-ls9k.onrender.com/health
```

Use `--confirm` for an already authorized release. Capture the returned deployment ID and monitor that exact deployment. Keep long CLI operations in resumable execution sessions and check them at bounded intervals while reporting progress. A disconnected CLI or wait timeout requires a deployment-status check before another create command. For diagnostics, inspect `render logs --help` and query the affected service, deployment time window, and build or runtime log type supported by that CLI version.

Require Render to report the exact commit **Live** and verify the health endpoint plus the original affected flow or job result. A healthy process alone does not establish that imports or background jobs work. When credentials or authenticated checks are unavailable, describe the exact verification gap.

If a build or rollout fails, confirm which deployment is actually live and healthy. Diagnose and test a fix before another deployment. For a release regression, restore the recorded known-good release using the provider-supported rollback path. If the installed CLI has no rollback operation, use the existing dashboard or connector for that recovery and verify the result. Keep the rollback SHA separate from the current GitHub head. Restore the healthy baseline while preparing the corrected commit on `main`.

## Supabase and product defaults

Inspect live schema and migration history before writing to Supabase. When the intended SQL is already applied, reconcile its recorded version with the repository and avoid replaying it. Apply only the migrations required for the requested release. Verify affected functions and permissions and keep generated types synchronized with the schema.

Treat ordinary community product availability as a default. Keep it independent of a per-community flag, rollout list, or settings row. Fix obsolete gates at the shared code or database default rather than updating communities individually. Preserve community access, client visibility permissions, real configuration prerequisites, provider authorization, and deliberate activation for external actions such as sending, publishing, or spending.

For Meta and Google Ads, create authorized account links active and include them in routine scheduled imports without a second enable step. A paused or disconnected account link is an integration state. Check authorization, the property and account link, campaign scope, schedule, and recent import receipts before changing anything. Never bulk-reactivate links as a substitute for diagnosis.

## Close the release

Compare the final GitHub `main` SHA, tested tree, Vercel alias/deployment ID, and each affected Render deployment ID and live SHA before declaring a release complete. Check for an intervening release from another chat. Record differing revisions explicitly, including documentation-only commits and services with unchanged runtime code. Report the verified GitHub SHA, live deployment links and statuses, relevant smoke checks, and any migration or rollback. If a step is blocked, say which one and what evidence establishes the blocker. Preserve the verified live deployment when qualification fails. A skill cannot guarantee provider availability or permanent authentication. Diagnose the actual error, make safe recoveries, and report unresolved access or verification gaps precisely.
