from types import SimpleNamespace

from siteaudit.analyst import SiteAuditAnalyst, extract_claude_text, openai_completion_token_param


def test_openai_token_param_uses_completion_tokens_for_gpt5():
    assert openai_completion_token_param('gpt-5.6-sol') == {'max_completion_tokens': 16000}
    assert openai_completion_token_param('gpt-4o') == {'max_tokens': 16000}


def test_extract_claude_text_skips_thinking_blocks():
    response = SimpleNamespace(content=[
        SimpleNamespace(type='thinking', thinking='plan'),
        SimpleNamespace(type='text', text='{"recommendations":[]}'),
    ])
    assert extract_claude_text(response) == '{"recommendations":[]}'


def test_validate_keeps_grounded_recommendations_only():
    analyst = SiteAuditAnalyst.__new__(SiteAuditAnalyst)
    context = {
        'findings': [{'id': 'finding-1'}],
        'geo_signals': [{'prompt': 'best apartments in Otay Mesa'}],
    }
    validated = analyst._validate({
        'recommendations': [
            {
                'title': 'Fix missing neighborhood titles',
                'narrative': 'Epoca pages are missing location titles, which hurts discovery prompts in Otay Mesa.',
                'grounding': {'finding_ids': ['finding-1'], 'query_evidence': []},
                'proposed_changes': [{'url': 'https://epocalife.com', 'proposed': 'Epoca in Otay Mesa'}],
            },
            {
                'title': 'Generic content advice',
                'narrative': 'Create more content and build backlinks across the site to improve visibility overall.',
                'grounding': {'finding_ids': ['not-real'], 'query_evidence': []},
            },
        ],
    }, context)

    assert [rec['title'] for rec in validated] == ['Fix missing neighborhood titles']
    assert validated[0]['grounding']['finding_ids'] == ['finding-1']


def test_pagination_does_not_truncate_saved_evidence():
    from siteaudit.analyst import _read_pages
    from unittest.mock import Mock
    query=Mock();query.range.return_value=query
    query.execute.side_effect=[SimpleNamespace(data=[{'id':i} for i in range(500)]),SimpleNamespace(data=[{'id':i} for i in range(500,1000)]),SimpleNamespace(data=[{'id':i} for i in range(1000,1005)])]
    assert len(_read_pages(query))==1005
    assert query.range.call_args.args==(1000,1499)

def test_proposed_page_replacements_require_observed_urls():
    analyst=SiteAuditAnalyst.__new__(SiteAuditAnalyst)
    result=analyst._validate({'recommendations':[{'title':'Fix observed page','narrative':'A concrete finding supports improving the observed page title for this community.',
       'grounding':{'finding_ids':['finding']},'proposed_changes':[{'url':'https://example.com/observed','proposed':'Observed title'},{'url':'https://invented.invalid','proposed':'Invented title'}]}]},
       {'findings':[{'id':'finding','affected_urls':['https://example.com/observed']}],'geo_signals':[],'pages':[]})
    assert [change['url'] for change in result[0]['proposed_changes']]==['https://example.com/observed']
