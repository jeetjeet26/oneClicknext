-- Fix widget_sessions table - add missing columns
-- Required by /api/lumaleasing/chat route

ALTER TABLE widget_sessions 
ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
ADD COLUMN IF NOT EXISTS message_count int default 0,
ADD COLUMN IF NOT EXISTS user_agent text,
ADD COLUMN IF NOT EXISTS referrer_url text;

-- Create index for last_activity_at for performance
CREATE INDEX IF NOT EXISTS idx_widget_sessions_last_activity 
ON widget_sessions(last_activity_at DESC);

-- Update existing sessions to set last_activity_at
UPDATE widget_sessions 
SET last_activity_at = created_at 
WHERE last_activity_at IS NULL;
