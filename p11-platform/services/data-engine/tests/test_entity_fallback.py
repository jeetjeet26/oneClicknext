from connectors.entity_fallback import (
    ensure_ordered_entities,
    finalize_answer_block,
    find_mention_index,
    reconcile_hallucination_flags,
)
from connectors.claude_natural_connector import extract_sources_from_claude_response
from connectors.evaluator import score_answer


def test_find_mention_index():
    assert find_mention_index('Epoca is a master-planned community in Otay Mesa.', 'Epoca') == 0
    assert find_mention_index('Other communities nearby.', 'Epoca') is None


def test_reads_rank_from_numbered_list():
    entities = ensure_ordered_entities(
        existing=[{'name': 'Epoca', 'domain': 'epocalife.com', 'rationale': 'First mentioned in the answer at character 4.', 'position': 1}],
        analysis_entities=[],
        brand_name='Epoca',
        brand_domains=['epocalife.com'],
        text='\n'.join([
            'If you are looking within Otay Mesa, these are the strongest areas:',
            '',
            '1. **Ocean View Hills — best overall**',
            '2. **Millenia**',
            '3. **Epoca**',
        ]),
    )
    assert [f"{entity['position']}:{entity['name']}" for entity in entities] == [
        '1:Ocean View Hills',
        '2:Millenia',
        '3:Epoca',
    ]


def test_rebuilds_list_from_prose():
    entities = ensure_ordered_entities(
        existing=[],
        analysis_entities=[],
        brand_name='Epoca',
        brand_domains=['epocalife.com'],
        competitors=['Pacific Highlands'],
        text='Pacific Highlands and then Epoca are both in South County.',
    )
    assert [entity['name'] for entity in entities] == ['Pacific Highlands', 'Epoca']
    assert entities[1]['position'] == 2


def test_finalize_strips_hallucination_when_brand_is_named():
    answer = finalize_answer_block(
        {
            'ordered_entities': [],
            'citations': [],
            'answer_summary': 'Epoca is a master plan in Otay Mesa, San Diego.',
            'notes': {'flags': ['possible_hallucination']},
        },
        {'brandName': 'Epoca', 'brandDomains': ['epocalife.com']},
        '## Epoca Master Plan — Otay Mesa, San Diego',
        {},
    )
    assert answer['ordered_entities'] == []
    assert answer['notes']['flags'] == []
    assert reconcile_hallucination_flags(['possible_hallucination'], 'No brand here.', 'Epoca') == [
        'possible_hallucination'
    ]


def test_score_answer_recovers_rank_from_prose():
    scored = score_answer(
        {
            'ordered_entities': [],
            'citations': [],
            'answer_summary': 'Epoca is a master plan in Otay Mesa, San Diego.',
            'notes': {'flags': ['possible_hallucination']},
        },
        {
            'brandName': 'Epoca',
            'brandDomains': ['epocalife.com'],
            'competitors': [],
            'sourceText': '## Epoca Master Plan — Otay Mesa, San Diego',
        },
    )
    assert scored['presence'] is True
    assert scored['llm_rank'] is None
    assert 'possible_hallucination' not in scored['flags']


def test_extract_sources_from_claude_response():
    class Block:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    response = Block(content=[
        Block(
            type='text',
            text='Epoca is in Otay Mesa.',
            citations=[Block(url='https://epocalife.com', title='Epoca', cited_text='Epoca')],
        ),
        Block(
            type='web_search_tool_result',
            content=[Block(url='https://zillow.com/epoca', title='Zillow', snippet='listing')],
        ),
    ])
    sources = extract_sources_from_claude_response(response)
    assert [source['url'] for source in sources] == [
        'https://epocalife.com',
        'https://zillow.com/epoca',
    ]
