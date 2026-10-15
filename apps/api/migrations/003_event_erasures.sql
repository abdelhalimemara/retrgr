-- BigQuery refuses DML on rows still in the streaming buffer (~up to 90 min after
-- insert), so erasure of a person's pseudonymous events is queued here and retried
-- by the retrgtr-erasures job until it succeeds. Holds scan ids only, no PII.
CREATE TABLE event_erasures (
  scan_id       uuid PRIMARY KEY,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text
);
