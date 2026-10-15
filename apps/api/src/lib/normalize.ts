import { createHash } from 'node:crypto'
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/** Returns E.164 (e.g. +966501234567) or null when the number is not valid. */
export function normalizePhone(raw: string, defaultCountry: CountryCode = 'SA'): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry)
  return parsed?.isValid() ? parsed.number : null
}

/** Lowercase, strip punctuation/whitespace — the form Meta/Google expect before hashing names and cities. */
export function normalizeToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
  return v || null
}

export function cleanName(raw: string | null | undefined): string | null {
  const v = raw?.trim().replace(/\s+/g, ' ')
  return v ? v.slice(0, 100) : null
}
