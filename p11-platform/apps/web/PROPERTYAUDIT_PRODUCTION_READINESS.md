# PropertyAudit Production Readiness

PropertyAudit is the platform's US English AI visibility product. It measures how a property or brand appears across grounded API proxies for ChatGPT, Gemini, Perplexity, and Google AI-style search behavior.

## Measurement Surfaces

- `chatgpt`: OpenAI grounded API proxy for ChatGPT-style answers.
- `gemini`: Gemini grounded API proxy.
- `perplexity`: Perplexity answer API with citation-aware capture.
- `google_ai`: Google-grounded proxy using Google search results plus answer synthesis. This is not exact browser capture of Google AI Overviews or AI Mode.
- `openai` and `claude`: legacy/internal compatibility surfaces.

## Required Production Environment

Core runtime:

- `PROPERTYAUDIT_USE_DATA_ENGINE=true`: expected for PropertyAudit runs. `false` is an explicit opt-out and should not be used for normal audits.
- `DATA_ENGINE_URL`: data-engine base URL.
- `DATA_ENGINE_API_KEY`: API key used by the web app to dispatch data-engine jobs.
- `GEO_AUDIT_MODE=natural`: expected default for production measurement.
- `CRON_SECRET`: not required for normal PropertyAudit audits. It is only relevant to unrelated cron routes and deterministic local fixture processing.

Surface providers:

- `OPENAI_API_KEY`: required for ChatGPT measurement and preferred extraction analyzer.
- `GOOGLE_GEMINI_API_KEY`: required for Gemini measurement.
- `PERPLEXITY_API_KEY`: required for Perplexity measurement.
- `SERPAPI_API_KEY`: required for Google AI proxy measurement.
- `ANTHROPIC_API_KEY`: optional fallback analyzer / legacy Claude support.

Optional model overrides:

- `GEO_OPENAI_MODEL`
- `GEO_CHATGPT_MODEL`
- `GEO_GEMINI_MODEL`
- `GEO_PERPLEXITY_MODEL`
- `GEO_GOOGLE_PROXY_MODEL`
- `GEO_CLAUDE_MODEL`

## Preflight Expectations

Before a run starts, the PropertyAudit preflight route checks selected surfaces for missing provider keys and runtime readiness. A surface should not be started in production when preflight marks it as unavailable.

The run modal should show:

- ready / missing-config state per surface
- runtime readiness for data-engine
- Google AI proxy caveat

## URL-Only Audit Limitations

PropertyAudit can create useful recommendations from a public site URL without code access. URL-only recommendations can identify:

- public crawlability issues
- missing `robots.txt`, `sitemap.xml`, or `llms.txt`
- homepage structured-data gaps
- FAQ / answer-block signals
- prompt-to-page opportunities
- third-party citation targets

URL-only audits cannot prove:

- how templates are generated internally
- CMS implementation effort
- unpublished content
- private analytics or conversion attribution
- code-level fix complexity

Recommendations therefore include `AccessLevel` values:

- `URLOnly`
- `CMSOrEditor`
- `CodeRequired`
- `ThirdParty`

## Demo Checklist

1. Select a property with a public website URL.
2. Add client prompts or generate the fallback 24-prompt panel.
3. Open Run Audit and confirm the four default surfaces are ready.
4. Run at least one execution per query for a demo; use three or more for stronger evidence.
5. Confirm results populate by surface.
6. Review Recommendations and explain `AccessLevel`, `Owner`, `Status`, `Target Page Type`, and `Target URL`.
7. Open Insights to show competitor and citation signals.
8. Export the report and explain the methodology / proxy caveats.

## Production Gate

Before promoting PropertyAudit changes:

- `npm run check:schema-types-sync`
- `npm run check:schema-truth`
- `npm run check:foundation`
- targeted PropertyAudit route tests
- local browser smoke for the PropertyAudit flow

