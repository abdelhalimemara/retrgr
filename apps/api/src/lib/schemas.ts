import { z } from 'zod'
import { normalizeAgeRange, normalizeGender, normalizeOrigin } from './normalize.js'

export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const
export const GENDERS = ['male', 'female', 'undisclosed'] as const
export const PLATFORMS = ['meta', 'google', 'tiktok', 'snapchat'] as const
export const PURPOSES = ['marketing', 'ad_personalization'] as const

const optText = (max = 200) => z.string().trim().max(max).optional().nullable()

/** Context gathered by the GTM collector script on the landing page. */
export const captureContextSchema = z
  .object({
    utm_source: optText(),
    utm_medium: optText(),
    utm_campaign: optText(),
    utm_content: optText(),
    utm_term: optText(),
    fbclid: optText(500),
    gclid: optText(500),
    ttclid: optText(500),
    sccid: optText(500),
    landing_url: optText(2000),
    referrer: optText(2000),
    device_type: z.enum(['mobile', 'tablet', 'desktop']).optional().nullable(),
    language: optText(35),
    timezone: optText(64),
  })
  .partial()

const slug = z.string().regex(/^[a-z0-9-]{3,64}$/)
/** Public partner key from the collector snippet (data-partner). */
const partnerKey = z.string().regex(/^[a-z0-9]{6,32}$/)
const hasTarget = (v: { campaign?: string | null; partner?: string | null; bid?: string | null }) =>
  !!(v.campaign || v.partner || v.bid)
const placementCode = z.string().regex(/^[a-z0-9-]{2,40}$/)
const smallInt = z.number().int().min(0).max(1_000_000).optional().nullable()

/** Anonymous scan, sent once analytics consent is granted. No direct identifiers. */
export const scanSchema = z.object({
  scan_id: z.uuid(),
  visitor_id: z.uuid(),
  campaign: slug.optional().nullable(),
  partner: partnerKey.optional().nullable(),
  bid: placementCode.optional().nullable(),
  offer_variant: optText(40),
  scan_number: z.number().int().min(1).max(10_000).default(1),
  prior_bids: z.array(placementCode).max(50).default([]),
  consent: z.object({ analytics: z.literal(true), policy_version: z.string().max(32) }),
  context: captureContextSchema.default({}),
  device: z
    .object({
      os: optText(40),
      os_version: optText(40),
      model: optText(80),
      browser: optText(200),
      screen_w: smallInt,
      screen_h: smallInt,
      viewport_w: smallInt,
      viewport_h: smallInt,
      pixel_ratio: z.number().min(0).max(10).optional().nullable(),
      orientation: optText(40),
      connection_type: optText(20),
      languages: optText(200),
      touch_points: smallInt,
    })
    .partial()
    .default({}),
}).refine(hasTarget, { message: 'campaign, partner or bid is required' })

export const engagementSchema = z.object({
  scan_id: z.uuid(),
  dwell_seconds: z.number().int().min(0).max(86_400),
  max_scroll_pct: z.number().int().min(0).max(100),
  cta_clicks: z.number().int().min(0).max(10_000),
  scan_to_action_ms: smallInt,
  form_started: z.boolean().default(false),
  form_submitted: z.boolean().default(false),
  last_field: z.string().max(40).optional().nullable(), // field-level drop-off
})

export const captureSchema = z
  .object({
    campaign: slug.optional().nullable(),
    partner: partnerKey.optional().nullable(),
    scan_id: z.uuid().optional().nullable(),
    visitor_id: z.uuid().optional().nullable(),
    bid: placementCode.optional().nullable(),
    email: z.string().trim().max(254).optional().nullable(),
    phone: z.string().trim().max(32).optional().nullable(),
    first_name: optText(100),
    last_name: optText(100),
    // Auto-captured partner forms answer these freely ("Male", "ذكر", "29", "1995-04-02"…);
    // anything that can't be mapped is dropped rather than rejected.
    age_range: z.unknown().optional().transform((v) => normalizeAgeRange(v)),
    gender: z.unknown().optional().transform((v) => normalizeGender(v)),
    city: optText(100),
    // Other answers on the partner's form (label → value), kept on the touchpoint.
    extra: z.record(z.string().max(80), z.string().max(500)).optional().nullable()
      .refine((v) => !v || Object.keys(v).length <= 30, 'Too many fields'),
    source: z.enum(['hosted', 'auto']).default('hosted'),
    form_id: optText(120),
    consent: z.object({
      analytics: z.boolean().optional(),
      // Only an explicit, affirmative opt-in counts. Without it the lead is stored
      // but never exported or sent to ad platforms.
      marketing: z.boolean().default(false),
      ad_personalization: z.boolean().default(false),
      policy_version: z.string().max(32),
    }),
    context: captureContextSchema.default({}),
  })
  .refine((v) => v.email || v.phone, { message: 'Email or phone is required', path: ['email'] })
  .refine(hasTarget, { message: 'campaign, partner or bid is required' })

/** dataLayer pushes observed on the landing page, batched by the collector. */
export const dataLayerSchema = z.object({
  scan_id: z.uuid(),
  visitor_id: z.uuid(),
  campaign: slug.optional().nullable(),
  partner: partnerKey.optional().nullable(),
  consent: z.object({ analytics: z.literal(true) }),
  events: z
    .array(
      z.object({
        seq: z.number().int().min(0).max(100_000),
        ts: z.number().int().min(0),
        event: z.string().max(120).optional().nullable(),
        data: z.unknown(),
      }),
    )
    .min(1)
    .max(50),
})

export const withdrawSchema = z
  .object({ email: z.string().max(254).optional(), phone: z.string().max(32).optional() })
  .refine((v) => v.email || v.phone, { message: 'Email or phone is required' })

export const partnerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Websites allowed to run this partner's collector, normalised to origins.
  allowed_origins: z
    .array(z.string().trim().max(200))
    .max(50)
    .default([])
    .transform((list, ctx) => {
      const out = new Set<string>()
      for (const raw of list.filter(Boolean)) {
        const o = normalizeOrigin(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
        if (!o) ctx.addIssue({ code: 'custom', message: `Not a website address: ${raw}` })
        else out.add(o)
      }
      return [...out]
    }),
  contact_email: z.email().optional().nullable(),
  notes: optText(2000),
})

export const campaignSchema = z.object({
  partner_id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/, 'Lowercase letters, numbers and dashes only'),
  location: optText(),
  city: optText(100),
  starts_on: z.iso.date().optional().nullable(),
  ends_on: z.iso.date().optional().nullable(),
  status: z.enum(['draft', 'active', 'ended']).default('draft'),
  headline: optText(200),
  consent_version: z.string().max(32).default('v1'),
})

export const placementSchema = z.object({
  campaign_id: z.uuid(),
  code: placementCode,
  name: z.string().trim().min(1).max(200),
  format: optText(80),
  city: optText(100),
  district: optText(100),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  cost_sar: z.number().min(0).max(1e10).optional().nullable(),
})

export const segmentFiltersSchema = z.object({
  campaignIds: z.array(z.uuid()).max(200).optional(),
  placementIds: z.array(z.uuid()).max(500).optional(),
  minScans: z.number().int().min(2).max(100).optional(), // repeat-exposure audiences
  partnerIds: z.array(z.uuid()).max(200).optional(),
  ageRanges: z.array(z.enum(AGE_RANGES)).optional(),
  genders: z.array(z.enum(GENDERS)).optional(),
  cities: z.array(z.string().max(100)).max(100).optional(),
  capturedFrom: z.iso.date().optional(),
  capturedTo: z.iso.date().optional(),
  requireAdPersonalization: z.boolean().optional(),
})
export type SegmentFilters = z.infer<typeof segmentFiltersSchema>

export const segmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optText(1000),
  filters: segmentFiltersSchema,
})

export const exportSchema = z.object({
  segment_id: z.uuid(),
  platform: z.enum(PLATFORMS),
  identifier: z.enum(['email', 'phone']).default('email'),
})
