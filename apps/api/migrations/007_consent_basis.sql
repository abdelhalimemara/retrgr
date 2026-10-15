-- Per-partner legal basis, recorded honestly on every scan and consent.
ALTER TABLE partners
  -- consent: collector waits for the site's consent banner (Consent Mode analytics_storage).
  -- notice:  collector runs without a banner, relying on the site's privacy notice.
  ADD COLUMN analytics_basis text NOT NULL DEFAULT 'consent' CHECK (analytics_basis IN ('consent', 'notice')),
  ADD COLUMN privacy_notice_url text CHECK (privacy_notice_url ~ '^https?://' AND char_length(privacy_notice_url) <= 2000),
  -- checkbox:    marketing opt-in = a ticked consent checkbox on the form.
  -- form_notice: submitting a form that shows marketing_notice is the opt-in.
  ADD COLUMN marketing_basis text NOT NULL DEFAULT 'checkbox' CHECK (marketing_basis IN ('checkbox', 'form_notice')),
  ADD COLUMN marketing_notice text CHECK (char_length(marketing_notice) BETWEEN 20 AND 2000),
  ADD COLUMN notice_covers_ads boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT partners_notice_basis CHECK (analytics_basis = 'consent' OR privacy_notice_url IS NOT NULL),
  ADD CONSTRAINT partners_marketing_notice CHECK (marketing_basis = 'checkbox' OR marketing_notice IS NOT NULL);

-- How each consent was obtained, with the exact notice text when it was a form notice.
ALTER TABLE consents
  ADD COLUMN basis text NOT NULL DEFAULT 'checkbox' CHECK (basis IN ('checkbox', 'form_notice')),
  ADD COLUMN notice_text text;

-- Whether a scan ran after banner consent or under the partner's privacy notice.
ALTER TABLE scans ADD COLUMN analytics_basis text NOT NULL DEFAULT 'consent' CHECK (analytics_basis IN ('consent', 'notice'));
