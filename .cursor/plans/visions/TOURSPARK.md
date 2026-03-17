# Vision: TourSpark

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

TourSpark is the system of action for lead progression. It should move prospects from inquiry to tour to follow-up with deterministic workflow state and operator trust.

## Role In The Platform

TourSpark is the action engine that connects lead capture, messaging cadence, booking state, and operator interventions. It is the product that converts passive intent into scheduled action.

## Current Implementation Baseline

Materially implemented today:

- lead and workflow APIs under `app/api/leads/*` and `app/api/workflows/*`
- workflow processor in `utils/services/workflow-processor.ts`
- tour scheduling and lifecycle APIs in `app/api/leads/[id]/tours/route.ts`
- operator UI under lead and settings surfaces

Current reality:

- workflow state handling is materially stronger than earlier repo generations
- deterministic leasing and pause/stop behavior exists
- the full operator-grade and autonomy-grade closure still needs broader validation and replay confidence

## End-State Vision

TourSpark should feel like a reliable workflow operating system for leasing:

- every lead enters a clear workflow state
- every scheduled action is claim-safe, retry-safe, and auditable
- every operator override is explicit and preserved in history
- workflows adapt to booking, reply, no-show, and completion signals without duplicate sends

The finished product should support:

- human-first control with strong automation
- precise lifecycle transitions
- durable action history
- reusable cadence logic that future autonomy loops can recommend or supervise

## P1 Closure Priorities

- add stronger local happy-path validation for workflow progression and recovery
- improve operator visibility into pending, skipped, retried, and paused actions
- tighten message provider failure handling across all cadence actions
- connect workflow state more directly to product-level KPIs such as booked tours and show rate

## P2 Autonomy Contract

Before autonomy can optimize or supervise TourSpark, the product must provide:

- explicit workflow state transitions
- per-action audit records
- policy limits around cadence, channel, and send frequency
- confidence-aware recommendations before automatic cadence changes
- replay and rollback behavior for failed or cancelled actions

## Success Metrics

- inquiry-to-tour conversion rate
- show rate
- duplicate send rate
- workflow completion rate
- operator intervention rate per workflow

# Vision: TourSpark

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

TourSpark is the system of action for lead progression. It should move prospects from inquiry to tour to follow-up with deterministic workflow state and operator trust.

## Role In The Platform

TourSpark is the action engine that connects lead capture, messaging cadence, booking state, and operator interventions. It is the product that converts passive intent into scheduled action.

## Current Implementation Baseline

Materially implemented today:

- lead and workflow APIs under `app/api/leads/*` and `app/api/workflows/*`
- workflow processor in `utils/services/workflow-processor.ts`
- tour scheduling and lifecycle APIs in `app/api/leads/[id]/tours/route.ts`
- operator UI under lead and settings surfaces

Current reality:

- workflow state handling is materially stronger than earlier repo generations
- deterministic leasing and pause/stop behavior exists
- the full operator-grade and autonomy-grade closure still needs broader validation and replay confidence

## End-State Vision

TourSpark should feel like a reliable workflow operating system for leasing:

- every lead enters a clear workflow state
- every scheduled action is claim-safe, retry-safe, and auditable
- every operator override is explicit and preserved in history
- workflows adapt to booking, reply, no-show, and completion signals without duplicate sends

The finished product should support:

- human-first control with strong automation
- precise lifecycle transitions
- durable action history
- reusable cadence logic that future autonomy loops can recommend or supervise

## P1 Closure Priorities

- add stronger local happy-path validation for workflow progression and recovery
- improve operator visibility into pending, skipped, retried, and paused actions
- tighten message provider failure handling across all cadence actions
- connect workflow state more directly to product-level KPIs such as booked tours and show rate

## P2 Autonomy Contract

Before autonomy can optimize or supervise TourSpark, the product must provide:

- explicit workflow state transitions
- per-action audit records
- policy limits around cadence, channel, and send frequency
- confidence-aware recommendations before automatic cadence changes
- replay and rollback behavior for failed or cancelled actions

## Success Metrics

- inquiry-to-tour conversion rate
- show rate
- duplicate send rate
- workflow completion rate
- operator intervention rate per workflow

