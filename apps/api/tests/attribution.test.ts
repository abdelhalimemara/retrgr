import { describe, expect, it } from 'vitest'
import { matchKeys } from '../src/lib/exporters.js'
import { sha256 } from '../src/lib/normalize.js'
import { isBot } from '../src/lib/request.js'
import { engagementSchema, scanSchema } from '../src/lib/schemas.js'
import { buildSegmentWhere } from '../src/lib/segments.js'

const ids = { scan_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', visitor_id: '11111111-1111-4111-8111-111111111111' }

describe('scanSchema', () => {
  const base = { ...ids, campaign: 'riyadh-q4', bid: 'kfr-01', consent: { analytics: true, policy_version: 'v1' } }

  it('accepts a consented scan and defaults scan_number', () => {
    const r = scanSchema.parse(base)
    expect(r.scan_number).toBe(1)
    expect(r.prior_bids).toEqual([])
  })

  it('rejects scans without analytics consent', () => {
    expect(scanSchema.safeParse({ ...base, consent: { analytics: false, policy_version: 'v1' } }).success).toBe(false)
  })

  it('rejects malformed billboard codes', () => {
    expect(scanSchema.safeParse({ ...base, bid: 'KFR 01; drop' }).success).toBe(false)
  })

  it('does not accept identity fields', () => {
    const r = scanSchema.parse({ ...base, email: 'a@b.co' } as object)
    expect(r).not.toHaveProperty('email')
  })
})

describe('engagementSchema', () => {
  it('bounds values', () => {
    expect(engagementSchema.safeParse({ scan_id: ids.scan_id, dwell_seconds: 10, max_scroll_pct: 120, cta_clicks: 0 }).success).toBe(false)
    expect(engagementSchema.safeParse({ scan_id: ids.scan_id, dwell_seconds: 10, max_scroll_pct: 60, cta_clicks: 2 }).success).toBe(true)
  })
})

describe('matchKeys', () => {
  it('produces both phone formats and normalised name/city hashes', () => {
    const k = matchKeys({ email: 'sara@example.com', phone: '+966501234567', first_name: 'Sara', city: 'Al Riyadh', gender: 'female' })
    expect(k.ph_e164).toBe(sha256('+966501234567'))
    expect(k.ph_digits).toBe(sha256('966501234567'))
    expect(k.fn).toBe(sha256('sara'))
    expect(k.ct).toBe(sha256('alriyadh'))
    expect(k.ge).toBe(sha256('f'))
    expect(k.country).toBe(sha256('sa'))
    expect(k.ln).toBeNull()
  })
})

describe('segment attribution filters', () => {
  it('filters by billboard and repeat exposure, parameterised', () => {
    const { where, params } = buildSegmentWhere({ placementIds: [ids.scan_id], minScans: 3 })
    expect(where).toContain('s.placement_id = ANY($2::uuid[])')
    expect(where).toContain('>= $3::int')
    expect(where).toContain('NOT s.is_bot')
    expect(params.slice(1)).toEqual([[ids.scan_id], 3])
  })
})

describe('isBot', () => {
  it('flags crawlers and missing UAs, passes phones', () => {
    expect(isBot(null)).toBe(true)
    expect(isBot('facebookexternalhit/1.1')).toBe(true)
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1')).toBe(false)
  })
})
