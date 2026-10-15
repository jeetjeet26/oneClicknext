import ast
from pathlib import Path
import unittest
from types import SimpleNamespace
from datetime import datetime, timezone
import importlib.util
spec = importlib.util.spec_from_file_location('unit_identity', Path(__file__).resolve().parents[1] / 'scrapers/unit_identity.py')
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
unique_units, existing_unit_index, unit_key, AmbiguousUnitIdentity = identity.unique_units, identity.existing_unit_index, identity.unit_key, identity.AmbiguousUnitIdentity


def unit(name='1BR', rent=2400, **kwargs):
    return SimpleNamespace(unit_type=name, bedrooms=1, bathrooms=1, sqft_min=700,
        sqft_max=700, rent_min=rent, rent_max=rent, deposit=None,
        available_count=None, move_in_specials=None, **kwargs)


class UnitIdentityTests(unittest.TestCase):
    def test_conflicting_bedroom_labels_reject_the_entire_batch(self):
        with self.assertRaises(AmbiguousUnitIdentity):
            unique_units([unit(rent=value) for value in [2585, 2295, 2795, 2395, 2695]])

    def test_exact_duplicate_observations_count_once(self):
        self.assertEqual(len(unique_units([unit(), unit('  1br  ')])), 1)

    def test_distinct_named_plans_can_share_bedroom_count(self):
        self.assertEqual(len(unique_units([unit('A1'), unit('A2')])), 2)

    def test_same_price_different_plan_dimensions_are_not_duplicates(self):
        other = unit(); other.sqft_min = 900
        with self.assertRaises(AmbiguousUnitIdentity): unique_units([unit(), other])

    def test_existing_duplicate_names_cannot_choose_an_arbitrary_record(self):
        with self.assertRaises(AmbiguousUnitIdentity):
            existing_unit_index([{'id':'a','unit_type':'1BR'}, {'id':'b','unit_type':' 1br '}])

    def test_missing_name_is_not_an_identity(self):
        with self.assertRaises(AmbiguousUnitIdentity): unique_units([unit(' ')])

    def test_real_importer_rejects_before_any_database_write(self):
        # Execute the real import method without loading network/provider clients.
        for filename, classname, methodname in [('scrapers/coordinator.py','ScrapingCoordinator','_update_units_from_floor_plans'), ('scrapers/brand_intelligence.py','BrandIntelligenceExtractor','_store_floor_plans')]:
            source = Path(__file__).resolve().parents[1] / filename
            tree = ast.parse(source.read_text())
            coordinator = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == classname)
            method = next(n for n in coordinator.body if isinstance(n, ast.FunctionDef) and n.name == methodname)
            module = ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),method],type_ignores=[])
            namespace={'unique_units':unique_units,'existing_unit_index':existing_unit_index,'unit_key':unit_key,'datetime':datetime,'timezone':timezone}
            exec(compile(ast.fix_missing_locations(module),str(source),'exec'),namespace)
            class NoDatabase:
                def table(self, name): raise AssertionError('Ambiguous batch reached database')
            with self.assertRaises(AmbiguousUnitIdentity):
                namespace[methodname](SimpleNamespace(supabase=NoDatabase()),'competitor',[unit(rent=2585),unit(rent=2295)],'capture')


class ImportWriteTests(unittest.TestCase):
    def test_repeated_observation_creates_one_change_and_replay_creates_no_alert(self):
        source = Path(__file__).resolve().parents[1] / 'scrapers/coordinator.py'
        tree = ast.parse(source.read_text())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ScrapingCoordinator')
        method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_update_units_from_floor_plans')
        module = ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),method],type_ignores=[])
        namespace = {'unique_units':unique_units,'existing_unit_index':existing_unit_index,'unit_key':unit_key,'datetime':datetime,'timezone':timezone,'price_change_alert_fields':lambda *_:{'alert_type':'price_drop','severity':'info'}}
        exec(compile(ast.fix_missing_locations(module),str(source),'exec'),namespace)
        class Database:
            def __init__(self): self.saved={'id':'plan','unit_type':'1BR','rent_min':2695,'rent_max':2695,'available_count':None}; self.writes=[]
            def table(self,name): return Query(self,name)
        class Query:
            def __init__(self,db,name): self.db=db;self.name=name;self.payload=None;self.action='select'
            def select(self,*_): return self
            def eq(self,*_): return self
            def single(self): return self
            def insert(self,payload): self.payload=payload;self.action='insert';return self
            def update(self,payload): self.payload=payload;self.action='update';return self
            def execute(self):
                if self.action!='select':
                    self.db.writes.append((self.name,self.payload))
                    if self.name=='competitor_units': self.db.saved.update(self.payload)
                    return SimpleNamespace(data=[self.payload])
                return SimpleNamespace(data=[dict(self.db.saved)] if self.name=='competitor_units' else {'name':'Fixture','property_id':'property'})
        db=Database();worker=SimpleNamespace(supabase=db)
        update=namespace['_update_units_from_floor_plans']
        self.assertEqual(update(worker,'competitor',[unit(rent=2500),unit(rent=2500)],'capture'),1)
        self.assertEqual([name for name,_ in db.writes],['competitor_units','competitor_price_history','market_alerts'])
        self.assertEqual(db.writes[-1][1]['data']['old_price'],2695)
        db.writes.clear()
        update(worker,'competitor',[unit(rent=2500)],'capture')
        self.assertEqual([name for name,_ in db.writes],['competitor_units'])

if __name__ == '__main__': unittest.main()
