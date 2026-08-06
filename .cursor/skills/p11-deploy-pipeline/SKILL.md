---
name: p11-deploy-pipeline
description: Project-only deployment workflow for oneClick/P11. Use when deploying, checking whether changes are deployed, working with Vercel, Render, Supabase migrations, hellop11.com, the web app, or the data-engine service in this repository.
---

# P11 Deploy Pipeline

This skill is only for the `oneClick` project. It captures the deployment topology for this repo and should be followed before any deploy/check-deploy work.

## Deployment Topology

- Web app: `p11-platform/apps/web`
- Web host: Vercel project `web`
- Production domain: `https://hellop11.com`
- Vercel generated aliases such as `web-opal-xi-85.vercel.app` can point to the same production deployment.
- Data engine: `p11-platform/services/data-engine`
- Data-engine host: Render service `oneClick` / `p11-data-engine`
- Supabase DB changes: apply with Supabase MCP, then mirror in `p11-platform/supabase/migrations`.

Never deploy the repository root as the web app. The root `vercel.json` exists, but the reliable CLI deploy path for this project is the app directory: `p11-platform/apps/web`.

## Before Deploying

1. Commit the work first whenever possible. The strongly preferred deploy source is the main repo at a clean, committed state. Isolated worktree deploys are a last resort, not the default.
2. Check `git status --short`.
3. If the working tree has unrelated changes that must not ship, first ask whether they can simply be committed (separately) instead. Only if not, create a clean temporary worktree and apply only the files intended for deploy.
4. Do not ship unrelated dirty files just because they are present locally.
5. For Supabase-backed route or schema work, verify live schema with Supabase MCP first.

### Stale deploy-source protection (mandatory)

A production regression occurred on 2026-08-06 because a deploy was run from a leftover `/Users/jasjitgill/oneclickdeploy` folder containing two-day-old code. Vercel deploys are full snapshots of the deploy directory: deploying an old copy silently reverts everything not explicitly patched into it. To prevent this:

- NEVER reuse an existing deploy directory. If a candidate temp path already exists, delete it and create a fresh one.
- Always create isolation worktrees fresh, immediately before the deploy, with a unique timestamped path:

```bash
STAMP=$(date +%Y%m%d%H%M%S)
git worktree add "/Users/jasjitgill/oneclickdeploy-$STAMP" HEAD
# apply only intended diffs/files
```

- Before running `vercel deploy` from any directory other than the main repo, verify the source is current:

```bash
git -C <deploy-dir> log -1 --format="%h %ci %s"   # must match current main repo HEAD
git log -1 --format="%h %ci %s"
```

If the commits differ, stop and rebuild the worktree from current HEAD.

- Remove the worktree immediately after the deployment is verified — never leave it for a later session:

```bash
git worktree remove --force "/Users/jasjitgill/oneclickdeploy-$STAMP"
git worktree prune
```

- After any isolated deploy, commit the deployed changes to `main` and push to `origin` (https://github.com/jeetjeet26/oneClicknext) in the same session, so the repo never lags behind production.

## Web App Deploy

Always run Vercel commands from:

```bash
/Users/jasjitgill/oneClick/p11-platform/apps/web
```

or the equivalent path inside the temporary worktree.

Use:

```bash
vercel link --project web --yes
npm install
npm run build
vercel deploy --prod --yes --logs
vercel inspect <deployment-url>
curl -I https://hellop11.com/dashboard/propertyaudit
```

Expected success signals:

- Vercel deployment status is `Ready`.
- Deployment target is `production`.
- `https://hellop11.com` appears in aliases.
- Protected dashboard routes can return an auth redirect; that is not a deploy failure.

Common failure to avoid:

- Running `vercel deploy --prod` from the repo root can fail with “No Next.js version detected” or deploy the wrong shape.
- Running from a temp folder with uppercase or invalid project-name characters can confuse auto-linking. Use a simple lowercase temp path such as `/Users/jasjitgill/oneclickdeploy-<timestamp>`, created fresh per the stale deploy-source protection above.
- Reusing a previously created deploy folder ships stale code and reverts newer work on production. Always delete leftover deploy folders and rebuild from current HEAD.

## Render Data Engine Deploy

Only use Render for data-engine changes under:

```bash
p11-platform/services/data-engine
```

Do not redeploy Render for web-only TypeScript/Next.js changes. Do not redeploy Vercel for Python-only data-engine changes unless the web app also changed.

Render service facts:

- Service name: `oneClick`
- Root dir: `p11-platform/services/data-engine`
- Host URL: `https://oneclick-ls9k.onrender.com`
- Auto deploys are tied to commits on `main`; use Render MCP only after confirming the intended service.

## Supabase Schema Changes

For live schema fixes:

1. Read MCP tool schema before calling the tool.
2. Use Supabase MCP `execute_sql` to inspect live schema.
3. Use Supabase MCP `apply_migration` for DDL that must take effect immediately.
4. Add the matching migration file in `p11-platform/supabase/migrations`.
5. Regenerate/stamp/check from `p11-platform/apps/web`:

```bash
npm run schema:types:stamp
npm run check:schema-types-sync
npm run check:schema-truth
npm run check:foundation
```

## Deploy Result Format

Report deploys briefly:

```markdown
## Deploy Result
- URL: <deployment-url>
- Alias: https://hellop11.com
- Target: production
- Status: Ready
- Verification: <build/check/log summary>
```

If something failed, say where it failed and the next concrete command or fix.
