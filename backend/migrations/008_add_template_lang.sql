-- Add lang column to email_template
ALTER TABLE email_template ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'es';
