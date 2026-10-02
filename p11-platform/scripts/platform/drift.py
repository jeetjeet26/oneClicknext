#!/usr/bin/env python3
"""Read-only catalog capture/comparison and verified migration-bundle preparation.

No command applies SQL migrations or changes migration history. Snapshot contents
are schema metadata and hashes only; client rows and credentials are never queried.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

FORMAT = 2

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def sql_digest(text):
    return hashlib.md5(text.encode()).hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')

def validate(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get('formatVersion') != FORMAT:
        raise ValueError('Unsupported snapshot format')
    for field in ('source', 'projectRef', 'capturedAt', 'catalogQueryHash', 'serverVersion'):
        if not isinstance(snapshot.get(field), str) or not snapshot[field]:
            raise ValueError('Missing snapshot provenance: ' + field)
    if snapshot['source'] not in ('local', 'production'):
        raise ValueError('Unknown snapshot source')
    if snapshot['source'] == 'production' and not re.fullmatch('[a-z]{20}', snapshot['projectRef']):
        raise ValueError('Invalid production project identity')
    if not re.fullmatch('[a-f0-9]{64}', snapshot['catalogQueryHash']):
        raise ValueError('Invalid catalog query hash')
    stamp = datetime.fromisoformat(snapshot['capturedAt'].replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Snapshot capture requires an explicit timezone')
    for field in ('objects', 'migrations'):
        if not isinstance(snapshot.get(field), list):
            raise ValueError('Missing snapshot collection: ' + field)
    for row in snapshot['objects']:
        if not isinstance(row, dict) or not isinstance(row.get('kind'), str) or not row['kind'] or not isinstance(row.get('identity'), str) or not row['identity'] or not isinstance(row.get('value'), dict):
            raise ValueError('Malformed catalog object')
    for row in snapshot['migrations']:
        if not isinstance(row, dict) or not isinstance(row.get('version'), str) or not re.fullmatch('[0-9]{14}', row['version']) or not isinstance(row.get('name'), str):
            raise ValueError('Malformed migration identity')
        if row.get('sqlHash') is not None and not re.fullmatch('[a-f0-9]{32}', row['sqlHash']):
            raise ValueError('Malformed migration SQL hash')
        if row.get('statementCount') is not None and (type(row['statementCount']) is not int or row['statementCount'] < 0):
            raise ValueError('Malformed migration statement count')
    keys = [(x['kind'], x['identity']) for x in snapshot['objects']]
    if len(keys) != len(set(keys)):
        raise ValueError('Duplicate catalog object identity')
    versions = [x['version'] for x in snapshot['migrations']]
    if len(versions) != len(set(versions)):
        raise ValueError('Duplicate migration version')
    expected = digest({k: v for k, v in snapshot.items() if k != 'contentHash'})
    if snapshot.get('contentHash') != expected:
        raise ValueError('Snapshot content hash does not match')
    return snapshot

def compare(baseline, candidate):
    validate(baseline); validate(candidate)
    if baseline['catalogQueryHash'] != candidate['catalogQueryHash']:
        raise ValueError('Catalog query differs; recapture with one query version')
    if baseline['source'] == candidate['source'] == 'production' and baseline['projectRef'] != candidate['projectRef']:
        raise ValueError('Production project mismatch')
    report = {'formatVersion': 1, 'baselineHash': baseline['contentHash'],
              'candidateHash': candidate['contentHash'], 'baselineSource': baseline['source'],
              'candidateSource': candidate['source'], 'schema': [], 'history': []}
    for collection, target, identity in (
        ('objects', 'schema', lambda x: (x['kind'], x['identity'])),
        ('migrations', 'history', lambda x: (x['version'],)),
    ):
        before = {identity(x): x for x in baseline[collection]}
        after = {identity(x): x for x in candidate[collection]}
        for key in sorted(before.keys() | after.keys()):
            a, b = before.get(key), after.get(key)
            if a == b:
                continue
            entry = {'identity': list(key), 'change': 'added' if a is None else 'removed' if b is None else 'changed',
                     'beforeHash': digest(a) if a is not None else None,
                     'afterHash': digest(b) if b is not None else None}
            if a is not None and b is not None:
                av, bv = (a['value'], b['value']) if target == 'schema' else (a, b)
                entry['fields'] = [k for k in sorted(av.keys() | bv.keys()) if (k in av) != (k in bv) or av.get(k) != bv.get(k)]
            report[target].append(entry)
    report['hasDrift'] = bool(report['schema'] or report['history'])
    report['sameTarget'] = baseline['source'] == candidate['source'] and baseline['projectRef'] == candidate['projectRef']
    # A local comparison is evidence of pending work, never a hosted release certificate.
    report['status'] = 'drift_detected' if report['hasDrift'] else 'matching_snapshot' if report['sameTarget'] else 'matching_structure_different_environment'
    return report

def unwrap(value):
    if isinstance(value, str):
        return unwrap(json.loads(value))
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError('Expected one catalog result')
        return unwrap(value[0])
    if isinstance(value, dict):
        if 'objects' in value and 'migrations' in value:
            return value
        for key in ('snapshot', 'result', 'rows', 'data'):
            if key in value:
                return unwrap(value[key])
    raise ValueError('Unrecognized catalog response')

def capture(args):
    query_path = Path(__file__).with_name('catalog.sql')
    query = query_path.read_text().rstrip().rstrip(';')
    query_hash = hashlib.sha256(query_path.read_bytes()).hexdigest()
    sql = "select jsonb_build_object('capturedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),'objects',(select coalesce(jsonb_agg(x),'[]'::jsonb)from(" + query + ")x),'migrations',(select coalesce(jsonb_agg(x order by x.version),'[]'::jsonb)from(select version,name,md5(array_to_string(statements,E'\\n'))as \"sqlHash\",cardinality(statements)as \"statementCount\" from supabase_migrations.schema_migrations)x)) as snapshot;"
    if args.source == 'production':
        if not re.fullmatch('[a-z]{20}', args.project_ref or ''):
            raise ValueError('Production capture requires its exact project ref')
        # Fixed catalog query: there is no user SQL input and no migration command.
        with tempfile.TemporaryDirectory(prefix='p11-catalog-') as folder:
            path = Path(folder) / 'catalog.sql'; path.write_text(sql)
            command = [args.supabase_bin, 'db', 'query', '--linked', '--project-ref', args.project_ref, '--file', str(path), '--output-format', 'json']
            result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=90)
    else:
        if not re.fullmatch(r'postgres|phase6_[a-z0-9_]+', args.database):
            raise ValueError('Only the local console or an explicit Phase 6 rehearsal database is supported')
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', args.database, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True, check=True, timeout=90)
    snapshot = unwrap(json.loads(result.stdout))
    snapshot.update(formatVersion=FORMAT, source=args.source,
                    projectRef=args.project_ref if args.source == 'production' else 'local:p11-platform:' + args.database,
                    catalogQueryHash=query_hash)
    snapshot['objects'].sort(key=lambda x: (x['kind'], x['identity']))
    snapshot['migrations'].sort(key=lambda x: x['version'])
    snapshot['contentHash'] = digest(snapshot)
    validate(snapshot); write_json(Path(args.output), snapshot)
    return {'status': 'captured', 'objects': len(snapshot['objects']), 'migrations': len(snapshot['migrations']), 'contentHash': snapshot['contentHash']}

def bundle(snapshot, history_dir, pending_dir, manifest, output):
    validate(snapshot)
    if snapshot['source'] != 'production' or not snapshot['migrations']:
        raise ValueError('Bundle requires a verified production snapshot')
    if output.exists():
        raise ValueError('Bundle destination must be new; no overwrite is supported')
    prepared = []
    versions = set()
    for row in sorted(snapshot['migrations'], key=lambda x: x['version']):
        version, name = row['version'], row['name']
        if not re.fullmatch(r'[0-9]{14}', version) or not re.fullmatch(r'[A-Za-z0-9_]+', name or ''):
            raise ValueError('Invalid historical migration filename')
        path = history_dir / f'{version}_{name}.sql'
        text = path.read_text()
        # Current CLI fetch appends one SQL terminator and newline. Verify the exact
        # recorded bytes, never normalize comments, rename history, or infer by name.
        if row['statementCount'] != 1 or not any(sql_digest(v) == row['sqlHash'] for v in (text, text[:-2] if text.endswith(';\n') else text)):
            raise ValueError('Fetched migration does not match recorded SQL: ' + path.name)
        prepared.append((path.name, path.read_bytes(), 'production_history')); versions.add(version)
    seen = set()
    if not isinstance(manifest, list) or not manifest:
        raise ValueError('An explicit nonempty pending migration manifest is required')
    for row in manifest:
        name = row['file']
        if not re.fullmatch(r'[0-9]{14}_[A-Za-z0-9_]+\.sql', name) or name in seen:
            raise ValueError('Invalid or duplicate pending migration identity')
        seen.add(name); version = name[:14]
        if version in versions or (versions and version <= max(versions)):
            raise ValueError('Pending migration collides with recorded history/order')
        data = (pending_dir / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError('Pending migration content changed: ' + name)
        prepared.append((name, data, 'pending')); versions.add(version)
    # All checks finish before any output is created. Preparation is not deployment.
    output.mkdir(parents=True)
    destination = output / 'supabase' / 'migrations'; destination.mkdir(parents=True)
    entries = []
    for name, data, source in prepared:
        (destination / name).write_bytes(data)
        entries.append({'file': name, 'source': source, 'sha256': hashlib.sha256(data).hexdigest()})
    result = {'formatVersion': 1, 'projectRef': snapshot['projectRef'], 'productionSnapshotHash': snapshot['contentHash'],
              'preparedAt': datetime.now(timezone.utc).isoformat(), 'status': 'prepared_not_deployed',
              'qualificationRequired': ['fresh production drift check', 'data preflight', 'upgrade and restore qualification', 'product/client gates', 'release approval'], 'files': entries}
    result['contentHash'] = digest(result); write_json(output / 'manifest.json', result)
    (output / 'README.md').write_text('Prepared migration review bundle. No migration was applied.\n\nProduction history is preserved by its recorded versions and verified SQL hashes.\nThe pending sequence is explicit and hash-checked. Do not use the reconstructed\nrepository history for a blind hosted push or mark historical files applied.\n\nA fresh production snapshot, data preflight, complete upgrade/restore checks and\nowner release approval are required before any hosted application. This folder\ncontains no project credentials or linked-project settings.\n')
    return {'status': result['status'], 'historyFiles': sum(x['source'] == 'production_history' for x in entries), 'pendingFiles': len(manifest), 'contentHash': result['contentHash']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('capture'); p.add_argument('--source', choices=['local', 'production'], required=True)
    p.add_argument('--project-ref'); p.add_argument('--database', default='postgres'); p.add_argument('--supabase-bin', default='supabase'); p.add_argument('--output', required=True)
    p = commands.add_parser('compare'); p.add_argument('--baseline', required=True); p.add_argument('--candidate', required=True); p.add_argument('--output', required=True)
    p = commands.add_parser('bundle'); p.add_argument('--snapshot', required=True); p.add_argument('--history-dir', required=True); p.add_argument('--pending-dir', required=True); p.add_argument('--pending-manifest', required=True); p.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'capture':
            print(json.dumps(capture(args))); return 0
        if args.command == 'compare':
            result = compare(json.loads(Path(args.baseline).read_text()), json.loads(Path(args.candidate).read_text()))
            write_json(Path(args.output), result)
            print(json.dumps({'status': result['status'], 'schemaDifferences': len(result['schema']), 'historyDifferences': len(result['history'])}))
            return 2 if result['hasDrift'] else 0
        result = bundle(json.loads(Path(args.snapshot).read_text()), Path(args.history_dir), Path(args.pending_dir), json.loads(Path(args.pending_manifest).read_text()), Path(args.output))
        print(json.dumps(result)); return 0
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        # Never echo CLI stderr: provider diagnostics can contain connection details.
        print(json.dumps({'status': 'failed', 'reason': str(error) if not isinstance(error, subprocess.SubprocessError) else 'Catalog command failed; inspect the local CLI configuration without sharing secrets.'}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
