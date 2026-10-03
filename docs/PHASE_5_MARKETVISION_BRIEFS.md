# Phase 5 — saved MarketVision briefs and recorded review

Status: locally verified for exact-source briefs, recovery, review decisions and downloads. Downstream recommendation handoffs, monitoring and the wider product register remain open.

Creating a brief first saves the complete pricing and approved subject-inventory snapshot, its hash, requester, reason and reporting window with a shared context/job and action. Calculation uses that retained snapshot, with no provider/model call. Interrupted requests resume the same report; explicit recovery completes the original evidence. Completed briefs and source snapshots are immutable. History pages all requests, and earlier reports remain readable as unqualified historical narratives.

The report compares floor-plan means by bedroom count, retains unknowns and source dates, shows the actual recorded changes and supports inspecting their evidence. Review prompts have stable identities and explicit limits; they do not invent calibrated confidence, expected revenue or business rewards. A current-source check identifies changed records or a moved reporting window without rewriting the original report. Approved, currently effective subject inventory is distinguished from pending or expired inventory.

Operators can mark a prompt for consideration or dismiss it with a reason. Corrections compare against the last saved review, preventing silent overwrites. Considering a changed-source report requires an explicit historical acknowledgment. Reviews do not execute pricing or downstream changes. Shared events distinguish the human request/review from actual local report calculation.

Readable Markdown and complete JSON downloads retain exact artifact bytes and SHA-256. A lost response returns the original artifact, even if rendering code changes. Preparation is recorded separately from confirmed receipt or external delivery. The prior arbitrary report insertion endpoint is retired, and authenticated direct writes to legacy market insights are revoked.

## Local verification

- 315 MarketVision service/API/calculation/transport/action cases across 42 suites pass, including strict review/export contracts and request recovery identity.
- 37 dedicated SQL assertions; 201 assertions across six serial MarketVision suites plus 29 shared action-history assertions pass. Result/action failures roll back report, job and artifact changes. The separately pending ReviewFlow response suite remains excluded.
- Three browser journeys pass for lost create/review/export responses, exact historical completion after source changes, correction history, failed reads, 22-report pagination and preserved earlier reports. The principal download journey passes again after adding recorded changes and subject evidence. Mobile UI and the readable report inspected.
- Full application types, changed-file lint and schema stamp pass. 292 saved function bodies match the local database; no fixture/orphan records remain. Existing 1,333 database WARN/ERROR findings are unchanged.
- Migration 20260922192642_phase_five_marketvision_briefs.sql applied only locally, with no migration history entry. No real provider/model call, hosted change, deployment or training occurred. Browser downloads used isolated fixture data.

Continue exact-source recommendation handoffs, runtime monitoring/discovery/intake, remaining system/interaction recording and every retained product gate. The existing legacy proposal/dispatcher paths still require qualification. Phase 5 remains active; this does not declare client or autonomy readiness.
