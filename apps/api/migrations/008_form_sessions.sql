-- Form abandonment analytics: one row per visit per form. Field NAMES only — typed values
-- of unsubmitted forms are never collected. Deleted with the scan (and so with the person).
CREATE TABLE form_sessions (
  scan_id       uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  form_id       text NOT NULL CHECK (char_length(form_id) <= 120),
  fields_total  int NOT NULL DEFAULT 0,
  fields_filled text[] NOT NULL DEFAULT '{}', -- names of fields that had a value when the visitor left/submitted
  last_field    text,                         -- last field focused (drop-off point when not submitted)
  submitted     boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_id, form_id)
);
CREATE INDEX form_sessions_form ON form_sessions (form_id);
