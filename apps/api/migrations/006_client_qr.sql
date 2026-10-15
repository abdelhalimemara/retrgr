-- Client-owned QR codes and landing pages.
ALTER TABLE placements
  -- Rule mapping a client's own QR URL to this billboard, e.g. utm_content=kfr or path /riyadh-offer.
  ADD COLUMN match_param    text CHECK (match_param ~ '^[A-Za-z0-9_.-]{1,64}$'),
  ADD COLUMN match_value    text CHECK (char_length(match_value) <= 200),
  ADD COLUMN match_path     text CHECK (match_path ~ '^/' AND char_length(match_path) <= 300),
  -- Client landing page for redirect links (/q/:code → destination + bid).
  ADD COLUMN destination_url text CHECK (destination_url ~ '^https?://' AND char_length(destination_url) <= 2000),
  ADD CONSTRAINT placements_match_pair CHECK ((match_param IS NULL) = (match_value IS NULL));

-- QR opens through redirect links: a plain daily counter per billboard (no IP, no device, no cookies),
-- so it needs no consent and shows how many people scanned versus how many consented.
CREATE TABLE qr_opens (
  placement_id uuid NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  day          date NOT NULL,
  opens        int  NOT NULL DEFAULT 0,
  PRIMARY KEY (placement_id, day)
);
