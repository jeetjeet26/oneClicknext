import asyncio

import httpx
import pytest

from connectors.v1_natural_connectors import post_gemini_with_retry


class FakeGeminiClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    async def post(self, url, json):
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def make_response(status_code=200, payload=None, headers=None):
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com/test")
    return httpx.Response(
        status_code,
        request=request,
        json=payload or {"candidates": []},
        headers=headers or {},
    )


def make_rate_limit_error(headers=None):
    response = make_response(429, {"error": "Too Many Requests"}, headers=headers)
    return httpx.HTTPStatusError("429 Too Many Requests", request=response.request, response=response)


@pytest.mark.asyncio
async def test_post_gemini_with_retry_retries_429(monkeypatch):
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setenv("GEO_GEMINI_THROTTLE_MS", "0")
    monkeypatch.setenv("GEO_GEMINI_MAX_RETRIES", "2")
    monkeypatch.setenv("GEO_GEMINI_BASE_BACKOFF_MS", "0")
    monkeypatch.setenv("GEO_GEMINI_MAX_BACKOFF_MS", "0")
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    client = FakeGeminiClient([
        make_rate_limit_error(headers={"retry-after": "0"}),
        make_response(200, {"ok": True}),
    ])

    response = await post_gemini_with_retry(client, "https://example.com", {"prompt": "test"})

    assert response.status_code == 200
    assert client.calls == 2
    assert sleeps == [0]


@pytest.mark.asyncio
async def test_post_gemini_with_retry_serializes_concurrent_calls(monkeypatch):
    active_calls = 0
    max_active_calls = 0
    release_first_call = asyncio.Event()

    class BlockingClient:
        async def post(self, url, json):
            nonlocal active_calls, max_active_calls
            active_calls += 1
            max_active_calls = max(max_active_calls, active_calls)
            if json["prompt"] == "first":
                await release_first_call.wait()
            active_calls -= 1
            return make_response(200, {"ok": True})

    monkeypatch.setenv("GEO_GEMINI_THROTTLE_MS", "0")
    monkeypatch.setenv("GEO_GEMINI_MAX_RETRIES", "0")

    client = BlockingClient()
    first = asyncio.create_task(post_gemini_with_retry(client, "https://example.com", {"prompt": "first"}))
    second = asyncio.create_task(post_gemini_with_retry(client, "https://example.com", {"prompt": "second"}))

    await asyncio.sleep(0)
    assert max_active_calls == 1

    release_first_call.set()
    await first
    await second

    assert max_active_calls == 1
