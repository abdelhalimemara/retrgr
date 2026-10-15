import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { latinName } from '../src/lib/arabic-names.js'
import { buildExportCsv, exportedPeople, type ExportRow } from '../src/lib/exporters.js'
import { lookupIp, operatorName } from '../src/lib/geoip.js'
import { sha256 } from '../src/lib/normalize.js'
import { buildSegmentWhere } from '../src/lib/segments.js'
import { checkEmail, checkPhone } from '../src/lib/validation.js'
import { commerceOf } from '../src/routes/ingest.js'

describe('IP enrichment', () => {
  it('names Saudi operators from ASN or network owner', () => {
    expect(operatorName('Saudi Telecom Company JSC', 25019)).toBe('STC')
    expect(operatorName('Mobile Telecommunication Company Saudi Arabia Joint-Stock company')).toBe('Zain')
    expect(operatorName('Etihad Etisalat, a joint stock company')).toBe('Mobily')
    expect(operatorName('Google LLC', 15169)).toBe('Google LLC')
    expect(operatorName(null)).toBeNull()
  })
  it.runIf(existsSync('geo/dbip-city-lite.mmdb'))('resolves a Saudi IP offline', async () => {
    const r = await lookupIp('2.88.0.1')
    expect(r.ip_country).toBe('SA')
    expect(r.carrier).toBe('STC')
    expect(await lookupIp('192.168.1.1')).toEqual({ ip_city: null, ip_region: null, ip_country: null, asn: null, carrier: null })
  })
})

describe('dataLayer commerce', () => {
  it('reads GA4 ecommerce pushes and gtag events', () => {
    expect(commerceOf('purchase', { event: 'purchase', ecommerce: { value: 250, currency: 'SAR' } })).toEqual({ kind: 'purchase', value: 250 })
    expect(commerceOf('add_to_cart', { gtag: ['event', 'add_to_cart', { value: 99 }] })).toEqual({ kind: 'cart', value: 99 })
    expect(commerceOf('purchase', { ecommerce: { value: 'abc' } })).toEqual({ kind: 'purchase', value: 0 })
    expect(commerceOf('view_item', { ecommerce: { value: 10 } })).toBeNull()
  })
})

describe('Arabic name variants', () => {
  it('maps common names, tolerating spacing and hamza forms', () => {
    expect(latinName('محمد', 'first')).toBe('mohammed')
    expect(latinName('عبد الله', 'first')).toBe('abdullah')
    expect(latinName('أحمد', 'first')).toBe('ahmed')
    expect(latinName('القحطاني', 'family')).toBe('alqahtani')
    expect(latinName('قحطاني', 'family')).toBe('alqahtani')
    expect(latinName('Sara', 'first')).toBeNull()
    expect(latinName('زبرجد', 'first')).toBeNull()
  })
})

describe('validated exports', () => {
  const base: ExportRow = { email: 'a@b.co', phone: '+966501234567', first_name: 'سارة', last_name: 'القحطاني', city: 'Riyadh', country: 'SA', gender: 'female' }
  it('adds a Latin-name row for Meta only', () => {
    const meta = buildExportCsv('meta', [base]).trim().split('\n')
    expect(meta).toHaveLength(3)
    expect(meta[2]).toContain(sha256('sara'))
    expect(meta[2]).toContain(sha256('alqahtani'))
    expect(exportedPeople('meta', [base])).toBe(1)
    expect(buildExportCsv('google', [base]).trim().split('\n')).toHaveLength(2)
  })
  it('drops invalid identifiers and people with none left', () => {
    const rows: ExportRow[] = [
      { ...base, first_name: null, last_name: null, email_status: 'invalid' },
      { ...base, first_name: null, last_name: null, email: 'x@y.co', phone: null, email_status: 'invalid' },
    ]
    const csv = buildExportCsv('meta', rows)
    expect(csv).not.toContain(sha256('a@b.co'))
    expect(csv.trim().split('\n')).toHaveLength(2)
    expect(exportedPeople('meta', rows)).toBe(1)
    expect(exportedPeople('tiktok', rows, 'email')).toBe(0)
  })
})

describe('contact validation (built-in)', () => {
  it('classifies Saudi numbers by line type', async () => {
    expect((await checkPhone('+966501234567')).status).toBe('mobile')
    expect((await checkPhone('+966112345678')).status).toBe('fixed')
    expect((await checkPhone('+96650')).status).toBe('invalid')
  })
  it('rejects malformed emails without any network call', async () => {
    expect((await checkEmail('not-an-email')).status).toBe('invalid')
    expect((await checkEmail('a@b')).status).toBe('invalid')
  })
})

describe('insight segments', () => {
  it('filters through the insights view, parameterised, and always keeps the consent gate', () => {
    const { where, params } = buildSegmentWhere({ minIntent: 50, carriers: ['STC'], commerce: 'cart_abandoners', validContactsOnly: true })
    expect(where).toContain('customer_insights')
    expect(where).toContain('i.cart_adds > 0 AND i.purchases = 0')
    expect(where).toContain("email_status IS DISTINCT FROM 'invalid'")
    expect(where).toContain('withdrawn_at IS NULL')
    expect(params).toEqual([['marketing'], 50, ['STC']])
  })
})
