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

1. Check `git status --short`.
2. If the working tree has unrelated changes, create a clean temporary worktree and apply only the files intended for deploy.
3. Do not ship unrelated dirty files just because they are present locally.
4. For Supabase-backed route or schema work, verify live schema with Supabase MCP first.

Recommended clean worktree pattern:

```bash
git worktree add /Users/jasjitgill/oneclickdeploy HEAD
# apply only intended diffs/files
```

Remove it after deployment:

```bash
git worktree remove --force /Users/jasjitgill/oneclickdeploy
```

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
- Running from a temp folder with uppercase or invalid project-name characters can confuse auto-linking. Use a simple lowercase temp path such as `/Users/jasjitgill/oneclickdeploy`.

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
