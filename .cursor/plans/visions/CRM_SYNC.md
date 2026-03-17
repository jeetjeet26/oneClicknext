# Vision: CRM Sync

Last Updated: March 16, 2026
Document Type: Vision grounded in current implementation

## Mission

CRM Sync turns P11 from an internal operating layer into a system that can safely write back to the systems of record our clients already use.

## Role In The Platform

CRM Sync is the boundary between internal product behavior and external client systems such as Yardi, RealPage, Salesforce, and HubSpot. It is the write-path most likely to create trust damage if retries, duplicate detection, or field mappings are weak.

## Current Implementation Baseline

Materially implemented today:

- CRM integration routes in `app/api/integrations/crm/route.ts`
- retry/dead-letter logic in `utils/services/crm-sync.ts`
- cron retry processor in `app/api/cron/crm-sync/route.ts`
- mapping and connection support through the data-engine CRM router

Current reality:

- the integration surface is real and useful
- duplicate detection and retry semantics exist
- queue claiming and operator recovery are not yet strong enough for full autonomy-grade trust

## End-State Vision

CRM Sync should become a policy-safe, client-trustworthy sync layer that:

- validates mappings before write
- deduplicates intelligently before create
- writes auditable action records for every sync attempt
- classifies failures as retryable, permanent, or operator-action-required
- gives operators exact visibility into what was synced, skipped, linked, retried, or dead-lettered

The best version of this product feels boring in the best way:

- no mystery duplicates
- no silent drops
- no unclear retry behavior
- no ambiguity about what happened in the external CRM

## P1 Closure Priorities

- add claim-safe processing for retry queues
- expose operator replay and requeue controls for dead-lettered leads
- standardize error classification and visibility across providers
- add full local validation for connection, push, retry, and dead-letter flows

## P2 Autonomy Contract

Before autonomy can write through CRM Sync, the system must provide:

- a shared action ledger for every outbound CRM mutation
- policy checks before high-risk data mutations
- confidence and approval support for ambiguous mappings
- deterministic retry semantics with no duplicate writes across overlapping workers
- operator-visible replay and rollback guidance where rollback is possible

## Success Metrics

- duplicate write rate
- percentage of retryable failures automatically recovered
- dead-letter rate by provider
- operator time to diagnose and recover failed syncs

