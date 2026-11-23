#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
web_app="$repo_root/p11-platform/apps/web"
current_branch=$(git -C "$repo_root" branch --show-current)
if [[ "$current_branch" != "main" ]]; then
  printf '%s\n' 'Switch to a clean checkout of main before staging a production release.' >&2
  exit 1
fi

current_commit=$(git -C "$repo_root" rev-parse HEAD)
remote_main=$(git -C "$repo_root" ls-remote --exit-code origin refs/heads/main)
if [[ "$current_commit" != "${remote_main%%$'\t'*}" ]]; then
  printf '%s\n' 'Update the checkout to match origin/main before staging a production release.' >&2
  exit 1
fi

if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
  printf '%s\n' 'Use a clean checkout of main before staging a production release.' >&2
  exit 1
fi

npm --prefix "$web_app" run siteforge:deployment-assets:verify
vercel --cwd "$repo_root" --local-config "$web_app/vercel.json" deploy \
  --prod --skip-domain --archive tgz --no-wait --yes --scope jeetjeet26s-projects \
  --meta "p11ReleaseCommit=$current_commit" --meta "p11ReleaseBranch=main"
