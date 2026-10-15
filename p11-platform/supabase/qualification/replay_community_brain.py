"""Replay candidate migrations against a schema-only live baseline, never production.

The Docker database name must start with community_brain_replay_. Existing
candidate databases are refused, not reset. No customer rows or secrets are logged.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr[:2000])
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-schema', required=True, type=Path)
    parser.add_argument('--system-schema', required=True, type=Path)
    parser.add_argument('--database', required=True)
    parser.add_argument('--container', default='supabase_db_p11-platform')
    args = parser.parse_args()
    if not args.database.startswith('community_brain_replay_') or not args.database.replace('_', '').isalnum():
        raise ValueError('Use an explicitly disposable Community Brain replay database')
    base = ['docker', 'exec', '-i', args.container, 'psql', '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
    run(base + ['-d', 'postgres'], input=f'create database "{args.database}";')
    db = base + ['-d', args.database]
    # Local Supabase's extension restore needs its bootstrap superuser. Feature
    # migrations and assertions still run as the normal postgres migration role.
    bootstrap = [*db]
    bootstrap[bootstrap.index('-U') + 1] = 'supabase_admin'
    system = args.system_schema.read_text()
    # Auth triggers can call functions in the public schema. Restore them only
    # after those functions exist; no trigger is discarded from qualification.
    triggers = re.findall(r'^CREATE (?:(?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER|POLICY)\b[\s\S]*?;\n', system, re.MULTILINE)
    triggers += [statement for statement in re.findall(r'^ALTER TABLE\b[\s\S]*?;\n', system, re.MULTILINE) if 'REFERENCES public.' in statement]
    for trigger in triggers:
        system = system.replace(trigger, '')
    for path, sql in [(args.system_schema, system), (args.public_schema, args.public_schema.read_text())]:
        run(bootstrap, input=sql)
        print(json.dumps({'schema': path.name, 'state': 'restored'}), flush=True)
    public = args.public_schema.read_text()
    retained = []
    for statement in triggers:
        target = re.search(r'REFERENCES public\.([a-z_]+)', statement)
        if target and f'"public"."{target[1]}" (' not in public:
            # A private local-dev FK references a table absent in live public.
            # Do not manufacture that table; record this baseline difference.
            print(json.dumps({'localOnlyForeignKeyTarget': target[1], 'state': 'excluded_from_live_schema_replay'}), flush=True)
        else:
            retained.append(statement)
    run(bootstrap, input='\n'.join(retained))
    root = Path(__file__).resolve().parents[1]
    migrations = sorted(root.glob('migrations/*community_brain*.sql'))
    for path in migrations:
        run(db, input=path.read_text())
        print(json.dumps({'migration': path.name, 'state': 'passed'}), flush=True)
    for path in sorted(root.glob('tests/community_brain_*.test.sql')):
        run(db, input=path.read_text())
        print(json.dumps({'test': path.name, 'state': 'passed'}), flush=True)
    print(json.dumps({'database': args.database, 'migrations': len(migrations), 'customerRowsCopied': False}))


if __name__ == '__main__':
    main()
