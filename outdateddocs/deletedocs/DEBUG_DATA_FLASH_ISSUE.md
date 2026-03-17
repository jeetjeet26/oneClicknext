# 🐛 Debug: Data Flashing Then Disappearing

## 🔍 What's Happening

**Symptom**: Dashboard shows data for 1 second, then disappears

**Common Causes**:
1. ❌ Data hasn't been imported yet (no rows in database)
2. ❌ API query is incorrect (looking for wrong data)
3. ❌ React state is being cleared
4. ❌ Property ID mismatch

---

## 🎯 Step-by-Step Diagnosis

### **Step 1: Check Browser Console**

Open DevTools (F12) → Console tab

**Look for logs:**
```javascript
Fetching marketing data: {propertyId: "...", dateRange: "30d", channels: "meta_ads"}
Marketing data response: {ok: true, hasData: true, channels: 1}
Data set successfully: {channels: 1, campaigns: 12, totalSpend: 1234.56}
```

**If you see:**
```javascript
hasData: false, channels: 0
```
→ No data in database yet

**If you see:**
```javascript
Failed to fetch marketing data: [error message]
```
→ API error (check what it says)

---

### **Step 2: Verify Data is in Database**

Run in Supabase SQL Editor:

```sql
-- Check if Epoca has ANY data
SELECT 
  COUNT(*) as total_rows,
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  SUM(spend) as total_spend
FROM fact_marketing_performance
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%');
```

**Expected**: `total_rows > 0`

**If 0 rows:**
→ Import hasn't run yet! Need to run sync first.

---

### **Step 3: Check Import Job Status**

```sql
-- Check if import actually ran
SELECT 
  status,
  progress_pct,
  records_imported,
  campaigns_found,
  error_message,
  created_at
FROM import_jobs
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%')
ORDER BY created_at DESC
LIMIT 1;
```

**If no rows:**
→ Import button hasn't been clicked yet

**If status = 'failed':**
→ Check error_message column

**If status = 'complete' but records_imported = 0:**
→ MCP sync ran but found no campaigns (check Meta token)

---

### **Step 4: Test API Directly**

```powershell
# Get Epoca property ID
# From Supabase: SELECT id FROM properties WHERE name ILIKE '%epoca%';

# Test API
curl "http://localhost:3000/api/marketvision/YOUR-EPOCA-UUID?dateRange=30d&channels=meta_ads"
```

**Look at response:**
```json
{
  "property": {...},
  "channels": [...],  // Should have data
  "campaigns": [...], // Should have campaigns
  "totals": {...},    // Should have numbers
  "debug": {
    "has_data": true,
    "row_count": 24
  }
}
```

**If `row_count: 0`:**
→ Data not in database

**If `channels: []`:**
→ Aggregation issue or query filtering out data

---

## 🔧 Quick Fixes

### **Fix 1: Data Not Imported Yet**

```powershell
# Run import manually
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"

# Get Epoca UUID first
python -c "from utils.supabase_client import get_supabase_client; sb = get_supabase_client(); print(sb.table('properties').select('id').ilike('name', '%epoca%').single().execute().data)"

# Then sync
python -m pipelines.mcp_marketing_sync --property-id YOUR-EPOCA-UUID --date-range LAST_30_DAYS
```

**Check output:**
```
Starting sync for property abc-123
Syncing Meta Ads for account 100422547226422
Upserting 24 records to fact_marketing_performance
✅ Sync complete: 24 records, 12 campaigns
```

### **Fix 2: React State Issue (Already Fixed)**

I added:
- ✅ Mounted check to prevent stale updates
- ✅ Error state handling
- ✅ Console logging
- ✅ Better loading states

Refresh your dashboard and check console logs now.

### **Fix 3: Channel Mismatch**

```typescript
// If you're filtering for 'google_ads,meta_ads' but only have meta_ads
// Change to just meta_ads:
const [selectedChannels, setSelectedChannels] = useState('meta_ads');
```

---

## 🎯 Manual Import Test (Guaranteed to Work)

### **Run This Sequence:**

**1. Verify Meta credentials:**
```powershell
# Check .env.local has:
# META_ACCESS_TOKEN=EAAT7wSyNFyUBQBSaoPvgGZC4PDjjUwRCa...
# META_AD_ACCOUNT_ID=100422547226422
```

**2. Test Meta API directly:**
```powershell
curl "https://graph.facebook.com/v19.0/act_100422547226422/insights?fields=campaign_id,campaign_name,impressions,clicks,spend&date_preset=last_30d&level=campaign&access_token=YOUR_TOKEN"
```

Should return JSON with campaigns.

**3. Test MCP tool:**
```powershell
cd p11-platform/services/mcp-servers
python test_meta_ads.py
```

Should print campaign list.

**4. Run full sync:**
```powershell
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --all
```

**5. Check database:**
```sql
SELECT * FROM fact_marketing_performance 
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%')
LIMIT 5;
```

**6. Refresh dashboard:**
Open http://localhost:3000/dashboard/marketvision

---

## 📊 Expected vs Actual

### **Expected Behavior:**
```
1. Page loads → Shows spinner
2. Data fetches → Displays cards with numbers
3. Data persists → Stays visible
4. Change date range → Refetches and updates
```

### **Actual (Your Issue):**
```
1. Page loads → Shows spinner
2. Data fetches → Shows cards for 1 second
3. Something happens → Cards disappear
4. Shows "No data available"
```

### **Most Likely Cause:**

**No data in database yet!**

The "flash" you see is probably:
1. Component mounts
2. Fetches from API
3. API returns empty result (no database rows)
4. React briefly shows loading state
5. Then shows "no data" state

**Solution**: Run the import sync first!

---

## ✅ Checklist to Resolve

Run these in order:

- [ ] **Check Meta token works**:
  ```powershell
  curl "https://graph.facebook.com/v19.0/me?access_token=YOUR_TOKEN"
  ```

- [ ] **Verify link in database**:
  ```sql
  SELECT * FROM ad_account_connections 
  WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%');
  ```

- [ ] **Run import sync**:
  ```powershell
  cd p11-platform/services/data-engine
  python -m pipelines.mcp_marketing_sync --all
  ```

- [ ] **Check data was stored**:
  ```sql
  SELECT COUNT(*) FROM fact_marketing_performance;
  ```

- [ ] **Test API returns data**:
  ```bash
  curl "http://localhost:3000/api/marketvision/EPOCA-UUID?dateRange=30d"
  ```

- [ ] **Open dashboard with DevTools**:
  - Check console logs
  - Check Network tab for API calls
  - Check if data is in response

- [ ] **Check for errors**:
  - Red text in console
  - Failed API calls
  - 500 errors

---

## 🎯 Most Likely Solution

**You need to run the import first!** The link is established, but no data has been synced yet.

**Run this:**
```powershell
cd p11-platform/services/data-engine
.\start.bat
# Wait for "Uvicorn running on http://0.0.0.0:8000"

# Then in another terminal:
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --all --date-range LAST_30_DAYS
```

**Then refresh dashboard.** Data should persist!

---

**Need more help?** Share:
1. Browser console logs (what it says when flashing)
2. Data Engine terminal output (when running sync)
3. SQL query result (SELECT COUNT from fact_marketing_performance)





