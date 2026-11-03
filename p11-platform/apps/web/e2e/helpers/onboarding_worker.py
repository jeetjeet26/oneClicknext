"""One real extraction for a property-scoped LOCAL browser fixture, without a polling worker."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'services' / 'data-engine'))
from community_brain import worker

db = worker.Database()
items = db.rpc('brain_claim_work', {'p_worker': worker.WORKER, 'p_limit': 1})['jobs']
if len(items) != 1 or items[0]['job']['property_id'] != sys.argv[1]:
    raise RuntimeError('Expected exactly one job for the isolated onboarding property')
result = worker.run_job(db, items[0])
print(json.dumps({'state': result.get('state')}))
