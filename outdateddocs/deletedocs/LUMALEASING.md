# LumaLeasing™ - AI-Powered Leasing Assistant

**Product Status:** Active Development  
**Last Updated:** December 10, 2025

---

## Overview

LumaLeasing is an AI-powered chatbot for apartment communities that handles prospect inquiries, schedules tours, and now supports Gmail integration and Google Calendar sync for a complete communication experience.

### Key Features
- ✅ **AI Chatbot** - GPT-4o-mini powered leasing assistant
- ✅ **Knowledge Base RAG** - Answers questions using property documents
- ✅ **Tour Scheduling** - Book in-person, virtual, or self-guided tours
- ✅ **Email Confirmations** - Send via Resend API
- ⏳ **Gmail Integration** - Receive/respond to prospect emails (Planned)
- ⏳ **Google Calendar Sync** - Two-way calendar sync (Planned)
- ⏳ **Dynamic Availability** - Auto-generate slots from agent calendars (Planned)

---

## Gmail & Google Calendar Integration Plan

**Priority:** High  
**Estimated Effort:** 3-4 weeks

### Executive Summary

Extend LumaLeasing to handle **email conversations** and **calendar-based tour scheduling** via Google APIs:
1. **Gmail Integration** - Receive prospect emails, auto-reply with AI, thread into CRM
2. **Google Calendar Sync** - Two-way sync between tour bookings and agent calendars
3. **Dynamic Availability** - Auto-generate tour slots from agent calendar availability
4. **Calendar Invites** - Send Google Calendar invites to prospects when tours are booked

### Current State

| Feature | Status |
|---------|--------|
| Chat widget conversations | ✅ Working |
| Manual tour slot creation | ✅ Working |
| Tour booking via widget | ✅ Working |
| Email confirmation (Resend) | ✅ Working |
| Inbound email handling | ❌ Planned |
| Google Calendar sync | ❌ Planned |
| Calendar invites to prospects | ❌ Planned |
| Dynamic availability | ❌ Planned |

---

## Phase 1: Gmail Integration

### Database Schema

```sql
-- Property Gmail Configuration
CREATE TABLE gmail_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES properties(id) ON DELETE CASCADE UNIQUE,
  gmail_address text NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  history_id text,
  watch_expiration timestamptz,
  auto_reply_enabled boolean DEFAULT true,
  auto_reply_delay_minutes int DEFAULT 5,
  signature text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Email Threads
CREATE TABLE email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES properties(id),
  lead_id uuid REFERENCES leads(id),
  conversation_id uuid REFERENCES conversations(id),
  gmail_thread_id text NOT NULL,
  subject text,
  last_message_at timestamptz,
  message_count int DEFAULT 0,
  status text DEFAULT 'open',
  assigned_agent_id uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(property_id, gmail_thread_id)
);

-- Individual Email Messages
CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL UNIQUE,
  direction text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  ai_generated boolean DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

### API Routes

```
/api/lumaleasing/gmail/
├── connect/route.ts       # OAuth flow initiation
├── callback/route.ts      # OAuth callback handler
├── webhook/route.ts       # Gmail Push Notification receiver
├── sync/route.ts          # Manual sync trigger
├── config/route.ts        # Get/update gmail settings
└── threads/route.ts       # List email threads
```

### Gmail Integration Flow

```
1. SETUP (One-time per property)
   Admin Panel → OAuth Flow → Store Token in DB

2. WATCH (Subscribe to inbox changes)
   Setup Webhook → Gmail Watch API → Pub/Sub Subscription

3. INBOUND EMAIL
   Gmail Inbox → Push to Pub/Sub → Webhook Receives
   ↓
   PROCESS EMAIL:
   1. Fetch full message via Gmail API
   2. Parse sender → match/create lead
   3. Store in email_messages table
   4. Link to/create conversation
   5. Queue AI response (if enabled)

4. AI RESPONSE
   1. Use existing LumaLeasing RAG system
   2. Generate contextual email reply
   3. Send via Gmail API (same thread)
   4. Store outbound message
```

---

## Phase 2: Google Calendar Integration

### Database Schema

```sql
-- Agent Calendar Configuration
CREATE TABLE agent_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  calendar_id text DEFAULT 'primary',
  access_token text,
  refresh_token text,
  sync_enabled boolean DEFAULT true,
  working_hours jsonb DEFAULT '{"mon":{"start":"09:00","end":"18:00"},...}',
  tour_duration_minutes int DEFAULT 30,
  buffer_minutes int DEFAULT 15,
  UNIQUE(profile_id, property_id)
);

-- Calendar Events (for two-way sync)
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_calendar_id uuid REFERENCES agent_calendars(id),
  tour_booking_id uuid REFERENCES tour_bookings(id),
  google_event_id text NOT NULL,
  sync_status text DEFAULT 'synced',
  last_synced_at timestamptz DEFAULT now(),
  UNIQUE(tour_booking_id)
);

-- Prospect Calendar Invites
CREATE TABLE prospect_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_booking_id uuid REFERENCES tour_bookings(id),
  lead_id uuid REFERENCES leads(id),
  google_event_id text,
  invite_sent_at timestamptz,
  invite_method text DEFAULT 'email',
  response_status text,
  UNIQUE(tour_booking_id)
);
```

### Dynamic Availability Generation

Fetches agent's busy times from Google Calendar and generates available slots:
1. Get all agents with calendars for property
2. Query Google Calendar freebusy API
3. Generate slots based on working hours minus busy times
4. Add agent info to each slot

### Two-Way Sync

When tour is booked:
1. Create Google Calendar event for agent
2. Add prospect as attendee (sends invite)
3. Track event ID for sync

When agent modifies event in Google:
1. Webhook receives notification
2. Update tour booking accordingly
3. Handle cancellations

---

## Phase 3: Lead Enrichment

### Conversation Analysis

Extract structured data from conversations:
- Amenities they asked about
- Floorplan preferences
- Budget range
- Move-in timeline
- Pet information
- Parking needs
- Special requirements
- Urgency level

```sql
CREATE TABLE lead_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  interest_type text NOT NULL,
  interest_value text NOT NULL,
  confidence float DEFAULT 1.0,
  extracted_from text,
  created_at timestamptz DEFAULT now()
);
```

---

## Google Cloud Setup Required

### Enable APIs
- Gmail API
- Google Calendar API
- Cloud Pub/Sub API

### OAuth Scopes
```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
```

### Pub/Sub Setup
1. Create topic: `lumaleasing-gmail-notifications`
2. Create push subscription to webhook endpoint
3. Grant Gmail publish permission to topic

### Environment Variables
```env
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_PUBSUB_TOPIC=projects/xxx/topics/lumaleasing-gmail-notifications
GMAIL_WEBHOOK_SECRET=xxx
```

---

## Email Sending Configuration

### Current Setup (Resend)

```env
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=onboarding@resend.dev  # Test domain
```

**Note:** `onboarding@resend.dev` is Resend's test domain. For production:
1. Verify your domain in Resend
2. Add DNS records
3. Update `RESEND_FROM_EMAIL` to use your domain

### Testing Email Sending

1. Go to Leads page (`/dashboard/leads`)
2. Select a lead
3. Click "Send Message" → Choose Email
4. Enter subject and message
5. Check terminal for detailed logs:

```
[Email] Attempting to send to user@example.com
[Email] Resend API Response: {...}
[Email] ✅ Successfully sent, Message ID: abc123
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Invalid API Key | Get new key from https://resend.com/api-keys |
| Email not arriving | Check spam; test domain may not deliver |
| Missing subject | Subject is required for email |
| Rate limiting | Wait and retry; upgrade Resend plan |

### Verify with Curl
```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "user@example.com",
    "subject": "Test Email",
    "text": "This is a test"
  }'
```

---

## Implementation Checklist

### Week 1: Gmail Foundation
- [ ] Create migration `20251211100000_gmail_calendar_integration.sql`
- [ ] Implement Gmail OAuth flow
- [ ] Set up Google Cloud Pub/Sub topic
- [ ] Implement webhook handler
- [ ] Build email parsing and storage logic
- [ ] Create email threads UI

### Week 2: Gmail AI + Calendar Foundation
- [ ] Implement AI email response generation
- [ ] Add email signature support
- [ ] Create Gmail admin config UI
- [ ] Implement agent calendar OAuth
- [ ] Build calendar config UI

### Week 3: Calendar Features
- [ ] Implement dynamic availability generation
- [ ] Modify tour booking to create calendar events
- [ ] Implement two-way sync webhook
- [ ] Add calendar invites for prospects
- [ ] Test end-to-end flow

### Week 4: Lead Enrichment + Polish
- [ ] Implement conversation analysis
- [ ] Add lead_interests table and extraction
- [ ] Update leads UI to show interests
- [ ] End-to-end testing
- [ ] Documentation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Gmail connected | 3+ properties |
| Inbound emails processed | 95%+ |
| AI response accuracy | 90%+ |
| Calendar events synced | 99%+ |
| Tour booking → Calendar | < 5 sec |
| Lead enrichment coverage | 80%+ leads |

---

**LumaLeasing™**  
*Your AI Leasing Partner*









