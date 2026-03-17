# ⚡ Quick Commands Reference

## 🚀 Get Epoca Data Right Now (2 Commands)

### **Command 1: Start Data Engine**
```powershell
cd C:\Users\jasji\projects\oneClick\p11-platform\services\data-engine
.\start.bat
```

Leave running. Opens on http://localhost:8000

### **Command 2: Start Web App**
```powershell
cd C:\Users\jasji\projects\oneClick\p11-platform\apps\web
npm run dev
```

Leave running. Opens on http://localhost:3000

### **Then:**
- Open browser: http://localhost:3000/dashboard/marketvision
- Select: "Epoca • San Diego"
- Click: **"Import Latest Data"**
- Wait: 10-30 seconds
- Done: Data appears!

---

## 🔍 Verification Commands

### **Check Data Engine is Running:**
```powershell
curl http://localhost:8000/health
# Should return: {"status":"healthy"}
```

### **Check Epoca is Linked:**
```sql
-- Run in Supabase SQL Editor
SELECT 
  p.name,
  ac.platform,
  ac.account_id,
  ac.is_active
FROM ad_account_connections ac
JOIN properties p ON p.id = ac.property_id
WHERE p.name ILIKE '%epoca%';

-- Should show: epoca | meta_ads | 100422547226422 | true
```

### **Check Import History:**
```sql
SELECT 
  status,
  progress_pct,
  records_imported,
  campaigns_found,
  created_at
FROM import_jobs
ORDER BY created_at DESC
LIMIT 5;
```

### **Check Imported Data:**
```sql
SELECT 
  campaign_name,
  date,
  spend,
  clicks,
  impressions,
  conversions
FROM fact_marketing_performance
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%')
ORDER BY date DESC, spend DESC;
```

---

## 🐛 Troubleshooting Commands

### **"Data Engine won't start":**
```powershell
# Check Python installed
python --version
# Should be 3.10 or higher

# Manually create venv
cd p11-platform/services/data-engine
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### **"Import button does nothing":**
```powershell
# Check Data Engine logs (in terminal where start.bat ran)
# Should show incoming requests

# Or check Data Engine health
curl http://localhost:8000/health
```

### **"Import says complete but no data":**
```sql
-- Check import_jobs for errors
SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 1;

-- Check if Meta token works
-- Test in Postman/curl:
curl "https://graph.facebook.com/v19.0/me/adaccounts?access_token=YOUR_TOKEN&fields=id,name"
```

### **"MCP import errors":**
```powershell
# Test MCP directly
cd p11-platform/services/mcp-servers
python test_meta_ads.py

# Check output for errors
```

---

## 🔄 Daily Operations

### **Check Today's Imports:**
```sql
SELECT 
  p.name AS property,
  ij.status,
  ij.records_imported,
  ij.created_at
FROM import_jobs ij
JOIN properties p ON p.id = ij.property_id
WHERE ij.created_at > CURRENT_DATE
ORDER BY ij.created_at DESC;
```

### **Manually Trigger Import for Specific Property:**
```powershell
# Via Python
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --property-id EPOCA-UUID

# Or via API
curl -X POST http://localhost:3000/api/marketvision/import `
  -H "Content-Type: application/json" `
  -d "{\"property_id\":\"EPOCA-UUID\",\"channels\":[\"meta_ads\"]}"
```

### **Import All Properties:**
```powershell
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --all
```

---

## 📅 Setup Auto-Schedule

### **Via pg_cron (Recommended):**
```sql
-- Run in Supabase SQL Editor
SELECT cron.schedule(
  'auto-import-epoca',
  '0 2 * * *',  -- Daily at 2 AM
  $$
  SELECT net.http_post(
    'http://localhost:8000/sync-all-properties',
    '{"date_range": "YESTERDAY"}'::jsonb,
    headers := '{"Authorization": "Bearer a7f3c8e9d4b2f1a8c6e5d9b7a4f2c1e8d5b9a6f3c2e1d8b5a7f4c9e6d3b1a8f5", "Content-Type": "application/json"}'::jsonb
  );
  $$
);

-- Check scheduled jobs
SELECT * FROM cron.job;

-- Remove schedule
SELECT cron.unschedule('auto-import-epoca');
```

### **Via Windows Task Scheduler:**
```powershell
# Create script: import-epoca.bat
@echo off
cd C:\Users\jasji\projects\oneClick\p11-platform\services\data-engine
call venv\Scripts\activate.bat
set PYTHONPATH=%CD%\..\mcp-servers;%CD%\..
python -m pipelines.mcp_marketing_sync --all
```

Then schedule in Task Scheduler to run daily.

---

## 🎯 For Epoca Specifically

### **Get Epoca Property ID:**
```sql
SELECT id FROM properties WHERE name ILIKE '%epoca%';
-- Copy the UUID
```

### **Test Import:**
```powershell
cd p11-platform/services/data-engine
$env:PYTHONPATH = "C:\Users\jasji\projects\oneClick\p11-platform\services"
python -m pipelines.mcp_marketing_sync --property-id YOUR-UUID-HERE --date-range LAST_7_DAYS
```

### **View Epoca Data:**
```sql
SELECT * FROM fact_marketing_performance 
WHERE property_id = 'YOUR-UUID-HERE'
ORDER BY date DESC;
```

---

## 📊 Dashboard Access

### **Add MarketVision to App:**

If MarketVision page doesn't exist, create it:

```tsx
// app/dashboard/marketvision/page.tsx
import { createClient } from '@/utils/supabase/server';
import PropertyMarketingDashboard from '@/components/marketvision/PropertyMarketingDashboard';

export default async function MarketVisionPage() {
  const supabase = createClient();
  
  // Get Epoca property
  const { data: property } = await supabase
    .from('properties')
    .select('id, name')
    .ilike('name', '%epoca%')
    .single();
  
  if (!property) {
    return <div>Property not found</div>;
  }
  
  return (
    <div className="container mx-auto p-8">
      <PropertyMarketingDashboard
        propertyId={property.id}
        propertyName={property.name}
      />
    </div>
  );
}
```

---

## ✅ Success Criteria

After running commands, you should have:

- [ ] Data Engine running on port 8000
- [ ] Web app running on port 3000
- [ ] Epoca property shows in UI
- [ ] "Import" button visible
- [ ] Click import → Progress bar shows
- [ ] After 30s → "Complete" message
- [ ] Dashboard shows campaign data
- [ ] Supabase has rows in fact_marketing_performance

---

**Everything is ready. Just run the 2 start commands and click "Import"!** 🚀





