/**
 * Scrubbing for data captured automatically from partner pages.
 *
 * - Form fields: anything that looks like a secret or a government/financial
 *   identifier is dropped entirely (never stored anywhere).
 * - dataLayer payloads go to the pseudonymous BigQuery store, so on top of that,
 *   personal values (emails, phones, names, addresses) are redacted there too.
 */
const SENSITIVE_KEY = /pass|pwd|secret|token|csrf|captcha|(^|[_-])otp($|[_-])|(^|[_-])pin($|[_-])|cvv|cvc|card|iban|account.?(no|num)|routing|ssn|national.?id|iqama|passport|(^|[_-])id.?(no|num)|هوية|إقامة|اقامة|جواز|بطاقة|كلمة.?المرور/i
const PERSONAL_KEY = /e.?mail|phone|mobile|(^|[_-])tel($|[_-])|msisdn|whats.?app|address|street|postal|zip|birth|dob|user_data|بريد|جوال|هاتف|اسم|عنوان/i
// Person names only; product/page/promotion names (item_name, page_name…) are kept.
const PERSON_NAME = /^(name|fname|lname|surname|(first|last|full|given|family|middle|user|customer|contact|display)[_\s-]?name)$/i
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/i
const PHONE = /(?:\+|00)?\d[\d\s().-]{7,}\d/
const SAUDI_ID = /^[12]\d{9}$/ // national ID / Iqama

function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

/** True for values that must never be stored: card numbers, national IDs / Iqama. */
export function isSensitiveValue(value: string) {
  const digits = value.replace(/[\s-]/g, '')
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return true
  return SAUDI_ID.test(digits)
}

export const isSensitiveKey = (key: string) => SENSITIVE_KEY.test(key)

/** Keeps extra (non-identifier) form answers, minus secrets and government/financial IDs. */
export function cleanFormExtras(extra: Record<string, string> | null | undefined) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(extra ?? {})) {
    const key = k.trim().slice(0, 80)
    const val = String(v).trim().slice(0, 500)
    if (!key || !val || isSensitiveKey(key) || isSensitiveValue(val)) continue
    out[key] = val
  }
  return Object.keys(out).length ? out : null
}

const REDACTED = '[redacted]'

/** Deep-copies a dataLayer value, redacting personal and sensitive data. Bounded in size and depth. */
export function scrubDataLayer(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const v = value.slice(0, 500)
    return EMAIL.test(v) || isSensitiveValue(v) || (PHONE.test(v) && v.replace(/\D/g, '').length >= 9) ? REDACTED : v
  }
  if (depth >= 5) return null
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDataLayer(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (isSensitiveKey(k) || PERSONAL_KEY.test(k) || PERSON_NAME.test(k)) {
        if (v !== undefined && v !== null && v !== '') out[k] = REDACTED
        continue
      }
      out[k.slice(0, 100)] = scrubDataLayer(v, depth + 1)
    }
    return out
  }
  return null
}
