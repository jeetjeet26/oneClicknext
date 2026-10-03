#!/usr/bin/env python3
"""Offline paid-pilot review. Supplied facts are unverified, never launch authority.

Freeze a cohort before measuring it; retain unknowns, failures, complete costs and
the original comparison. No network, database, provider, training or execution.
"""
import argparse
from datetime import date, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from pathlib import Path
import re
from statistics import median

from datasets import digest, identity, shape, timestamp, write_new

POLICY = 'p11-demand-review-v1'
PRODUCTS = {'siteforge', 'lumaleasing', 'propertyaudit', 'brandforge', 'tourspark',
            'leadpulse', 'crm', 'forgestudio', 'reviewflow', 'marketvision', 'bi',
            'knowledge', 'property', 'integrations', 'reports', 'pipelines',
            'settings', 'team', 'platform'}
COSTS = ('directLabour', 'providers', 'suppliers', 'support', 'onboarding')
FINANCE = ('earnedFees', 'paidFees', 'passThroughRevenue', 'passThroughCosts', *COSTS)
ACCEPTANCE = ('production_access', 'client_product_journeys', 'hosted_release_restore',
              'model_quality', 'client_retention', 'live_operating_window',
              'bounded_autonomy', 'reviewflow_response_suite')
RULES = ('minimumPaidPilots', 'minimumRenewedPilots', 'minimumTasksPerPilot',
         'minimumHumanSavingPercent', 'minimumContributionPercent',
         'minimumDeliveryLower95Percent', 'minimumDeliverySample')
LIMITS = [
    'Imported records, reviewers and source hashes require independent verification.',
    'Local fixtures never establish client acceptance, model quality or business outcomes.',
    'Matched task comparisons are descriptive; differences do not establish causality.',
    'Contribution includes all recorded period onboarding and support costs; it is not net profit or cash flow.',
    'No currency conversion, annualization, revenue forecast or headcount target is inferred.',
    'A favorable review cannot release software, send messages, spend money, train a model or expand permissions.',
]


def seal(value):
    return {**value, 'contentHash': digest(value)}


def sealed(value, expected=None):
    identity(value.get('contentHash'))
    if digest({k: v for k, v in value.items() if k != 'contentHash'}) != value['contentHash']:
        raise ValueError('Content changed after freezing')
    if expected is not None and value['contentHash'] != expected:
        raise ValueError('Unexpected frozen program hash')


def integer(value, maximum=10**15):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError('Expected a nonnegative bounded integer')
    return value


def percent(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError('Invalid percent threshold')


def refs(value, required=False):
    if not isinstance(value, list) or len(value) > 100 or len(value) != len(set(value)):
        raise ValueError('Unique evidence references required')
    for ref in value:
        identity(ref)
    if required and not value:
        raise ValueError('Measured facts require source evidence')


def fact(value, boolean=False):
    shape(value, ['value', 'evidence'])
    v = value['value']
    refs(value['evidence'], v is not None)
    if v is not None:
        if boolean:
            if type(v) is not bool:
                raise ValueError('Expected an explicit boolean or unknown')
        else:
            integer(v)
    return v


def distinct(rows, key):
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ValueError('Expected a bounded collection')
    ids = [row[key] for row in rows]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate identity')
    return set(ids)


def validate_program(program):
    shape(program, ['policy', 'source', 'programId', 'frozenAt', 'period', 'comparison', 'currency',
                    'minorUnitDigits', 'cohort', 'rules', 'contentHash'])
    sealed(program)
    if program['policy'] != POLICY or program['source'] not in ('synthetic', 'imported_records'):
        raise ValueError('Unknown review policy or provenance')
    identity(program['programId'])
    timestamp(program['frozenAt'])
    shape(program['comparison'], ['baselineKind', 'contractHash'])
    if program['comparison']['baselineKind'] not in ('current_process', 'general_ai_assistant', 'incumbent_stack'):
        raise ValueError('Declare the baseline comparison being measured')
    identity(program['comparison']['contractHash'])
    period = program['period']
    shape(period, ['start', 'end'])
    if any(not isinstance(x, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', x) for x in period.values()):
        raise ValueError('Period requires ISO dates')
    if date.fromisoformat(period['start']) > date.fromisoformat(period['end']):
        raise ValueError('Invalid review period')
    if not isinstance(program['currency'], str) or not re.fullmatch('[A-Z]{3}', program['currency']):
        raise ValueError('Declare one currency; conversion is not supported')
    integer(program['minorUnitDigits'], 4)
    distinct(program['cohort'], 'pilotId')
    if not program['cohort']:
        raise ValueError('A real planned cohort is required; do not fill unknown clients with fixtures')
    tasks = set()
    for pilot in program['cohort']:
        shape(pilot, ['pilotId', 'clientId', 'products', 'taskIds', 'scopeHash', 'permissionHash'])
        for key in ('pilotId', 'clientId', 'scopeHash', 'permissionHash'):
            identity(pilot[key])
        products = pilot['products']
        if not isinstance(products, list) or not products or len(set(products)) != len(products) or not set(products) <= PRODUCTS:
            raise ValueError('Declare supported product scope')
        refs(pilot['taskIds'], True)
        if tasks.intersection(pilot['taskIds']):
            raise ValueError('A task cannot occur in two pilots')
        tasks.update(pilot['taskIds'])
    rules = program['rules']
    if rules is not None:
        shape(rules, ['adoptedBy', 'adoptedAt', 'decisionHash', *RULES])
        identity(rules['adoptedBy']); identity(rules['decisionHash'])
        if timestamp(rules['adoptedAt']) > timestamp(program['frozenAt']):
            raise ValueError('Rules were adopted after this frozen program')
        for key in RULES:
            if 'Percent' in key:
                percent(rules[key])
            else:
                integer(rules[key], 10000)
                if rules[key] == 0:
                    raise ValueError('Adopted sample requirements must be positive')
    return program


def freeze(program):
    if 'contentHash' in program:
        raise ValueError('Already frozen; preserve it and create an explicit new revision')
    return validate_program(seal(program))


def unknown():
    return {'value': None, 'evidence': []}


def evidence_template(program):
    validate_program(program)
    return {
        'programHash': program['contentHash'], 'source': program['source'],
        'asOf': None, 'reviewerId': None, 'sources': [],
        'pilots': [{
            'pilotId': pilot['pilotId'], 'clientId': pilot['clientId'],
            'finance': {key: unknown() for key in FINANCE},
            'costAllocationHash': None,
            'renewal': {'state': 'pending', 'paidMinor': None, 'evidence': []},
            'tasks': [{'taskId': task, 'baselineSeconds': unknown(),
                       'assistedSeconds': unknown(), 'reviewSeconds': unknown(),
                       'remediationSeconds': unknown(), 'accepted': unknown()}
                      for task in pilot['taskIds']],
            'delivery': {'eligible': unknown(), 'confirmed': unknown()},
            'operations': {key: unknown() for key in (
                'openCriticalDefects', 'interventions', 'exceptions', 'supportSeconds',
                'onboardingSeconds', 'completedTasks', 'elapsedSeconds', 'acceptedOutcome')},
            'outcomes': [],
        } for pilot in program['cohort']],
        'acceptance': [{'id': key, 'state': 'pending', 'evidence': []} for key in ACCEPTANCE],
        'demand': [],
    }


def wilson(confirmed, total):
    """Two-sided 95% Wilson interval; descriptive binomial assumption only."""
    if total == 0:
        return None
    z = 1.959963984540054
    p = confirmed / total
    denominator = 1 + z*z/total
    center = (p + z*z/(2*total)) / denominator
    half = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / denominator
    return [round(100 * max(0, center-half), 6), round(100 * min(1, center+half), 6)]


def metrics(pilot, spec):
    shape(pilot, ['pilotId', 'clientId', 'finance', 'costAllocationHash', 'renewal',
                  'tasks', 'delivery', 'operations', 'outcomes'])
    if pilot['clientId'] != spec['clientId']:
        raise ValueError('Cross-client evidence is not allowed')
    shape(pilot['finance'], FINANCE)
    money = {key: fact(pilot['finance'][key]) for key in FINANCE}
    if any(v is not None for v in money.values()):
        identity(pilot['costAllocationHash'])
    elif pilot['costAllocationHash'] is not None:
        identity(pilot['costAllocationHash'])
    renewal = pilot['renewal']
    shape(renewal, ['state', 'paidMinor', 'evidence'])
    if renewal['state'] not in ('pending', 'declined', 'signed_unpaid', 'paid_renewed'):
        raise ValueError('Unknown renewal state')
    refs(renewal['evidence'], renewal['state'] != 'pending')
    if renewal['state'] == 'paid_renewed':
        if integer(renewal['paidMinor']) == 0:
            raise ValueError('Paid renewal requires a positive payment')
    elif renewal['paidMinor'] is not None:
        raise ValueError('Only a paid renewal may report renewal payment')
    if distinct(pilot['tasks'], 'taskId') != set(spec['taskIds']):
        raise ValueError('Report every frozen task exactly once, including failures and unknowns')
    pairs = []; accepted = []; incomplete = 0
    for task in pilot['tasks']:
        shape(task, ['taskId', 'baselineSeconds', 'assistedSeconds', 'reviewSeconds',
                     'remediationSeconds', 'accepted'])
        times = [fact(task[k]) for k in ('baselineSeconds', 'assistedSeconds', 'reviewSeconds', 'remediationSeconds')]
        accepted.append(fact(task['accepted'], True))
        if any(t is None for t in times):
            incomplete += 1
        else:
            pairs.append((times[0], sum(times[1:])))
    baseline = median([a for a, _ in pairs]) if pairs and not incomplete else None
    assisted = median([b for _, b in pairs]) if pairs and not incomplete else None
    saving = round(100*(baseline-assisted)/baseline, 6) if baseline else None
    delivery = pilot['delivery']; shape(delivery, ['eligible', 'confirmed'])
    eligible = fact(delivery['eligible']); confirmed = fact(delivery['confirmed'])
    if eligible is None or confirmed is None:
        interval = rate = None
    else:
        if confirmed > eligible:
            raise ValueError('Confirmed deliveries exceed the eligible denominator')
        interval = wilson(confirmed, eligible)
        rate = round(100*confirmed/eligible, 6) if eligible else None
    ops = pilot['operations']
    shape(ops, ['openCriticalDefects', 'interventions', 'exceptions', 'supportSeconds',
               'onboardingSeconds', 'completedTasks', 'elapsedSeconds', 'acceptedOutcome'])
    operations = {key: fact(value, key == 'acceptedOutcome') for key, value in ops.items()}
    distinct(pilot['outcomes'], 'metricId')
    for outcome in pilot['outcomes']:
        shape(outcome, ['metricId', 'definitionHash', 'value', 'unit', 'evidence'])
        identity(outcome['metricId']); identity(outcome['definitionHash'])
        if not isinstance(outcome['unit'], str) or not re.fullmatch('[a-zA-Z0-9_%/ -]{1,40}', outcome['unit']):
            raise ValueError('Use a short unit, not private content')
        refs(outcome['evidence'], outcome['value'] is not None)
        if outcome['value'] is not None:
            if not isinstance(outcome['value'], str) or len(outcome['value']) > 40:
                raise ValueError('Outcome values use decimal strings')
            try:
                if not Decimal(outcome['value']).is_finite():
                    raise ValueError('Outcome must be finite')
            except InvalidOperation as e:
                raise ValueError('Invalid outcome value') from e
    cost = sum(money[k] for k in COSTS) if all(money[k] is not None for k in COSTS) else None
    fees = money['earnedFees']
    contribution = fees - cost if fees is not None and cost is not None else None
    margin = round(100*contribution/fees, 6) if fees and contribution is not None else None
    pass_margin = money['passThroughRevenue'] - money['passThroughCosts'] if money['passThroughRevenue'] is not None and money['passThroughCosts'] is not None else None
    n = len(accepted)
    elapsed = operations['elapsedSeconds']; completed = operations['completedTasks']
    return {
        'pilotId': spec['pilotId'], 'clientId': spec['clientId'], 'products': spec['products'],
        'paidPilot': money['paidFees'] > 0 if money['paidFees'] is not None else None,
        'renewal': renewal['state'], 'finance': money,
        'directCostMinor': cost, 'contributionMinor': contribution,
        'contributionPercent': margin, 'passThroughMarginMinor': pass_margin,
        'tasks': {'planned': n, 'completeTimePairs': len(pairs), 'unknownTimePairs': incomplete,
                  'accepted': accepted.count(True), 'rejected': accepted.count(False),
                  'unknownAcceptance': accepted.count(None), 'baselineMedianSeconds': baseline,
                  'assistedMedianSeconds': assisted, 'humanSavingPercent': saving},
        'delivery': {'eligible': eligible, 'confirmed': confirmed, 'confirmedPercent': rate,
                     'wilson95Percent': interval},
        'operations': operations,
        'tasksPerHour': round(completed*3600/elapsed, 6) if elapsed and completed is not None else None,
        'outcomes': pilot['outcomes'],
    }


def review(program, expected_hash, evidence):
    validate_program(program); sealed(program, expected_hash)
    shape(evidence, ['programHash', 'source', 'asOf', 'reviewerId', 'sources', 'pilots', 'acceptance', 'demand'])
    if evidence['programHash'] != expected_hash or evidence['source'] != program['source']:
        raise ValueError('Evidence belongs to another program or provenance')
    as_of = timestamp(evidence['asOf']); identity(evidence['reviewerId'])
    if as_of < timestamp(program['frozenAt']):
        raise ValueError('Review predates frozen program')
    distinct(evidence['sources'], 'sha256')
    sources = {}
    for source in evidence['sources']:
        shape(source, ['sha256', 'clientId', 'availableAt'])
        identity(source['sha256'])
        if source['clientId'] is not None:
            identity(source['clientId'])
        if timestamp(source['availableAt']) > as_of:
            raise ValueError('Future evidence is unavailable at this review cutoff')
        sources[source['sha256']] = source

    def check_sources(value, clients):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == 'evidence' or key in ('costAllocationHash', 'alternativeHash', 'decisionHash'):
                    hashes = child if isinstance(child, list) else [child] if child is not None else []
                    for h in hashes:
                        if h not in sources or sources[h]['clientId'] not in clients:
                            raise ValueError('Missing or cross-client source evidence')
                else:
                    check_sources(child, clients)
        elif isinstance(value, list):
            for child in value:
                check_sources(child, clients)
    specs = {p['pilotId']: p for p in program['cohort']}
    if distinct(evidence['pilots'], 'pilotId') != specs.keys():
        raise ValueError('Report the entire frozen pilot cohort; no selective reporting')
    pilots = [metrics(p, specs[p['pilotId']]) for p in sorted(evidence['pilots'], key=lambda p: p['pilotId'])]
    for p in evidence['pilots']:
        check_sources(p, {p['clientId']})
    if distinct(evidence['acceptance'], 'id') != set(ACCEPTANCE):
        raise ValueError('Every prerequisite must remain visible')
    for gate in evidence['acceptance']:
        shape(gate, ['id', 'state', 'evidence'])
        if gate['state'] not in ('pending', 'failed', 'reported_satisfied'):
            raise ValueError('Unknown acceptance state')
        refs(gate['evidence'], gate['state'] != 'pending')
        check_sources(gate, {None})
    distinct(evidence['demand'], 'id')
    for request in evidence['demand']:
        shape(request, ['id', 'kind', 'pilotIds', 'evidence', 'alternativeHash', 'decision',
                        'ownerId', 'decisionHash'])
        identity(request['id'])
        if request['kind'] not in ('integration', 'specialization', 'roles', 'client_access', 'capacity', 'delegation'):
            raise ValueError('Unknown expansion category')
        refs(request['pilotIds'], True)
        if not set(request['pilotIds']) <= specs.keys():
            raise ValueError('Demand must reference this cohort')
        refs(request['evidence'], True); identity(request['alternativeHash'])
        if request['decision'] not in ('pending', 'defer', 'investigate', 'propose_scoped_work'):
            raise ValueError('Expansion cannot grant execution authority')
        if request['decision'] != 'pending':
            identity(request['ownerId']); identity(request['decisionHash'])
        elif request['ownerId'] is not None or request['decisionHash'] is not None:
            raise ValueError('Pending demand must not imply an owner decision')
        check_sources(request, {None} | {specs[pid]['clientId'] for pid in request['pilotIds']})
    rules = program['rules']; checks = []

    def check(key, value, target, pilot_id=None):
        checks.append({'id': key, 'pilotId': pilot_id, 'actual': value, 'requiredMinimum': target,
                       'state': 'unknown' if value is None else 'met' if value >= target else 'not_met'})

    paid = sum(p['paidPilot'] is True for p in pilots)
    renewed = sum(p['renewal'] == 'paid_renewed' for p in pilots)
    if rules is not None:
        check('paid_pilots', paid, rules['minimumPaidPilots'])
        check('paid_renewals', renewed, rules['minimumRenewedPilots'])
        for p in pilots:
            pid = p['pilotId']; task = p['tasks']; d = p['delivery']; ops = p['operations']
            check('complete_task_sample', task['completeTimePairs'], rules['minimumTasksPerPilot'], pid)
            check('human_saving_percent', task['humanSavingPercent'], rules['minimumHumanSavingPercent'], pid)
            check('contribution_percent', p['contributionPercent'], rules['minimumContributionPercent'], pid)
            check('delivery_sample', d['eligible'], rules['minimumDeliverySample'], pid)
            # A perfect tiny sample cannot prove reliability. Use the lower bound.
            check('delivery_95_lower_percent', d['wilson95Percent'][0] if d['wilson95Percent'] else None,
                  rules['minimumDeliveryLower95Percent'], pid)
            check('no_critical_defects', None if ops['openCriticalDefects'] is None else int(ops['openCriticalDefects'] == 0), 1, pid)
            check('all_tasks_accepted', None if task['unknownAcceptance'] else int(task['accepted'] == task['planned']), 1, pid)
            check('client_outcome_accepted', None if ops['acceptedOutcome'] is None else int(ops['acceptedOutcome']), 1, pid)
            check('measured_outcome_present', int(any(x['value'] is not None for x in p['outcomes'])), 1, pid)
    prerequisites = [g['id'] for g in evidence['acceptance'] if g['state'] != 'reported_satisfied']
    incomplete_ops = [p['pilotId'] for p in pilots if any(v is None for v in p['operations'].values())]
    incomplete_money = [p['pilotId'] for p in pilots if any(v is None for v in p['finance'].values())]
    open_period = as_of.astimezone(timezone.utc).date() <= date.fromisoformat(program['period']['end'])
    blockers = []
    if rules is None:
        blockers.append('continuation_rules_not_adopted')
    if any(c['state'] != 'met' for c in checks):
        blockers.append('continuation_checks_incomplete_or_not_met')
    if prerequisites:
        blockers.append('prerequisite_acceptance_pending_or_failed')
    if incomplete_ops or incomplete_money:
        blockers.append('incomplete_cost_or_operations_records')
    if open_period:
        blockers.append('observation_period_not_closed')
    result = {
        'policy': POLICY, 'programHash': expected_hash, 'evidenceHash': digest(evidence),
        'source': program['source'], 'asOf': evidence['asOf'], 'reviewerId': evidence['reviewerId'],
        'period': program['period'], 'comparison': program['comparison'], 'currency': program['currency'], 'minorUnitDigits': program['minorUnitDigits'],
        'periodTimeZone': 'UTC',
        'comparisonTiming': 'prospective' if timestamp(program['frozenAt']).astimezone(timezone.utc).date() < date.fromisoformat(program['period']['start']) else 'retrospective',
        'status': 'synthetic_rehearsal' if program['source'] == 'synthetic' else 'evidence_incomplete' if blockers else 'ready_for_independent_review',
        'provenanceVerification': 'fixture' if program['source'] == 'synthetic' else 'imported_unverified',
        'blockers': blockers, 'openPrerequisites': prerequisites,
        'incompleteOperations': incomplete_ops, 'incompleteFinance': incomplete_money,
        'pilots': pilots, 'paidPilots': paid, 'paidClients': len({p['clientId'] for p in pilots if p['paidPilot'] is True}),
        'paidRenewals': renewed, 'rules': rules, 'checks': checks, 'acceptance': evidence['acceptance'],
        'demand': evidence['demand'], 'launchAuthorized': False, 'trainingEnabled': False,
        'permissionExpansionAuthorized': False, 'limitations': LIMITS,
    }
    return seal(result)


def markdown(report):
    def display(value):
        return 'Unknown' if value is None else str(value)

    lines = ['# Paid-pilot and expansion review', '',
             f"Status: **{report['status']}**. Source: **{report['source']}**; supplied evidence is not independently verified.", '',
             f"Period: {report['period']['start']} to {report['period']['end']} inclusive, UTC. Currency: {report['currency']} ({report['minorUnitDigits']} minor-unit digits).",
             f"Comparison: {report['comparison']['baselineKind']}; {report['comparisonTiming']} selection.",
             f"Paid pilots: {report['paidPilots']}; distinct paid clients: {report['paidClients']}; paid renewals: {report['paidRenewals']}.", '',
             'This review grants no launch, spending, training or expanded permissions.', '',
             '| Pilot reference | Contribution % | Human time saving % | Task acceptance | Delivery confirmed / eligible | 95% interval % |',
             '|---|---:|---:|---|---|---|']
    for p in report['pilots']:
        t = p['tasks']; d = p['delivery']
        lines.append(f"| {p['pilotId']} | {display(p['contributionPercent'])} | {display(t['humanSavingPercent'])} | {t['accepted']}/{t['planned']} ({t['unknownAcceptance']} unknown) | {display(d['confirmed'])}/{display(d['eligible'])} | {display(d['wilson95Percent'])} |")
    lines += ['', '## Outstanding conditions', '']
    lines += ['- ' + b for b in report['blockers']] or ['- Independent verification and an exact owner decision are still required.']
    lines += ['- Prerequisite: ' + g for g in report['openPrerequisites']]
    lines += ['', '## Adopted continuation checks', '', '| Check | Pilot | Actual | Minimum | State |', '|---|---|---:|---:|---|']
    for c in report['checks']:
        lines.append(f"| {c['id']} | {c['pilotId'] or 'Cohort'} | {display(c['actual'])} | {c['requiredMinimum']} | {c['state']} |")
    if report['rules'] is None:
        lines += ['', 'No thresholds have been adopted. Planning examples were not applied automatically.']
    lines += ['', '## Demand decisions', '']
    lines += [f"- {d['kind']}: {d['decision']} ({d['id']}); {len(d['pilotIds'])} cited pilots." for d in report['demand']] or ['- No evidenced expansion request recorded.']
    lines += ['', '## Interpretation', ''] + ['- ' + x for x in report['limitations']]
    lines += ['', 'Delivery intervals assume independent binomial trials. Correlated incidents, missing eligibility and selective sampling invalidate that interpretation. Read the denominator evidence.',
              '', f"Program hash: `{report['programHash']}`", f"Evidence hash: `{report['evidenceHash']}`", f"Report hash: `{report['contentHash']}`", '']
    return '\n'.join(lines)


def write_bundle(output, program, evidence, report, previous=None):
    # Compute and validate everything before creating an immutable new directory.
    previous_hash = None; changes = []
    if previous is not None:
        verify_bundle(previous)
        old = json.loads((previous / 'report.json').read_text())
        if old['programHash'] != report['programHash']:
            raise ValueError('A review revision cannot silently replace the frozen cohort or rules')
        if timestamp(old['asOf']) > timestamp(report['asOf']):
            raise ValueError('A revision cannot move the review date backwards')
        previous_hash = old['contentHash']
        old_evidence = json.loads((previous / 'evidence.json').read_text())
        for field in evidence:
            if old_evidence[field] != evidence[field]:
                changes.append(field)
    bodies = {'program.json': json.dumps(program, indent=2)+'\n',
              'evidence.json': json.dumps(evidence, indent=2)+'\n',
              'report.json': json.dumps(report, indent=2)+'\n', 'report.md': markdown(report)}
    manifest = seal({'policy': POLICY, 'reportHash': report['contentHash'],
                     'previousReportHash': previous_hash, 'changedSections': changes,
                     'files': {k: hashlib.sha256(v.encode()).hexdigest() for k, v in bodies.items()}})
    output.mkdir(parents=True, exist_ok=False)
    for name, body in bodies.items():
        with (output / name).open('x') as f:
            f.write(body)
    write_new(output / 'manifest.json', manifest)


def verify_bundle(folder):
    m = json.loads((folder / 'manifest.json').read_text()); sealed(m)
    shape(m, ['policy', 'reportHash', 'previousReportHash', 'changedSections', 'files', 'contentHash'])
    if m['policy'] != POLICY or set(m['files']) != {'program.json', 'evidence.json', 'report.json', 'report.md'}:
        raise ValueError('Unknown review bundle')
    for name, h in m['files'].items():
        if (folder / name).is_symlink() or hashlib.sha256((folder / name).read_bytes()).hexdigest() != h:
            raise ValueError('Bundle file changed')
    program = json.loads((folder / 'program.json').read_text())
    evidence = json.loads((folder / 'evidence.json').read_text())
    report = json.loads((folder / 'report.json').read_text())
    if report != review(program, program['contentHash'], evidence) or report['contentHash'] != m['reportHash']:
        raise ValueError('Report does not match its frozen inputs')
    if (folder / 'report.md').read_text() != markdown(report):
        raise ValueError('Readable report does not match calculation')
    return m


def template():
    return {'policy': POLICY, 'source': 'imported_records', 'programId': None,
            'frozenAt': None, 'period': {'start': None, 'end': None},
            'comparison': {'baselineKind': None, 'contractHash': None},
            'currency': None, 'minorUnitDigits': None, 'cohort': [], 'rules': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    a = commands.add_parser('template'); a.add_argument('--output', type=Path, required=True)
    a = commands.add_parser('freeze'); a.add_argument('--program', type=Path, required=True); a.add_argument('--output', type=Path, required=True)
    a = commands.add_parser('evidence-template'); a.add_argument('--program', type=Path, required=True); a.add_argument('--output', type=Path, required=True)
    a = commands.add_parser('review'); a.add_argument('--program', type=Path, required=True); a.add_argument('--program-hash', required=True); a.add_argument('--evidence', type=Path, required=True); a.add_argument('--output', type=Path, required=True); a.add_argument('--previous', type=Path)
    a = commands.add_parser('verify'); a.add_argument('--bundle', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'template':
            write_new(args.output, template()); result = {'status': 'blank_template_created'}
        elif args.command == 'freeze':
            result = freeze(json.loads(args.program.read_text())); write_new(args.output, result)
        elif args.command == 'evidence-template':
            result = evidence_template(json.loads(args.program.read_text())); write_new(args.output, result)
        elif args.command == 'verify':
            result = verify_bundle(args.bundle)
        else:
            program = json.loads(args.program.read_text()); evidence = json.loads(args.evidence.read_text())
            result = review(program, args.program_hash, evidence)
            write_bundle(args.output, program, evidence, result, args.previous)
        print(json.dumps({k: result[k] for k in ('status', 'contentHash', 'reportHash', 'blockers') if k in result}))
        return 0
    except (ValueError, KeyError, TypeError, OSError, OverflowError) as e:
        print(json.dumps({'status': 'failed', 'reason': str(e)})); return 1


if __name__ == '__main__':
    raise SystemExit(main())
