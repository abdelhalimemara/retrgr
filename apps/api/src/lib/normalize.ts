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

/** Maps free-form gender answers (EN/AR, from any partner form) onto the stored enum. */
export function normalizeGender(raw: unknown): 'male' | 'female' | 'undisclosed' | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (/^(m|male|man|men|mr|ذكر|رجل)$/.test(v)) return 'male'
  if (/^(f|female|woman|women|mrs|ms|miss|أنثى|انثى|امرأة|إمرأة)$/.test(v)) return 'female'
  if (/prefer|undisclosed|other|none|n\/a|لا أفضل|أفضل عدم/.test(v)) return 'undisclosed'
  return null
}

const AGE_BANDS: [number, string][] = [[24, '18-24'], [34, '25-34'], [44, '35-44'], [54, '45-54'], [64, '55-64']]

/** Accepts an age range ('25-34'), an age ('29'), a birth year ('1995') or a birth date ('1995-04-02'). */
export function normalizeAgeRange(raw: unknown, now = new Date()): string | null {
  if (typeof raw === 'number') raw = String(raw)
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/[–—]/g, '-').replace(/\s/g, '')
  if (/^(18-24|25-34|35-44|45-54|55-64|65\+)$/.test(v)) return v
  let age: number | null = null
  const date = v.match(/^(\d{4})[-/.]\d{1,2}[-/.]\d{1,2}$/) ?? v.match(/^\d{1,2}[-/.]\d{1,2}[-/.](\d{4})$/)
  if (date) age = now.getUTCFullYear() - Number(date[1])
  else if (/^\d{4}$/.test(v)) age = now.getUTCFullYear() - Number(v)
  else if (/^\d{1,3}$/.test(v)) age = Number(v)
  if (age === null || age < 18 || age > 110) return null // under-18s are never profiled
  return AGE_BANDS.find(([max]) => age! <= max)?.[1] ?? '65+'
}

/** Lowercased scheme://host[:port], or null when the value isn't an http(s) origin. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const host = u.hostname.toLowerCase()
    // Real hostnames only: labels of letters/digits/hyphens, dotted (or localhost for testing).
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || (!host.includes('.') && host !== 'localhost')) return null
    return u.origin.toLowerCase()
  } catch {
    return null
  }
}
