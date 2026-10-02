import inspect
import pytest

@pytest.mark.parametrize('module,constructor,env',[
 ('openai_connector','OpenAIConnector','OPENAI_API_KEY'),('openai_natural_connector','OpenAINaturalConnector','OPENAI_API_KEY'),
 ('claude_connector','ClaudeConnector','ANTHROPIC_API_KEY'),('claude_natural_connector','ClaudeNaturalConnector','ANTHROPIC_API_KEY')])
@pytest.mark.asyncio
async def test_provider_requests_are_async_bounded_and_have_no_hidden_sdk_retries(monkeypatch,module,constructor,env):
    import importlib
    monkeypatch.setenv(env,'fixture-not-a-real-key')
    connector=getattr(importlib.import_module('connectors.'+module),constructor)()
    try:
        assert connector.client.max_retries==0
        assert connector.client.timeout==45
        create=connector.client.chat.completions.create if module.startswith('openai') else connector.client.messages.create
        assert inspect.iscoroutinefunction(inspect.unwrap(create))
    finally:
        await connector.client.close()
