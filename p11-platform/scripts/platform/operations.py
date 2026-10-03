#!/usr/bin/env python3
"""Read-only schedule inventory and observation qualification. Never runs a job."""
import argparse, calendar, hashlib, json, re
from datetime import datetime, timedelta
from pathlib import Path

def stamp(s):
    d=datetime.fromisoformat(s.replace('Z','+00:00'))
    if d.tzinfo is None: raise ValueError('Schedule evidence needs timezone-aware timestamps')
    return d

def month_after(d):
    year=d.year+(d.month==12); month=d.month%12+1
    return d.replace(year=year,month=month,day=min(d.day,calendar.monthrange(year,month)[1]))

def qualify(spec,runs,now):
    """A timer firing, a held run or an HTTP response is not a completed cycle."""
    now=stamp(now); issues=[]; ids=set(); good=[]
    if spec['enabled'] is not True: return {'state':'held','issues':['Normal operation has not been enabled.']}
    for r in runs:
        if r['job']!=spec['job']: continue
        if r['id'] in ids: raise ValueError('Duplicate run identity')
        ids.add(r['id']); start=stamp(r['startedAt'])
        end=stamp(r['finishedAt']) if r.get('finishedAt') else None
        if start>now or end and (end<start or end>now): raise ValueError('Invalid observed run interval')
        if r['configurationHash']!=spec['configurationHash']: issues.append('Configuration changed during observation.'); continue
        if r['status']!='success' or r.get('held') is not False or not r.get('receiptHash'):
            issues.append('A run failed, remained held or lacks its saved completion receipt.'); continue
        if not re.fullmatch('[0-9a-f]{64}',r['receiptHash']) or end is None: raise ValueError('Invalid completion evidence')
        good.append((start,end))
    good.sort()
    if not good: return {'state':'unobserved','issues':sorted(set(issues+['No qualified completed run.']))}
    gap=timedelta(minutes=spec['maxGapMinutes'])
    if now-good[-1][1]>gap: issues.append('Latest completed run is overdue.')
    if any(b[0]-a[0]>gap for a,b in zip(good,good[1:])): issues.append('There is a missing schedule interval.')
    boundary=month_after(good[0][0]) if spec['cycle']=='calendar_month' else good[0][0]+timedelta(minutes=spec['cycleMinutes'])
    if good[-1][1]<boundary: issues.append('The longest relevant operating cycle has not been observed.')
    return {'state':'needs_review' if issues else 'observed','issues':sorted(set(issues)),
            'completedRuns':len(good),'observationStart':good[0][0].isoformat(),'observationEnd':good[-1][1].isoformat(),
            'cycleBoundary':boundary.isoformat(),'businessOutcome':'not_inferred'}

def inventory(root):
    v=root/'apps/web/vercel.json'; data=json.loads(v.read_text()); rows=[]
    for cron in data['crons']:
        path=root/'apps/web/app'/cron['path'].lstrip('/')/'route.ts'
        if not path.is_file(): raise ValueError('Scheduled route is missing: '+cron['path'])
        text=path.read_text()
        rows.append({**cron,'route':str(path.relative_to(root)),
            'sourceHash':hashlib.sha256(path.read_bytes()).hexdigest(),
            'jobNames':re.findall(r"jobName\s*:\s*['\"]([^'\"]+)['\"]",text),
            'tests':[{ 'file':str(p.relative_to(root)), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                     for p in [path.with_name('route.test.ts')] if p.exists()],
            'coverage':'Source references only; helper and database schedules require the reviewed operations register.'})
    return {'formatVersion':1,'configurationHash':hashlib.sha256(v.read_bytes()).hexdigest(),
            'configuredRoutes':rows,'activation':'unchanged','longestRetainedCycle':'calendar_month',
            'observationQualification':'not_observed_while_runtime_and_delivery_are_held'}

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    q=s.add_parser('inventory');q.add_argument('--root',type=Path,required=True)
    q=s.add_parser('qualify');q.add_argument('--spec',type=Path,required=True);q.add_argument('--runs',type=Path,required=True);q.add_argument('--now',required=True)
    a=p.parse_args()
    try:
        result=inventory(a.root) if a.command=='inventory' else qualify(json.loads(a.spec.read_text()),json.loads(a.runs.read_text()),a.now)
        print(json.dumps(result,indent=2));return 0
    except(ValueError,KeyError,TypeError,OSError) as e: print(json.dumps({'state':'unavailable','reason':str(e)}));return 1

if __name__=='__main__':raise SystemExit(main())
