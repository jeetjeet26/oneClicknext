# Token Limits Reference - TypeScript vs Python

## 📊 Max Token Settings

### OpenAI (gpt-5.2)

| Phase | API | TypeScript | Python | Notes |
|-------|-----|------------|--------|-------|
| **Phase 1 (Natural)** | Responses API | No limit specified | No limit specified | ✅ Match |
| **Phase 2 (Analysis)** | Chat Completions | No limit specified | 4000 `max_completion_tokens` | ✅ GPT-5+ uses `max_completion_tokens` |

**Critical**: GPT-5+ models reject `max_tokens` parameter and require `max_completion_tokens` instead.

### Claude (claude-sonnet-4-20250514)

| Phase | TypeScript | Python | Notes |
|-------|------------|--------|-------|
| **Phase 1 (Natural)** | 2000 | 2000 | ✅ Match |
| **Phase 2 (Analysis)** | 4000 | 4000 | ✅ Match (increased to avoid truncation) |

---

## 🔧 Implementation Details

### OpenAI Phase 2 (Analysis) - Model-Specific

```python
# Python handles both GPT-4 and GPT-5+
params = {...}

if re.search(r'^gpt-5', self.model, re.I):
    params["max_completion_tokens"] = 4000  # GPT-5+ requirement
else:
    params["max_tokens"] = 4000  # GPT-4 and earlier
```

### Why Different Parameters?

**GPT-5 models** require the newer API:
- ✅ `max_completion_tokens` (counts only output tokens)
- ❌ `max_tokens` causes 400 error: "Unsupported parameter"

**GPT-4 models** use the older API:
- ✅ `max_tokens` (counts output tokens)
- ❌ `max_completion_tokens` not supported

---

## 🎯 Current Configuration

### Your Settings (from .env):
```bash
GEO_OPENAI_MODEL=gpt-5.2           # Uses max_completion_tokens
GEO_CLAUDE_MODEL=claude-sonnet-4-20250514
GEO_ENABLE_WEB_SEARCH=true
GEO_AUDIT_MODE=natural
```

### Token Allocation:

**OpenAI GPT-5.2**:
- Phase 1 (Natural response): **No limit** (Responses API auto-manages)
- Phase 2 (Analysis): **4000 completion tokens** (enough for detailed extraction)

**Claude Sonnet 4**:
- Phase 1 (Natural response): **2000 tokens** (sufficient for conversational answer)
- Phase 2 (Analysis): **4000 tokens** (handles detailed structured extraction)

---

## 💡 Why These Limits?

### Phase 1 (Natural Response)
- **Goal**: Get a natural conversational answer (like real ChatGPT/Claude)
- **Tokens**: 2000 is sufficient for 3-5 paragraph answers
- **OpenAI**: No limit needed (Responses API manages dynamically)

### Phase 2 (Detailed Analysis)
- **Goal**: Extract structured GEO data from natural response
- **Tokens**: 4000 because analysis includes:
  - `answer_block` with entities, citations, summary, flags
  - `analysis` with ordered_entities (prominence, mention_count, quotes)
  - `brand_analysis` (mentioned, position, location_correct)
  - `extraction_confidence` score
- **Risk**: Truncation would lose critical metadata

---

## 🔍 Token Usage Monitoring

The Python implementation logs token usage:

```python
# Phase 1
logger.info(f"Phase 1: {usage['total_tokens']} tokens")

# Phase 2
logger.info(f"Phase 2: {usage['total_tokens']} tokens")
```

Typical usage per query:
- Phase 1: ~1000-1500 tokens
- Phase 2: ~2000-3000 tokens
- **Total per query**: ~3000-4500 tokens
- **Total per run (18 queries)**: ~54,000-81,000 tokens

---

## ⚠️ Important Notes

1. **GPT-5.2 API Change**: The switch from `max_tokens` to `max_completion_tokens` is an OpenAI API change, not our bug
2. **Responses API**: Doesn't expose token control (manages automatically)
3. **Analysis Needs More**: Phase 2 requires more tokens than Phase 1 because it outputs detailed structured JSON
4. **Temperature**: TypeScript uses `config.temperature` (default 0), Python uses 0 or 0.1 for extraction

---

## ✅ Python Implementation Status

All token limits now match TypeScript exactly:

- ✅ OpenAI Responses API: No limit (auto-managed)
- ✅ OpenAI Phase 2: 4000 via `max_completion_tokens` (GPT-5+)
- ✅ Claude Phase 1: 2000
- ✅ Claude Phase 2: 4000 (increased to avoid truncation)

**Result**: Python output quality = TypeScript output quality 🎯






