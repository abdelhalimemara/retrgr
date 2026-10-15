-- Phase 1 attribution: billboard placements and anonymous (analytics-consented) scans.
-- Wide event payloads (device hints, engagement) go to BigQuery; Cloud SQL keeps the
-- slim rows needed to link scans to customers and drive the placement dashboard.

CREATE TABLE placements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{2,40}$'), -- the `bid` URL parameter
  name        text NOT NULL,
  format      text, -- e.g. unipole, digital screen, mall
  city        text,
  district    text,
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  cost_sar    numeric(12, 2), -- flight cost, for cost per scan / lead
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placements_campaign_idx ON placements (campaign_id);

CREATE TABLE scans (
  id             uuid PRIMARY KEY, -- generated client-side so engagement + form submits can reference it
  campaign_id    uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  placement_id   uuid REFERENCES placements(id) ON DELETE SET NULL,
  customer_id    uuid REFERENCES customers(id) ON DELETE CASCADE, -- set when the scanner submits the form
  visitor_id     uuid NOT NULL, -- random first-party id, consent-gated, never shared with ad platforms
  scan_number    integer NOT NULL DEFAULT 1, -- repeat-exposure counter on this device
  offer_variant  text,
  device_type    text,
  os             text,
  language       text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  is_bot         boolean NOT NULL DEFAULT false,
  dwell_seconds  integer,
  max_scroll_pct integer,
  cta_clicks     integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scans_placement_idx ON scans (placement_id, created_at);
CREATE INDEX scans_campaign_idx ON scans (campaign_id, created_at);
CREATE INDEX scans_customer_idx ON scans (customer_id);
CREATE INDEX scans_visitor_idx ON scans (visitor_id);

ALTER TABLE touchpoints
  ADD COLUMN placement_id uuid REFERENCES placements(id) ON DELETE SET NULL,
  ADD COLUMN scan_id uuid REFERENCES scans(id) ON DELETE SET NULL;
