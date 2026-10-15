import { describe, expect, it } from 'vitest'
import { normalizeOrigin } from '../src/lib/normalize.js'
import { captureSchema, partnerSchema, placementSchema, scanSchema } from '../src/lib/schemas.js'
import { originAllowed } from '../src/lib/targets.js'

describe('partner websites', () => {
  it('normalises origins', () => {
    expect(normalizeOrigin('https://Brand.SA/offers?x=1')).toBe('https://brand.sa')
    expect(normalizeOrigin('http://localhost:5174')).toBe('http://localhost:5174')
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull()
    expect(normalizeOrigin('not a url')).toBeNull()
  })

  it('accepts bare domains in the partner form and dedupes them', () => {
    const p = partnerSchema.parse({ name: 'Brand', allowed_origins: ['brand.sa', 'https://brand.sa/', 'www.brand.sa'] })
    expect(p.allowed_origins).toEqual(['https://brand.sa', 'https://www.brand.sa'])
    expect(partnerSchema.safeParse({ name: 'B', allowed_origins: ['ht!tp://??'] }).success).toBe(false)
  })

  it('only restricts partners that registered websites', () => {
    expect(originAllowed([], 'https://anything.com')).toBe(true)
    expect(originAllowed(['https://brand.sa'], 'https://brand.sa')).toBe(true)
    expect(originAllowed(['https://brand.sa'], 'https://evil.com')).toBe(false)
    expect(originAllowed(['https://brand.sa'], null)).toBe(false)
  })
})

describe('partner-level snippet payloads', () => {
  const scan = {
    scan_id: '00000000-0000-4000-8000-000000000001',
    visitor_id: '00000000-0000-4000-8000-000000000002',
    consent: { analytics: true, policy_version: 'v1' },
  }
  it('accepts a partner key or a bid instead of a campaign', () => {
    expect(scanSchema.safeParse({ ...scan, partner: 'abc123def456' }).success).toBe(true)
    expect(scanSchema.safeParse({ ...scan, bid: 'kfr-01' }).success).toBe(true)
    expect(scanSchema.safeParse(scan).success).toBe(false)
    expect(scanSchema.safeParse({ ...scan, partner: 'Bad Key!' }).success).toBe(false)
  })
  it('requires a target on leads too', () => {
    const lead = { email: 'a@b.co', consent: { marketing: true, policy_version: 'v1' } }
    expect(captureSchema.safeParse({ ...lead, partner: 'abc123def456' }).success).toBe(true)
    expect(captureSchema.safeParse(lead).success).toBe(false)
  })
})

describe('client-owned QR placements', () => {
  const base = { campaign_id: '00000000-0000-4000-8000-000000000001', code: 'mall-03', name: 'Mall entrance' }
  it('accepts a parameter rule, a path rule or a redirect destination', () => {
    expect(placementSchema.safeParse({ ...base, match_param: 'utm_content', match_value: 'mall3' }).success).toBe(true)
    expect(placementSchema.safeParse({ ...base, match_path: '/riyadh-offer' }).success).toBe(true)
    expect(placementSchema.safeParse({ ...base, destination_url: 'https://brand.sa/offer?x=1' }).success).toBe(true)
  })
  it('rejects half rules, bad paths and non-web destinations', () => {
    expect(placementSchema.safeParse({ ...base, match_param: 'utm_content' }).success).toBe(false)
    expect(placementSchema.safeParse({ ...base, match_path: 'riyadh' }).success).toBe(false)
    expect(placementSchema.safeParse({ ...base, destination_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(placementSchema.safeParse({ ...base, match_param: 'bad key!', match_value: 'x' }).success).toBe(false)
  })
})
