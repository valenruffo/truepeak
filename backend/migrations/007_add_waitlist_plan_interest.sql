-- Add plan_interest column to waitlist_entry table
ALTER TABLE waitlist_entry ADD COLUMN IF NOT EXISTS plan_interest TEXT;
