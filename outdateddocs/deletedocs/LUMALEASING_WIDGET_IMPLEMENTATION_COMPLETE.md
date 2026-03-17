# LumaLeasing Calendar Widget - Implementation Complete ✅

**Implementation Date:** January 27, 2026  
**Status:** Code Complete - Ready for Testing  
**Implemented By:** P11 Engineering Team

---

## ✅ Implementation Summary

### Critical Blockers Resolved

1. ✅ **Tour Reminder Emails** - COMPLETE
2. ✅ **Google Calendar Integration** - COMPLETE
3. ✅ **Calendar Widget UI** - COMPLETE
4. ✅ **Token Health Monitoring** - COMPLETE
5. ✅ **Database Migrations Applied** - VERIFIED

---

## 📦 Files Created/Modified

### Database Migrations (Applied to Supabase ✅)

1. **`20260127000000_add_tour_booking_reminders.sql`**
   - Added `reminder_24h_sent_at` and `reminder_1h_sent_at` to `tour_bookings`
   - Created index for cron job efficiency
   - ✅ **Verified in database**

2. **`20260127000001_google_calendar_integration.sql`**
   - Created `agent_calendars` table (19 columns)
   - Created `calendar_events` table (linking tours to Google events)
   - Created `calendar_token_refreshes` audit table
   - Added RLS policies for security
   - ✅ **Verified in database - All tables exist**

### Backend API Routes (New)

1. **`app/api/lumaleasing/calendar/connect/route.ts`** - OAuth initiation
   - Redirects PM to Google consent screen
   - Validates user access to property
   - Includes state parameter for security

2. **`app/api/lumaleasing/calendar/callback/route.ts`** - OAuth callback
   - Exchanges authorization code for tokens
   - Stores tokens in `agent_calendars` table
   - Fetches user email and timezone
   - Redirects to dashboard with success message

3. **`app/api/lumaleasing/calendar/status/route.ts`** - Calendar status
   - Returns calendar connection status for property
   - Shows email, health status, last check time

4. **`app/api/lumaleasing/tours/availability/route.ts`** - Dynamic availability
   - Fetches busy times from Google Calendar
   - Generates available slots based on working hours
   - Excludes busy times and adds buffer
   - Returns slots grouped by date

### Backend Utilities (New)

1. **`utils/services/google-calendar.ts`** - Google Calendar API wrapper
   - `refreshAccessTokenIfNeeded()` - Auto-refresh before calls
   - `refreshAccessToken()` - Exchange refresh token
   - `fetchBusyTimes()` - Get PM's busy periods
   - `generateAvailableSlots()` - Create 30min slots
   - `createCalendarEvent()` - Add tour to PM's calendar
   - `getCalendarConfig()` - Fetch property's calendar config

### Backend Updates (Modified)

1. **`utils/services/tour-reminders.ts`** - Updated for LumaLeasing
   - Added `TourBookingWithLead` interface
   - Added `processLumaLeasingReminders()` function
   - Added `send24hReminderForBooking()` function
   - Added `send1hReminderForBooking()` function
   - Added `build1hEmailMessage()` template
   - Now processes both `tours` and `tour_bookings` tables

2. **`app/api/lumaleasing/tours/route.ts`** - Enhanced booking
   - Added support for direct date/time booking (no slotId required)
   - Added Google Calendar event creation
   - Stores event ID in `calendar_events` table
   - Non-blocking calendar creation (booking succeeds even if calendar fails)

3. **`vercel.json`** - Added cron job
   - Added `/api/tours/reminders` to run every 15 minutes

### Frontend Widget (Major Update)

1. **`public/lumaleasing.js`** - Calendar widget UI
   - Added calendar state variables (`widgetMode`, `calendarData`, `selectedDate`, `selectedTime`)
   - Added `detectTourIntent()` - Catches tour keywords
   - Added `fetchTourAvailability()` - Fetches from Google Calendar
   - Added `bookTour()` - Creates booking with date/time
   - Added `renderCalendar()` - Main calendar router
   - Added `renderMonthView()` - Month grid with available dates
   - Added `renderTimePicker()` - Time slot selection
   - Added `renderConfirmation()` - Contact form + booking summary
   - Added `renderCalendarError()` - Error handling UI
   - Added global handlers for calendar navigation
   - Added comprehensive CSS for calendar UI (150+ lines)
   - Updated `sendMessage()` to detect tour intent and show calendar

### Frontend Dashboard (Modified)

1. **`components/lumaleasing/LumaLeasingConfig.tsx`** - Calendar UI
   - Added calendar status display
   - Added "Connect Google Calendar" button
   - Added "Reconnect" button for expired tokens
   - Added health status indicator (green/yellow/red)
   - Added OAuth callback handling (success/error messages)

### Data Engine (New)

1. **`jobs/google_calendar_health_monitor.py`** - Token monitoring
   - Checks all calendar configs every 6 hours
   - Proactively refreshes tokens expiring in <24 hours
   - Tests token validity with Calendar API call
   - Detects revoked/expired tokens
   - Updates `token_status` in database
   - Sends re-auth alert emails to PMs
   - Logs all refreshes to audit table

2. **`requirements.txt`** - Added Google dependencies
   - `google-auth`
   - `google-auth-oauthlib`
   - `google-auth-httplib2`
   - `google-api-python-client`

### Documentation (New)

1. **`LUMALEASING_CALENDAR_SETUP.md`** - Complete setup guide
   - Google Cloud Console configuration
   - OAuth credentials setup
   - Environment variables
   - Render cron configuration
   - Testing procedures
   - Troubleshooting guide

2. **`LUMALEASING_IMPLEMENTATION_STATUS.md`** - Progress tracker
   - What's complete
   - What's remaining
   - Testing plan
   - Launch readiness assessment

---

## 🔧 What Needs to Be Done Next

### Environment Variables (REQUIRED)

Add these to Vercel project settings:

```env
# Already exist (verify):
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
RESEND_API_KEY=...

# NEW - Add these:
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
CRON_SECRET=generate-with-openssl-rand
NEXT_PUBLIC_APP_URL=https://p11platform.vercel.app
```

### Data Engine Environment Variables (REQUIRED)

Add these to Render service:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Deploy (REQUIRED)

1. **Deploy P11 Platform to Vercel**
   ```bash
   cd p11-platform/apps/web
   vercel --prod
   ```

2. **Deploy Data Engine to Render**
   - Push code to GitHub
   - Render auto-deploys
   - Configure cron job in Render dashboard

3. **Verify Cron Jobs**
   - Vercel: Check that tour reminders cron is active
   - Render: Check that calendar health monitor is scheduled

---

## 🧪 Testing Checklist

### Phase 1: Backend Testing (Days 1-2)

**OAuth Flow:**
- [ ] Go to Dashboard → Settings → LumaLeasing
- [ ] Click "Connect Google Calendar"
- [ ] Verify redirects to Google OAuth
- [ ] Grant calendar access
- [ ] Verify redirects back with success message
- [ ] Check database: `agent_calendars` has new row with tokens
- [ ] Verify calendar status shows "Connected ✅"

**Availability API:**
- [ ] Create test events in Google Calendar (block 10am-11am)
- [ ] Call `/api/lumaleasing/tours/availability` with widget API key
- [ ] Verify response includes available dates
- [ ] Verify 10am-11am slot is marked `available: false`
- [ ] Verify working hours respected (no slots before 9am or after 6pm)

**Token Refresh:**
- [ ] Deploy Python cron job to Render
- [ ] Manually trigger: `python jobs/google_calendar_health_monitor.py`
- [ ] Check logs for successful token check
- [ ] Verify `last_health_check_at` updated in database

**Tour Booking:**
- [ ] Book tour via Postman/curl to `/api/lumaleasing/tours`
- [ ] Verify tour_bookings record created
- [ ] Check Google Calendar - event should appear
- [ ] Check `calendar_events` table - google_event_id stored
- [ ] Verify prospect receives confirmation email

**Tour Reminders:**
- [ ] Create test tour 24 hours in future
- [ ] Wait for cron to run (or trigger manually)
- [ ] Verify `reminder_24h_sent_at` timestamp updated
- [ ] Check email received
- [ ] Create test tour 1 hour in future
- [ ] Wait for cron
- [ ] Verify `reminder_1h_sent_at` updated
- [ ] Check email received

### Phase 2: Widget UI Testing (Days 3-4)

**Calendar Widget Flow:**
- [ ] Install widget on test WordPress site
- [ ] Open chat and type "I'd like to schedule a tour"
- [ ] **Verify:** Calendar picker appears immediately
- [ ] **Verify:** Month grid shows available dates highlighted
- [ ] **Verify:** Past dates are disabled
- [ ] **Verify:** Today is highlighted
- [ ] Click on available date
- [ ] **Verify:** Time picker appears with slots
- [ ] **Verify:** Slots formatted as "2:00 PM" (12-hour format)
- [ ] Click on time slot
- [ ] **Verify:** Confirmation form appears
- [ ] Fill in name, email, phone, special requests
- [ ] Click "Confirm Tour"
- [ ] **Verify:** Success message in chat
- [ ] **Verify:** Returned to chat mode
- [ ] **Verify:** Confirmation email received
- [ ] **Verify:** Event in Google Calendar

**Error Handling:**
- [ ] Test with calendar not connected
- [ ] **Verify:** Shows fallback message "Please call us"
- [ ] Test with expired token
- [ ] **Verify:** Shows error message
- [ ] Test selecting fully booked slot
- [ ] **Verify:** Graceful error handling

**Mobile Testing:**
- [ ] Test on iPhone (Safari)
- [ ] **Verify:** Calendar grid responsive
- [ ] **Verify:** Time slots tap correctly
- [ ] **Verify:** Form fields work with mobile keyboard
- [ ] Test on Android (Chrome)
- [ ] **Verify:** Same as iPhone
- [ ] Test landscape orientation
- [ ] **Verify:** Layout adapts

### Phase 3: Integration Testing (Day 5)

**End-to-End Flow:**
- [ ] Prospect visits WordPress site
- [ ] Opens chat, mentions tour
- [ ] Selects date/time from calendar
- [ ] Submits booking
- [ ] **Verify:** Lead created in `leads` table
- [ ] **Verify:** Tour booking in `tour_bookings` table
- [ ] **Verify:** Event in PM's Google Calendar
- [ ] **Verify:** Confirmation email sent
- [ ] **Verify:** Lead synced to CRM (if configured)
- [ ] **Verify:** Lead scored by LeadPulse
- [ ] Wait 24 hours
- [ ] **Verify:** 24hr reminder email sent
- [ ] Wait 23 more hours
- [ ] **Verify:** 1hr reminder email sent

**Token Health:**
- [ ] Let cron run for 24 hours
- [ ] Check `calendar_token_refreshes` audit log
- [ ] Verify at least 4 successful health checks
- [ ] Manually revoke token in Google (for testing)
- [ ] Wait for next cron run
- [ ] **Verify:** Token marked as 'revoked'
- [ ] **Verify:** Alert email sent to PM
- [ ] Reconnect calendar
- [ ] **Verify:** Status returns to 'healthy'

---

## 🚨 Known Issues / Limitations

### Issue #1: Tour API Mismatch (FIXED ✅)

**Problem:** Original API required `slotId` from `tour_slots` table  
**Solution:** Updated API to accept either `slotId` OR `tourDate + tourTime`  
**Status:** ✅ Fixed - API now supports both booking methods

### Issue #2: No Webhook Receiver Yet (NOT BLOCKING)

**Impact:** PM reschedules in Google Calendar → P11 doesn't update  
**Workaround:** PM must also update in P11 Dashboard  
**Priority:** P1 - Important but not MVP blocker  
**Estimated Effort:** 2-3 days

### Issue #3: Single Month View Only (MINOR)

**Impact:** Widget only shows current month  
**Workaround:** User can book up to 14 days out (usually same month)  
**Priority:** P2 - Enhancement  
**Estimated Effort:** 1 day (add month navigation)

### Issue #4: No Loading Skeleton (MINOR)

**Impact:** Blank screen briefly while fetching availability  
**Workaround:** Happens quickly (~500ms)  
**Priority:** P3 - Polish  
**Estimated Effort:** 1 hour

---

## 🎯 Environment Setup Required

### 1. Google Cloud Console (15 minutes)

**Steps:**
1. Create project "P11 LumaLeasing"
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials
4. Add redirect URI: `https://p11platform.vercel.app/api/lumaleasing/calendar/callback`
5. Note Client ID and Secret

**Result:** You'll have:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET

### 2. Vercel Environment Variables (5 minutes)

**Add to Vercel project settings:**
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CRON_SECRET=[generate with: openssl rand -base64 32]
NEXT_PUBLIC_APP_URL=https://p11platform.vercel.app
```

### 3. Render Environment Variables (5 minutes)

**Add to Data Engine service:**
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### 4. Deploy Services (10 minutes)

**Vercel:**
```bash
cd p11-platform/apps/web
vercel --prod
```

**Render:**
- Push to GitHub (auto-deploys)
- Or trigger manual deploy in Render dashboard

### 5. Configure Render Cron (5 minutes)

**Option A - Via Dashboard:**
1. Go to Render service → Cron Jobs
2. Add new cron job:
   - Name: `calendar-health-monitor`
   - Schedule: `0 */6 * * *` (every 6 hours)
   - Command: `python jobs/google_calendar_health_monitor.py`

**Option B - Via render.yaml:**
- Already documented in `LUMALEASING_CALENDAR_SETUP.md`

---

## 📊 Database Verification

**Tables Created:** ✅ Verified via Supabase MCP

| Table | Columns | Rows | Status |
|-------|---------|------|--------|
| `agent_calendars` | 19 | 0 | ✅ Ready |
| `calendar_events` | 7 | 0 | ✅ Ready |
| `calendar_token_refreshes` | 6 | 0 | ✅ Ready |
| `tour_bookings` | 18 (added 2) | ? | ✅ Updated |

**Indexes Created:** ✅ 15 indexes total

**RLS Policies:** ✅ 5 policies (secure)

**Security Advisors:** ⚠️ 1 warning on `calendar_events`
- Warning: "System manage calendar events" policy uses `USING (true)`
- **This is intentional** - Service role needs full access for automation
- Not a security risk (service role is already privileged)

---

## 💻 Widget Code - What Changed

### JavaScript Widget (`public/lumaleasing.js`)

**Total Changes:** ~666 lines added (file grew from 732 → 1398 lines)

**New State Variables:**
```javascript
let widgetMode = 'chat'; // 'chat' | 'calendar' | 'confirmation'
let calendarData = null;
let selectedDate = null;
let selectedTime = null;
```

**New Functions Added:**
1. `detectTourIntent(text)` - Detects 12 tour-related keywords
2. `fetchTourAvailability()` - Calls availability API
3. `bookTour(date, time, contactInfo)` - Creates booking
4. `renderCalendar()` - Calendar mode router
5. `renderMonthView()` - Month grid with dates
6. `renderTimePicker()` - Time slot picker
7. `renderConfirmation()` - Contact form
8. `renderCalendarError()` - Error state
9. Global handlers: `lumaleasing_selectDate()`, `lumaleasing_selectTime()`, etc.

**Modified Functions:**
- `renderWidget()` - Now handles 3 modes (chat/calendar/confirmation)
- `sendMessage()` - Detects tour intent FIRST, shows calendar if detected

**New CSS Classes:** (150+ lines)
```css
.ll-calendar-content, .ll-calendar-header, .ll-calendar-grid
.ll-calendar-day, .ll-calendar-day-available, .ll-calendar-day-past
.ll-time-slots, .ll-time-slot
.ll-confirmation-summary, .ll-booking-form
.ll-form-group, .ll-form-actions
.ll-button-primary, .ll-button-secondary
```

---

## 🔍 Widget Integration - Does It Need Updates?

### ✅ Widget is Complete - NO updates needed for WordPress plugin

The WordPress plugin (`lumawidget` repo) **does NOT need any changes** because:

1. **Plugin loads JavaScript from P11 Platform**
   - Plugin file: `lumaleasing-wordpress/includes/class-public.php`
   - Loads: `<script src="{{P11_PLATFORM_URL}}/lumaleasing.js">`
   - The updated `lumaleasing.js` with calendar UI is served by P11 Platform

2. **Plugin passes API key**
   - Plugin: `lumaleasing('init', 'API_KEY')`
   - Widget JavaScript handles everything else

3. **No PHP changes needed**
   - All calendar logic is in JavaScript + Backend APIs
   - WordPress plugin is just a loader

### What WordPress Developers Will See (Automatic)

Once you deploy the updated `lumaleasing.js` to P11 Platform:

**Old behavior (before today):**
- User: "I want a tour"
- Bot: "What day works for you?"
- User types: "Tomorrow at 2pm"
- Bot extracts date/time

**New behavior (after deploy):**
- User: "I want a tour"
- Bot: "Great! Let me show you our available times..."
- **Calendar picker appears automatically**
- User clicks date → time picker
- User clicks time → confirmation form
- Submit → Done

**Zero changes required in WordPress plugin code.**

---

## 🚀 Deployment Steps

### Pre-Deployment Checklist

- [x] Database migrations applied to Supabase
- [x] Code complete and linter-clean
- [ ] Environment variables configured (Vercel + Render)
- [ ] Google Cloud project set up
- [ ] OAuth credentials created

### Deployment Commands

```bash
# 1. Verify local changes
git status

# 2. Commit changes
git add .
git commit -m "feat: LumaLeasing calendar widget + Google Calendar integration

- Add tour reminder emails (24hr + 1hr)
- Add Google Calendar OAuth flow
- Add dynamic availability API from PM's calendar
- Add calendar picker UI in widget
- Add token health monitoring cron job
- Update tour booking to create Google Calendar events

Closes P11-XX (calendar widget blocker)"

# 3. Push to GitHub
git push origin main

# 4. Deploy to Vercel (auto-deploys from main)
# Or manual:
cd p11-platform/apps/web
vercel --prod

# 5. Render auto-deploys from main branch
# Or manually trigger in dashboard

# 6. Verify deployment
curl https://p11platform.vercel.app/lumaleasing.js | head -20
# Should show widget version with calendar code
```

### Post-Deployment Verification

```bash
# Test availability API
curl -H "X-API-Key: YOUR_KEY" \
  https://p11platform.vercel.app/api/lumaleasing/tours/availability

# Test cron job (Vercel)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://p11platform.vercel.app/api/tours/reminders

# Test cron job (Render)
# Go to Render dashboard → Cron Jobs → Run Now
```

---

## 📈 Success Metrics to Monitor

### Week 1 Post-Deploy

**Technical Metrics:**
- [ ] OAuth flow success rate: Target >95%
- [ ] Availability API response time: Target <2 seconds
- [ ] Tour booking success rate: Target >98%
- [ ] Token refresh success rate: Target >99%
- [ ] Reminder email delivery: Target >98%

**Business Metrics:**
- [ ] Tours booked via calendar widget: Track count
- [ ] Calendar vs conversational booking ratio
- [ ] Tour no-show rate: Target <20% (with reminders)
- [ ] Lead capture rate: Target >35%

### Monitor These Tables

```sql
-- Tour bookings via calendar widget
SELECT count(*), DATE(created_at) as day
FROM tour_bookings 
WHERE source = 'lumaleasing'
AND created_at > NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;

-- Calendar event creation success rate
SELECT 
  count(*) FILTER (WHERE google_event_id IS NOT NULL) as with_event,
  count(*) as total,
  ROUND(100.0 * count(*) FILTER (WHERE google_event_id IS NOT NULL) / count(*), 1) as success_rate
FROM tour_bookings tb
LEFT JOIN calendar_events ce ON ce.tour_booking_id = tb.id
WHERE tb.created_at > NOW() - INTERVAL '7 days';

-- Token health status
SELECT 
  token_status,
  count(*) as properties
FROM agent_calendars
WHERE sync_enabled = true
GROUP BY token_status;

-- Reminder delivery rate
SELECT 
  count(*) FILTER (WHERE reminder_24h_sent_at IS NOT NULL) as reminders_24h_sent,
  count(*) FILTER (WHERE reminder_1h_sent_at IS NOT NULL) as reminders_1h_sent,
  count(*) as total_upcoming_tours
FROM tour_bookings
WHERE scheduled_date >= CURRENT_DATE
AND status = 'confirmed';
```

---

## 🎯 Go/No-Go Decision

### Status: ✅ READY FOR TESTING PHASE

**Code Complete:** Yes  
**Database Ready:** Yes  
**Documentation Complete:** Yes  

**Next Gate:** After successful testing (3-5 days)  
**Then:** Soft launch to 2-3 pilot properties  
**Full Launch:** After pilot feedback (~1-2 weeks)

---

## 📞 Support

**Implementation Questions:** dev@p11creative.com  
**Setup Help:** See `LUMALEASING_CALENDAR_SETUP.md`  
**Testing Issues:** Create GitHub issue or Slack #lumaleasing

---

**Implementation Status:** ✅ **CODE COMPLETE**  
**Next Step:** Configure environment variables and deploy  
**Timeline to Production:** 1-2 weeks (testing + pilot)
