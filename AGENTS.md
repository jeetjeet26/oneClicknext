# oneClick project instructions

Read [the P11 release skill](.cursor/skills/p11-deploy-pipeline/SKILL.md) before working on GitHub maintenance, deployments, rollbacks, or release verification for this project.

## Release policy

Commit and push authorized task changes directly to GitHub `main` using ordinary fast-forward updates. The owner is the sole contributor and wants routine work on `main` without feature branches or pull requests. Preserve unrelated local work by using a clean isolated clone of remote `main` when needed.

Use the installed Vercel and Render CLIs as the primary release interfaces. Check access and project/workspace identity from the current execution session before requesting login or a Terminal handoff. Recheck provider connectivity after temporary failures. Commit tested code to `main`, stage the production build, verify it, and promote that exact deployment to hellop11.com. Deploy affected Render services from the full verified `main` SHA and wait for Live plus functional checks.

Other chats can advance `main`. Recheck GitHub and production immediately before deployment and promotion. Reconcile remote advances with the task, rerun affected checks, and continue through an ordinary push. Follow the release skill for access recovery, interrupted operations, rollback, and final verification.

## Community product defaults

Make standard products available by default in every existing and new community. Never require a community administrator to opt in, toggle an activation boolean, or request a community-specific allowlist entry for normal product use. If an obsolete activation gate blocks a product, fix the default and the code path for all eligible communities.

Keep organization and community access checks, client portal permissions, provider authorization, and approval for external actions. A newly authorized ad account link participates in scheduled imports immediately. Preserve explicit disconnection and pause controls on the individual integration. Diagnose a missing or failed import in its actual link, credentials, campaign scope, schedule, or job history.
