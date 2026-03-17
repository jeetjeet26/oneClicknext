# Vision: LeadPulse

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

LeadPulse turns raw lead activity into operational priority. It should tell operators and future autonomous systems which leads deserve attention now, why, and what outcome the score is trying to improve.

## Role In The Platform

LeadPulse is the decision-support layer for the conversion stack. It should influence workflow priority, follow-up timing, and operator focus across TourSpark and LumaLeasing.

## Current Implementation Baseline

Materially implemented today:

- scoring APIs in `app/api/leadpulse/*`
- event tracking support in `utils/services/leadpulse-events.ts`
- score badges and insights in UI components
- lead and workflow surfaces already reference score context

Current reality:

- rule-based scoring and event tracking exist
- the product is useful for prioritization
- it is not yet a fully closed optimization engine with robust attribution and policy-aware actuation

## End-State Vision

LeadPulse should become a property-aware attention engine that:

- scores leads continuously based on behavior, source, timing, completeness, and downstream outcomes
- explains the score in operator language
- feeds workflow orchestration with actionable priority signals
- learns from actual conversion outcomes over time

The product should eventually support:

- portfolio benchmarks
- property-specific scoring calibration
- recommended next-best action
- policy-safe use of scores in autonomous decisioning

## P1 Closure Priorities

- expand end-to-end validation that scoring does not block core lead operations
- tighten event ingestion reliability and visibility
- make score explanations more explicit in operator surfaces
- tie scoring changes more clearly to downstream workflow behavior and conversion outcomes

## P2 Autonomy Contract

Before autonomy can act on LeadPulse, the product must provide:

- explainable score factors
- clear confidence bounds or stability rules
- KPI linkage to real outcomes such as tours, show rate, and lease conversion
- protection against overfitting to noisy engagement signals
- auditability when scores influence outbound actions

## Success Metrics

- correlation between score bands and booked tours
- correlation between score bands and show/lease outcomes
- operator adoption of score-informed prioritization
- percentage of score changes that are explainable in product

