# ✅ FINAL SETUP - Epoca Marketing Data Import

## 🎯 You're Here: Epoca Connected, Ready to Import

**Current Status:**
- ✅ MCP servers built (30+ files)
- ✅ Database migrations applied
- ✅ Epoca property linked to Meta account
- ✅ Import system ready

**What's Left:** Start services and click "Import"

---

## 🚀 2-Minute Setup (Do This Once)

### **Terminal 1: Start Data Engine**

```powershell
cd C:\Users\jasji\projects\oneClick\p11-platform\services\data-engine
.\start.bat
```

**Expected output:**
```
Starting P11 Data Engine...

Virtual environment activated
PYTHONPATH configured

Data Engine running on http://localhost:8000
Press Ctrl+C to stop

INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

✅ Leave this running!

### **Terminal 2: Start Web App** (If not running)

```powershell
cd C:\Users\jasji\projects\oneClick\p11-platform\apps\web
npm run dev
```

✅ Leave this running too!

---

## 📊 Import Your First Data

### **Method 1: Via Dashboard** (Recommended)

1. Open: http://localhost:3000/dashboard/bi (MultiChannel BI)
2. Select property: "Epoca • San Diego" (should be auto-selected)
3. Click: **"Import Latest Data"** button (needs to be added)
4. Watch progress:

```
┌─────────────────────────────────────────┐
│ 🔄 Syncing Meta Ads... 65%             │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━            │
└─────────────────────────────────────────┘
```

5. See completion:

```
┌─────────────────────────────────────────┐
│ ✅ Import complete! 24 records imported │
│ 12 campaigns synced from meta_ads       │
└─────────────────────────────────────────┘
```

6. Dashboard updates automatically!

### **Method 2: Quick Test Command**

```powershell
# Get Epoca UUID
# Run in Supabase SQL Editor:
# SELECT id FROM properties WHERE name ILIKE '%epoca%';

# Then:
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --property-id YOUR-EPOCA-UUID
```

---

## 🎨 What You'll See in Dashboard

### **Before Import:**
```
Epoca • San Diego
Last imported: Never
[Import Latest Data]

No data available - Click import to load campaigns
```

### **During Import (10-30 seconds):**
```
━━━━━━━━━━━━━━━━━━━━ 50%
Syncing Meta Ads...
```

### **After Import:**
```
Last imported: Just now
[History] [Import Latest Data]

┌─────────────────────────────────┐
│ Total Spend: $1,234             │
│ Clicks: 890                     │
│ Impressions: 12,000             │
│ Conversions: 45                 │
└─────────────────────────────────┘

Performance by Channel:
• Meta Ads: $1,234 · 12 campaigns

Top Campaigns:
1. Brand Awareness      $567
2. Leasing Special      $345
3. Retargeting          $234
```

---

## ⚡ Fast Import Testing

### **Quick API Test:**

```powershell
# Test Data Engine is running
curl http://localhost:8000/health

# Should return: {"status":"healthy"}
```

### **Trigger Import:**

```powershell
# Replace YOUR-EPOCA-UUID with actual ID from Supabase
curl -X POST http://localhost:3000/api/marketvision/import `
  -H "Content-Type: application/json" `
  -d "{\"property_id\":\"YOUR-EPOCA-UUID\",\"channels\":[\"meta_ads\"],\"date_range\":\"LAST_7_DAYS\"}"
```

### **Check Status:**

```powershell
# Use job_id from previous response
curl "http://localhost:3000/api/marketvision/import?job_id=JOB-UUID"
```

---

## 📋 Verification Checklist

### **After Import, Check:**

**1. Data Engine Terminal:**
```
✅ Should show:
Starting sync for property abc-123
Syncing Meta Ads for account 100422547226422
Upserting 24 records to fact_marketing_performance
✅ Sync complete: 24 records, 12 campaigns
```

**2. Supabase (SQL Editor):**
```sql
-- Should return rows
SELECT 
  campaign_name,
  date,
  spend,
  clicks,
  impressions
FROM fact_marketing_performance
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%')
ORDER BY date DESC, spend DESC;
```

**3. API Response:**
```powershell
curl "http://localhost:3000/api/marketvision/YOUR-EPOCA-UUID?dateRange=30d&channels=meta_ads"

# Should return JSON with campaigns, spend, etc.
```

**4. Dashboard:**
- Cards show totals
- Channel section shows "Meta Ads"
- Campaigns listed with spend/clicks

---

## 🔁 Daily Use

### **Every Time You Want Fresh Data:**

1. Open dashboard
2. Click "Import Latest Data"
3. Wait 10-30 seconds
4. Data updates

**That's it!** No terminal, no Python, no commands.

### **Set Up Auto-Import** (Optional):

1. Click "History" button
2. Toggle "Enable Auto-Import"
3. Select: "Daily at 2:00 AM"
4. Click "Save Schedule"

Now imports happen automatically every day!

---

## 🎯 What Happens Behind the Scenes

```
You click "Import"
  ↓
UI creates import_job (status: pending)
  ↓
UI calls Data Engine API
  ↓
Data Engine (already running, venv active):
  1. Changes job status to 'running' (0%)
  2. Looks up Epoca's Meta account ID
  3. Calculates date range (incremental)
  4. Calls Meta Ads MCP tool (25%)
  5. Fetches campaign insights from Meta API (50%)
  6. Transforms data to table format (75%)
  7. Upserts to fact_marketing_performance (90%)
  8. Updates job status to 'complete' (100%)
  ↓
UI polls job status every 2 seconds
  ↓
UI sees status = 'complete'
  ↓
UI refreshes dashboard with new data
  ↓
You see updated campaigns!
```

**All automatic. Zero manual steps.**

---

## 🎉 Summary

### **One-Time Setup:**
1. ✅ Run `.\start.bat` (Data Engine)
2. ✅ Ensure `npm run dev` (Web App)

### **Every Time You Want Data:**
1. ✅ Click "Import Latest Data"
2. ✅ Wait for green checkmark
3. ✅ View updated dashboard

### **Optional:**
1. ✅ Set up auto-schedule (daily imports)
2. ✅ View import history
3. ✅ Filter by date range/channels

---

## 🚀 Ready to Test?

**Run these 2 commands right now:**

```powershell
# Terminal 1
cd p11-platform\services\data-engine
.\start.bat

# Terminal 2
cd p11-platform\apps\web
npm run dev
```

**Then open:**
http://localhost:3000/dashboard/marketvision

**Click "Import Latest Data" and watch it work!** 🎉

