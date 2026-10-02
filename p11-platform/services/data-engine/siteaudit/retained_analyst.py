"""One saved provider invocation; parse only a durably retained receipt."""
import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from siteaudit.analyst import SiteAuditAnalyst, ANALYST_SYSTEM_PROMPT, openai_completion_token_param, extract_claude_text


PROCESSOR_VERSION = 'retained-analyst-' + hashlib.sha256(Path(__file__).read_bytes() + Path(__file__).with_name('analyst.py').read_bytes()).hexdigest()

def analyst_plan():
    provider = os.environ.get('SITEAUDIT_ANALYST_PROVIDER', 'openai')
    if provider not in ('openai', 'anthropic'):
        raise ValueError('Unsupported analyst provider')
    model = (os.environ.get('SITEAUDIT_ANALYST_OPENAI_MODEL') or os.environ.get('GEO_OPENAI_MODEL') or 'gpt-4o') if provider == 'openai' else (os.environ.get('SITEAUDIT_ANALYST_CLAUDE_MODEL') or os.environ.get('GEO_CLAUDE_MODEL') or 'claude-sonnet-5')
    return {'provider': provider, 'model': model}


def retained_context(source):
    """Keep captured question variants and each actual observation distinct."""
    findings = [f for f in source.get('findings', []) if f.get('status') not in ('fixed', 'wont_fix') and not f.get('fixed_at')]
    findings.sort(key=lambda f: ({'critical': 0, 'high': 1, 'medium': 2, 'low': 3}.get(f.get('severity'), 4), str(f.get('id'))))
    pages = [p for p in source.get('pages', []) if p.get('status_code') == 200]
    pages.sort(key=lambda p: (-(p.get('inlink_count') or 0), p.get('url', '')))
    groups, mentions = {}, defaultdict(list)
    answers_total = expected = unattributed = 0
    for entry in source.get('runs', []):
        run = entry.get('run', {})
        items = entry.get('items', [])
        expected += len(items)
        queries = {i.get('answerId'): i.get('query') for i in items if i.get('answerId')}
        for row in entry.get('answers', []):
            answer = row.get('answer', {})
            answers_total += 1
            question = queries.get(answer.get('id'))
            if not question or not question.get('text'):
                unattributed += 1
                continue
            canonical = json.dumps(question, sort_keys=True, separators=(',', ':'))
            version = hashlib.sha256(canonical.encode()).hexdigest()
            signal = groups.setdefault(version, {'source_version': version, 'question_id': question.get('id'), 'prompt': question['text'], 'type': question.get('type'), 'observations': []})
            signal['observations'].append({'answer_id': answer.get('id'), 'run_id': run.get('id'), 'surface': run.get('surface'), 'model': run.get('model_name'), 'run_status': run.get('status'), 'present': answer.get('presence'), 'rank': answer.get('llm_rank'), 'sov': answer.get('sov'), 'synthetic': run.get('measurement_mode') == 'local_fixture'})
            for entity in answer.get('ordered_entities') or []:
                if isinstance(entity, dict) and entity.get('name') and isinstance(entity.get('position'), int) and not isinstance(entity['position'], bool):
                    mentions[entity['name']].append(entity['position'])
    signals = sorted(groups.values(), key=lambda q: (q['prompt'], q['source_version']))
    name = source.get('property', {}).get('name', '')
    competitors = [{'name': name_, 'mentions': len(values), 'avg_rank': round(sum(values) / len(values), 1)} for name_, values in sorted(mentions.items(), key=lambda x: (-len(x[1]), x[0])) if name_.casefold() != name.casefold()][:10]
    # Keep the full source privately; disclose exactly which bounded prompt subset is used.
    selected_findings = [{k: f.get(k) for k in ('id', 'category', 'detector', 'severity', 'title', 'description', 'occurrences', 'affected_urls', 'affected_url_count', 'status')} for f in findings[:40]]
    selected_pages = [{k: p.get(k) for k in ('url', 'status_code', 'title', 'meta_description', 'h1s', 'h2s', 'word_count', 'page_type', 'inlink_count', 'crawl_depth')} for p in pages[:30]]
    coverage = {'findingsSelected': len(selected_findings), 'findingsAvailable': len(findings), 'pagesSelected': len(selected_pages), 'pagesAvailable': len(pages), 'questionVariantsSelected': min(30, len(signals)), 'questionVariantsAvailable': len(signals), 'answersAvailable': answers_total, 'answersWithoutCapturedQuestion': unattributed, 'capturedExecutions': expected, 'runCount': len(source.get('runs', [])), 'synthetic': any(e.get('run', {}).get('measurement_mode') == 'local_fixture' for e in source.get('runs', [])), 'missingAnswersAreNegative': False, 'scope': 'Open retained findings ordered by severity and ID; successful pages by inlinks and URL; captured question variants by wording and source identity. Historical observations are not a current business outcome.'}
    crawl = source.get('crawl') or {}
    coverage['crawl'] = {'status': crawl.get('status'), 'pageCap': crawl.get('page_cap'), 'pagesCaptured': crawl.get('pages_crawled'), 'pageCapReached': (crawl.get('crawl_state') or {}).get('page_cap_reached'), 'recoveryLimited': (crawl.get('crawl_state') or {}).get('recovery_limited'), 'scope': 'Stored parsed page records, not complete original HTTP bytes. Recovery may reconstruct the queue from bounded stored links; missing pages are not evidence of absence.'}
    return {'property': source.get('property', {}), 'findings': selected_findings, 'pages': selected_pages, 'geo_signals': signals[:30], 'competitors': competitors, 'coverage': coverage}


def provider_request(job):
    context = retained_context(job['source'])
    if not context['findings'] and not context['geo_signals']:
        raise ValueError('no_input_data')
    analyst = SiteAuditAnalyst.__new__(SiteAuditAnalyst)
    prompt = analyst._build_user_prompt(context) + '\n\n## Retained source coverage and limitations\n' + json.dumps(context['coverage'], sort_keys=True)
    plan = job['model_plan']
    if plan['provider'] == 'openai':
        parameters = {'model': plan['model'], 'messages': [{'role': 'system', 'content': ANALYST_SYSTEM_PROMPT}, {'role': 'user', 'content': prompt}], 'response_format': {'type': 'json_object'}, **openai_completion_token_param(plan['model'])}
        if re.search(r'^gpt-[34]', plan['model'], flags=re.I):
            parameters['temperature'] = 0.3
    elif plan['provider'] == 'anthropic':
        parameters = {'model': plan['model'], 'max_tokens': 16000, 'system': ANALYST_SYSTEM_PROMPT, 'messages': [{'role': 'user', 'content': prompt}]}
    else:
        raise ValueError('unsupported_provider')
    result = {'modelPlan': plan, 'sourceHash': job['source_hash'], 'parameters': parameters, 'context': context, 'coverage': context['coverage'], 'processorVersion': PROCESSOR_VERSION}
    if len(json.dumps(result, ensure_ascii=False).encode()) > 524288:
        raise ValueError('prompt_source_limit')
    return result


def invoke_provider(request):
    plan, params = request['modelPlan'], request['parameters']
    if plan['provider'] == 'openai':
        import openai
        client = openai.OpenAI(api_key=os.environ.get('OPENAI_API_KEY'), timeout=45, max_retries=0)
        response = client.chat.completions.create(**params)
        raw = response.model_dump(mode='json')
        text = response.choices[0].message.content or ''
    else:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'), timeout=45, max_retries=0)
        response = client.messages.create(**params)
        raw = response.model_dump(mode='json')
        text = extract_claude_text(response)
    return {'response': raw, 'text': text, 'error': None}


def saved_rpc(db, name, **args):
    result = db.rpc(name, args).execute().data
    if not isinstance(result, dict):
        raise RuntimeError('Recommendation persistence not confirmed')
    return result


async def execute_retained_analysis(db, job):
    identity = {'p_id': job['id'], 'p_token': job['lease_token']}
    request = job.get('invocation')
    if request is None:
        try:
            request = provider_request(job)
        except ValueError as error:
            code = str(error) if str(error) in ('no_input_data', 'unsupported_provider', 'prompt_source_limit') else 'source_unavailable'
            return saved_rpc(db, 'finish_geo_recommendation', **identity, p_preview=None, p_error=code)
    started = saved_rpc(db, 'start_geo_analysis_invocation', **identity, p_request=request)
    if started.get('state') == 'claimed':
        try:
            receipt = invoke_provider(request)
        except Exception:
            # Unknown provider outcome is retained, not sent to a fallback provider.
            receipt = {'response': None, 'text': '', 'error': 'provider_outcome_unknown'}
        for attempt in range(2):
            try:
                retained = saved_rpc(db, 'retain_geo_analysis_receipt', **identity, p_receipt=receipt)
                if retained.get('state') != 'retained':
                    raise RuntimeError('Actual response retention not confirmed')
                break
            except Exception:
                if attempt == 1:
                    raise
    elif started.get('state') == 'retained':
        receipt = started['receipt']
        request = started['invocation']
    else:
        return started
    preview, error = None, receipt.get('error')
    if not error:
        try:
            payload = json.loads(receipt['text'])
            if not isinstance(payload, dict):
                raise ValueError('invalid_response')
            recommendations = SiteAuditAnalyst.__new__(SiteAuditAnalyst)._validate(payload, request['context'])
            if not recommendations:
                raise ValueError('no_grounded_recommendations')
            preview = {'recommendations': recommendations[:100], 'coverage': request['coverage'], 'processorVersion': PROCESSOR_VERSION, 'generatedCount': len(payload.get('recommendations', [])), 'acceptedCount': min(100, len(recommendations)), 'rejectedCount': max(0, len(payload.get('recommendations', [])) - min(100, len(recommendations)))}
        except (ValueError, TypeError, KeyError, AttributeError):
            error = 'invalid_or_ungrounded_response'
    return saved_rpc(db, 'finish_geo_recommendation', **identity, p_preview=preview, p_error=error)
