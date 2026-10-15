-- One central sGTM container serves every partner. Each partner installs the
-- collector with its own public key; the campaign is resolved from the billboard
-- code (bid), and requests are only accepted from the partner's own websites.
ALTER TABLE partners
  ADD COLUMN key text UNIQUE CHECK (key ~ '^[a-z0-9]{6,32}$'),
  -- e.g. {https://brand.sa,https://www.brand.sa}. Empty = not restricted yet.
  ADD COLUMN allowed_origins text[] NOT NULL DEFAULT '{}';
UPDATE partners SET key = substr(md5(random()::text || id::text), 1, 12) WHERE key IS NULL;
ALTER TABLE partners
  ALTER COLUMN key SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  ALTER COLUMN key SET NOT NULL;
