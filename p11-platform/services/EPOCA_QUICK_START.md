# Epoca Property - Import Data Guide

## Prerequisites
- Epoca property linked to Meta account `100422547226422` via UI

## Setup (One-Time)

### Terminal 1: Start Data Engine
```bash
cd p11-platform/services/data-engine
./start.bat   # Windows: .\start.bat
```
Leave running — serves on http://localhost:8000

### Terminal 2: Start Web App (if not running)
```bash
cd p11-platform/apps/web
npm run dev
```
Leave running — serves on http://localhost:3000

## Import Data

**Via Dashboard (Recommended):**
1. Open http://localhost:3000/dashboard/marketvision
2. Select "Epoca • San Diego" from property dropdown
3. Click **"Import Latest Data"**
4. Wait 10-30 seconds for completion

**Via API:**
```bash
curl -X POST http://localhost:3000/api/marketvision/import \
  -H "Content-Type: application/json" \
  -d '{"property_id":"YOUR-EPOCA-UUID","channels":["meta_ads"]}'
```

**Via Data Engine Directly:**
```bash
cd p11-platform/services/data-engine
python -m pipelines.mcp_marketing_sync --property-id YOUR-EPOCA-UUID --date-range LAST_30_DAYS
```

**Import All Properties:**
```bash
cd p11-platform/services/data-engine
python -m pipelines.mcp_marketing_sync --all
```

---

## Incremental Imports

The system automatically calculates optimal date range based on the last import:
- **First import:** Pulls LAST_30_DAYS (~240-900 records, 20-30s)
- **Subsequent imports:** Pulls only YESTERDAY (~8-30 records, 5-10s)

**Data stored in:** `fact_marketing_performance` (row per campaign per day, upserts on conflict)

---

## Verification

### Check Data Engine is Running
```bash
curl http://localhost:8000/health
# Returns: {"status":"healthy"}
```

### Check Epoca is Linked
```sql
SELECT p.name, ac.platform, ac.account_id, ac.is_active
FROM ad_account_connections ac
JOIN properties p ON p.id = ac.property_id
WHERE p.name ILIKE '%epoca%';
```

### Check Import History
```sql
SELECT status, progress_pct, records_imported, campaigns_found, created_at
FROM import_jobs ORDER BY created_at DESC LIMIT 5;
```

### Check Imported Data
```sql
SELECT campaign_name, date, spend, clicks, impressions, conversions
FROM fact_marketing_performance
WHERE property_id = (SELECT id FROM properties WHERE name ILIKE '%epoca%')
ORDER BY date DESC, spend DESC;
```

---

## Troubleshooting

**"Data Engine won't start":**
```bash
cd p11-platform/services/data-engine
python -m venv venv
source venv/bin/activate   # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

**"Import stays at 0%":** Check Data Engine terminal for errors (MCP venv missing, Meta token expired, PYTHONPATH not set).

**"Import complete but no data":**
```sql
SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 1;
```

**"MCP import errors":**
```bash
cd p11-platform/services/mcp-servers
python test_meta_ads.py
```

---

## Auto-Schedule (Optional)

### Via pg_cron
```sql
SELECT cron.schedule(
  'auto-import-all',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    'http://localhost:8000/sync-all-properties',
    '{"date_range": "YESTERDAY"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

---

## Success Checklist

- [ ] Data Engine terminal shows sync complete
- [ ] Supabase has rows in `fact_marketing_performance`
- [ ] `import_jobs` table shows status = 'complete'
- [ ] Dashboard displays campaign cards
- [ ] Totals show correct spend/clicks





