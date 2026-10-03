#!/usr/bin/env python3
"""Inspect dependency locks, or deliberately recompile them on the qualified runtime."""
import argparse, hashlib, importlib.metadata, json, os, platform, subprocess
from pathlib import Path

TARGETS = ['services/data-engine/requirements', 'services/data-engine/requirements-dev',
           *['services/mcp-servers/'+x+'/requirements' for x in ['google_ads','meta_ads','wordpress']]]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2])
    p.add_argument('--compile',action='store_true')
    a=p.parse_args(); root=a.root.resolve()
    if a.compile:
        if platform.python_version()!='3.11.16':
            p.error('Compile locks with Python 3.11.16; other runtimes can select different dependencies.')
        if importlib.metadata.version('pip-tools')!='7.6.1': p.error('Use pip-tools 7.6.1.')
        env={**os.environ,'CUSTOM_COMPILE_COMMAND':'python3 scripts/platform/lock-dependencies.py --compile'}
        for target in TARGETS:
            dest=root/(target+'.txt'); source=root/(target+'.in')
            subprocess.run(['pip-compile','--generate-hashes','--strip-extras','--resolver=backtracking',
                            '--output-file',dest.name,source.name],cwd=dest.parent,env=env,check=True)
    rows=[]
    for target in TARGETS:
        for ext in ['.in','.txt']:
            f=root/(target+ext); rows.append({'file':str(f.relative_to(root)), 'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    for name in ['apps/web/package.json','apps/web/package-lock.json','services/data-engine/runtime.txt']:
        f=root/name; rows.append({'file':name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    print(json.dumps({'formatVersion':1,'python':'3.11.16','node':'24.x','npm':'11.12.1','files':rows},indent=2))
    return 0

if __name__=='__main__': raise SystemExit(main())
