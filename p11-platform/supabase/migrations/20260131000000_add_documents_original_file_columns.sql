-- Add original file reference columns to documents table
-- These columns store references to the original uploaded files in Supabase Storage
-- Used by document upload feature to maintain original file links

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS original_file_url text,
ADD COLUMN IF NOT EXISTS original_file_path text,
ADD COLUMN IF NOT EXISTS original_file_name text,
ADD COLUMN IF NOT EXISTS original_file_size bigint,
ADD COLUMN IF NOT EXISTS original_file_type text;

-- Add index for faster lookups by original file path
CREATE INDEX IF NOT EXISTS idx_documents_original_file_path ON documents(original_file_path);
