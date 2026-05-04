# PropertyAudit Report Reference Guide

This guide explains what is included in a PropertyAudit report, how to interpret the metrics, and how to turn the recommendations into action.

## What PropertyAudit Measures

PropertyAudit measures how a property or brand appears in AI-generated answers for a defined set of prompts. It focuses on US English AI visibility across these surfaces:

- `ChatGPT`: a grounded API proxy for ChatGPT-style answers.
- `Gemini`: a grounded API proxy for Gemini-style answers.
- `Perplexity`: a citation-focused API answer capture.
- `Google AI Proxy`: a Google-grounded proxy using search results and answer synthesis.

PropertyAudit does not claim perfect browser-surface capture of every consumer AI product. The Google AI Proxy is not exact Google AI Overview or AI Mode capture. It is a directional measurement of how Google-grounded answer systems may understand and cite the client.

## How To Read The Report

### Executive Snapshot

The first page answers the core business questions:

- where the brand currently stands
- whether visibility is strong or weak
- which AI surface performs best
- which surface or prompt cluster needs attention
- which three actions should happen next

Use this section for executive and client-facing conversation.

### AI Visibility Position

This section breaks performance down by surface. It shows where the brand is present, where it is absent, and whether the answer/citation pattern is stable.

Important fields:

- `Visibility / Presence Rate`: how often the brand appears in measured answers.
- `Median Brand Position`: the typical position of the brand when it appears.
- `Citation Share / Share of Voice`: the share of cited sources that reference the brand.
- `Citation Consistency`: whether the same cited domains recur across repeated runs.
- `Answer Drift`: whether repeated runs produce materially different answer summaries.

### Competitive Landscape

This section explains who AI systems mention instead of, or alongside, the client.

It includes:

- top competitors mentioned in AI answers
- competitors with stronger positioning
- top cited domains
- likely citation targets worth pursuing

This is often the section that creates the clearest client urgency.

### Website And URL-Only Readiness

This section uses public website signals and does not require code access.

It checks:

- homepage reachability
- `robots.txt`
- `sitemap.xml`
- `llms.txt`
- structured data
- FAQ schema
- answer-block signals

These findings are useful from a public URL alone. They do not prove how difficult a fix is internally.

### Action Plan

Recommendations are grouped into workstreams:

- `Owned Content`: pages, FAQs, answer blocks, and content updates the client can usually control.
- `Citation Targets`: directories, lists, PR, partnerships, reviews, or third-party sources.
- `Entity / Technical Fixes`: structured data, crawlability, metadata, and brand consistency.
- `Competitive Plays`: prompt clusters where competitors are currently stronger.

Each recommendation includes:

- `Priority`: urgency level.
- `Impact`: estimated upside.
- `AccessLevel`: what kind of access is likely required.
- `Owner`: likely responsible team.
- `Status`: current execution state.
- `Target URL`: known public URL or domain target.
- `Target Page Type`: the kind of page or asset to update/create.
- `Evidence Mode`: whether the recommendation came from URL-only evidence or deeper implementation context.

### Evidence Appendix

This section is for deeper review. It may include:

- prompt-level results
- natural answer text
- ordered entities
- cited domains and URLs
- glossary and methodology notes

## Recommendation Access Levels

`URLOnly`

The recommendation is based on public website and AI-answer evidence. Code access is not required to identify the issue.

`CMSOrEditor`

The recommendation likely requires page or CMS editing, such as adding FAQs, updating headings, creating landing pages, or improving answer blocks.

`CodeRequired`

The recommendation likely requires engineering help, such as adding structured data templates, changing metadata generation, fixing crawlability issues, or managing `llms.txt` deployment.

`ThirdParty`

The recommendation depends on external platforms, outreach, PR, directories, listings, reviews, or partner content.

## Do We Need Website Code Access?

No. A public URL is enough for a valuable PropertyAudit report.

With only a URL, PropertyAudit can identify:

- whether AI systems mention the brand
- which competitors appear
- which public pages and third-party sources influence answers
- whether public crawl and structured data signals are weak
- what content or citation opportunities should be prioritized

Code access improves execution, but it is not required for diagnosis.

Code or CMS access helps when the client wants to:

- implement schema
- edit templates
- add pages
- fix metadata
- publish `llms.txt`
- automate recommendations
- estimate implementation effort precisely

## How Clients Should Use The 30/60-Day Plan

First 30 days:

- fix high-priority visibility gaps
- create or refresh the most important owned content
- address obvious structured data and crawlability issues
- pursue the top citation targets

Next 60 days:

- rerun monitored prompts
- compare changes by surface
- close remaining recommendations
- refresh the report for trend and drift analysis

## Plain-English Metric Glossary

`GEO Score`

Composite score estimating how well the brand appears in AI answers.

`Visibility / Presence Rate`

How often AI tools mention or recommend the brand.

`Median Brand Position`

Where the brand usually appears when it is mentioned.

`Citation Share / Share of Voice`

The client's slice of cited sources compared with competitors and third parties.

`Citation Consistency`

How stable the citation pattern is across repeated runs.

`Answer Drift`

How much AI answers change across repeated runs.

`Opportunity Score`

Estimated impact and fixability of a recommendation.

`Google AI Proxy Visibility`

Directional Google-grounded visibility signal, not exact browser capture of AI Overviews.

