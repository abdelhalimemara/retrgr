-- Disclosed "save as you type": only for partners whose form shows typed_notice above the fields.
ALTER TABLE partners ADD COLUMN typed_notice text CHECK (char_length(typed_notice) BETWEEN 20 AND 2000);

-- Entries saved while typing, before (or without) submitting. Never exported to ad platforms,
-- deleted when the person submits (becomes a full lead), opts out, or after 30 days.
CREATE TABLE partial_leads (
  scan_id     uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  form_id     text NOT NULL CHECK (char_length(form_id) <= 120),
  email       text,             -- normalised, for opt-out matching
  phone       text,             -- E.164
  data        jsonb NOT NULL,   -- name, city, gender, age range, other answers
  notice_text text NOT NULL,    -- the disclosure shown on the form (evidence)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  PRIMARY KEY (scan_id, form_id)
);
CREATE INDEX partial_leads_expiry ON partial_leads (expires_at);
CREATE INDEX partial_leads_email ON partial_leads (email);
CREATE INDEX partial_leads_phone ON partial_leads (phone);
