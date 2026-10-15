-- Retrgtr core schema. Customer PII lives only in `customers`; every other
-- table references it with ON DELETE CASCADE so an erasure request
-- (PDPL right to destruction) removes the person everywhere in one statement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  contact_email text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,64}$'),
  location        text,
  city            text,
  starts_on       date,
  ends_on         date,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  headline        text,
  consent_version text NOT NULL DEFAULT 'v1',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text,
  email_sha256  text UNIQUE,
  phone         text, -- E.164, e.g. +966501234567
  phone_sha256  text UNIQUE,
  first_name    text,
  last_name     text,
  age_range     text CHECK (age_range IN ('18-24', '25-34', '35-44', '45-54', '55-64', '65+')),
  gender        text CHECK (gender IN ('male', 'female', 'undisclosed')),
  city          text,
  country       text NOT NULL DEFAULT 'SA',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id    uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  policy_version text NOT NULL,
  purposes       text[] NOT NULL,
  ip_address     inet,
  user_agent     text,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);
CREATE INDEX consents_active_idx ON consents (customer_id) WHERE withdrawn_at IS NULL;

CREATE TABLE touchpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id  uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  fbclid       text,
  gclid        text,
  ttclid       text,
  sccid        text,
  landing_url  text,
  referrer     text,
  device_type  text,
  language     text,
  timezone     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX touchpoints_customer_idx ON touchpoints (customer_id);
CREATE INDEX touchpoints_campaign_idx ON touchpoints (campaign_id, created_at);

CREATE TABLE segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  filters     jsonb NOT NULL DEFAULT '{}',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id   uuid REFERENCES segments(id) ON DELETE SET NULL,
  segment_name text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok', 'snapchat')),
  identifier   text NOT NULL,
  record_count integer NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Accountability trail for PDPL: who exported or erased what, and when.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
