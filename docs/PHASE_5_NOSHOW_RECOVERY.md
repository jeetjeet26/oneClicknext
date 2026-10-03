# Phase 5 — bounded no-show recovery

Qualified locally September 15, 2026. Automatic no-show processing now persists a per-tour, per-schedule-version attempt alongside its atomic outcome. Failures roll back status, score, activity and follow-up enrollment together. A first failure waits fifteen minutes, a second waits one hour, and the third requires operator review. A saved response can be recovered without repeating the outcome. Held and deferred records are excluded before applying the batch limit, allowing independent tours to continue.

The lead’s Tours panel shows retry or review status and the existing verified outcome control. Tours older than seven days remain manual decisions. A no-show recorded more than 24 hours after its start, or without a reliable time context, does not enqueue a fresh no-show campaign. Existing campaigns are not rewritten or replayed. Missing timezone, ambiguous clock changes and missing lead associations remain explicit. Database transport failure cannot be checkpointed while the database is unavailable; the next run checks durable state before attempting a mutation.

Verification: 49 service/API cases, 31 new plus 49 existing rollback-only database assertions, two real local browser journeys, full web type checking and targeted lint (zero errors; seven existing leads-page warnings). Both desktop and mobile screenshots were inspected. Local database advisors remain at 1,386 existing WARN/ERROR entries with no added findings. Fixture cleanup passed. Evidence: `work/phase-five-noshow/` in the development task.

The migration was created with the Supabase CLI and applied only to the local database without changing migration history. Outbound delivery remains paused. No hosted migration, provider send, backlog replay, commit, push or deployment occurred.

Remaining TourSpark work: initial booking and confirmation integrity, legacy/calendar qualification, and comprehensive action recording. This increment does not complete every product or make the autonomous agency production-ready.
