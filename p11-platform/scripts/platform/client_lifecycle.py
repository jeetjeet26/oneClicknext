#!/usr/bin/env python3
"""Explicit synthetic client export/offboarding rehearsal on the local Supabase stack.

Never accepts a hosted URL. Writes are restricted to a separately named disposable
clone. This is not a production erasure service or a replacement for client policy.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

CONTAINER = 'supabase_db_p11-platform'
SCHEMAS = ('public', 'private')
SECRET = re.compile(r'password|credential|(^|_)token($|_)|secret|api_key|authorization_code', re.I)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def ident(value):
    return '"' + value.replace('"', '""') + '"'

def table_name(schema, table):
    return ident(schema) + '.' + ident(table)

def private_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('x', encoding='utf-8') as f:
        os.chmod(path, 0o600)
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')

def redact(value, trail=(), removed=None):
    if removed is None:
        removed = []
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            path = (*trail, key)
            if SECRET.search(key):
                result[key] = '[excluded credential or operational token]'
                removed.append('.'.join(path))
            else:
                result[key] = redact(item, path, removed)
        return result
    if isinstance(value, list):
        return [redact(v, (*trail, str(i)), removed) for i, v in enumerate(value)]
    return value

class LocalDatabase:
    def __init__(self, name):
        if name != 'postgres' and not re.fullmatch(r'phase6_client_lifecycle_[0-9]{8}(?:_[a-z]+)?', name):
            raise ValueError('Only the local console or a new client-lifecycle clone is supported')
        host = os.environ.get('DOCKER_HOST', '')
        if host and not host.startswith('unix://'):
            raise ValueError('A local Unix Docker endpoint is required')
        context = json.loads(subprocess.check_output(['docker', 'context', 'inspect'], text=True))
        if not context[0]['Endpoints']['docker']['Host'].startswith('unix://'):
            raise ValueError('Remote Docker is not supported')
        labels = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .Config.Labels}}', CONTAINER], text=True))
        if labels.get('com.supabase.cli.project') != 'p11-platform':
            raise ValueError('Wrong local Supabase project')
        self.name = name

    def sql(self, query):
        proc = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', self.name, '-v', 'ON_ERROR_STOP=1'], input=query, capture_output=True, text=True, timeout=60)
        if proc.returncode:
            # Caller artifacts must not accidentally contain complete row contents or credentials.
            raise RuntimeError('Local SQL failed: ' + proc.stderr.splitlines()[0][:500])
        return proc.stdout.strip()

    def metadata(self):
        return json.loads(self.sql("""select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid,'columns',
 (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)))
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r'),
 'fks',(select jsonb_agg(jsonb_build_object('child',c.conrelid,'parent',c.confrelid,'columns',
 (select jsonb_agg(jsonb_build_array(a.attname,b.attname) order by k.i) from generate_subscripts(c.conkey,1)k(i)
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[k.i]
 join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[k.i]))) from pg_constraint c where c.contype='f'))"""))

    def snapshot(self, org):
        org = str(uuid.UUID(org))
        meta = self.metadata()
        tables = {t['oid']: t for t in meta['tables']}
        setup = ["CREATE TEMP TABLE lifecycle_rows (table_oid oid, row_hash text, data jsonb, PRIMARY KEY(table_oid,row_hash));",
                 "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='45s';"]
        properties = "select id from public.properties where org_id=" + literal(org) + '::uuid'
        for t in tables.values():
            predicates = []
            columns = t['columns']
            if t['name'] == 'organizations' and t['schema'] == 'public':
                predicates.append('id=' + literal(org) + '::uuid')
            for c in ['org_id', 'requested_org_id']:
                if c in columns:
                    predicates.append(ident(c) + '=' + literal(org) + '::uuid')
            for c in ['property_id', 'subject_property_id', 'related_property_id']:
                if c in columns:
                    predicates.append(ident(c) + ' IN(' + properties + ')')
            if predicates:
                setup.append(f"INSERT INTO lifecycle_rows SELECT {t['oid']},md5(to_jsonb(r)::text),to_jsonb(r) FROM {table_name(t['schema'],t['name'])} r WHERE " + ' OR '.join(predicates) + ' ON CONFLICT DO NOTHING;')
        commands = []
        for f in meta['fks']:
            if f['child'] not in tables or f['parent'] not in tables:
                continue
            child = tables[f['child']]
            comparisons = [f"to_jsonb(r)->{literal(c)}=p.data->{literal(parent)} AND p.data->{literal(parent)}<>'null'::jsonb" for c, parent in f['columns']]
            commands.append(f"INSERT INTO lifecycle_rows SELECT {f['child']},md5(to_jsonb(r)::text),to_jsonb(r) FROM {table_name(child['schema'],child['name'])} r WHERE EXISTS(SELECT 1 FROM lifecycle_rows p WHERE p.table_oid={f['parent']} AND " + ' AND '.join(comparisons) + ') ON CONFLICT DO NOTHING; GET DIAGNOSTICS added=ROW_COUNT; total=total+added;')
        setup.append('DO $scope$ DECLARE total bigint; added bigint; BEGIN LOOP total=0; ' + '\n'.join(commands) + ' EXIT WHEN total=0; END LOOP; END $scope$;')
        # Ownership disagreements are never silently swept into a client export or deletion.
        setup.append("""DO $scope$ BEGIN IF EXISTS(SELECT 1 FROM lifecycle_rows r WHERE
 (r.data->>'org_id' IS NOT NULL AND r.data->>'org_id'<>""" + literal(org) + ") OR (r.data->>'requested_org_id' IS NOT NULL AND r.data->>'requested_org_id'<>" + literal(org) + ") OR (r.data->>'property_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=r.data->>'property_id' AND p.org_id=" + literal(org) + "::uuid))) THEN RAISE EXCEPTION 'Cross-client or unresolved ownership; export blocked'; END IF; END $scope$;")
        # An unowned JSON/text copy needs review; do not silently guess ownership.
        for t in tables.values():
            setup.append("DO $scope$ BEGIN IF EXISTS(SELECT 1 FROM " + table_name(t['schema'],t['name']) +
                " r WHERE NOT EXISTS(SELECT 1 FROM lifecycle_rows x WHERE x.table_oid=" + str(t['oid']) +
                " AND x.row_hash=md5(to_jsonb(r)::text)) AND (strpos(to_jsonb(r)::text," + literal(org) +
                ")>0 OR EXISTS(SELECT 1 FROM public.properties p WHERE p.org_id=" + literal(org) +
                "::uuid AND strpos(to_jsonb(r)::text,p.id::text)>0))) THEN RAISE EXCEPTION 'Unowned client reference requires retention review'; END IF; END $scope$;")
        setup.append("SELECT coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'data',r.data) ORDER BY n.nspname,c.relname,r.row_hash),'[]') FROM lifecycle_rows r JOIN pg_class c ON c.oid=r.table_oid JOIN pg_namespace n ON n.oid=c.relnamespace; COMMIT;")
        rows = json.loads(self.sql('\n'.join(setup)))
        if not any(r['table'] == 'public.organizations' for r in rows):
            raise ValueError('Client not found')
        result = {'formatVersion': 1, 'source': 'synthetic_local', 'database': self.name, 'org': org, 'rows': rows}
        result['contentHash'] = digest(rows)
        return result

    def require_synthetic(self, snapshot):
        org = next(r['data'] for r in snapshot['rows'] if r['table'] == 'public.organizations')
        if not org['name'].startswith('Synthetic lifecycle '):
            raise ValueError('Only explicitly named synthetic lifecycle clients are supported')
        actors = [r['data']['id'] for r in snapshot['rows'] if r['table'] == 'public.profiles']
        for actor in actors:
            email = self.sql('select email from auth.users where id=' + literal(actor) + '::uuid;')
            if not re.fullmatch(r'lifecycle-[a-f0-9-]+@p11.test', email):
                raise ValueError('Non-fixture account in the client scope')
        return actors

def export_client(db, org, output):
    output = Path(output)
    if output.exists():
        raise ValueError('Use a new export directory')
    snap = db.snapshot(org)
    actors = db.require_synthetic(snap)
    removed = []
    cleaned = redact(snap['rows'], removed=removed)
    # The private rehearsal snapshot is temporary input for an isolated database restore.
    # The client-facing export excludes authentication and provider secrets.
    private_json(output / 'private-rehearsal-snapshot.json', snap)
    private_json(output / 'client-data.json', cleaned)
    manifest = {'formatVersion': 1, 'source': 'synthetic_local', 'org': org,
                'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceHash': snap['contentHash'],
                'clientDataHash': digest(cleaned), 'tables': sorted({r['table'] for r in cleaned}),
                'rows': len(cleaned), 'actors': actors, 'credentialFieldsExcluded': removed,
                'files': [], 'limitations': ['Storage bytes require separate API export and receipts.',
                'Provider copies, backup expiry and downloaded exports remain separate retained copies.',
                'This rehearsal snapshot is not a hosted client export authorization.'], 'trainingEligible': False}
    private_json(output / 'manifest.json', manifest)
    return manifest


def check_policy(policy, snapshot):
    if snapshot.get('formatVersion') != 1 or snapshot.get('source') != 'synthetic_local' or digest(snapshot.get('rows')) != snapshot.get('contentHash'):
        raise ValueError('Snapshot contents or provenance changed')
    if policy.get('source') != 'synthetic_test_policy' or policy.get('org') != snapshot['org']:
        raise ValueError('An explicit policy for this synthetic client is required')
    if policy.get('sourceHash') != snapshot['contentHash']:
        raise ValueError('The reviewed client inventory changed')
    if policy.get('holds') or policy.get('pendingWriters'):
        raise ValueError('Retention holds or active writers remain')
    stamp = datetime.fromisoformat(policy['eligibleAfter'].replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise ValueError('The test retention period has not elapsed')
    if policy.get('mode') != 'erase_disposable_clone' or not policy.get('retainedCopies'):
        raise ValueError('Name retained exports/backups before erasure')
    if policy.get('providerCopies') != 'none_synthetic' or policy.get('trainingEligible') is not False:
        raise ValueError('Provider or training obligations are unresolved')

def erasure_sql(db, snapshot, actors):
    """Exact-set removal on a disconnected disposable clone, never a hosted executor.

    Legacy append-only triggers and restrictive relationships intentionally do not
    define client retention. This isolated rehearsal removes the reviewed row set
    with triggers disabled *in this transaction only*, then checks every FK and
    every unselected row before commit. Native application guards stay unchanged.
    """
    meta = db.metadata()
    tables = {t['oid']: t for t in meta['tables']}
    grouped = {}
    for row in snapshot['rows']:
        grouped.setdefault(row['table'], []).append(row['data'])
    monitored = [(t['schema'], t['name']) for t in tables.values()]
    auth_tables = json.loads(db.sql("select coalesce(jsonb_agg(c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='r'"))
    monitored += [('auth', t) for t in auth_tables]
    # The clone's synthetic Auth identities are exported only as ids in the deletion receipt.
    for actor in actors:
        rows = json.loads(db.sql('select coalesce(jsonb_agg(to_jsonb(u)),\'[]\') from auth.users u where id=' + literal(actor) + '::uuid'))
        grouped.setdefault('auth.users', []).extend(rows)
    table_set = set(monitored)
    if any(tuple(name.split('.')) not in table_set for name in grouped):
        raise ValueError('Reviewed table no longer exists')
    q = ["BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';",
         'LOCK TABLE ' + ','.join(table_name(*t) for t in sorted(monitored)) + ' IN ACCESS EXCLUSIVE MODE;',
         'CREATE TEMP TABLE erase_targets(table_name text,data jsonb) ON COMMIT DROP;',
         'CREATE TEMP TABLE retained_before(table_name text,fingerprint text) ON COMMIT DROP;']
    for name, rows in grouped.items():
        q.append('INSERT INTO erase_targets SELECT ' + literal(name) + ',v FROM jsonb_array_elements(' + literal(json.dumps(rows)) + '::jsonb)v;')
        table = table_name(*name.split('.'))
        q.append("DO $verify$ BEGIN IF (SELECT count(*) FROM " + table + " r WHERE EXISTS(SELECT 1 FROM erase_targets t WHERE t.table_name=" + literal(name) + " AND t.data=to_jsonb(r)))<>" + str(len(rows)) + " THEN RAISE EXCEPTION 'Reviewed row changed or disappeared'; END IF; END $verify$;")
    properties = [r['data']['id'] for r in snapshot['rows'] if r['table'] == 'public.properties']
    references = [snapshot['org'], *properties]
    for t in tables.values():
        name = t['schema'] + '.' + t['name']
        contains = ' OR '.join('strpos(to_jsonb(r)::text,' + literal(v) + ')>0' for v in references)
        q.append("DO $verify$ BEGIN IF EXISTS(SELECT 1 FROM " + table_name(t['schema'],t['name']) +
            " r WHERE NOT EXISTS(SELECT 1 FROM erase_targets x WHERE x.table_name=" + literal(name) +
            " AND x.data=to_jsonb(r)) AND (" + contains +
            ")) THEN RAISE EXCEPTION 'New or unowned client reference requires a fresh export'; END IF; END $verify$;")
    # Content-free, stable fingerprints include every other client's rows and Auth records.
    def fingerprint(schema, name, before):
        full = schema + '.' + name
        suffix = " WHERE NOT EXISTS(SELECT 1 FROM erase_targets t WHERE t.table_name=" + literal(full) + ' AND t.data=to_jsonb(r))' if before else ''
        return "SELECT encode(extensions.digest(coalesce(string_agg(encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex'),'' ORDER BY encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex')),''),'sha256'),'hex') FROM " + table_name(schema, name) + ' r' + suffix
    for schema, name in sorted(monitored):
        q.append('INSERT INTO retained_before VALUES(' + literal(schema + '.' + name) + ',(' + fingerprint(schema, name, True) + '));')
    q.append('SET LOCAL session_replication_role=replica;')
    for name in sorted(grouped):
        q.append('DELETE FROM ' + table_name(*name.split('.')) + ' r WHERE EXISTS(SELECT 1 FROM erase_targets t WHERE t.table_name=' + literal(name) + ' AND t.data=to_jsonb(r));')
    q.append('SET LOCAL session_replication_role=origin;')
    for schema, name in sorted(monitored):
        q.append("DO $verify$ BEGIN IF (" + fingerprint(schema, name, False) + ") IS DISTINCT FROM (SELECT fingerprint FROM retained_before WHERE table_name=" + literal(schema + '.' + name) + ") THEN RAISE EXCEPTION 'Unselected records changed'; END IF; END $verify$;")
    # Scan every FK involving application/Auth tables, including non-deferrable legacy keys.
    foreign_keys = json.loads(db.sql("""select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'childSchema',cn.nspname,'child',cc.relname,'parentSchema',pn.nspname,'parent',pc.relname,'match',c.confmatchtype,'columns',(select jsonb_agg(jsonb_build_array(a.attname,b.attname) order by k.i) from generate_subscripts(c.conkey,1)k(i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[k.i] join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[k.i]))),'[]') from pg_constraint c join pg_class cc on cc.oid=c.conrelid join pg_namespace cn on cn.oid=cc.relnamespace join pg_class pc on pc.oid=c.confrelid join pg_namespace pn on pn.oid=pc.relnamespace where c.contype='f' and cn.nspname in('public','private','auth')"""))
    for fk in foreign_keys:
        nonnull = ' AND '.join('r.' + ident(c) + ' IS NOT NULL' for c, _ in fk['columns'])
        match = ' AND '.join('p.' + ident(p) + '=r.' + ident(c) for c, p in fk['columns'])
        violation = '(' + nonnull + ') AND NOT EXISTS(SELECT 1 FROM ' + table_name(fk['parentSchema'], fk['parent']) + ' p WHERE ' + match + ')'
        if fk['match'] == 'f':
            anynull = ' OR '.join('r.' + ident(c) + ' IS NULL' for c, _ in fk['columns'])
            anyset = ' OR '.join('r.' + ident(c) + ' IS NOT NULL' for c, _ in fk['columns'])
            violation = '(' + violation + ') OR ((' + anynull + ') AND (' + anyset + '))'
        q.append("DO $verify$ BEGIN IF EXISTS(SELECT 1 FROM " + table_name(fk['childSchema'], fk['child']) + ' r WHERE ' + violation + ") THEN RAISE EXCEPTION 'Foreign-key validation failed: " + fk['name'].replace("'", "''") + "'; END IF; END $verify$;")
    properties = [r['data']['id'] for r in snapshot['rows'] if r['table'] == 'public.properties']
    for t in tables.values():
        checks = []
        for column in ['org_id', 'requested_org_id']:
            if column in t['columns']:
                checks.append(ident(column) + '=' + literal(snapshot['org']) + '::uuid')
        for column in ['property_id', 'subject_property_id', 'related_property_id']:
            if column in t['columns'] and properties:
                checks.append(ident(column) + ' IN(' + ','.join(literal(v) + '::uuid' for v in properties) + ')')
        if checks:
            q.append("DO $verify$ BEGIN IF EXISTS(SELECT 1 FROM " + table_name(t['schema'], t['name']) + ' WHERE ' + ' OR '.join(checks) + ") THEN RAISE EXCEPTION 'Client rows remain after erasure'; END IF; END $verify$;")
    q.append('COMMIT;')
    return '\n'.join(q), len(foreign_keys), len(monitored)

def offboard_client(db, snapshot, policy, output, *, rollback=False):
    if db.name == 'postgres':
        raise ValueError('Offboarding is disabled in the active console and all hosted databases')
    if Path(output).exists():
        raise ValueError('Use a new receipt path')
    check_policy(policy, snapshot)
    if db.snapshot(snapshot['org'])['contentHash'] != snapshot['contentHash']:
        raise ValueError('The client changed after export; export and review again')
    actors = db.require_synthetic(snapshot)
    # No client, worker or REST service can connect while the clone is erased.
    # supabase_admin is the isolated maintenance connection; no role is changed globally.
    active = int(db.sql("select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()"))
    if active:
        raise ValueError('Other connections remain on the isolated clone')
    db.sql('ALTER DATABASE ' + ident(db.name) + ' CONNECTION LIMIT 0;')
    query, foreign_keys, monitored = erasure_sql(db, snapshot, actors)
    if rollback:
        query = query.removesuffix('COMMIT;') + 'ROLLBACK;'
    db.sql(query)
    result = {'formatVersion': 1, 'state': 'rollback_verified' if rollback else 'local_clone_erased',
              'database': db.name, 'org': snapshot['org'], 'sourceHash': snapshot['contentHash'],
              'policyHash': digest(policy), 'exportSourceHash': policy.get('exportSourceHash'), 'erasedRows': 0 if rollback else len(snapshot['rows']),
              'authIdentitiesRemoved': [] if rollback else actors, 'checkedForeignKeys': foreign_keys,
              'unchangedNeighborTables': monitored, 'writerFence': 'isolated_database_connection_limit_zero',
              'retainedCopies': policy['retainedCopies'], 'storage': policy.get('storage', 'not_yet_verified'),
              'productionReady': False, 'trainingEligible': False,
              'restoreRequirement': 'Reject this organization before exposing a restored client snapshot.',
              'completedAt': datetime.now(timezone.utc).isoformat()}
    if rollback and db.snapshot(snapshot['org'])['contentHash'] != snapshot['contentHash']:
        raise ValueError('Rollback did not preserve client rows')
    result['contentHash'] = digest(result)
    private_json(output, result)
    return result


def verify_export(folder):
    folder = Path(folder)
    manifest = json.loads((folder/'manifest.json').read_text())
    snapshot = json.loads((folder/'private-rehearsal-snapshot.json').read_text())
    data = json.loads((folder/'client-data.json').read_text())
    if snapshot.get('source') != 'synthetic_local' or snapshot.get('formatVersion') != 1:
        raise ValueError('Unknown export provenance')
    if digest(snapshot['rows']) != snapshot['contentHash'] or snapshot['org'] != manifest['org']:
        raise ValueError('Private snapshot changed')
    removed = []
    expected = redact(snapshot['rows'], removed=removed)
    if data != expected or digest(data) != manifest['clientDataHash'] or manifest['sourceHash'] != snapshot['contentHash']:
        raise ValueError('Client export changed or contains excluded credentials')
    if removed != manifest['credentialFieldsExcluded'] or manifest['rows'] != len(data):
        raise ValueError('Export inventory changed')
    stored = folder/'storage-export.json'
    verified_files = 0
    if stored.exists():
        storage = json.loads(stored.read_text())
        if storage['org'] != snapshot['org'] or storage['sourceHash'] != snapshot['contentHash']:
            raise ValueError('Storage belongs to another export')
        originals = {r['data']['id']:r['data'] for r in data if r['table']=='public.knowledge_files'}
        if len(storage['files']) != len(originals):
            raise ValueError('Storage export is incomplete')
        seen = set()
        for file in storage['files']:
            row = originals.get(file['id'])
            if not row or file['id'] in seen or file['exportFile'] != 'originals/'+file['id']+'.bin':
                raise ValueError('Unexpected or duplicate exported original')
            seen.add(file['id'])
            content = (folder/file['exportFile']).read_bytes()
            if hashlib.sha256(content).hexdigest() != row['input']['byteHash'] or len(content) != row['input']['size']:
                raise ValueError('Exported original bytes changed')
            verified_files += 1
    return {'state':'verified','rows':len(data),'originals':verified_files,
            'storage':'verified' if stored.exists() else 'pending','sourceHash':snapshot['contentHash']}

def restore_check(snapshot, receipts):
    if snapshot.get('source') != 'synthetic_local' or digest(snapshot.get('rows')) != snapshot.get('contentHash'):
        raise ValueError('Invalid restore snapshot')
    organizations = {snapshot['org']}
    organizations.update(r['data']['id'] for r in snapshot['rows'] if r['table']=='public.organizations')
    for receipt in receipts:
        if receipt.get('contentHash') != digest({k:v for k,v in receipt.items() if k!='contentHash'}):
            raise ValueError('Deletion receipt changed')
        if receipt.get('state') == 'local_clone_erased' and receipt.get('org') in organizations:
            raise ValueError('Restore blocked: this client has an erasure receipt; exclude it before serving a restored snapshot')
    return {'state':'no_erasure_match','meaning':'This check does not authorize restoration or client access.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export')
    export.add_argument('--database', default='postgres')
    export.add_argument('--org', required=True)
    export.add_argument('--output', type=Path, required=True)
    erase = sub.add_parser('offboard')
    erase.add_argument('--database', required=True)
    erase.add_argument('--snapshot', type=Path, required=True)
    erase.add_argument('--policy', type=Path, required=True)
    erase.add_argument('--output', type=Path, required=True)
    erase.add_argument('--rollback', action='store_true')
    verify = sub.add_parser('verify')
    verify.add_argument('--bundle', type=Path, required=True)
    restore = sub.add_parser('restore-check')
    restore.add_argument('--snapshot', type=Path, required=True)
    restore.add_argument('--receipt', type=Path, action='append', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'verify':
            print(json.dumps(verify_export(args.bundle)));return 0
        if args.command == 'restore-check':
            print(json.dumps(restore_check(json.loads(args.snapshot.read_text()),[json.loads(p.read_text()) for p in args.receipt])));return 0
        if args.command == 'export':
            result = export_client(LocalDatabase(args.database), args.org, args.output)
            summary = {'state': 'exported', 'rows': result['rows'], 'tables': len(result['tables']), 'sourceHash': result['sourceHash']}
        else:
            result = offboard_client(LocalDatabase(args.database), json.loads(args.snapshot.read_text()), json.loads(args.policy.read_text()), args.output, rollback=args.rollback)
            summary = {key: result[key] for key in ['state', 'erasedRows', 'checkedForeignKeys', 'unchangedNeighborTables']}
        print(json.dumps(summary))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'state': 'needs_review', 'reason': str(error)}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
