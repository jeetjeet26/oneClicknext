# PropertyAudit GEO Reports — Operator Process

Use this document to run, generate, and deliver a PropertyAudit GEO report. It is written for account, strategy, and ops teammates — not engineering.

Companion reading after you have a report in hand:

- `PROPERTYAUDIT_CLIENT_REVIEW_PRIMER.md` — how to walk a client through the numbers
- `PROPERTYAUDIT_REPORT_REFERENCE.md` — section-by-section report glossary

## What This Product Does

PropertyAudit measures **GEO** (Generative Engine Optimization): how often a property is mentioned, ranked, and cited when people ask AI tools about local housing options.

It is **not** a census, radius study, or traditional SEO rank tracker. It answers:

1. Does AI mention the property when someone asks by name?
2. Does AI recommend the property when the prospect does **not** know the brand?
3. Who shows up instead (competitors and aggregators)?
4. Which sources is the AI citing?
5. What should we do in the next 30–60 days?

Results are **directional**. They show patterns across a defined prompt set. They do not guarantee the exact answer every consumer will see in ChatGPT, Gemini, Perplexity, or Google AI Overviews.

## Before You Start

You need:

- A P11 login with access to the property
- The property already created in the dashboard
- A public website URL if you want site-readiness findings (helpful, not required to diagnose visibility)

Fill in property data **before** generating queries. Better inputs produce a better prompt panel:

| Field | Why it matters |
| --- | --- |
| Property name | Branded recognition prompts |
| City / state / neighborhood | Discovery and local prompts |
| Property type | Apartments vs homes vs other nouns |
| Amenities and special features | Long-tail discovery prompts the property can actually win |
| Website URL | Public crawl, schema, `llms.txt`, citation checks |
| Competitors (MarketVision) | Comparison prompts and competitive landscape |

A public URL is enough for a useful report. CMS or code access is only needed later, when the client wants to implement technical fixes.

## Standard Delivery Path

```
Select property → Build query panel → Review prompts → Run audit (5×) → Wait for all surfaces to complete → Generate report → Save as PDF → Review internally → Client walkthrough
```

Default client-ready run:

- Surfaces: **ChatGPT, Claude, Gemini, Perplexity, Google AI**
- Repeat count: **5×**
- Report template: **Executive Brief** for a meeting, **Comprehensive Audit** for the leave-behind

---

## Step 1. Open PropertyAudit

1. Sign in at [https://hellop11.com](https://hellop11.com).
2. Use the property switcher in the top of the dashboard and select the correct property.
3. In the left sidebar, open **PropertyAudit**.

If you see “Select a property to view GEO insights,” the property switcher is empty or unset. Fix that first. Scores, queries, and reports are always scoped to the selected property.

The page you want is `/dashboard/propertyaudit`.

---

## Step 2. Build The Query Panel

The query panel is the set of prompts PropertyAudit will ask each AI surface. The report is only as useful as this list.

### First-time property

1. Stay on the **Overview** tab.
2. Click **Generate Query Panel**.
3. Switch to the **Queries** tab and review every prompt before you run anything.

### Better first-time panel (recommended)

If you have a SEMrush or Google Ads keyword export:

1. Open the **Queries** tab.
2. Click **Seed CSV**.
3. Upload a CSV with a keyword column (`Keyword`, `Search term`, `Search keyword`, `Phrase`, or `Query`). Impressions, clicks, cost, and conversions are optional and used only to rank seeds.
4. Confirm the preview looks right, then generate.

The uploader keeps the strongest seeds (up to 50 parsed, about 20 used) and turns them into discovery-style prompts. Generic “best apartments in {city}” seeds are usually weaker than neighborhood + amenity + lifestyle phrases.

### Regenerating later

**Regenerate** adds a new generated panel. It does not replace your existing prompts. Review the **Queries** tab afterward and delete duplicates or stale rows. Do not regenerate blindly right before a client rerun if you need period-over-period comparability.

---

## Step 3. Review And Edit Prompts

Open **Queries**. You want a balanced panel, not a long list of city-wide “best of” questions.

### Keep these types

| Type | Example | What it measures |
| --- | --- | --- |
| **Branded** | `What is {Property}?` / `{Property} reviews` | Does AI know the property exists and describe it correctly? |
| **Category** | `Pet-friendly apartments in Kearny Mesa with EV charging` | Discovery when the prospect does not know the brand |
| **Local** | `Best place to live in {Neighborhood}` | Neighborhood / relocation intent |
| **Comparison** | `{Property} vs {Competitor}` | Head-to-head positioning |
| **FAQ / Voice** | Conversational questions a prospect would ask before touring | Answer-ready content gaps |

### Edit rules

- Prefer **long-tail** prompts: neighborhood + amenity + lifestyle + differentiator.
- Keep **one** generic city-wide prompt such as `Best apartments in {City}` as a benchmark. Do not fill the panel with them. Aggregators (Apartments.com, Zillow, Rent.com) are built to win those.
- Deactivate or delete prompts that are misspelled, name the wrong city, or do not match the property type.
- Use **Add Query** for client-requested prompts (a specific competitor, amenity, or landmark).
- Toggle a query **inactive** if you want to keep it for later but exclude it from the next run.

A strong panel usually includes:

- 4 branded prompts
- Several neighborhood / amenity discovery prompts
- A few local / moving prompts
- 1–3 real competitor comparisons
- A small FAQ / voice set

If branded recognition is the only thing that looks good, the panel is doing its job. Discovery is the harder, more valuable story.

---

## Step 4. Run The Audit

1. Click **Run Audit** in the top right. The button stays disabled until the property has at least one query.
2. In **Configure Audit Run**, leave the default surfaces selected unless a surface shows **Missing config**:
   - ChatGPT
   - Claude
   - Gemini
   - Perplexity
   - Google AI
3. Set **Run Each Query** to **5×** for a client-ready report. Use 1× only for a quick internal smoke check.
4. Confirm the **Total LLM calls** number looks reasonable (`queries × surfaces × repeats`).
5. Click **Start Audit**.

Claude is a client surface. Leave it selected unless a key is missing. Legacy OpenAI is the only surface that stays out of the headline average.

### While it runs

- A progress bar appears on the page and again under the **History** tab.
- One audit batch creates one run per selected surface. Wait until **every** selected surface is `completed`.
- Do not generate a client report from a mix of a finished ChatGPT run and a still-running Gemini run.
- If a surface shows **Missing config** or the runtime is not ready, stop and ask engineering. Do not send a partial four-surface report as if it were complete.
- A missing Gemini run should be described as **not measured**, never as 0%.
- Gemini 3 search grounding has its own quota. The runner uses `googleSearch` (not the older retrieval tool), then falls back to an ungrounded answer if grounding 429s. After 6 consecutive 429s with no success, the run stops instead of sitting `running` for hours. If Gemini still fails with 0 answers, check Google AI Studio **Search Grounding** quota / billing, or set `GEO_GEMINI_MODEL` to `gemini-2.5-pro`.

Runs can take a while, especially at 5× across four surfaces. Stay on the property, or come back later and use **History** to confirm completion.

---

## Step 5. Read The Dashboard Before You Export

The four headline cards are what you lead with:

| Card | Meaning | How to talk about it |
| --- | --- | --- |
| **Branded recognition** | Share of named-property prompts where the property appears | “When someone asks for us by name, do AI tools know who we are?” |
| **Discovery mention** | Share of category + local prompts where the property appears | “When someone is shopping the neighborhood and does not know us, do we get recommended?” |
| **Citation quality** | How cleanly the property is ranked and cited **when it appears** | Secondary. High quality does not mean high visibility. |
| **Owned citations** | Share of prompts that cite the property’s own domain | “Is AI learning about us from our site, or only from Zillow / Apartments.com?” |

Surface cards under the headlines show discovery mention first, then branded recognition. A surface marked **Not measured** was not in the completed batch.

Then check these tabs before you generate the file:

- **Overview** — alerts, surface comparison, query-type rings, trend
- **Recommendations** — Audit Roadmap and prioritized actions
- **Insights** — competitors and positioning
- **History** — confirm the batch you are about to report on

Do not lead a client review with blended visibility or the old overall GEO score. Lead with branded recognition and discovery mention, in that order.

---

## Step 6. Generate The Report

**Generate Report** is disabled until at least one run is `completed`.

1. Click **Generate Report**.
2. Confirm the snapshot line mentions the latest completed batch. If it says a completed run is required, refresh History and wait.
3. Choose a template:

| Template | Use when |
| --- | --- |
| **Executive Brief** (~5 pages) | Live client meeting, owner update, first readout |
| **Comprehensive Audit** (~15 pages) | Leave-behind, new-business audit, full evidence pack |
| **Competitive Intelligence** (~10 pages) | The story is “who AI recommends instead of us” |
| **Monthly Progress Report** (~8 pages) | Rerun against the same prompt set |

4. Keep **Executive Summary** on. Add or remove optional sections as needed:
   - Score Overview & Trends
   - Surface Coverage & Measurement Notes
   - Competitive Intelligence
   - Actionable Recommendations
   - Query-Level Details
   - Appendix & Methodology
5. Click **Generate Report**.
6. An HTML file downloads. Open it in Chrome or another browser.
7. Use **Print → Save as PDF**. That PDF is the client artifact.

### Faster exports

Next to **Generate Report**:

- **Print/PDF** — opens the latest completed run in a print window
- **Markdown** — useful for Notion, Slack, or drafting an email

Use **Generate Report** when you want a named template and section control. Use **Print/PDF** when you just need a copy of the latest run.

### Delivery options in the modal

The email-recipient and “schedule monthly reports” fields are **not live**. Do not tell a client the report will email itself. Download the HTML, save a PDF, and send it yourself.

---

## Step 7. Internal QA Before The Client Sees It

Check the PDF against this list:

- [ ] Property name, city, and website are correct.
- [ ] All four default surfaces completed. Any missing surface is labeled “not measured.”
- [ ] Headline numbers match the dashboard (branded recognition, discovery mention, citation quality).
- [ ] Generic city-wide prompts are treated as a benchmark, not as the discovery headline.
- [ ] Recommendations name real pages, competitors, or citation targets — not vague “create more content.”
- [ ] You can explain the top 3 actions in plain English without opening the appendix.
- [ ] You are not claiming exact Google AI Overview or live ChatGPT UI capture.

If branded recognition is weak, that is the first conversation. If branded is strong and discovery is weak, the conversation is content, citations, and neighborhood positioning — not “the brand is unknown.”

---

## Step 8. How To Walk The Report

Use this order in the meeting. Details and talk tracks live in `PROPERTYAUDIT_CLIENT_REVIEW_PRIMER.md`.

1. **Executive snapshot** — branded recognition, discovery mention, citation quality, best surface, weakest surface, top 3 actions.
2. **Discovery** — where the property is absent on non-branded local/category prompts, and who wins instead.
3. **Citations** — owned site vs aggregators, directories, reviews, and competitors.
4. **Website readiness** — public signals only: homepage, robots, sitemap, `llms.txt`, schema, FAQ blocks.
5. **30/60-day plan**
   - Next 30 days: high-priority branded and local gaps, owned pages, answer-ready FAQs, obvious crawl/schema issues, top citation targets.
   - Next 60 days: rerun the **same** prompt set, compare movement by surface, watch answer drift, refresh the roadmap.

### Sentences that stay honest

Use:

- “This is a directional AI-visibility audit across a defined prompt set.”
- “Google AI in this report is a grounded proxy, not a pixel-perfect capture of every live AI Overview.”
- “Generic ‘best in city’ prompts usually favor listing sites. The actionable wins are neighborhood and amenity prompts.”

Avoid:

- “You rank #3 in ChatGPT.”
- “Google AI Overviews show you X% of the time.”
- “The GEO score is your visibility score.”

---

## Step 9. Recurring Measurement

Treat PropertyAudit as a repeating measurement system, not a one-off PDF.

1. Keep the query panel stable after the first client-approved run.
2. Add new prompts only when the client has a new competitor, amenity, or campaign.
3. Rerun the same surfaces at 5× after the 30-day work is done.
4. Generate a **Monthly Progress Report** and compare discovery mention and branded recognition **in points**, not as a blended percent.
5. Close or refresh recommendations that were completed.

Do not click **Reset all GEO scores** unless you intentionally want to wipe run history, scores, answers, citations, and AI Overview observations. Query prompts are kept. This cannot be undone. Use it for a contaminated test property, not a live client.

---

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| “Select a property to view GEO insights” | Select the property in the dashboard switcher. |
| **Run Audit** is disabled | There are no queries. Generate or add at least one. |
| **Generate Report** is disabled | No completed run yet. Wait for History to show `completed`. |
| Surface says **Missing config** | Do not run that surface. Ask engineering to restore provider keys. |
| Runtime not ready | The audit worker is down. Do not start a client run. |
| Report error about an incomplete run | Wait for the full batch, or generate from the latest completed batch only. |
| Browser blocked the download | Use **Download Markdown report** in the modal, or **Print/PDF** on the page. |
| Pop-up blocked on Print/PDF | Allow pop-ups for hellop11.com and try again. |
| Queries look generic / wrong city | Edit property address and amenities, then add or edit prompts. Do not ship the first auto-generated panel unreviewed. |
| Gemini missing from the headline | Say “not measured.” Never treat it as zero. |
| Numbers disagree across tabs | Refresh the page after the last surface completes so scores reload. |

---

## Roles

| Role | Owns |
| --- | --- |
| Operator / CSM | Property selection, query review, run, report, client meeting |
| Strategy | Prompt mix, recommendation priority, 30/60-day plan |
| Web / SEO | Owned-content and on-site fixes from the roadmap |
| Engineering | Missing surface config, stalled runs, reset requests on live clients |

If you are unsure whether a finding is a visibility problem or a website-implementation problem, use the recommendation **Access Level**:

- `URLOnly` — diagnosed from the public site and AI answers
- `CMSOrEditor` — page/CMS edits
- `CodeRequired` — schema, templates, crawl, `llms.txt`
- `ThirdParty` — directories, PR, reviews, partners

---

## Quick Checklist

Copy this into the ticket or Slack thread for each property:

- [ ] Correct property selected
- [ ] Property name, city, neighborhood, amenities, website, and competitors look right
- [ ] Query panel reviewed; long-tail discovery prompts kept; generic city prompts limited
- [ ] Audit run on ChatGPT, Claude, Gemini, Perplexity, and Google AI at 5×
- [ ] All selected surfaces `completed`
- [ ] Dashboard headlines reviewed
- [ ] Report generated (Executive Brief for the meeting and/or Comprehensive for the leave-behind)
- [ ] HTML opened and saved as PDF
- [ ] Internal QA passed
- [ ] Client walkthrough scheduled using the primer script
- [ ] Follow-up rerun date set (30–60 days) against the same prompt set
