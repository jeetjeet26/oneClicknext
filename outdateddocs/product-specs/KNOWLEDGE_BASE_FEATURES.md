# Knowledge Base Management Features

## Overview

The Property Knowledge Base system now includes comprehensive management capabilities for adding and maintaining content without requiring the full property edit workflow.

## New Features (January 2026)

### 1. Add Website URLs
**Button Location:** `/dashboard/community` → Knowledge Base tab → "Add URLs"

**Purpose:** Scrape additional website pages and add them to the knowledge base without going through the full property edit flow.

**Features:**
- Add multiple URLs at once
- Each URL is scraped individually
- Content is automatically chunked and embedded
- Creates/updates knowledge_sources entry with source_type: 'website'
- Extracts amenities, pet policies, and other structured data

**API Endpoint:** `POST /api/community/scrape-website`

**Request:**
```json
{
  "propertyId": "uuid",
  "websiteUrl": "https://example.com/amenities",
  "additionalUrls": [
    "https://example.com/floor-plans",
    "https://example.com/pet-policy"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "documentsCreated": 45,
  "pagesScraped": 3,
  "amenities": ["Pool", "Fitness Center", "Dog Park"],
  "propertyName": "Example Community"
}
```

---

### 2. Paste Text Content
**Button Location:** `/dashboard/community` → Knowledge Base tab → "Paste Text"

**Purpose:** Add text content directly to the knowledge base without creating a file.

**Features:**
- Direct text input with optional title
- Minimum 50 characters, maximum 100,000 characters
- Automatic text chunking (800 chars with 100 char overlap)
- AI embeddings generated via OpenAI text-embedding-3-small
- Creates/updates knowledge_sources entry with source_type: 'manual'

**API Endpoint:** `POST /api/documents/paste-text`

**Request:**
```json
{
  "propertyId": "uuid",
  "content": "Your text content here...",
  "title": "Pet Policy Details" // optional
}
```

**Response:**
```json
{
  "success": true,
  "title": "Pet Policy Details",
  "chunks": 12,
  "characters": 5432
}
```

**Use Cases:**
- Pet policy details
- Amenity descriptions
- Community guidelines
- FAQ answers
- Pricing information
- Special offers

---

### 3. Existing Features (Enhanced)

#### Upload Documents
**Button:** "Upload"
- Supports PDF, TXT, MD files
- Max 10MB per file
- Original files stored in Supabase Storage
- Content chunked and embedded

#### Refresh Website
**Button:** "Refresh"
- Re-scrapes existing website sources
- Updates last_synced_at timestamp
- Only visible when website sources exist

#### Scrape Pricing
**Button:** "Scrape Pricing"
- Extracts pricing and floor plan data from property website
- Saves to property_units table
- Updates knowledge base with structured pricing data

#### Paste Pricing
**Button:** "Paste Pricing"
- AI-powered extraction of pricing from pasted text
- Preview before saving
- Saves to property_units table
- Updates knowledge base

---

## Architecture

### Database Schema

**documents table:**
```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  property_id uuid REFERENCES properties(id),
  content text NOT NULL,
  metadata jsonb,
  embedding vector(1536),
  created_at timestamptz,
  -- New columns for file references
  original_file_url text,
  original_file_path text,
  original_file_name text,
  original_file_size bigint,
  original_file_type text
);
```

**knowledge_sources table:**
```sql
CREATE TABLE knowledge_sources (
  id uuid PRIMARY KEY,
  property_id uuid REFERENCES properties(id),
  source_type text CHECK (source_type IN ('intake_form', 'document', 'website', 'integration', 'manual')),
  source_name text NOT NULL,
  source_url text,
  file_name text,
  file_type text,
  status text CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  documents_created int DEFAULT 0,
  extracted_data jsonb,
  last_synced_at timestamptz,
  error_message text,
  created_at timestamptz,
  updated_at timestamptz
);
```

### Source Types

- **intake_form**: Data from initial property intake form
- **document**: Uploaded PDF/TXT/MD files
- **website**: Scraped website content
- **integration**: External integrations (PMS, etc.)
- **manual**: Manually pasted text or pricing data

---

## Component Structure

```
/components/community/
  ├── KnowledgeSourcesList.tsx      # Main KB management UI
  ├── AddWebsiteUrlsModal.tsx       # NEW: Add URLs modal
  ├── PasteTextModal.tsx            # NEW: Paste text modal
  ├── ManualPricingModal.tsx        # Existing: Paste pricing
  └── DocumentUploader.tsx          # Existing: Upload files

/app/api/
  ├── documents/
  │   ├── upload/route.ts           # Existing: File upload
  │   └── paste-text/route.ts       # NEW: Text pasting
  └── community/
      └── scrape-website/route.ts   # Existing (now has UI)
```

---

## User Workflows

### Workflow 1: Add Website Content
1. Navigate to `/dashboard/community` → Knowledge Base tab
2. Click "Add URLs" button
3. Enter one or more website URLs
4. Click "Scrape & Add to KB"
5. Wait for processing (content appears in sources list)

### Workflow 2: Add Text Content
1. Navigate to `/dashboard/community` → Knowledge Base tab
2. Click "Paste Text" button
3. Enter optional title
4. Paste text content (min 50 chars)
5. Click "Add to Knowledge Base"
6. Wait for processing (content appears in sources list)

### Workflow 3: Upload Document
1. Navigate to `/dashboard/community` → Knowledge Base tab
2. Click "Upload" button
3. Drag & drop or select PDF/TXT/MD file
4. Wait for processing

### Workflow 4: Refresh Website
1. Navigate to `/dashboard/community` → Knowledge Base tab
2. Click "Refresh" button (if website sources exist)
3. Existing website sources are re-scraped

---

## Integration Points

### Authentication
- All endpoints require authenticated user
- User must belong to property's organization
- Uses Supabase RLS policies

### AI/Embeddings
- OpenAI text-embedding-3-small (1536 dimensions)
- Batch processing (100 chunks at a time)
- Stored in pgvector format

### Storage
- Original files stored in Supabase Storage bucket: `documents`
- File path format: `{propertyId}/uploads/{filename}`
- Public URLs generated for file access

### Knowledge Base Sync
- Document chunks automatically indexed for RAG
- Chatbot can query using semantic search
- match_documents() function for similarity search

---

## Future Enhancements

### Potential Features
1. **Delete/Remove Sources**: Remove individual knowledge sources
2. **Edit Content**: Update existing document chunks
3. **Bulk Operations**: Delete multiple sources, bulk upload
4. **Source Management**: Organize sources into categories
5. **Content Preview**: View chunks before they're added
6. **Duplicate Detection**: Prevent adding same content twice
7. **Source History**: Track changes to sources over time
8. **Export KB**: Download entire knowledge base as JSON/CSV

### API Improvements
1. Webhook support for external scraping services
2. RSS/Feed monitoring for auto-updates
3. Integration with CMS platforms (WordPress, etc.)
4. Scheduled re-scraping of website sources

---

## Troubleshooting

### Issue: Content not appearing in chatbot
**Solution:** 
- Verify documents were created in database
- Check knowledge_sources status is 'completed'
- Verify embeddings were generated
- Check match_documents() function is working

### Issue: Website scraping fails
**Solution:**
- Verify URL is accessible publicly
- Check if site blocks automated requests
- Verify OpenAI API key is configured
- Check error_message in knowledge_sources

### Issue: Paste text fails
**Solution:**
- Ensure content is at least 50 characters
- Check content doesn't exceed 100,000 characters
- Verify OpenAI API key is configured
- Check server logs for errors

---

## Related Documentation
- [P11 Platform Overview](./docs/P11_PLATFORM.md)
- [CRM Quick Start](./docs/CRM_QUICK_START.md)
- [Data Engine Migration](./docs/DATA_ENGINE_MIGRATION.md)
