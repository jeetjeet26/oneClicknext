# Phase 5 — recorded conversation handling

September 23, 2026. Locally qualified; the holistic Phase 5 remains active.

The LumaLeasing Conversations tab now opens the complete paged inbox and transcript. Current managers can take over, reply, return control, archive and restore with retained original context and atomic action history. New visitor messages reopen archived conversations. Staff replies are saved for the visitor widget; persistence does not claim visitor receipt, email or SMS delivery. The previous duplicate assistant page redirects to this inbox and unrecorded takeover, human-message and deletion routes are closed.

Exact transcript reviews and JSON preparations retain their original source even when later messages arrive. Browser download initiation or failure is recorded separately. Decisions retain private reasons, original messages and before/after state; shared history exposes safe references only. Missing replies recover the same request, and unused cancellation fences late requests. Complete decision and service history remain available under current property authorization.

Public message persistence now emits actual service-principal evidence. A captured conversation-control version prevents an old assistant response from being delivered after staff take over and return control during the model call. Held output remains private. Human-mode public messages use the same recorded persistence boundary and do not initialize the model client. These changes do not qualify the remaining full public/model invocation and retrieval lifecycle.

## Evidence

- 85 application cases across nine affected suites passed.
- Four serial rollback suites passed: conversations 55, widgets 47, configuration 29 and shared actions 29 (160 total). After the staff-label refinement, all 55 conversation assertions passed again. The separately blocked ReviewFlow response suite was not run.
- Twelve distinct connected browser journeys passed through affected reruns: six widget and six conversation journeys. Initial fixture cleanup order was corrected and the six exact leftover synthetic fixtures were removed. The tests exposed and fixed duplicate React keys during recovery. The final pagination test retained its assertions with a 30-second wait after a successful response took 10.8 seconds. Actual visitor reads, human-mode posting, takeover/release, lost-response recovery, immutable exports, stale decisions, permissions, archive/reopen and full history passed. Desktop/mobile screenshots were inspected.
- Full application types passed after the final changes; lint and added whitespace are clean. Schema stamp passed, all 654 checked native bodies match, selected fixtures/orphans and migration-history counts are zero, and the 1,333 existing advisor findings are unchanged.

Migration `20260924054759_phase_five_luma_conversations.sql` was applied once locally. One subsequent exact replacement of `read_luma_conversations` corrected unnamed-current-staff versus former-staff labels; no full migration replay occurred. Evidence is retained in `work/luma-conversations/` including application/SQL/browser logs, copied browser results, `types-complete.log`, `verification.log`, schema/advisor JSON and the refinement SQL.

Next: truthful overview and complete public/lead-linked retrieval, remaining private model/system evidence, and the other holistic product gates. Hosted/provider/client acceptance is deferred; provider delivery, training and autonomous activation remain held. Sign-in remains email/password only.
