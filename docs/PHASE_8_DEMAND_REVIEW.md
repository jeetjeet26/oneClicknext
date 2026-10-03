# Phase 8 — measured demand and continuation review

September 24, 2026 (Pacific). The remaining independent Phase 8 review tooling is implemented and qualified. **Commercial validation and expansion are pending actual client evidence.** No paying client, price, currency, revenue, margin, success rate, staffing decision or client acceptance has been invented. This phase adds no production schema or runtime changes.

The engineering plan ends at Phase 8. Its purpose is to decide which improvements, integrations, capacity and delegated responsibilities are justified by real demand. It does not require adding more integrations, team roles or autonomous permissions before that demand exists. The September 9 business action plan remains the commercial source; its numerical targets are proposed, not adopted. Its historical revenue/staff assumptions are not a financial baseline.

## Delivered workflow

The offline `p11-platform/scripts/platform/scale.py` review tool accepts explicitly supplied records. It produces a readable report plus frozen inputs and a verifiable calculation record. It makes no network/provider/accounting/database requests and does not read client rows. It is an operating-review tool, not a new billing system or console screen.

1. Define the actual period, currency, client/pilot cohort, products, expected comparison tasks, scope and source permissions. Freeze these before measurement where possible. A retrospective selection is labeled; freezing it does not turn it into a prospective experiment.
2. Select one comparison: current process, a capable person with a general AI assistant, or an incumbent/partner stack. The comparison contract records the same task inputs, eligibility, acceptance criteria and measurement method. Use a separate frozen comparison for each alternative; never combine incomparable tasks or sum duplicated revenue across those reports.
3. Complete the generated evidence template. Every planned pilot and task must remain, including failures, rejected results, lost receipts and unknown values. The program fixes the currency and UTC period; the source reviewer must reconcile every imported amount and count to that exact scope.
4. Review fees earned and fees actually paid separately. Separate media/print pass-through revenue and costs. Include direct labor, provider use, other suppliers, support and all onboarding costs incurred in the period. Do not double-count support/onboarding in direct labor: document allocation in the required source record. No automatic amortization is applied. An amortized forecast, if desired, is a separate expressly justified business analysis; it must not overwrite actual incurred cost.
5. Compare median baseline human seconds with median assisted work **including review and remediation**. Keep onboarding and support effort separately visible. Every selected time pair must be complete before a savings percentage is reported. Rejected work still contributes its time. Zero or unknown baseline cannot yield a claimed saving.
6. Review confirmed delivery against all eligible inquiries, including failures and unresolved receipt states. Record denominator definition, exclusions, duplicate handling, provider/destination receipts and time window in the source evidence. Counts must reconcile. The report includes a descriptive two-sided 95% Wilson interval and sample size; zero denominator stays unknown. Correlated failures and incomplete sampling require separate interpretation. [NIST describes the Wilson interval](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
7. Record accepted client outcomes with a versioned metric definition, unit, decimal value and evidence. Conversion/lease outcomes, accepted site/change counts and delivery cost are different measures. Record open critical defects, interventions, exceptions, support/onboarding seconds, completed workload and elapsed time. Throughput is descriptive; the tool does not claim causality or net profit.
8. Record renewal as pending, declined, signed but unpaid, or paid renewed. A paid renewal requires a positive payment and source receipt. The report shows paid pilots and distinct paid clients separately.
9. Review pending product/platform prerequisites and evidenced demand for integrations, specialization, roles, client access, capacity or delegation. Each demand item cites the relevant pilots and an alternative analysis. A recorded decision can defer, investigate or propose specifically scoped work; it cannot activate anything.
10. Save a new review directory. Corrections use `--previous` to preserve the prior report hash and changed sections. Verify before using the report. Old outputs are not overwritten. Changing a cohort, comparison, or thresholds requires an explicitly new program; it cannot silently change a review's original denominator.

## Source and calculation contract

See `scripts/platform/fixtures/demand-program-v1.json` and `demand-fixture-evidence-v1.json` for a fully runnable **synthetic** example. Do not copy their made-up identities, money, rules or acceptance claims into a real pilot. The `template` command generates blank fields instead; `evidence-template` generates unknown values and pending acceptance for the actual frozen cohort.

| Input | Required interpretation |
|---|---|
| `programId`, `pilotId`, `clientId`, `taskIds` | Scoped SHA-256 identifiers. Retain the private identity mapping with the client owner. A task cannot appear twice or belong to two pilots. |
| `frozenAt`, `period` | Timestamp with timezone; period start/end are inclusive UTC dates. A period remains open until after its final UTC day. |
| `currency`, `minorUnitDigits` | Explicit three-letter currency and integer scaling. Monetary facts use nonnegative integer minor units. No currency conversion or currency inference. |
| `scopeHash`, `permissionHash`, comparison `contractHash` | References to the exact commercial scope, data permission and comparison design. Hashes are change detectors, not signatures or proof of authority. |
| `sources` | Hash, client identity (or null for shared organizational acceptance), and availability time. Facts cannot cite missing, cross-client or future sources. The tool does not retrieve or independently authenticate source contents. |
| Facts | `{ "value": null, "evidence": [] }` means unknown. Measured values require source references. Financial/time/count values are bounded integers; acceptance values are explicit booleans. |
| `costAllocationHash` | Same-client evidence defining period costs, staff-time rates, pass-through classification, invoice/payment reconciliation and non-overlapping cost categories. |
| `outcomes` | Exact metric and definition hashes, decimal-string value or null, unit and source references. No inferred attribution, forecast, reward or training eligibility. |
| `acceptance` | All eight product/platform prerequisites remain visible. `reported_satisfied` requires references but is still a supplied assertion, not verified release authority. |
| `rules` | Null until an owner has explicitly adopted exact thresholds. An adopted rule set records owner, decision source and adoption time no later than freezing. |
| Review identity | Reviewer, cutoff, program hash and complete input hash. Manual records remain `imported_unverified`; a fully favorable result is at most `ready_for_independent_review`. |

Contribution = earned service fees minus direct labor, providers, other suppliers, support and onboarding incurred in the same period. Pass-through margin is reported separately. Contribution percentage is unknown if fees are zero or any direct cost is unknown; incomplete pass-through accounting still prevents a complete review. Contribution is not net profit, cash balance, annualized margin or a growth forecast.

Adopted rules use `minimumPaidPilots`, `minimumRenewedPilots`, `minimumTasksPerPilot`, `minimumHumanSavingPercent`, `minimumContributionPercent`, `minimumDeliveryLower95Percent` and `minimumDeliverySample`. The delivery threshold explicitly applies to the **lower confidence bound**, not the observed success fraction. This is a selectable review contract, not an automatic reinterpretation or adoption of the business plan's proposed 99% target. Sample/count requirements must be positive; percentages must be finite and between 0 and 100. All per-pilot checks must meet the adopted rules; strong results for one client cannot average away another's failures. Unknowns, open critical defects, rejected tasks and missing client outcomes remain visible.

The tool deliberately cannot authenticate a reviewer, a payment or an ownership decision from a JSON file. An authorized person must compare the supplied record with the source system before commercial acceptance. Hashes and role labels alone cannot turn an imported claim into trusted execution evidence. Cross-client source checks prevent explicit scope mixing, not a dishonest source label. Real records belong in approved client evidence storage, not Git, shared fixtures or training datasets.

## Commercial inputs still required

These are collection instructions for actual business records, not generated financial facts:

| Workstream | Owner to assign | Required record and completion test |
|---|---|---|
| Financial baseline | Financial owner | Last 12 months by client/service, agency fees versus media/print pass-through, recurring versus projects, direct labor/suppliers and explicit unallocated amounts. Reconcile totals to accounting records; record debtors, payment terms and renewal dates. |
| Investment/cash capacity | Financial owner + operator | 13-week cash view and 90-day investment limit that cost assigned staff time and protect existing delivery. No fabricated starting cash, revenue mix, margin or headcount target. |
| Pilot selection | Commercial owner | Five actual candidates scored on access, urgency, relationship, repeatability and measurability; sponsor, current software, problem, data permission and segment. Choose an initial segment/principal CRM from that evidence. |
| Client agreement | Commercial + delivery owner | Contracted product scope, setup/operating fees, service boundaries, factual/source owner, allowed destinations and access, acceptance/recovery, support responsibilities and renewal decision date. |
| Product acceptance | Product owner | Complete the real journeys in `PHASE_5_LOCAL_COMPLETION.md`, with source/provider/host receipts and a representative failure/recovery. Keep unavailable capabilities explicitly unavailable. |
| Measurement | Measurement owner | Frozen alternatives and task acceptance criteria; source definitions and denominators; time/cost/outcome collection including corrections and maintenance; observed uncertainty. |
| Weekly operations | Operator | Review revenue/receipts, costs, deliveries, stale data, accepted changes, support, incidents, unresolved defects and renewal decisions. Save new review versions; no scheduler or notifications were created. |
| Continuation/expansion | Owner | Adopt, amend or reject proposed gates before their use. Decide continue, narrow, partner or stop based on independently checked records. Record why clients keep paying and the cheapest adequate alternative. |

A useful demand record includes: the repeated client request, current workaround and effort, number of affected paid clients, expected value, provider/tenant access and ongoing fees, cheaper existing alternatives, support burden, isolation/recovery implications, and a bounded validation plan. Richer roles require actual separation-of-duty or client-access needs; self-service requires evidence clients can operate without extensive assistance. More autonomy requires separately accepted live actions, limits, outcomes, correction burden and stop/undo behavior. This review grants none of those permissions.

## Verification and release state

The full offline platform-tool suite passed **123 tests in pinned Python 3.11.16 with networking disabled**, including 39 new demand-review cases. These cover hand-calculated economics, missing and invalid costs, pass-through separation, review/remediation effort, failed/omitted tasks, paid versus unpaid renewals, zero/tiny delivery samples, confidence bounds, critical defects, cross-client/future/missing evidence, frozen scope, UTC cutoffs, forbidden authority, bundle tampering, correction lineage and no-overwrite behavior. The repository synthetic fixtures match the qualified contract. The command is included in existing CI's offline test discovery; no hosted CI was dispatched.

The real CLI also produced and verified a synthetic review and its corrected revision; invalid selective reporting and output reuse were rejected. A separate blank program was generated for future actual records. No client measurements were supplied or inferred.

Fresh read-only production capture at **2026-09-25 03:09:32 UTC** (September 24 Pacific): oneClick project `lmjmutuggvzuadwreqxx`, **2,858 catalog objects / 155 migrations**, zero structural or migration-history drift versus Phase 7 closeout. No database change, migration or generated-type change was required. The frozen Phase 7 bundle of 155 historical/125 pending migrations and its 118-suite upgrade rehearsal remain the latest schema qualification; this tooling-only phase does not replace them.

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase8-completion/`. The [whole-plan completion ledger](P11_PLAN_COMPLETION.md) records every remaining acceptance dependency. Phase 8 commercial completion cannot be claimed until the real workload, payments, renewals and continuation decision exist.
