-- Partial leads are kept until the person submits (merged into the full lead) or opts out.
-- expires_at stays available for a retention period set later (the maintenance job honours it).
ALTER TABLE partial_leads ALTER COLUMN expires_at DROP NOT NULL, ALTER COLUMN expires_at DROP DEFAULT;
UPDATE partial_leads SET expires_at = NULL;
