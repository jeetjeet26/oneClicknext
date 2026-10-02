#!/usr/bin/env python3
"""Reproduce an explicitly reviewed upgrade in a new local Supabase database.

Prepare freezes schema-only baseline files, an exact release bundle, synthetic
fixtures and tests. Run never targets postgres, resets a DB or writes history.
This is local qualification, not deployment or whole-platform acceptance.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from drift import compare, digest, validate, write_json

PROJECT = 'lmjmutuggvzuadwreqxx'
CONTAINER = 'supabase_db_p11-platform'
BLOCKED = {'reviewflow_responses.test.sql'}
WRAPPED = {'marketing_fact_identity.test.sql', 'marketing_import_recovery.test.sql', 'phase_zero_access.test.sql'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def checked_path(root, name):
    root = Path(root).resolve()
    path = root / name
    if Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('Input must stay within its reviewed directory')
    if any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(root)):
        raise ValueError('Symlink inputs are not supported')
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise ValueError('Missing reviewed input: ' + str(name))
    return path


def reference(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Input must be an ordinary file')
    return {'path': str(path.resolve()), 'sha256': sha(path.read_bytes())}


def content(ref):
    path = Path(ref['path'])
    if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != ref['sha256']:
        raise ValueError('Reviewed input changed: ' + path.name)
    return path.read_bytes()


def signed(value):
    if value.get('contentHash') != digest({k: v for k, v in value.items() if k != 'contentHash'}):
        raise ValueError('Manifest content changed')
    return value


def test_mode(body):
    if re.search(r'\b(?:no_plan|plan)\s*\(', body, re.I) and 'pgtap' in body.lower():
        return 'pgtap'
    if re.search(r'raise\s+exception', body, re.I):
        return 'sql_assertions'
    raise ValueError('Test has no recognized assertion contract')


def prepare(platform, baseline_path, bundle_path):
    platform, baseline_path, bundle_path = map(Path, [platform, baseline_path, bundle_path])
    baseline = signed(read_json(baseline_path))
    bundle = signed(read_json(bundle_path / 'manifest.json'))
    snapshot = validate(read_json(checked_path(baseline_path.parent, baseline['snapshot'])))
    expected = validate(read_json(checked_path(baseline_path.parent, baseline['expectedCandidate'])))
    if baseline.get('formatVersion') != 1 or baseline.get('scope') != 'reviewed_schema_only_local_rehearsal':
        raise ValueError('A reviewed schema-only baseline is required')
    if snapshot['source'] != 'production' or snapshot['projectRef'] != PROJECT or bundle['projectRef'] != PROJECT:
        raise ValueError('Wrong production project')
    if bundle['productionSnapshotHash'] != snapshot['contentHash']:
        raise ValueError('Bundle was not prepared from this production snapshot')
    if expected['source'] != 'local' or not re.fullmatch(r'local:p11-platform:(?:phase6_[a-z0-9_]+|phase7_execution_[0-9]{8})', expected['projectRef']):
        raise ValueError('Expected candidate must be an isolated local rehearsal')
    entries, versions, names = [], set(), set()
    for row in bundle['files']:
        name = row['file']
        if not re.fullmatch(r'[0-9]{14}_[A-Za-z0-9_]+\.sql', name) or name in names or name[:14] in versions:
            raise ValueError('Duplicate or invalid migration identity')
        names.add(name); versions.add(name[:14])
        path = checked_path(bundle_path / 'supabase/migrations', name)
        if sha(path.read_bytes()) != row['sha256'] or row['source'] not in ['production_history', 'pending']:
            raise ValueError('Migration bundle changed')
        if row['source'] == 'pending':
            current = checked_path(platform / 'supabase/migrations', name)
            if sha(current.read_bytes()) != row['sha256']:
                raise ValueError('Repository migration differs from reviewed bundle: ' + name)
        entries.append({**reference(path), 'file': name, 'source': row['source']})
    history = [x for x in entries if x['source'] == 'production_history']
    by_version = {x['file'][:14]: x for x in history}
    if set(by_version) != {x['version'] for x in snapshot['migrations']}:
        raise ValueError('Historical migration coverage differs')
    for row in snapshot['migrations']:
        data = content(by_version[row['version']]).decode()
        if row['statementCount'] != 1 or row['sqlHash'] not in [hashlib.md5(v.encode()).hexdigest() for v in [data, data[:-2] if data.endswith(';\n') else data]]:
            raise ValueError('Historical SQL does not match production')
    tests = []
    for path in sorted((platform / 'supabase/tests').glob('*.test.sql')):
        if path.name in BLOCKED:
            tests.append({'file': path.name, 'gate': 'separate_approval_pending'})
            continue
        body = path.read_text()
        if path.name not in WRAPPED and not re.search(r'(?i)(?:^|;)\s*rollback\s*;', body):
            raise ValueError('Unreviewed test transaction: ' + path.name)
        tests.append({**reference(path), 'file': path.name, 'gate': 'eligible', 'mode': test_mode(body), 'wrap': path.name in WRAPPED})
    if not tests or not any(x['source'] == 'pending' for x in entries):
        raise ValueError('Qualification needs pending migrations and tests')
    inputs = {key: reference(checked_path(baseline_path.parent, baseline[key])) for key in
              ['managedArchive', 'managedList', 'publicSchema', 'privateSchema', 'managedHooks', 'legacyFixture', 'legacyCheck', 'snapshot', 'expectedCandidate']}
    for name, expected_hash in baseline['sha256'].items():
        if name not in inputs or inputs[name]['sha256'] != expected_hash:
            raise ValueError('Baseline input changed')
    if set(baseline['sha256']) != set(inputs):
        raise ValueError('Every baseline file needs a reviewed hash')
    inputs['seed'] = reference(platform / 'supabase/seed.sql')
    inputs['catalog'] = reference(Path(__file__).with_name('catalog.sql'))
    inputs['bundle'] = reference(bundle_path / 'manifest.json')
    inputs['baseline'] = reference(baseline_path)
    value = {'formatVersion': 1, 'kind': 'local_upgrade_rehearsal', 'projectRef': PROJECT,
             'preparedAt': datetime.now(timezone.utc).isoformat(), 'platform': str(platform.resolve()),
             'bundleHash': bundle['contentHash'], 'inputs': inputs, 'migrations': entries,
             'tests': tests, 'limitations': baseline['limitations'], 'productionWrites': False,
             'historyWrites': False, 'wholePhaseAcceptance': 'pending'}
    value['contentHash'] = digest(value)
    return value


def verify_plan(plan):
    signed(plan)
    if plan.get('kind') != 'local_upgrade_rehearsal' or plan.get('projectRef') != PROJECT or plan.get('formatVersion') != 1:
        raise ValueError('Unknown rehearsal contract')
    # Re-preparation catches repository changes, omitted tests and altered gate flags.
    fresh = prepare(plan['platform'], plan['inputs']['baseline']['path'], Path(plan['inputs']['bundle']['path']).parent)
    for key in ['inputs', 'migrations', 'tests', 'bundleHash', 'limitations']:
        if fresh[key] != plan[key]:
            raise ValueError('Qualification inputs changed: ' + key)
    return plan


def check_test_output(output, mode, exit_code):
    if exit_code or re.search(r'(?mi)^\s*(?:not ok\b|Bail out!)|Looks like you (?:failed|planned)', output):
        raise ValueError('Database assertions failed')
    if mode == 'pgtap':
        plans = re.findall(r'(?m)^\s*1\.\.(\d+)\s*$', output)
        checks = re.findall(r'(?m)^\s*ok\s+(\d+)\b', output)
        if len(plans) != 1 or not checks or list(map(int, checks)) != list(range(1, int(plans[0]) + 1)):
            raise ValueError('Missing or incomplete pgTAP result')


def run(plan, database, output):
    verify_plan(plan)
    if not re.fullmatch(r'phase6_rehearsal_[a-z0-9_]{1,35}', database):
        raise ValueError('Only a new phase6_rehearsal_<name> database is allowed')
    output = Path(output)
    if output.exists():
        raise ValueError('Use a new evidence directory; previous trials are preserved')
    # No remote Docker daemon or PostgreSQL connection settings are accepted.
    if os.environ.get('DOCKER_HOST') and not os.environ['DOCKER_HOST'].startswith('unix://'):
        raise ValueError('Remote Docker is not supported')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    def docker(args, data=None):
        return subprocess.run(['docker', *args], input=data, capture_output=True, timeout=240, env=env)
    context = docker(['context', 'inspect'])
    if context.returncode or not json.loads(context.stdout)[0]['Endpoints']['docker']['Host'].startswith('unix://'):
        raise ValueError('A local Unix Docker context is required')
    inspected = docker(['inspect', CONTAINER, '--format', '{{json .}}'])
    if inspected.returncode:
        raise ValueError('Start the local Supabase container first')
    info = json.loads(inspected.stdout)
    if info['Config']['Labels'].get('com.supabase.cli.project') != 'p11-platform' or not info['State']['Running']:
        raise ValueError('Local container identity does not match')
    container = info['Id']
    exists = docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atc',
                     "select count(*) from pg_database where datname='" + database + "'"])
    if exists.returncode or exists.stdout.strip() != b'0':
        raise ValueError('Target database already exists or cannot be checked; no reset performed')
    output.mkdir(parents=True, mode=0o700)
    report = {'formatVersion': 1, 'planHash': plan['contentHash'], 'database': database, 'containerId': container,
              'imageId': info['Image'], 'status': 'running', 'steps': [], 'tests': [], 'wholePhaseAcceptance': 'pending'}
    def save():
        write_json(output / 'report.json', report)
    def command(label, args, data=None, mode=None):
        started = time.monotonic()
        result = docker(args, data)
        text = (result.stdout + result.stderr).decode(errors='replace')
        (output / (label + '.log')).write_text(text)
        report['steps'].append({'name': label, 'exitCode': result.returncode, 'seconds': round(time.monotonic()-started, 3), 'logHash': sha(text.encode())})
        save()
        if mode:
            check_test_output(text, mode, result.returncode)
        elif result.returncode:
            raise ValueError('Step failed; see retained log: ' + label)
        return result.stdout
    def sql(label, data, role='postgres', transaction=True, mode=None):
        return command(label, ['exec', '-i', container, 'psql', '-U', role, '-d', database,
                               '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', *(['-1'] if transaction else [])], data, mode)
    def body(name):
        return content(plan['inputs'][name])
    try:
        save()
        command('create', ['exec', container, 'createdb', '-U', 'supabase_admin', '-O', 'postgres', '-T', 'template0', database])
        # Unique file names; no source data is restored, and --create/--clean are never used.
        remote = '/tmp/' + database
        command('copy-archive', ['cp', plan['inputs']['managedArchive']['path'], container+':'+remote+'.dump'])
        command('copy-list', ['cp', plan['inputs']['managedList']['path'], container+':'+remote+'.list'])
        command('restore-managed', ['exec', container, 'pg_restore', '--schema-only', '--exit-on-error', '-U', 'supabase_admin', '-d', database,
                                    '--use-list='+remote+'.list', remote+'.dump'])
        sql('vector', b'create extension if not exists vector with schema public;', 'supabase_admin')
        for name in ['publicSchema', 'privateSchema', 'managedHooks']:
            sql(name, body(name), 'supabase_admin')
        sql('legacy-before-upgrade', body('legacyFixture'), 'supabase_admin')
        for row in sorted((r for r in plan['migrations'] if r['source'] == 'pending'), key=lambda r: r['file']):
            sql(row['file'], content(row))
            print('UPGRADE', row['file'], flush=True)
        sql('legacy-after-upgrade', body('legacyCheck'))
        sql('seed', body('seed'))
        for row in plan['tests']:
            if row['gate'] != 'eligible':
                report['tests'].append({'file': row['file'], 'status': row['gate']}); save(); continue
            text = content(row)
            if row['wrap']:
                text = b'begin;\n' + text + b'\nrollback;'
            sql('test-'+row['file'], text, transaction=False, mode=row['mode'])
            report['tests'].append({'file': row['file'], 'status': 'passed', 'sha256': row['sha256']})
            save(); print('TEST', row['file'], flush=True)
        sql('legacy-after-tests', body('legacyCheck'))
        history = sql('history-empty', b'select count(*) from supabase_migrations.schema_migrations;')
        if history.strip() != b'0':
            raise ValueError('Rehearsal unexpectedly populated migration history')
        query = body('catalog').decode().strip().rstrip(';')
        raw = sql('candidate-catalog', ("select jsonb_build_object('capturedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),'objects',(select jsonb_agg(x)from("+query+")x),'migrations','[]'::jsonb);").encode())
        candidate = json.loads(raw)
        candidate.update(formatVersion=2, source='local', projectRef='local:p11-platform:'+database, catalogQueryHash=sha(body('catalog')))
        candidate['objects'].sort(key=lambda x:(x['kind'],x['identity'])); candidate['contentHash']=digest(candidate)
        write_json(output/'candidate.json', candidate)
        difference = compare(json.loads(body('expectedCandidate')), candidate)
        write_json(output/'candidate-drift.json', difference)
        if difference['hasDrift']:
            raise ValueError('Candidate differs from the qualified schema; inspect candidate-drift.json')
        report['status'] = 'eligible_local_checks_passed'
        report['pendingMigrations'] = sum(r['source']=='pending' for r in plan['migrations'])
        report['passedSuites'] = sum(r['status']=='passed' for r in report['tests'])
        report['unrunSuites'] = [r for r in report['tests'] if r['status']!='passed']
        report['completedAt'] = datetime.now(timezone.utc).isoformat()
        save(); return report
    except (ValueError, subprocess.TimeoutExpired, OSError) as error:
        report['status']='failed'; report['failure']=str(error); save(); raise


def main():
    parser=argparse.ArgumentParser(description=__doc__); commands=parser.add_subparsers(dest='command',required=True)
    p=commands.add_parser('prepare'); p.add_argument('--platform',required=True,type=Path); p.add_argument('--baseline',required=True,type=Path); p.add_argument('--bundle',required=True,type=Path); p.add_argument('--output',required=True,type=Path)
    p=commands.add_parser('run'); p.add_argument('--plan',required=True,type=Path); p.add_argument('--database',required=True); p.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    try:
        if args.command=='prepare':
            result=prepare(args.platform,args.baseline,args.bundle)
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x') as stream: stream.write(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'status':'prepared', 'planHash':result['contentHash'], 'wholePhaseAcceptance':'pending'}))
        else:
            result=run(read_json(args.plan),args.database,args.output)
            print(json.dumps({k:result[k] for k in ['status','pendingMigrations','passedSuites','unrunSuites','wholePhaseAcceptance']}))
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status':'failed','reason':str(error)})); return 1
if __name__=='__main__':
    raise SystemExit(main())
