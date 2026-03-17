# Vision: ReviewFlow

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

ReviewFlow is the reputation operations layer for each property. It should ingest reviews, triage risk, generate responses, support approval workflows, and eventually enable bounded low-risk automation.

## Role In The Platform

ReviewFlow connects public reputation signals to operator response behavior. It is both a customer-experience product and a future autonomy candidate, but only for the safest classes of response.

## Current Implementation Baseline

Materially implemented today:

- sync, import, analysis, respond, config, tickets, reviews, and stats routes in `app/api/reviewflow/*`
- scheduled sync path in `app/api/cron/sync-reviews/route.ts`
- operator UI under `components/reviewflow/*`

Current reality:

- ingestion and response drafting are real
- approval workflows exist
- provider-side posting is not yet a fully governed execution path inside the product

## End-State Vision

ReviewFlow should become a reputation operations console that:

- aggregates review signals across sources
- classifies reviews by risk, urgency, sentiment, and operator priority
- drafts responses in brand-safe, policy-safe language
- supports explicit approval and controlled post execution
- keeps a full action history from ingest to final post state

The product should help operators move fast on routine reputation work without losing control of sensitive or high-risk responses.

## P1 Closure Priorities

- close the gap between drafted/approved responses and true provider-side posting behavior
- strengthen overlap safety and observability for recurring review sync
- improve degraded behavior when model analysis or provider data is incomplete
- add stronger happy-path validation for sync -> analyze -> approve -> post tracking

## P2 Autonomy Contract

Before autonomy can act through ReviewFlow, the product must provide:

- a real post execution path with audit records
- policy gates by review class, risk, and platform
- approval support for anything non-routine
- confidence metadata and strict holdout boundaries for low-risk automation
- a shared action ledger for every external review response mutation

## Success Metrics

- median time to first drafted response
- median time to operator-approved response
- response coverage rate
- percentage of low-risk reviews resolved with minimal operator effort
- policy incident rate on posted responses

