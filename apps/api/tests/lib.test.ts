import { describe, expect, it } from 'vitest'
import { buildExportCsv, countCsvRows, type ExportRow } from '../src/lib/exporters.js'
import { normalizeEmail, normalizePhone, normalizeToken, sha256 } from '../src/lib/normalize.js'
import { captureSchema } from '../src/lib/schemas.js'
import { buildSegmentWhere } from '../src/lib/segments.js'

describe('normalize', () => {
  it('lowercases and validates email', () => {
    expect(normalizeEmail('  Sara.Ali@Example.COM ')).toBe('sara.ali@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
  })

  it('parses Saudi numbers to E.164', () => {
    expect(normalizePhone('050 123 4567')).toBe('+966501234567')
    expect(normalizePhone('+966 50 123 4567')).toBe('+966501234567')
    expect(normalizePhone('00966501234567')).toBe('+966501234567')
    expect(normalizePhone('12')).toBeNull()
  })

  it('strips punctuation and spaces from tokens', () => {
    expect(normalizeToken("Al-Qahtani O'Neil")).toBe('alqahtanioneil')
    expect(normalizeToken('  ')).toBeNull()
  })

  it('hashes with SHA-256 hex', () => {
    expect(sha256('test@example.com')).toBe('973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b')
  })
})

describe('captureSchema', () => {
  const base = { campaign: 'riyadh-q4', consent: { marketing: true, policy_version: 'v1' } }

  it('requires email or phone', () => {
    expect(captureSchema.safeParse(base).success).toBe(false)
    expect(captureSchema.safeParse({ ...base, phone: '0501234567' }).success).toBe(true)
  })

  it('rejects missing marketing consent', () => {
    const r = captureSchema.safeParse({ ...base, email: 'a@b.co', consent: { marketing: false, policy_version: 'v1' } })
    expect(r.success).toBe(false)
  })
})

describe('buildSegmentWhere', () => {
  it('always requires active marketing consent', () => {
    const { where, params } = buildSegmentWhere({})
    expect(where).toContain('withdrawn_at IS NULL')
    expect(params).toEqual([['marketing']])
  })

  it('parameterises every filter value', () => {
    const { where, params } = buildSegmentWhere({
      ageRanges: ['25-34'],
      cities: ["Riyadh'; DROP TABLE customers;--"],
      campaignIds: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'],
      capturedFrom: '2026-01-01',
      requireAdPersonalization: true,
    })
    expect(where).not.toContain('DROP')
    expect(params).toHaveLength(5)
    expect(params[0]).toEqual(['marketing', 'ad_personalization'])
    expect(where).toContain('t.campaign_id = ANY($4::uuid[])')
  })
})

describe('buildExportCsv', () => {
  const rows: ExportRow[] = [
    { email: 'sara@example.com', phone: '+966501234567', first_name: 'Sara', last_name: 'Al-Qahtani', city: 'Riyadh', country: 'SA', gender: 'female' },
    { email: null, phone: '+966551112222', first_name: null, last_name: null, city: null, country: 'SA', gender: null },
  ]

  it('meta: hashes every column with Meta normalisation', () => {
    const [header, first, second] = buildExportCsv('meta', rows).trimEnd().split('\n')
    expect(header).toBe('email,phone,fn,ln,ct,country,gen')
    const cells = first.split(',')
    expect(cells[0]).toBe(sha256('sara@example.com'))
    expect(cells[1]).toBe(sha256('966501234567'))
    expect(cells[3]).toBe(sha256('alqahtani'))
    expect(cells[6]).toBe(sha256('f'))
    expect(second.split(',')[0]).toBe('')
  })

  it('google: hashes phone in E.164 with plus', () => {
    const lines = buildExportCsv('google', rows).trimEnd().split('\n')
    expect(lines[0]).toBe('Email,Phone')
    expect(lines[1]).toBe(`${sha256('sara@example.com')},${sha256('+966501234567')}`)
  })

  it('tiktok/snapchat: one identifier per file, skipping rows without it', () => {
    const csv = buildExportCsv('tiktok', rows, 'email')
    expect(countCsvRows(csv)).toBe(1)
    expect(buildExportCsv('snapchat', rows, 'phone').split('\n')[2]).toBe(sha256('966551112222'))
  })

  it('never contains plaintext PII', () => {
    for (const p of ['meta', 'google', 'tiktok', 'snapchat'] as const) {
      const csv = buildExportCsv(p, rows)
      expect(csv).not.toMatch(/sara|966|riyadh/i)
    }
  })
})
