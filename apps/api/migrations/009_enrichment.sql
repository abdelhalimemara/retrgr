-- Offline IP enrichment (DB-IP Lite), device and dataLayer commerce signals on scans.
-- The IP address itself is never stored on scans — only what is derived from it.
ALTER TABLE scans
  ADD COLUMN ip_city        text,
  ADD COLUMN ip_region      text,
  ADD COLUMN ip_country     text,
  ADD COLUMN asn            int,
  ADD COLUMN carrier        text,
  ADD COLUMN network_type   text,          -- wifi / cellular when the browser reports it
  ADD COLUMN device_model   text,
  ADD COLUMN ecom_cart_adds int NOT NULL DEFAULT 0,
  ADD COLUMN ecom_purchases int NOT NULL DEFAULT 0,
  ADD COLUMN ecom_value     numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN last_purchase_at timestamptz;

-- Contact validation (built-in checks, or Twilio Lookup / ZeroBounce when configured).
ALTER TABLE customers
  ADD COLUMN email_status       text CHECK (email_status IN ('valid', 'risky', 'invalid', 'unknown')),
  ADD COLUMN email_check_source text,
  ADD COLUMN email_checked_at   timestamptz,
  ADD COLUMN phone_status       text CHECK (phone_status IN ('mobile', 'fixed', 'voip', 'invalid', 'unknown')),
  ADD COLUMN phone_carrier      text,
  ADD COLUMN phone_check_source text,
  ADD COLUMN phone_checked_at   timestamptz;
CREATE INDEX customers_unchecked ON customers (first_seen_at) WHERE email_checked_at IS NULL OR phone_checked_at IS NULL;

-- First-party insights per customer, derived only from data we already hold.
CREATE VIEW customer_insights AS
WITH s AS (
  SELECT s.*,
         CASE
           WHEN extract(hour FROM s.created_at AT TIME ZONE 'Asia/Riyadh') BETWEEN 5 AND 10 THEN 'morning'
           WHEN extract(hour FROM s.created_at AT TIME ZONE 'Asia/Riyadh') BETWEEN 11 AND 15 THEN 'midday'
           WHEN extract(hour FROM s.created_at AT TIME ZONE 'Asia/Riyadh') BETWEEN 16 AND 20 THEN 'evening'
           ELSE 'night'
         END AS daypart
    FROM scans s WHERE s.customer_id IS NOT NULL AND NOT s.is_bot
),
agg AS (
  SELECT c.id AS customer_id,
         count(s.id)::int AS scans,
         count(DISTINCT s.placement_id)::int AS placements,
         coalesce(round(avg(s.dwell_seconds)), 0)::int AS avg_dwell_seconds,
         coalesce(max(s.max_scroll_pct), 0)::int AS max_scroll_pct,
         coalesce(sum(s.cta_clicks), 0)::int AS cta_clicks,
         coalesce(sum(s.ecom_cart_adds), 0)::int AS cart_adds,
         coalesce(sum(s.ecom_purchases), 0)::int AS purchases,
         coalesce(sum(s.ecom_value), 0)::numeric(14, 2) AS purchase_value,
         max(s.last_purchase_at) AS last_purchase_at,
         mode() WITHIN GROUP (ORDER BY s.daypart) AS daypart,
         mode() WITHIN GROUP (ORDER BY lower(left(s.language, 2))) AS language,
         mode() WITHIN GROUP (ORDER BY s.carrier) AS carrier,
         mode() WITHIN GROUP (ORDER BY s.ip_city) AS ip_city,
         (array_agg(s.os ORDER BY s.created_at DESC))[1] AS os,
         (array_agg(s.device_model ORDER BY s.created_at DESC))[1] AS device_model,
         (array_agg(s.device_type ORDER BY s.created_at DESC))[1] AS device_type,
         c.email
    FROM customers c LEFT JOIN s ON s.customer_id = c.id
   GROUP BY c.id
)
SELECT a.customer_id, a.scans, a.placements, a.avg_dwell_seconds, a.max_scroll_pct, a.cta_clicks,
       a.cart_adds, a.purchases, a.purchase_value, a.last_purchase_at, a.daypart, a.language, a.carrier, a.ip_city,
       CASE
         WHEN a.device_type = 'desktop' THEN 'desktop'
         WHEN a.os ILIKE 'ios%' OR a.os ILIKE 'ipados%' THEN 'ios'
         WHEN a.device_model ~* '(SM-S9[0-9]{2}|SM-F[79][0-9]{2}|Galaxy (S2[2-9]|Z)|Pixel [7-9] Pro|Fold|Flip)' THEN 'android_premium'
         WHEN a.os ILIKE 'android%' THEN 'android'
         ELSE NULL
       END AS device_tier,
       CASE
         WHEN a.email IS NULL THEN NULL
         WHEN split_part(a.email, '@', 2) IN ('gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'outlook.sa', 'live.com',
           'msn.com', 'yahoo.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
           'yandex.com', 'mail.com', 'zoho.com') THEN 'personal'
         ELSE 'work'
       END AS email_type,
       -- Intent score 0–100: exposure (25) + breadth (10) + engagement (35) + commerce (30).
       LEAST(100,
         LEAST(25, 10 * a.scans)
         + LEAST(10, 5 * GREATEST(a.placements - 1, 0))
         + LEAST(15, a.avg_dwell_seconds / 4)
         + LEAST(10, a.max_scroll_pct / 10)
         + LEAST(10, 5 * a.cta_clicks)
         + CASE WHEN a.purchases > 0 THEN 30 WHEN a.cart_adds > 0 THEN 20 ELSE 0 END
       )::int AS intent_score
  FROM agg a;
