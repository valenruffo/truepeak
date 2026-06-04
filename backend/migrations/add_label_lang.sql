-- Add lang column to label table for email template language selection
ALTER TABLE label ADD COLUMN IF NOT EXISTS lang VARCHAR(2) DEFAULT 'en';

-- Update existing labels to use English as default
UPDATE label SET lang = 'en' WHERE lang IS NULL;
