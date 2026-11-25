---
name: p11-deploy-pipeline
description: Maintain GitHub main and stage, verify, promote, or roll back oneClick and P11 Console releases on Vercel, Render, and Supabase. Use for release checks, deployment blockers, CI changes, and community product activation or ad import problems in this repository.
---

# P11 release workflow

Use GitHub `jeetjeet26/oneClicknext` and its `main` branch as the single release source. Release the web app with Vercel project `web` on team `jeetjeet26s-projects` at https://hellop11.com. Release Data Engine with the existing Render web service `oneClick` (`srv-d5rqmn8gjchc73cfsc3g`) rooted at `p11-platform/services/data-engine`. Its public health check is https://oneclick-ls9k.onrender.com/health.

## Establish and test the release source

1. Read remote `main` and the live provider deployment records. Record the target commit and the current deployment IDs for affected services. Check local status before changing files.
2. Work from a clean checkout of current `main`. Use an isolated checkout if the working copy has unrelated edits. Advance `main` with reviewed, fast-forward commits. Never create a release branch, force-push, or deploy uncommitted or stale files.
3. Run the tests for the affected surfaces and a production web build for web changes. For schema changes, verify the live Supabase contract and run the web schema checks. For Data Engine changes, test the affected Python paths, including campaign scope and import recovery when relevant.
4. Verify remote `main` after the update. Keep production domain assignment and Data Engine deploys manual so a GitHub update cannot promote a build by itself.

When GitHub CLI or Git transport cannot reach GitHub, use the GitHub connector. Read the current ref before a write, preserve the intended file modes and exact tested tree, use a non-force update, and re-read the ref. A CLI-uploaded deployment can show a different checkout commit from remote `main`. Accept that only after verifying identical Git tree hashes and recording the remote release SHA and deployment ID.

## Stage and promote the web app

1. Confirm the existing Vercel team, project, project root setting `p11-platform/apps/web`, and current production alias. Check CLI reachability early with `vercel --scope jeetjeet26s-projects inspect hellop11.com`.
2. In the clean release checkout, ensure the approved, checksum-matching ACF Pro archive is available at `p11-platform/apps/web/runtime-assets/advanced-custom-fields-pro.zip`. Keep the archive private and out of Git. Run `npm --prefix p11-platform/apps/web run siteforge:deployment-assets:verify`. When Node or dependencies differ, use the repository's declared versions and lockfile.
3. Run `bash p11-platform/apps/web/scripts/stage-production-release.sh` from the linked checkout of `main`. The script validates remote `main` and stages with `--prod --skip-domain --archive tgz` and release metadata. It uploads from the repository root and passes the web app's Vercel config. The repository-root upload includes SiteForge's shared WordPress build inputs while Vercel builds from the configured web app directory.
4. Wait for **Ready** on the exact staged production deployment. Check build output, the staged URL, and the affected routes. Confirm protected routes handle sign-in correctly. Use an authorized session for authenticated checks. When staging auth is unavailable, report the gap and run any remaining checks immediately after promotion if the checks completed before promotion satisfy the release requirements.
5. Promote that same staged production deployment from its details page or with `vercel promote <deployment>`. Verify hellop11.com points to it in Vercel and rerun the affected flows on the production domain. Use the recorded previous deployment for rollback if a release regression warrants it.

**Recover access efficiently.** A Vercel connector 403 or 404 can coexist with a signed-in dashboard. Use the dashboard for status, build logs, exact-deployment promotion, and rollback. A managed shell DNS error is a network restriction. Reauthentication cannot fix it. If the only available archive upload path is the owner's ordinary Terminal, prepare the linked checkout, give one exact staging command with `--skip-domain`, and then locate the new deployment yourself and finish verification. Do not ask for repeated authentication or repeatedly retry the same access failure.

For an already verified, tree-identical checkout when the checked-in staging script cannot run, use the same upload with the confirmed checkout path and remote `main` SHA. Verify the private runtime assets and linked project first.

```bash
vercel --cwd "$release_checkout" \
  --local-config "$release_checkout/p11-platform/apps/web/vercel.json" deploy \
  --prod --skip-domain --archive tgz --no-wait --yes \
  --scope jeetjeet26s-projects \
  --meta "p11ReleaseCommit=$verified_main_sha" --meta p11ReleaseBranch=main
```

## Release the Data Engine

Keep the existing Render service linked to GitHub `main` with automatic deploys off. Confirm the current service, target commit, previous live deploy, and recent ingestion evidence before rolling out an import change. Use **Manual Deploy → Deploy a specific commit** and select the full verified `main` SHA. A tool that deploys only the latest linked-branch commit is safe only after verifying that branch and commit.

Wait for Render to report the exact commit **Live**, check `/health`, and check the affected flow or its latest routine job results. Leave unrelated services outside the release. Keep existing environment variables and credentials unless the change requires an authorized configuration update.

## Supabase and product defaults

Inspect live schema and migration history before writing to Supabase. When the intended SQL is already applied, reconcile its recorded version with the repository and avoid replaying it. Apply only the migrations required for the requested release. Verify affected functions and permissions and keep generated types synchronized with the schema.

Treat ordinary community product availability as a default. Keep it independent of a per-community flag, rollout list, or settings row. Fix obsolete gates at the shared code or database default rather than updating communities individually. Preserve community access, client visibility permissions, real configuration prerequisites, provider authorization, and deliberate activation for external actions such as sending, publishing, or spending.

For Meta and Google Ads, create authorized account links active and include them in routine scheduled imports without a second enable step. A paused or disconnected account link is an integration state. Check authorization, the property and account link, campaign scope, schedule, and recent import receipts before changing anything. Never bulk-reactivate links as a substitute for diagnosis.

## Close the release

Report the verified GitHub SHA, production deployment link and status for each affected service, the relevant smoke checks, and any migration or rollback. If a step is blocked, say which one and what evidence establishes the blocker. Preserve the verified live deployment when qualification fails.
