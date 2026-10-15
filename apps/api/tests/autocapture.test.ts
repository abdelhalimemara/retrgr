import { describe, expect, it } from 'vitest'
import { normalizeAgeRange, normalizeGender } from '../src/lib/normalize.js'
import { cleanFormExtras, isSensitiveValue, scrubDataLayer } from '../src/lib/scrub.js'

describe('normalizeGender', () => {
  it('maps English and Arabic answers', () => {
    expect(normalizeGender('Male')).toBe('male')
    expect(normalizeGender('F')).toBe('female')
    expect(normalizeGender('أنثى')).toBe('female')
    expect(normalizeGender('Prefer not to say')).toBe('undisclosed')
    expect(normalizeGender('maybe')).toBeNull()
  })
})

describe('normalizeAgeRange', () => {
  const now = new Date('2026-10-15T00:00:00Z')
  it('accepts ranges, ages, birth years and birth dates', () => {
    expect(normalizeAgeRange('25–34', now)).toBe('25-34')
    expect(normalizeAgeRange('41', now)).toBe('35-44')
    expect(normalizeAgeRange('1990', now)).toBe('35-44')
    expect(normalizeAgeRange('1960-02-01', now)).toBe('65+')
    expect(normalizeAgeRange('02/01/2001', now)).toBe('25-34')
  })
  it('never profiles minors or nonsense', () => {
    expect(normalizeAgeRange('16', now)).toBeNull()
    expect(normalizeAgeRange('2012', now)).toBeNull()
    expect(normalizeAgeRange('abc', now)).toBeNull()
  })
})

describe('sensitive values', () => {
  it('detects card numbers and Saudi national IDs / Iqama', () => {
    expect(isSensitiveValue('4111 1111 1111 1111')).toBe(true)
    expect(isSensitiveValue('1012345678')).toBe(true)
    expect(isSensitiveValue('2412345678')).toBe(true)
    expect(isSensitiveValue('0501234567')).toBe(false) // a mobile number, not an ID
    expect(isSensitiveValue('Riyadh')).toBe(false)
  })

  it('drops secrets and IDs from extra form answers', () => {
    expect(
      cleanFormExtras({ 'Preferred branch': 'Olaya', password: 'x', 'National ID': '1012345678', notes: '4111111111111111' }),
    ).toEqual({ 'Preferred branch': 'Olaya' })
    expect(cleanFormExtras({ otp: '123456' })).toBeNull()
  })
})

describe('scrubDataLayer', () => {
  it('keeps ecommerce data and redacts personal data', () => {
    const out = scrubDataLayer({
      event: 'purchase',
      ecommerce: { value: 250, currency: 'SAR', items: [{ item_name: 'Abaya', item_id: 'A1' }] },
      user_data: { email: 'a@b.co', phone_number: '+966501234567' },
      customer_email: 'x@y.com',
      first_name: 'Sara',
      note: 'contact me at sara@example.com',
      phone_text: '+966 50 123 4567',
      page_type: 'checkout',
      card_number: '4111111111111111',
    }) as Record<string, unknown>
    expect(out.ecommerce).toEqual({ value: 250, currency: 'SAR', items: [{ item_name: 'Abaya', item_id: 'A1' }] })
    expect(out.page_type).toBe('checkout')
    for (const k of ['user_data', 'customer_email', 'first_name', 'note', 'phone_text', 'card_number']) expect(out[k]).toBe('[redacted]')
  })

  it('redacts phone-like strings and bounds depth', () => {
    expect(scrubDataLayer({ ref: '0501234567' })).toEqual({ ref: '[redacted]' })
    expect(scrubDataLayer({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual({ a: { b: { c: { d: { e: null } } } } })
  })
})
