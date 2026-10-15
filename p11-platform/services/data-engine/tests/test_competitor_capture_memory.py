from types import SimpleNamespace
from unittest.mock import MagicMock
from scrapers.brand_intelligence import BrandIntelligenceExtractor


def fixture():
    extractor=BrandIntelligenceExtractor.__new__(BrandIntelligenceExtractor)
    extractor.supabase=MagicMock()
    brand=SimpleNamespace(competitor_id='competitor-a',to_db_dict=lambda:{'competitor_id':'competitor-a'})
    return extractor,brand


def test_uncaptured_text_cannot_overwrite_searchable_sources():
    extractor,brand=fixture()
    assert extractor.store_brand_intelligence(brand,[{'content':'unlinked'}])is False
    extractor.supabase.table.assert_not_called()


def test_new_capture_preserves_earlier_versions_and_deduplicates_its_own_chunks():
    extractor,brand=fixture()
    chunks=[{'competitor_id':'competitor-a','content':'Same text','content_hash':'hash-1'}]*2
    assert extractor.store_brand_intelligence(brand,chunks,capture_id='capture-new')is True
    extractor.supabase.table.return_value.delete.assert_not_called()
    chunk_calls=[c for c in extractor.supabase.table.return_value.upsert.call_args_list if isinstance(c.args[0],list)]
    assert len(chunk_calls)==1
    assert chunk_calls[0].kwargs['on_conflict']=='competitor_id,capture_id,content_hash'
    assert len(chunk_calls[0].args[0])==1
    assert chunk_calls[0].args[0][0]['capture_id']=='capture-new'
    assert 'capture_id'not in chunks[0]
