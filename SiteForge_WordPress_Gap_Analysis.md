# SiteForge → WordPress: Full Gap Analysis & Deployment Architecture

**Date:** March 4, 2026
**Scope:** Content quality audit, WordPress integration assessment, deployment layer design
**Status:** Analysis only — no code changes

---

## Part 1: Blueprint Content Quality Audit

### What Exists

SiteForge has generated **16 versions** of a website for "The Aurora at Downtown Denver." Across these versions, the blueprint engine has matured significantly from v1 (failed at 30%) to v16 (ready_for_preview at 100%).

### Version History Summary

| Versions | Status | Pages | ACF Block Coverage | Notes |
|----------|--------|-------|--------------------|-------|
| v1–v2 | Failed (30–50%) | 0–6 | Partial | Early pipeline issues |
| v3 | **Complete** | 5 | Full (14 blocks) | Only version marked "complete"; includes `pages_generated` + `site_architecture` |
| v4–v5 | Ready for preview | 5–6 | Full | Stable generation |
| v6 | Failed (30%) | 0 | — | Regression |
| v7 | Ready for preview | **9 pages** | Full | Richest version: Home, Floor Plans, Amenities, Gallery, Neighborhood, About, Contact, FAQ, Policies |
| v8–v11 | Failed (0%) | 0 | — | Multiple failures |
| v12–v16 | Ready for preview | 3 | Partial | Regression in page count (only Home, Amenities, Floor Plans) |

### Content Quality Assessment

**Version 3 (the "complete" one) — PRODUCTION GRADE:**

This is the strongest output. It produces a fully realized 5-page apartment community website with:

- **Home:** Hero slider → brand intro → amenity highlights (3-column grid with icons) → lifestyle feature section → CTA links. Content is specific (mentions Peloton bikes, quartz countertops, EV charging, specific amenities).
- **Floor Plans:** Header → sub-navigation filter (Studio/1BR/2BR/Penthouse) → interactive Yardi-connected plans browser → finish details feature → application CTA.
- **Amenities:** Hero slider → 6-amenity grid (Sky Deck, Wellness Center, Social Lounge, Pet Paradise, Executive Hub, Secure Parking) → lifestyle photo → pet policy HTML section → tour CTA.
- **Neighborhood:** Interactive POI map (restaurants, shopping, entertainment, transit) → editorial copy mentioning Union Station, Coors Field, LoDo → Google Maps directions embed.
- **Contact:** Split layout with leasing office info/hours → lead gen form → FAQ accordion (lease terms, parking, pets, furnished options).

Every section maps to a specific ACF block, has `image_index` references for photo placement, uses FontAwesome icons, and includes real conversion paths.

**Version 7 (richest) — STRONG BUT VERBOSE:**

Expands to 9 pages by adding Gallery, About, FAQ, and Policies pages. Content is solid but the FAQ and Policies pages could exist as sections within Contact rather than standalone pages.

**Versions 12–16 (latest) — REGRESSION:**

These only generate 3 pages (Home, Amenities, Floor Plans) and the content has shifted to being more generic and verbose. The "reasoning" metadata now takes up more space than the actual content. Key problems:

- Copy is repetitive — "thoughtfully designed," "sanctuary," and "resort-style" appear in nearly every section, sometimes 3+ times in the same paragraph.
- Missing specific amenity details that v3 had (no mention of Peloton, co-working pods, saltwater pool, etc.)
- No neighborhood page, no contact page, no FAQ — critical for a functional website.
- The `acfBlock` field is stored under `block` instead of `acfBlock`, breaking naming consistency.

### Content Verdict

| Criteria | v3 | v7 | v12–v16 |
|----------|----|----|---------|
| Page completeness | ✅ 5 essential pages | ✅ 9 pages (some unnecessary) | ❌ Only 3 pages |
| Specific content | ✅ Real amenity names, features | ✅ Good specifics | ❌ Generic/repetitive |
| ACF block mapping | ✅ Every section mapped | ✅ Every section mapped | ⚠️ Mapped but key renamed |
| Conversion paths | ✅ Multiple CTAs, forms, application links | ✅ Strong | ⚠️ Limited (missing contact page) |
| Image planning | ✅ `image_index` references throughout | ✅ Full coverage | ⚠️ `photoRequirement` descriptions but no indexes |
| WordPress-ready | ✅ Ready to deploy | ✅ Ready to deploy | ❌ Incomplete site |

**Recommendation:** v3's architecture with v7's page breadth is the target. The recent versions (v12–v16) represent a quality regression — the blueprint prompt likely needs to be re-tuned to produce v3-quality output with v7-level page coverage.

---

## Part 2: ACF Block Library Assessment

SiteForge references **14 distinct ACF blocks** across all versions. Here's the canonical block library:

| ACF Block | Purpose | Field Structure | Used In |
|-----------|---------|-----------------|---------|
| `acf/top-slides` | Hero image slider | `slides[]{headline, subheadline, cta_text, cta_link, image_index}`, `autoplay`, `overlay_style` | Every page hero |
| `acf/text-section` | Rich text content | `headline`, `content` (HTML), `layout` (center/left), `background` | Intros, about, policies |
| `acf/content-grid` | Card grid layout | `items[]{icon, headline, description, image_index}`, `columns` | Amenity showcases, highlights |
| `acf/feature-section` | Image + text split | `headline`, `content` (HTML), `layout` (image-left/right), `cta_link`, `cta_text`, `image_index` | Feature spotlights, neighborhood |
| `acf/links` | CTA button group | `links[]{url, text, style}` | Page CTAs, conversion points |
| `acf/plans-availability` | Floor plan browser | `data_source` (yardi), `display_style`, `filter_options[]` | Floor plans page |
| `acf/form` | Lead capture form | `heading`, `subheading`, `form_type` (contact/tour), `redirect_url` | Contact, conversion |
| `acf/gallery` | Photo gallery | `layout` (grid/masonry), `image_indices[]` or `images` | Gallery, lifestyle |
| `acf/image` | Single hero image | `size` (full/large/medium), `caption`, `image_index` | Visual breaks |
| `acf/map` | Google Maps embed | `zoom_level`, `show_directions` | Directions, contact |
| `acf/poi` | Points of interest map | `categories[]`, `intro_text`, `radius_miles` | Neighborhood |
| `acf/menu` | Sub-navigation | `menu_items[]` | Floor plan filters, page nav |
| `acf/accordion-section` | Expandable FAQ/list | `items[]{title, content}` | FAQ, policies |
| `acf/html-section` | Raw HTML | `html_content` | Pet policy, walk score, video |

### Block Library Verdict

This is a **well-designed, purpose-built block library for apartment marketing websites.** The 14 blocks cover every standard section type a property website needs. The field structures are consistent and well-defined across versions.

**However, this block library does not exist as actual WordPress code yet.** These are purely schema definitions in the blueprint JSON — no ACF PHP registration, no block templates, no CSS, no JavaScript. Building this block library is a prerequisite before any deployment can happen.

---

## Part 3: Blueprint-to-WordPress Mapping Viability

### What a deployment pipeline needs to do

For each blueprint, the pipeline must:

1. **Create WordPress pages** — one per `pages[]` entry, with the correct slug, title, and SEO metadata.
2. **Render ACF blocks** — translate each `sections[]` item into a Gutenberg block referencing the registered ACF block with its field values.
3. **Upload media** — resolve `image_index` references to actual photos, upload to WP media library, get attachment IDs.
4. **Set navigation** — create a WordPress menu matching the `navigation.items[]` from the blueprint.
5. **Configure theme** — apply brand colors, typography (Cormorant Garamond mentioned in blueprints), and design tokens.
6. **Connect data sources** — wire `acf/plans-availability` to Yardi API, `acf/form` to LumaLeasing lead capture, `acf/poi` to Google Maps API.

### Feasibility by block

| Block | WP REST API Deployable? | Complexity | Notes |
|-------|------------------------|------------|-------|
| `acf/top-slides` | ✅ Yes via ACF block API | Medium | Needs media upload first for slide images |
| `acf/text-section` | ✅ Yes | Low | HTML content maps directly |
| `acf/content-grid` | ✅ Yes | Low | Icon references (FontAwesome) need theme support |
| `acf/feature-section` | ✅ Yes | Medium | Image + layout positioning |
| `acf/links` | ✅ Yes | Low | Button rendering is theme-dependent |
| `acf/plans-availability` | ⚠️ Partially | **High** | Requires Yardi API integration built into the block |
| `acf/form` | ⚠️ Partially | **High** | Needs form backend (Gravity Forms, WPForms, or custom) connected to LumaLeasing |
| `acf/gallery` | ✅ Yes | Medium | Bulk media upload required |
| `acf/image` | ✅ Yes | Low | Single media upload |
| `acf/map` | ✅ Yes | Low | Google Maps API key needed |
| `acf/poi` | ⚠️ Partially | **High** | Custom JS for interactive POI map, data source needed |
| `acf/menu` | ✅ Yes | Low | WP nav menu API |
| `acf/accordion-section` | ✅ Yes | Low | Standard accordion markup |
| `acf/html-section` | ✅ Yes | Low | Raw HTML passthrough |

**10 of 14 blocks are straightforward.** The 3 complex ones (`plans-availability`, `form`, `poi`) require external integrations that go beyond simple WordPress deployment.

---

## Part 4: Deployment Layer Architecture

### Current State (What Exists)

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  SiteForge UI       │────▶│  Blueprint Engine     │────▶│  Supabase   │
│  (Brand input,      │     │  (AI generates site   │     │  (Stores    │
│   preferences)      │     │   blueprint JSON)     │     │   blueprint)│
└─────────────────────┘     └──────────────────────┘     └─────────────┘
                                                               │
                                                               ▼
                                                         siteforge_jobs
                                                         status: "queued"
                                                         (NOTHING PICKS
                                                          THESE UP)
```

### Required State (What Needs to Be Built)

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  SiteForge UI       │────▶│  Blueprint Engine     │────▶│  Supabase   │
│                     │     │                       │     │             │
└─────────────────────┘     └──────────────────────┘     └──────┬──────┘
                                                                │
                          ┌─────────────────────────────────────┤
                          │                                     │
                          ▼                                     ▼
                   ┌──────────────┐                    ┌────────────────┐
                   │ Job Processor │                    │ WP Provisioner │
                   │ (Edge Function│◀──────────────────│ (Creates WP    │
                   │  or Worker)   │                    │  instances via  │
                   └──────┬───────┘                    │  hosting API)  │
                          │                            └────────────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌────────────┐ ┌──────────┐ ┌──────────────┐
     │ Page Creator│ │ Media    │ │ Theme/Config │
     │ (WP REST   │ │ Uploader │ │ Deployer     │
     │  API)      │ │          │ │              │
     └─────┬──────┘ └────┬─────┘ └──────┬───────┘
           │              │              │
           └──────────────┼──────────────┘
                          ▼
                   ┌──────────────┐
                   │ WordPress    │
                   │ Instance     │
                   │ (Self-hosted │
                   │  or managed) │
                   └──────────────┘
```

### Component Breakdown

#### 1. WP Instance Provisioner
**Purpose:** Create/manage WordPress instances per property.

**Options evaluated:**

| Provider | API Provisioning | ACF Support | Custom Theme | Cost/Site | Auto-scaling |
|----------|-----------------|-------------|--------------|-----------|-------------|
| **WP Engine** | ✅ REST API | ✅ Full | ✅ Git push | ~$20/mo | ✅ |
| **Cloudways** | ✅ REST API | ✅ Full | ✅ SFTP/Git | ~$14/mo | ✅ |
| **Pressable** | ✅ REST API | ✅ Full | ✅ Git push | ~$25/mo | ✅ |
| **SpinupWP** | ✅ REST API | ✅ Full | ✅ Git push | ~$12/mo + server | ✅ |
| **WordPress.com Business** | ⚠️ Limited API | ⚠️ Limited plugins | ❌ No full theme control | ~$33/mo | ✅ |
| **Self-hosted (DigitalOcean/AWS)** | ✅ Full control | ✅ Full | ✅ Full | ~$6/mo + management | Manual |

**Recommendation:** **Cloudways or WP Engine.** Both have provisioning APIs, support ACF Pro, allow custom themes via Git, and handle SSL/CDN automatically. Cloudways is more cost-effective at scale; WP Engine has better DX.

**WordPress.com (what you just connected) is not viable** — free tier blocks API access, paid tiers restrict plugin installation (no ACF Pro), and you don't get the code-level access needed for custom ACF blocks.

#### 2. Job Processor (Edge Function)
**Purpose:** Pick up `siteforge_jobs` from Supabase and execute them.

**Responsibilities:**
- Poll or be triggered by Supabase webhook when `siteforge_jobs.status = 'queued'`
- Read the blueprint from `property_websites.site_blueprint`
- Read WP credentials from `property_websites.wp_credentials`
- Execute deployment steps in order: media upload → page creation → nav setup → config
- Update `siteforge_jobs.status` to `running` → `completed`/`failed`
- Update `property_websites.generation_status` to `deployed`
- Store deployment results in `siteforge_jobs.output_data`

#### 3. WordPress REST API Client
**Purpose:** Translate blueprint JSON into WordPress API calls.

**Required API endpoints:**
- `POST /wp-json/wp/v2/pages` — create pages with Gutenberg block content
- `POST /wp-json/wp/v2/media` — upload images
- `POST /wp-json/wp/v2/menus` — create navigation
- `POST /wp-json/acf/v3/options` — set ACF options (theme settings)
- `PUT /wp-json/wp/v2/settings` — site title, tagline, homepage

**Auth:** Application Passwords (built into WP 5.6+) or JWT via plugin.

#### 4. ACF Block Theme
**Purpose:** A custom WordPress theme containing all 14 registered ACF blocks.

**What this includes:**
- ACF Pro plugin (required for block registration)
- `functions.php` registering all 14 blocks via `acf_register_block_type()`
- Block templates (PHP render callbacks) for each block
- CSS/JS for block rendering (slider, accordion, gallery, map, POI, form)
- Theme.json for brand color/typography tokens
- Integration points for Yardi (plans-availability), LumaLeasing (forms), Google Maps (map/POI)

**This theme is the single biggest piece of work** — it's essentially a purpose-built apartment marketing theme. It needs to be built once and deployed to every property's WP instance.

#### 5. Media Pipeline
**Purpose:** Resolve image references to actual photos and upload them.

The blueprints use two image reference systems:
- **v3:** `image_index` (integer) — references into an ordered asset array
- **v7:** `image_index` + `image_indices[]` — same system, gallery support
- **v12–v16:** `photoRequirement` (object with `scene`, `category`, `priority`) — descriptive, no actual image reference

**The image pipeline needs:**
- A property photo library (Supabase storage or external CDN)
- AI-powered photo matching (match `photoRequirement.scene` descriptions to actual photos)
- Or a simpler approach: require properties to upload categorized photos that map to `image_index` positions

---

## Part 5: What WordPress.com MCP Can and Cannot Do

### What you connected
The WordPress.com MCP connector provides tools for managing a single WordPress.com site: creating/editing posts, pages, media, and taxonomies. It also provides theme context and editor capabilities.

### Why it doesn't work for SiteForge

| SiteForge Requirement | WordPress.com MCP | Gap |
|----------------------|-------------------|-----|
| Provision new WP instances per property | ❌ No provisioning API | Need hosting provider API |
| Install ACF Pro plugin | ❌ Plugin installation restricted on free/personal plans | Need Business plan ($33/mo) or self-hosted |
| Deploy custom theme with 14 ACF blocks | ❌ Custom themes restricted | Need Business plan or self-hosted |
| Store WP credentials per property | ❌ Single-site auth only | Need multi-site credential management |
| Programmatic page creation with ACF blocks | ⚠️ Can create pages, but ACF block content requires plugin | Partial — works IF ACF is installed |
| Bulk media upload | ⚠️ Can upload, but slow and single-site | Need parallel upload across instances |
| Connect to Yardi, LumaLeasing | ❌ No integration support | Custom theme handles this |

### Where WordPress.com MCP COULD fit

If you upgrade to WordPress.com Business plan ($33/mo per property), the MCP could serve as a **management and monitoring layer** for deployed sites — checking content, updating pages, managing media after initial deployment. But it cannot be the deployment mechanism itself.

---

## Part 6: Recommended Path Forward

### Phase 1: Fix Blueprint Quality (No infra needed)
- Revert to v3/v7 quality prompt engineering
- Ensure every blueprint generates 5+ pages minimum (Home, Floor Plans, Amenities, Neighborhood, Contact)
- Standardize on `acfBlock` key name (not `block`)
- Add image index requirement back (not just `photoRequirement` descriptions)
- Reduce copy repetition — "thoughtfully designed" and "sanctuary" should each appear max once per page

### Phase 2: Build the ACF Block Theme (Biggest effort)
- Register all 14 blocks in ACF Pro
- Build PHP render templates for each block
- Create CSS/JS for interactive blocks (slider, accordion, gallery, POI map)
- Build theme.json with configurable brand tokens (colors, fonts)
- Connect Yardi API for `plans-availability`
- Connect LumaLeasing for `form` lead capture
- Connect Google Maps for `map` and `poi`

### Phase 3: Build the Deployment Layer
- Choose hosting provider (Cloudways or WP Engine)
- Build WP Instance Provisioner (Edge Function)
- Build Job Processor to consume `siteforge_jobs` queue
- Build WP REST API client for page creation with ACF blocks
- Build media pipeline for photo upload
- Wire up credential storage in `property_websites.wp_credentials`

### Phase 4: Integration & Testing
- End-to-end test: blueprint → provisioned WP → deployed pages
- Performance testing (generation-to-live time target: <5 minutes)
- Monitoring: track `page_views`, `tour_requests`, `conversion_rate` post-deploy

---

## Summary

**Blueprint engine verdict:** The core AI content generation works. v3 produces a legitimately deployable apartment website. But recent versions (v12–v16) have regressed — fewer pages, more generic copy, inconsistent field naming. This needs prompt tuning, not code changes.

**WordPress.com MCP verdict:** Wrong tool for the job. It's designed for managing a single site you own, not programmatically deploying sites at scale. SiteForge needs a hosting API + custom ACF theme + deployment worker.

**What's missing to achieve full automation:**
1. A WordPress hosting provider with a provisioning API
2. A custom ACF block theme (14 blocks)
3. A job processor that reads blueprints and pushes to WordPress
4. A media pipeline for property photos
5. Blueprint quality regression fix

The blueprint engine is the hardest part and it's already built. The deployment layer is straightforward engineering — it just hasn't been started yet.
