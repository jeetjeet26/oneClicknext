# Vision: LumaLeasing

Last Updated: March 17, 2026
Document Type: Vision grounded in current implementation

## Mission

LumaLeasing is the always-on leasing concierge for each property. It should handle the first layer of prospect engagement, qualification, scheduling, and thread continuity while keeping operators in control of high-risk or ambiguous moments.

## Role In The Platform

LumaLeasing is the top-of-funnel and mid-funnel conversational surface for the platform. It bridges:

- property knowledge
- real-time lead interactions
- tour booking
- Gmail thread continuity
- calendar state
- human takeover

## Current Implementation Baseline

Materially implemented today:

- public widget and admin routes in `app/api/lumaleasing/*`
- widget client in `public/lumaleasing.js`
- Gmail service and thread lifecycle support in `utils/services/gmail-service.ts`
- calendar connect, status, reconcile, ingest, and watch-renew paths
- operator UI in `components/lumaleasing/LumaLeasingConfig.tsx`

Current reality:

- this is a real product with meaningful operational depth
- duplicate-safe booking and email-send protections exist
- the provider-backed happy path is not yet validated end to end in a way that fully closes `P1`

## End-State Vision

LumaLeasing should feel like a dependable digital leasing coordinator:

- it answers from real property knowledge
- captures leads at the right time
- schedules and confirms tours without duplicate or conflicting state
- maintains thread continuity across chat, email, and calendar
- escalates or hands off when confidence, policy, or provider state requires a human

The finished product should make the operator experience simple:

- one place to see booking health, pending threads, sync issues, and unresolved conversations
- one place to repair calendar drift or message lifecycle problems
- explicit degraded states rather than silent feature no-ops

## P1 Closure Priorities

- complete a verified provider-backed happy path across widget, booking, calendar sync, webhook/watch flow, and Gmail thread lifecycle
- align widget behavior across public JS and dashboard-admin expectations
- make webhook-dependent capability state explicit to operators
- close remaining manual recovery loops for reschedule/cancel and lifecycle repair

## P2 Autonomy Contract

Before autonomy can act through LumaLeasing, the product must provide:

- auditable records for every outbound message, booking, status change, and resolution action
- policy controls for messaging tone, compliance, and escalation
- confidence and approval handling for non-routine conversations
- human review that supports approve, deny, and modify outcomes with preserved textual reasoning for non-routine or high-risk conversation actions
- deterministic retry behavior with no duplicate sends or bookings
- operator-visible degraded states for email and calendar dependencies

## Success Metrics

- lead capture rate
- inquiry-to-tour conversion rate
- booking success rate without manual repair
- duplicate send and duplicate booking rate
- percentage of conversations resolved without operator intervention

