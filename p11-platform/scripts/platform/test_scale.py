import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scale import (ACCEPTANCE, FINANCE, digest, evidence_template, freeze, markdown,
                   review, seal, template, unknown, verify_bundle, wilson, write_bundle)


def fixture():
    h = lambda label: digest(label)
    plan = template()
    plan.update(source='synthetic', programId=h('program'), frozenAt='2026-08-01T00:00:00Z',
                period={'start': '2026-08-02', 'end': '2026-08-31'}, currency='USD', minorUnitDigits=2,
                comparison={'baselineKind': 'general_ai_assistant', 'contractHash': h('comparison')},
                cohort=[{'pilotId': h('pilot'), 'clientId': h('client'), 'products': ['siteforge', 'lumaleasing'],
                         'taskIds': [h('task1'), h('task2')], 'scopeHash': h('scope'), 'permissionHash': h('permission')}],
                rules={'adoptedBy': h('owner'), 'adoptedAt': '2026-08-01T00:00:00Z', 'decisionHash': h('decision'),
                       'minimumPaidPilots': 1, 'minimumRenewedPilots': 1, 'minimumTasksPerPilot': 2,
                       'minimumHumanSavingPercent': 50, 'minimumContributionPercent': 60,
                       'minimumDeliveryLower95Percent': 99, 'minimumDeliverySample': 100})
    plan = freeze(plan)
    evidence = evidence_template(plan)
    evidence.update(asOf='2026-09-01T00:00:00Z', reviewerId=h('reviewer'), sources=[
        {'sha256': h('client-source'), 'clientId': h('client'), 'availableAt': '2026-08-31T00:00:00Z'},
        {'sha256': h('organization-source'), 'clientId': None, 'availableAt': '2026-08-31T00:00:00Z'}])
    fact = lambda v: {'value': v, 'evidence': [h('client-source')]}
    p = evidence['pilots'][0]
    p['finance'] = {k: fact(v) for k, v in zip(FINANCE, [100000, 100000, 500000, 500000, 10000, 5000, 2000, 3000, 10000])}
    p['costAllocationHash'] = h('client-source')
    p['renewal'] = {'state': 'paid_renewed', 'paidMinor': 100000, 'evidence': [h('client-source')]}
    for t in p['tasks']:
        t.update(baselineSeconds=fact(100), assistedSeconds=fact(20), reviewSeconds=fact(10),
                 remediationSeconds=fact(10), accepted=fact(True))
    p['delivery'] = {'eligible': fact(1000), 'confirmed': fact(1000)}
    p['operations'] = {k: fact(v) for k, v in zip(p['operations'], [0, 2, 0, 500, 1000, 2, 10000, True])}
    p['outcomes'] = [{'metricId': h('metric'), 'definitionHash': h('definition'), 'value': '12.5',
                      'unit': 'accepted sites', 'evidence': [h('client-source')]}]
    evidence['acceptance'] = [{'id': k, 'state': 'reported_satisfied', 'evidence': [h('organization-source')]} for k in ACCEPTANCE]
    return plan, evidence


class DemandReviewTests(unittest.TestCase):
    def setUp(self):
        self.program, self.evidence = fixture()
        self.p = self.evidence['pilots'][0]

    def run_review(self):
        return review(self.program, self.program['contentHash'], self.evidence)

    def reseal(self):
        self.program = seal({k: v for k, v in self.program.items() if k != 'contentHash'})
        self.evidence['programHash'] = self.program['contentHash']

    def check_state(self, key):
        return next(c['state'] for c in self.run_review()['checks'] if c['id'] == key)

    def test_hand_calculated_economics_and_all_effort(self):
        r = self.run_review(); p = r['pilots'][0]
        self.assertEqual(p['directCostMinor'], 30000)
        self.assertEqual(p['contributionMinor'], 70000)
        self.assertEqual(p['contributionPercent'], 70)
        self.assertEqual(p['passThroughMarginMinor'], 0)
        self.assertEqual(p['tasks']['humanSavingPercent'], 60)
        self.assertEqual(p['tasksPerHour'], 0.72)
        self.assertEqual(r['blockers'], [])
        self.assertEqual(r['status'], 'synthetic_rehearsal')
        self.assertFalse(r['launchAuthorized']); self.assertFalse(r['trainingEnabled'])
        self.assertFalse(r['permissionExpansionAuthorized'])

    def test_real_imports_remain_unverified_even_if_checks_met(self):
        self.program['source'] = self.evidence['source'] = 'imported_records'; self.reseal()
        r = self.run_review()
        self.assertEqual(r['status'], 'ready_for_independent_review')
        self.assertEqual(r['provenanceVerification'], 'imported_unverified')
        self.assertFalse(r['launchAuthorized'])

    def test_template_has_no_invented_client_currency_or_financials(self):
        t = template(); self.assertEqual(t['cohort'], []); self.assertIsNone(t['currency']); self.assertIsNone(t['rules'])
        with self.assertRaises(ValueError): freeze(t)
        e = evidence_template(self.program)
        self.assertTrue(all(v['value'] is None for v in e['pilots'][0]['finance'].values()))

    def test_no_automatic_adoption_of_planning_thresholds(self):
        self.program['rules'] = None; self.reseal()
        r = self.run_review(); self.assertEqual(r['checks'], [])
        self.assertIn('continuation_rules_not_adopted', r['blockers'])

    def test_incomplete_finance_does_not_become_zero(self):
        self.p['finance']['support'] = unknown()
        p = self.run_review()['pilots'][0]
        self.assertIsNone(p['contributionMinor']); self.assertIsNone(p['contributionPercent'])
        self.assertEqual(self.check_state('contribution_percent'), 'unknown')

    def test_zero_revenue_and_negative_contribution(self):
        self.p['finance']['earnedFees']['value'] = 0
        self.assertIsNone(self.run_review()['pilots'][0]['contributionPercent'])
        self.p['finance']['earnedFees']['value'] = 10000
        self.assertEqual(self.run_review()['pilots'][0]['contributionPercent'], -200)

    def test_pass_through_does_not_inflate_fee_margin(self):
        self.p['finance']['passThroughRevenue']['value'] = 999999999
        self.assertEqual(self.run_review()['pilots'][0]['contributionPercent'], 70)

    def test_missing_pass_through_cost_prevents_readiness(self):
        self.p['finance']['passThroughCosts'] = unknown()
        self.assertTrue(self.run_review()['incompleteFinance'])

    def test_money_rejects_floats_boolean_negative_and_excess(self):
        for value in [0.01, True, -1, 10**16]:
            with self.subTest(value=value):
                self.p['finance']['providers']['value'] = value
                with self.assertRaises(ValueError): self.run_review()

    def test_arbitrary_and_nonfinite_metrics_rejected(self):
        for v in ['NaN', 'Infinity', 'client said yes', 10.0]:
            with self.subTest(value=v):
                self.p['outcomes'][0]['value'] = v
                with self.assertRaises(ValueError): self.run_review()

    def test_signed_contract_is_not_paid_renewal(self):
        self.p['renewal'].update(state='signed_unpaid', paidMinor=None)
        self.assertEqual(self.run_review()['paidRenewals'], 0)
        self.assertEqual(self.check_state('paid_renewals'), 'not_met')

    def test_zero_payment_cannot_count_as_renewal(self):
        self.p['renewal']['paidMinor'] = 0
        with self.assertRaisesRegex(ValueError, 'positive'): self.run_review()

    def test_complete_frozen_cohort_required(self):
        self.evidence['pilots'] = []
        with self.assertRaisesRegex(ValueError, 'entire frozen'): self.run_review()

    def test_task_cannot_be_omitted_or_duplicated(self):
        task = copy.deepcopy(self.p['tasks'][0])
        self.p['tasks'].pop()
        with self.assertRaisesRegex(ValueError, 'every frozen task'): self.run_review()
        self.p['tasks'].append(task)
        with self.assertRaisesRegex(ValueError, 'Duplicate'): self.run_review()

    def test_failed_task_remains_in_time_comparison(self):
        self.p['tasks'][0]['accepted']['value'] = False
        self.p['tasks'][0]['remediationSeconds']['value'] = 200
        p = self.run_review()['pilots'][0]
        self.assertEqual(p['tasks']['rejected'], 1)
        self.assertEqual(p['tasks']['humanSavingPercent'], -35)
        self.assertEqual(self.check_state('all_tasks_accepted'), 'not_met')

    def test_incomplete_time_does_not_use_only_good_pairs(self):
        self.p['tasks'][0]['reviewSeconds'] = unknown()
        p = self.run_review()['pilots'][0]
        self.assertIsNone(p['tasks']['humanSavingPercent'])
        self.assertEqual(p['tasks']['unknownTimePairs'], 1)

    def test_zero_baseline_stays_unknown(self):
        for t in self.p['tasks']: t['baselineSeconds']['value'] = 0
        self.assertIsNone(self.run_review()['pilots'][0]['tasks']['humanSavingPercent'])

    def test_tiny_perfect_sample_cannot_prove_99_percent(self):
        for k in self.p['delivery']: self.p['delivery'][k]['value'] = 2
        self.assertEqual(self.run_review()['pilots'][0]['delivery']['confirmedPercent'], 100)
        self.assertEqual(self.check_state('delivery_95_lower_percent'), 'not_met')

    def test_wilson_known_values_and_zero_denominator(self):
        self.assertIsNone(wilson(0, 0))
        self.assertAlmostEqual(wilson(50, 100)[0], 40.383153, places=5)
        self.assertAlmostEqual(wilson(50, 100)[1], 59.616847, places=5)
        for k in self.p['delivery']: self.p['delivery'][k]['value'] = 0
        self.assertIsNone(self.run_review()['pilots'][0]['delivery']['confirmedPercent'])

    def test_impossible_delivery_counts_rejected(self):
        self.p['delivery']['confirmed']['value'] = 1001
        with self.assertRaisesRegex(ValueError, 'denominator'): self.run_review()

    def test_defects_and_missing_outcomes_hold(self):
        self.p['operations']['openCriticalDefects']['value'] = 1
        self.p['outcomes'] = []
        self.assertEqual(self.check_state('no_critical_defects'), 'not_met')
        self.assertEqual(self.check_state('measured_outcome_present'), 'not_met')

    def test_acceptance_cannot_be_skipped_or_override_pending(self):
        self.evidence['acceptance'][0]['state'] = 'pending'
        self.assertIn(ACCEPTANCE[0], self.run_review()['openPrerequisites'])
        self.evidence['acceptance'].pop()
        with self.assertRaisesRegex(ValueError, 'Every prerequisite'): self.run_review()

    def test_open_period_is_not_full_period_evidence(self):
        self.evidence['asOf'] = '2026-08-31T23:59:59Z'
        self.assertIn('observation_period_not_closed', self.run_review()['blockers'])

    def test_future_sources_rejected(self):
        self.evidence['sources'][0]['availableAt'] = '2026-10-01T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Future'): self.run_review()

    def test_period_cutoff_uses_utc_not_supplied_local_date(self):
        self.evidence['asOf'] = '2026-09-01T01:00:00+14:00'
        self.assertIn('observation_period_not_closed', self.run_review()['blockers'])

    def test_cross_client_sources_and_missing_reference_rejected(self):
        self.evidence['sources'][0]['clientId'] = digest('another client')
        with self.assertRaisesRegex(ValueError, 'cross-client'): self.run_review()
        self.evidence['sources'] = []
        with self.assertRaisesRegex(ValueError, 'source evidence'): self.run_review()

    def test_cross_client_pilot_rejected(self):
        self.p['clientId'] = digest('another client')
        with self.assertRaisesRegex(ValueError, 'Cross-client'): self.run_review()

    def test_changed_program_or_wrong_expected_hash_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected frozen'): review(self.program, 'f'*64, self.evidence)
        self.program['currency'] = 'CAD'
        with self.assertRaisesRegex(ValueError, 'changed'): self.run_review()

    def test_rules_cannot_be_adopted_after_frozen_scope(self):
        self.program['rules']['adoptedAt'] = '2026-09-01T00:00:00Z'; self.reseal()
        with self.assertRaisesRegex(ValueError, 'adopted after'): self.run_review()

    def test_evidence_requires_actual_sources(self):
        self.p['finance']['paidFees']['evidence'] = []
        with self.assertRaisesRegex(ValueError, 'source evidence'): self.run_review()

    def demand(self):
        return {'id': digest('demand'), 'kind': 'roles', 'pilotIds': [self.p['pilotId']],
                'evidence': [digest('client-source')], 'alternativeHash': digest('organization-source'),
                'decision': 'propose_scoped_work', 'ownerId': digest('owner'), 'decisionHash': digest('organization-source')}

    def test_demand_records_are_bounded_proposals_only(self):
        self.evidence['demand'] = [self.demand()]
        self.assertFalse(self.run_review()['permissionExpansionAuthorized'])
        self.evidence['demand'][0]['decision'] = 'enable'
        with self.assertRaisesRegex(ValueError, 'authority'): self.run_review()

    def test_demand_must_link_actual_cohort_and_owner_decision(self):
        d = self.demand(); self.evidence['demand'] = [d]; d['pilotIds'] = [digest('missing')]
        with self.assertRaisesRegex(ValueError, 'this cohort'): self.run_review()
        d['pilotIds'] = [self.p['pilotId']]; d['ownerId'] = None
        with self.assertRaises(ValueError): self.run_review()

    def test_unknown_fields_cannot_smuggle_launch_or_training(self):
        self.evidence['launchAuthorized'] = True
        with self.assertRaises(ValueError): self.run_review()

    def test_deterministic_complete_markdown(self):
        report = self.run_review()
        self.assertEqual(report, self.run_review())
        m = markdown(report)
        for text in ['synthetic_rehearsal', report['contentHash'], 'independently verified', 'Delivery intervals']:
            self.assertIn(text, m)

    def test_immutable_bundle_and_revision_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); first = root/'first'; second = root/'second'
            report = self.run_review(); write_bundle(first, self.program, self.evidence, report)
            verify_bundle(first)
            with self.assertRaises(FileExistsError): write_bundle(first, self.program, self.evidence, report)
            self.p['operations']['exceptions']['value'] = 1
            changed = self.run_review(); write_bundle(second, self.program, self.evidence, changed, first)
            manifest = verify_bundle(second)
            self.assertEqual(manifest['previousReportHash'], report['contentHash'])
            self.assertEqual(manifest['changedSections'], ['pilots'])
            (first/'report.md').write_text('Invented success')
            with self.assertRaisesRegex(ValueError, 'file changed'): verify_bundle(first)

    def test_cannot_silently_replace_cohort_between_reviews(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp)/'first'; write_bundle(first, self.program, self.evidence, self.run_review())
            self.program['rules'] = None; self.reseal()
            with self.assertRaisesRegex(ValueError, 'cohort or rules'):
                write_bundle(Path(tmp)/'second', self.program, self.evidence, self.run_review(), first)
            self.assertFalse((Path(tmp)/'second').exists())

    def test_verify_recomputes_not_just_hash_labels(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)/'bundle'; write_bundle(folder, self.program, self.evidence, self.run_review())
            report = json.loads((folder/'report.json').read_text()); report['launchAuthorized'] = True
            report = seal({k: v for k, v in report.items() if k != 'contentHash'})
            (folder/'report.json').write_text(json.dumps(report))
            manifest = json.loads((folder/'manifest.json').read_text())
            manifest['files']['report.json'] = hashlib.sha256((folder/'report.json').read_bytes()).hexdigest()
            manifest['reportHash'] = report['contentHash']; manifest = seal({k: v for k, v in manifest.items() if k != 'contentHash'})
            (folder/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'frozen inputs'): verify_bundle(folder)

    def test_real_cli_unknown_facts_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'program.json'
            command = [sys.executable, str(Path(__file__).with_name('scale.py')), 'template', '--output', str(path)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(json.loads(path.read_text()), template())
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)

    def test_shipped_fixture_matches_qualified_contract(self):
        folder = Path(__file__).with_name('fixtures')
        self.assertEqual(json.loads((folder/'demand-program-v1.json').read_text()), self.program)
        self.assertEqual(json.loads((folder/'demand-fixture-evidence-v1.json').read_text()), self.evidence)


if __name__ == '__main__':
    unittest.main()
