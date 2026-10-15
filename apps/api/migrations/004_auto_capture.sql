-- Leads captured automatically from partner forms (collector v3).
ALTER TABLE touchpoints
  ADD COLUMN source    text NOT NULL DEFAULT 'hosted' CHECK (source IN ('hosted', 'auto')),
  ADD COLUMN form_id   text,
  -- Other answers on the partner's form (label → value). Secrets and government/financial
  -- identifiers are stripped before storage. Erased with the customer (cascade).
  ADD COLUMN form_data jsonb;
