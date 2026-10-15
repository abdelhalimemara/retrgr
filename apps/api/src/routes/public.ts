import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { config } from '../config.js'
import { query, withTransaction } from '../db.js'
import { cleanName, normalizeEmail, normalizePhone, sha256 } from '../lib/normalize.js'
import { matchKeys } from '../lib/exporters.js'
import { clientIp, clientUserAgent, rateLimit, requestOrigin, viaSgtm } from '../lib/request.js'
import { resolveTarget } from '../lib/targets.js'
import { captureSchema, withdrawSchema } from '../lib/schemas.js'
import { cleanFormExtras } from '../lib/scrub.js'

export const publicRoutes = new Hono()

publicRoutes.use('/capture', rateLimit({ windowMs: 60_000, max: 10 }))
publicRoutes.use('/withdraw', rateLimit({ windowMs: 60_000, max: 5 }))

/** Campaign details for the hosted consent page. Only active campaigns are visible. */
publicRoutes.get('/campaigns/:slug', async (c) => {
  const [campaign] = await query(
    `SELECT cp.slug, cp.name, cp.headline, cp.consent_version, p.name AS partner_name
       FROM campaigns cp JOIN partners p ON p.id = cp.partner_id
      WHERE cp.slug = $1 AND cp.status = 'active'`,
    [c.req.param('slug')],
  )
  if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' })
  return c.json(campaign)
})

/**
 * Consent capture. Upserts the customer on hashed email/phone so repeat scans
 * from different OOH placements consolidate into one clean record.
 */
publicRoutes.post('/capture', async (c) => {
  const body = captureSchema.parse(await c.req.json())

  const email = body.email ? normalizeEmail(body.email) : null
  const phone = body.phone ? normalizePhone(body.phone, config.defaultCountry) : null
  if (body.email && !email) throw new HTTPException(400, { message: 'Invalid email' })
  if (body.phone && !phone) throw new HTTPException(400, { message: 'Invalid phone number' })

  const target = await resolveTarget(body, requestOrigin(c))
  if (!target) throw new HTTPException(404, { message: 'Campaign not found' })
  const campaign = { id: target.campaign_id, city: target.city, placement_id: target.placement_id }

  const emailHash = email ? sha256(email) : null
  const phoneHash = phone ? sha256(phone) : null
  // Ad personalisation only counts on top of marketing consent.
  // How the opt-in was given, decided server-side from the partner's settings:
  //  - checkbox:    a ticked consent checkbox (partner form or our hosted page);
  //  - form_notice: the partner shows a marketing notice by the form, so submitting it is the
  //                 opt-in. The exact notice text is stored with the consent as evidence.
  // The notice sits on every form of a form_notice partner, so it applies to all their captured
  // forms; ticked checkboxes can only add to it (e.g. an ads box when the notice doesn't cover ads).
  const viaNotice = body.source === 'auto' && target.marketing_basis === 'form_notice'
  const ticked = body.consent.marketing
  const marketing = ticked || viaNotice
  const adConsent = (viaNotice && target.notice_covers_ads) || (ticked && body.consent.ad_personalization)
  const purposes = marketing ? ['marketing', ...(adConsent ? ['ad_personalization'] : [])] : []
  const basis = viaNotice ? 'form_notice' : 'checkbox'
  const extra = cleanFormExtras(body.extra)

  const save = () => withTransaction(async (db) => {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM customers WHERE email_sha256 = $1 OR phone_sha256 = $2 ORDER BY first_seen_at LIMIT 1`,
      [emailHash, phoneHash],
    )

    let customerId: string
    const fields = [
      cleanName(body.first_name),
      cleanName(body.last_name),
      body.age_range ?? null,
      body.gender ?? null,
      cleanName(body.city) ?? campaign.city,
    ]

    if (existing.rows[0]) {
      customerId = existing.rows[0].id
      // Fill gaps and refresh self-declared attributes; never blank out known values.
      // Identifiers are only added if not already claimed by another record.
      await db.query(
        `UPDATE customers SET
           email = COALESCE(email, CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE email_sha256 = $7) THEN $6 END),
           email_sha256 = COALESCE(email_sha256, CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE email_sha256 = $7) THEN $7 END),
           phone = COALESCE(phone, CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE phone_sha256 = $9) THEN $8 END),
           phone_sha256 = COALESCE(phone_sha256, CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE phone_sha256 = $9) THEN $9 END),
           first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           age_range = COALESCE($3, age_range),
           gender = COALESCE($4, gender),
           city = COALESCE($5, city),
           last_seen_at = now()
         WHERE id = $10`,
        [...fields, email, emailHash, phone, phoneHash, customerId],
      )
    } else {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO customers (first_name, last_name, age_range, gender, city, email, email_sha256, phone, phone_sha256, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [...fields, email, emailHash, phone, phoneHash, config.defaultCountry],
      )
      customerId = inserted.rows[0].id
    }

    // No opt-in → no consent row: the lead is kept but excluded from every segment and export.
    if (purposes.length) {
      await db.query(
        `INSERT INTO consents (customer_id, campaign_id, policy_version, purposes, ip_address, user_agent, basis, notice_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          customerId,
          campaign.id,
          body.consent.policy_version,
          purposes,
          clientIp(c),
          clientUserAgent(c),
          basis,
          viaNotice ? target.marketing_notice : null,
        ],
      )
    }

    // Attach this scan, and earlier anonymous scans from the same device, to the person.
    if (body.scan_id || body.visitor_id) {
      await db.query(
        `UPDATE scans SET customer_id = $1 WHERE customer_id IS NULL AND (id = $2 OR visitor_id = $3)`,
        [customerId, body.scan_id ?? null, body.visitor_id ?? null],
      )
    }
    const linkedScan = body.scan_id
      ? (await db.query('SELECT id FROM scans WHERE id = $1', [body.scan_id])).rows[0]?.id ?? null
      : null

    const ctx = body.context
    await db.query(
      `INSERT INTO touchpoints (customer_id, campaign_id, placement_id, scan_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         fbclid, gclid, ttclid, sccid, landing_url, referrer, device_type, language, timezone, source, form_id, form_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        customerId,
        campaign.id,
        campaign.placement_id,
        linkedScan,
        ctx.utm_source ?? null,
        ctx.utm_medium ?? null,
        ctx.utm_campaign ?? null,
        ctx.utm_content ?? null,
        ctx.utm_term ?? null,
        ctx.fbclid ?? null,
        ctx.gclid ?? null,
        ctx.ttclid ?? null,
        ctx.sccid ?? null,
        ctx.landing_url ?? null,
        ctx.referrer ?? null,
        ctx.device_type ?? null,
        ctx.language ?? null,
        ctx.timezone ?? null,
        body.source,
        body.form_id ?? null,
        extra,
      ],
    )
  })

  // Two simultaneous first-time submissions for the same person race on the
  // unique hash index; the retry finds the row the other request inserted.
  await save().catch((err) => ((err as { code?: string }).code === '23505' ? save() : Promise.reject(err)))

  // The sGTM Retrgtr Client gets hashed match keys to populate user_data for
  // CAPI / Customer Match tags — only with ad-personalisation consent, never to browsers.
  if (viaSgtm(c) && adConsent) {
    return c.json({ ok: true, marketing_consent: marketing, ad_personalization: adConsent, match_keys: matchKeys({ email, phone, first_name: body.first_name, last_name: body.last_name, city: body.city, gender: body.gender, country: config.defaultCountry }) }, 201)
  }
  return c.json({ ok: true, marketing_consent: marketing, ad_personalization: adConsent }, 201)
})

/**
 * Consent withdrawal. Always answers the same way so the endpoint can't be used
 * to probe whether someone is in the database.
 */
publicRoutes.post('/withdraw', async (c) => {
  const body = withdrawSchema.parse(await c.req.json())
  const email = body.email ? normalizeEmail(body.email) : null
  const phone = body.phone ? normalizePhone(body.phone, config.defaultCountry) : null

  await query(
    `UPDATE consents SET withdrawn_at = now()
      WHERE withdrawn_at IS NULL
        AND customer_id IN (SELECT id FROM customers WHERE email_sha256 = $1 OR phone_sha256 = $2)`,
    [email ? sha256(email) : null, phone ? sha256(phone) : null],
  )
  return c.json({ ok: true })
})
