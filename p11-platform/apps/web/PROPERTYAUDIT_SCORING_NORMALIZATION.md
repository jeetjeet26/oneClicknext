# PropertyAudit Scoring & Recommendations Normalization

## Overview

PropertyAudit tracks GEO performance across the sellable v1 surfaces: ChatGPT, Gemini, Perplexity, and Google AI Proxy. Claude and legacy OpenAI remain in history but are not averaged into the client headline.

---

## Client Headline

Share one helper (`utils/propertyaudit/client-headline.ts`) so the dashboard, score API, and HTML report cannot drift.

After collapsing 5× repeats to one median row per query:

1. **Branded recognition:** presence rate on `type === 'branded'`.
2. **Discovery mention:** presence rate on `category` + `local` only. Exclude comparison and generic city-wide category prompts (`weight <= 0.8` or `Best {type} in {city}`).
3. **Citation quality (secondary):** existing `45% position + 25% owned-citation rank + 20% SOV + 10% accuracy` on collapsed rows, then equal-average those queries.
4. **Owned citation rate:** share of collapsed queries with a brand-domain citation.

Client surfaces are the latest **completed** run per `SELLABLE_V1_SURFACES`. Missing Gemini is “not measured”, not 0. Trend uses the same headline rates and is labeled in **points**.

The stored `geo_scores.overall_score` remains historical. The score API recomputes the headline on read from `geo_answers` / `geo_queries`.

---

## Citation Quality Formula

`LLM_SERP_SCORE = 45% Position + 25% Link + 20% SOV + 10% Accuracy`

- **Position (45%):** LLM rank (1st = 100%, 10th = 10%)
- **Link (25%):** first owned-citation rank
- **SOV (20%):** brand citations / total citations
- **Accuracy (10%):** penalized by warning flags. `no_sources` is set after provider citations are merged, not from prose-only extraction.

---

## Recommendations

`modelBreakdown` is `Partial<Record<Surface, …>>` plus `affectedModels`. Cards iterate whatever v1 surfaces were measured.

Presence is optimistic: if any measured surface shows presence, the query has presence. Rank issues still generate recommendations when any surface ranks worse than #3.

---

## Measurement Notes

- ChatGPT-style = GPT-5.6 Sol API proxy.
- Gemini-style = Gemini 3.1 Pro API proxy (`thinking_level=low`).
- Perplexity stays `sonar-pro`.
- Google AI stays SerpAPI + synthesis.
