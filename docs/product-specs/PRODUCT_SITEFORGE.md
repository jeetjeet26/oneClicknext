# Product Spec: SiteForge

Last Updated: March 2, 2026
Status: MVP complete with deployment gap

## 1. Purpose
Generate and evolve property websites via AI-assisted agent pipeline and WordPress integration.

## 2. Core Capabilities
- Multi-agent planning and content/site generation.
- Template-based generation workflows.
- Conversational editing support.

## 3. Interfaces (Representative)
- SiteForge API routes for generation and edits.
- WordPress MCP server integration for execution.

## 4. Operational Requirements
- Publish/deploy path must be reliable and reversible.
- Generated changes should be validated before publish.
- Failed deploys must trigger rollback/fallback path.

## 5. Dependencies
- WordPress APIs/MCP, Cloudways (or equivalent hosting control), model providers.

## 6. Known Gaps
- WordPress deployment automation remains a major blocker.
- End-to-end autonomous publish workflow is not fully closed.

## 7. Runbook Links
- `docs/runbooks/RUNBOOK_RELEASE_AND_DEPLOYMENT.md`
- `docs/runbooks/RUNBOOK_INTEGRATIONS_AND_CREDENTIALS.md`
