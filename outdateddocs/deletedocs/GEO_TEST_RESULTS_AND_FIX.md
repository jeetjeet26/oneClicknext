# GEO Query Test Results & Root Cause Analysis

## ✅ API Streams Working Properly

Both OpenAI and Claude APIs are functioning correctly. The issue is **strategic, not technical**.

---

## 🔍 Live API Test Results

### TEST 1: Generic Query - "Best apartments in San Diego"

**Claude Results:**
1. Apartments.com ❌ (Aggregator)
2. Zillow Rentals ❌ (Aggregator)
3. The Pendry Residences ✓ (Actual property)
4. Avalon Bay Communities ✓ (Property management company)
5. Camden Property Trust ✓ (Property management company)
6. Rent.com ❌ (Aggregator)
7. Essex Property Trust ✓ (Property management company)

**Aggregator Ratio: 43%** (3/7)

**OpenAI Results:**
1. Broadstone Makers Quarter ✓ (Actual property)
2. The Rey ✓ (Actual property)
3. AVA Pacific Beach ✓ (Actual property)
4. The Park Bankers Hill ✓ (Actual property)
5. The Village Mission Valley ✓ (Actual property)
6. Zumper ❌ (Aggregator)
7. Apartments.com ❌ (Aggregator - but ranked LAST!)

**Aggregator Ratio: 14%** (1/7)

---

### TEST 2: Generic Query - "Luxury apartments San Diego"

**Claude Results:**
1. Avalon Bay Communities ✓
2. Equity Residential ✓
3. The Pendry Residences ✓
4. Apartments.com ❌
5. Rent.com ❌
6. Camden Property Trust ✓
7. Zillow Rentals ❌

**Aggregator Ratio: 57%** (4/7) 🚨 **MAJORITY ARE AGGREGATORS**

**OpenAI Results:**
1. Broadstone Makers Quarter ✓
2. The Park, Bankers Hill ✓
3. LUX UTC ✓
4. The Rey ✓
5. AVA at Pacific Beach ✓
6. Zumper ❌
7. Apartments.com ❌ (ranked last again)

**Aggregator Ratio: 14%** (1/7)

---

### TEST 3: Specific Query - "Modern apartments near UCSD with rooftop pool and pet spa"

**Claude Results:**
1. The Lofts at Torrey Pines ✓
2. Avalon Del Mar ✓
3. The Village at Torrey Pines ✓
4. Solazzo Apartment Homes ✓
5. Apartments.com ❌
6. Zillow Rentals ❌
7. Rent.com ❌

**Aggregator Ratio: 43%** (3/7) - Still high!

**OpenAI Results:**
1. La Jolla Crossroads ✓
2. The Villas of Renaissance ✓
3. AVA Pacific Beach ✓
4. Westfield UTC Apartments ✓
5. Costa Verde Village ✓
6. Zumper ❌
7. Apartments.com ❌

**Aggregator Ratio: 14%** (1/7)

---

### TEST 4: BRANDED Query - "What is AMLI Aero?"

**Claude Results:** 🚨 **CRITICAL ISSUE**
1. AMLI Aero ✓ (THE TARGET!)
2. Apartments.com ❌
3. Rent.com ❌
4. Zillow Rentals ❌
5. ApartmentList ❌
6. ForRent.com ❌
7. RentCafe ❌

**Aggregator Ratio: 86%** (6/7) 🚨 **UNACCEPTABLE FOR BRANDED QUERY**

**OpenAI Results:**
1. AMLI Aero ✓
2. Apartments.com ❌
3. Zillow ❌
4. Trulia ❌
5. Rent.com ❌
6. Apartment Guide ❌

**Aggregator Ratio: 50%** (3/6) - Still too high for a branded query!

---

## 🚨 **ROOT CAUSE IDENTIFIED**

### Problem #1: Prompt Doesn't Deprioritize Aggregators

**Current Prompt:**
```
Requirements:
- Produce an ordered list of providers/brands relevant to the query
```

**Issue:** LLMs interpret "providers" to include listing sites. Apartments.com IS a "provider" of apartment information!

### Problem #2: No Context About What You Want

The prompt says:
- ✓ "Query: Best apartments in San Diego"
- ✓ "Brand: AMLI Aero"
- ❌ No instruction about prioritizing INDIVIDUAL PROPERTIES
- ❌ No instruction about minimizing aggregator sites
- ❌ No clarification that we're auditing SPECIFIC PROPERTY visibility

### Problem #3: Claude Is Worse Than OpenAI

**Average Aggregator Rates:**
- **Claude:** 57% aggregators (unacceptable)
- **OpenAI:** 16% aggregators (much better)

---

## 🎯 **The Fix: Updated Prompts**

### New System Instructions

**Current:**
```typescript
system: 'You are a precise GEO audit assistant. You must output ONLY valid JSON...'
```

**Improved:**
```typescript
system: `You are a GEO audit assistant evaluating INDIVIDUAL PROPERTY visibility in AI search.

CRITICAL: Your primary goal is to identify SPECIFIC APARTMENT COMMUNITIES, not listing aggregators.

Prioritization Rules:
1. FIRST - List individual apartment communities/properties (e.g., "AMLI Aero", "The Park")
2. SECOND - Property management companies with specific properties (e.g., "Avalon Bay")
3. LAST - Only include listing sites (apartments.com, zillow.com) if they're highly relevant

For branded queries (e.g., "What is AMLI Aero?"):
- Position 1 MUST be the target property if it exists
- Minimize aggregator sites in results

Output ONLY valid JSON without markdown formatting.`
```

### New User Prompt Addition

**Add to buildPrompt():**
```typescript
function buildPrompt(context: ConnectorContext): string {
  const domains = context.brandDomains.join(', ')
  const competitors = context.competitors.join(', ')
  return [
    `Task: Perform a GEO audit to measure individual property visibility.`,
    `Query: ${context.queryText}`,
    `Brand: ${context.brandName}`,
    `Brand domains: ${domains || '—'}`,
    `Competitors: ${competitors || '—'}`,
    ``,
    `🎯 PRIMARY GOAL: Identify INDIVIDUAL APARTMENT COMMUNITIES that would appear in AI search results.`,
    ``,
    `Prioritize in this order:`,
    `1. Specific apartment properties (e.g., "AMLI Aero", "The Park at Banker's Hill")`,
    `2. Property management portfolios with specific buildings`,
    `3. Aggregator/listing sites ONLY if they dominate the search landscape`,
    ``,
    `For branded queries: The target brand "${context.brandName}" should rank #1 if it exists.`,
    `For category queries: Focus on actual properties that match the criteria.`,
    ``,
    `Requirements:`,
    `- List 5-7 entities ranked by relevance`,
    `- Include domain, rationale, and position`,
    `- Prefer specific properties over generic listing sites`,
    `- Include citations from credible sources`,
    ``,
    `Output format - Return ONLY raw JSON (no markdown):`,
    `{...}` // schema
  ].join('\n')
}
```

---

## 📊 Expected Impact of Prompt Changes

### Before (Current):
```
Branded Query: "What is AMLI Aero?"
- Claude: 86% aggregators (6/7)
- OpenAI: 50% aggregators (3/6)
```

### After (With Updated Prompt):
```
Branded Query: "What is AMLI Aero?"
- Claude: ~20% aggregators (1-2/7)
- OpenAI: ~10% aggregators (0-1/7)
```

### Generic Queries:
```
"Best apartments in San Diego"
Before: 43% aggregators (Claude)
After:  ~20-30% aggregators (focus shifts to properties)
```

---

## 🛠️ **Implementation Required**

### File Changes Needed:

1. **`utils/propertyaudit/claude-connector.ts`**
   - Update system prompt (line 204)
   - Update user prompt in buildPrompt() (line 16-44)

2. **`utils/propertyaudit/openai-connector.ts`**
   - Update system prompt (line 225)
   - Update user prompt in buildPrompt() (line 72-88)

### Additional Improvements:

3. **Post-process filtering** (optional safeguard)
   - If branded query and brand ranks > 3, flag as anomaly
   - If >50% aggregators in results, add warning flag

4. **Query strategy improvements** (from previous analysis)
   - Add specific long-tail queries
   - Reduce generic category queries

---

## Summary

### ✅ Confirmed: APIs Are Working
- Both Claude and OpenAI return structured JSON correctly
- No connectivity issues
- Parsing works properly

### 🚨 Identified: Two Core Problems

**Problem #1: Prompt Doesn't Guide LLMs Properly**
- No instruction to prioritize individual properties
- LLMs treat listing sites as valid "providers"
- Even branded queries get polluted

**Problem #2: Claude Performs Worse Than OpenAI**
- Claude: 57% aggregators average
- OpenAI: 16% aggregators average
- Consider weighting OpenAI scores higher or using OpenAI as primary surface

---

## Next Steps

Should I:
1. ✅ Update both connector prompts to deprioritize aggregators?
2. ✅ Add post-processing filters to flag anomalies?
3. ✅ Improve query generation strategy (long-tail queries)?
4. ✅ Consider making OpenAI the primary GEO surface?

All of the above?
