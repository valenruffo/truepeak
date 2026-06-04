-- Add lang column to label table for email template language selection
ALTER TABLE label ADD COLUMN IF NOT EXISTS lang VARCHAR(2) DEFAULT 'es';
