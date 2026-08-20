# GEO PropertyAudit Client Review Primer

## Executive Summary

The GEO PropertyAudit measures how a property appears in AI-generated answers when prospective residents, renters, buyers, or stakeholders ask questions about local options. In this context, `GEO` means Generative Engine Optimization: visibility in AI answer engines such as ChatGPT-style systems, Gemini-style systems, Perplexity, and Google-grounded AI results.

The audit is designed to answer five client-facing questions:

- Does the AI mention the property when someone asks about the brand?
- Does the AI recommend the property for non-branded local searches?
- Where does the property rank compared with competitors and aggregators?
- Which sources does the AI cite when forming its answer?
- What should the client improve over the next 30 to 60 days?

This is not a census, demographic, or radius-based real estate study. Geography matters because prompts include city, neighborhood, nearby landmarks, property type, amenities, and local intent. The output is a directional AI visibility audit: it shows where the property is strong, where it is missing, and what signals are likely influencing AI answers.

## How The Audit Works

The audit starts with a selected property and builds a prompt panel around the property name, market, neighborhood, website, property type, amenities, differentiated features, and known competitors. A typical panel includes branded, category, local, comparison, FAQ, and voice-style questions.

Example prompt types:

- Branded: "What is {Property Name}?" or "{Property Name} reviews"
- Category: "Best apartments in {City}" or "Luxury apartments near {Neighborhood}"
- Local: "Best place to live in {Neighborhood}" or "Moving to {Neighborhood} - apartment recommendations"
- Comparison: "{Property Name} vs {Competitor}"
- FAQ and voice: conversational questions a prospect might ask before touring or applying

The system runs the selected prompts across AI/search surfaces, captures the natural answer, extracts the ordered entities and citations, and evaluates whether the property appeared, where it appeared, and what sources supported the answer. The report then rolls those findings into scorecards, prompt-cluster insights, competitor visibility, citation opportunities, and a 30/60-day action plan.

## Why The Prompt Mix Matters

Generic local searches often favor aggregators such as Apartments.com, Zillow, Rent.com, and broad listing sites because those sources are comprehensive and heavily cited. That does not mean the property cannot win. It means the most useful audit compares two kinds of visibility:

- Brand recognition: whether AI systems understand and correctly describe the property when the name is included.
- Discovery visibility: whether AI systems mention the property when the prospect does not know the brand yet.

The strongest optimization opportunities usually come from specific long-tail prompts that combine neighborhood, amenities, lifestyle, landmarks, and differentiators. For example, "pet-friendly apartments in Kearny Mesa with EV charging and coworking" is more actionable than "best apartments in San Diego" because it reflects a narrower prospect need and gives the property a clearer way to stand out.

## Surfaces Measured

The audit can measure multiple AI/search surfaces. The current client-facing interpretation is:

- ChatGPT-style visibility: grounded API proxy using GPT-5.6 Sol (not the live ChatGPT UI).
- Gemini-style visibility: grounded API proxy using Gemini 3.1 Pro (not the live Gemini UI).
- Perplexity visibility: how the property performs in a citation-forward answer engine.
- Google AI proxy visibility: a directional Google-grounded signal based on search results and answer synthesis.

The Google AI proxy should be described carefully. It is not a guaranteed pixel-perfect capture of every live Google AI Overview or AI Mode result. It is a directional measurement of how Google-grounded systems may understand, mention, and cite the property.

## Core Stats Explained

### Client Headline: Branded Recognition and Discovery Mention

The client headline is two rates, computed after collapsing 5× repeats to one row per query (median presence):

- **Branded recognition:** share of branded prompts where the property is mentioned.
- **Discovery mention:** share of category and local prompts where the property is mentioned. Comparison prompts are excluded because they name the property. Generic city-wide category prompts (`Best {type} in {city}` or `weight <= 0.8`) stay as a benchmark row, not in this headline.

Client averages use the latest completed run on ChatGPT, Gemini, Perplexity, and Google AI only. Claude and legacy OpenAI stay in history. A missing Gemini run is “not measured,” not zero.

Trend movement is shown in **points**, not blended visibility percent.

### Citation Quality (Secondary)

Citation quality is the existing 0-100 composite, labeled honestly. It is **not** the visibility headline. After per-query collapse it averages:

- Position, weighted 45%: where the property appears in the AI's ordered answer. Rank #1 receives the strongest score; lower positions receive less credit.
- Link rank, weighted 25%: where the client's website or brand domain appears in the citation list.
- Share of voice, weighted 20%: the share of citations that point to the client's brand/domain compared with all citations in the answer.
- Accuracy, weighted 10%: whether the answer avoids warning flags such as no sources, possible hallucination, outdated information, conflicting details, or NAP inconsistencies.

Plain-English interpretation: high citation quality means that when the property appears, it is ranked cleanly and supported by citations.

### Visibility / Presence Rate

Blended presence across all prompt types is still available, but client reviews should lead with branded recognition and discovery mention.

### Average LLM Rank

Average LLM Rank shows the property's typical position when it appears in the AI answer. A lower number is better. Rank #1 means the property is the first named option or entity; rank #5 means it appears behind several competitors or sources.

For reporting, branded recognition is separated from non-branded discovery rank. Branded prompts are mainly entity-recognition checks. Non-branded category, local, and comparison prompts are better indicators of discovery performance.

### Average Link Rank

Average Link Rank shows where the client's owned domain appears in the citation list. A strong answer that mentions the property but cites only third-party sites may still indicate an owned-content gap. A strong owned citation position means the website is easier for AI systems to use as a source.

### Share Of Voice

Share of Voice measures how much of the cited source set belongs to the client's brand/domain. If an answer includes 10 citations and 2 are client-owned URLs, the share of voice is 20%.

This stat helps explain whether the AI is relying on the client's own website or mostly learning about the property through aggregators, directories, reviews, competitors, and other third parties.

### Citation Consistency

Citation Consistency shows whether the same domains keep appearing across repeated runs. High consistency means the AI has a stable source pattern. Low consistency means the answer may be more volatile or under-supported.

In a client review, this helps separate durable visibility from one-off mentions.

### Answer Drift

Answer Drift measures how much the AI's answer changes across repeated runs. Low drift means the answer is stable. High drift means the AI may not have a clear, consistent understanding of the property or the local category.

High drift can point to thin content, inconsistent third-party listings, weak citations, or an unclear brand/entity footprint.

### Branded Recognition

Branded Recognition measures how often the property appears correctly when the prompt includes the property name. This is the baseline: AI systems should know who the property is, what it offers, and where it is located.

Weak branded recognition is a priority issue because it suggests the brand/entity footprint itself needs cleanup.

### Discovery Mention and Rank

Discovery mention is the unprompted recommendation rate on category and local prompts. Discovery rank is the typical position when the property does appear there. Comparison prompts and generic city-wide “best in city” prompts are kept separate so they do not inflate or deflate the discovery headline.

### AI Overview Visibility

AI Overview Visibility tracks whether the property is visible in tracked Google AI Overview-style observations. Treat this as a separate directional signal, not as a replacement for live search review.

## How Recommendations Are Prioritized

Recommendations are grouped into workstreams that map to practical ownership:

- Owned Content: pages, FAQs, local landing pages, comparison copy, answer blocks, and amenity content the client can usually control.
- Citation Targets: directories, local guides, PR, partnerships, review platforms, and third-party sources that AI systems may use.
- Entity / Technical Fixes: structured data, crawlability, metadata, sitemap, robots.txt, `llms.txt`, brand consistency, and schema opportunities.
- Competitive Plays: prompts where competitors or aggregators are ahead and the property needs clearer positioning.

Priority is based on business impact, visibility gap, prompt intent, and fixability. Branded misses and high-intent local/category gaps generally receive more urgency than lower-intent maintenance items.

## Methodology Notes For The Meeting

Use the audit as a decision-support tool, not a single absolute ranking. AI answers can vary by model, retrieval source, timing, and prompt phrasing. The value of the report is in the pattern: repeated absences, recurring competitors, weak owned citations, unstable answers, and prompt clusters where the property can realistically improve.

Important methodology points to explain:

- The audit captures AI-generated answers and citations for a defined prompt set.
- Results are directional AI visibility evidence, not a guarantee of every user's exact answer.
- Branded prompts and non-branded discovery prompts should be interpreted separately.
- Generic "best in city" prompts are useful benchmarks, but they naturally favor aggregators.
- Specific neighborhood, amenity, lifestyle, and comparison prompts are often more actionable.
- A public URL is enough to diagnose many visibility gaps; CMS or code access is mainly needed to implement technical fixes.

## Suggested Client Review Flow

Start with the executive snapshot: branded recognition, discovery mention, citation quality, best and weakest surfaces, and the weakest prompt cluster.

Then move into discovery performance. Show where the property appears for non-branded local/category prompts and where competitors or aggregators are winning.

Next, review citations. Explain whether AI systems are relying on the client's owned website or third-party sources. This naturally leads into content, schema, and citation recommendations.

Close with the 30/60-day plan:

- Next 30 days: fix high-priority branded and local discovery gaps, strengthen owned pages, add or improve answer-ready FAQ/comparison content, clean up obvious structured data and crawlability issues, and pursue top citation targets.
- Next 60 days: rerun the same prompt set, compare movement by surface and prompt cluster, watch for answer drift, and update the roadmap based on what improved.

## Client-Friendly Bottom Line

The GEO PropertyAudit shows whether AI systems can find, understand, recommend, and cite the property. A strong result means the property is visible in the right conversations and supported by credible sources. A weak result does not simply mean "ranking is low"; it tells us which questions, sources, competitors, and website signals need attention so the property becomes easier for AI systems to recommend.
