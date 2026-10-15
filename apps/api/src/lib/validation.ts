import { promises as dns } from 'node:dns'
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { query } from '../db.js'

/**
 * Contact validation before audiences are synced/exported (higher match rates, fewer bounces).
 * Built-in tier needs no vendor: email syntax + disposable/role checks + MX lookup, phone line
 * type from libphonenumber's full metadata. Optional vendors, enabled by env vars:
 *   ZEROBOUNCE_API_KEY                      — mailbox-level email verification
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN  — phone line type + carrier (Lookup v2)
 * Both vendors process data outside KSA: enable them only with a DPA and PDPL transfer basis.
 */
export type EmailStatus = 'valid' | 'risky' | 'invalid' | 'unknown'
export type PhoneStatus = 'mobile' | 'fixed' | 'voip' | 'invalid' | 'unknown'

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com',
  'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'tempail.com', 'burnermail.io', 'moakt.com', 'spamgourmet.com', 'mailnesia.com',
])
const ROLE = /^(info|admin|support|sales|contact|hello|noreply|no-reply|webmaster|postmaster|marketing|office|test)@/i

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

/** true = domain can receive mail, false = it can't, null = DNS didn't answer (don't penalise). */
async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4000)
    if (mx.some((r) => r.exchange && r.exchange !== '.')) return true
    // RFC 7505 "null MX": the domain explicitly accepts no mail.
    if (mx.length && mx.every((r) => !r.exchange || r.exchange === '.')) return false
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') return null
    if (code === 'ENOTFOUND') return false
  }
  try {
    // RFC 5321: with no MX, mail goes to the domain's A/AAAA record.
    const a = await withTimeout(dns.resolve(domain), 4000)
    return a.length > 0
  } catch (err) {
    const code = (err as { code?: string }).code
    return code === 'ENODATA' || code === 'ENOTFOUND' ? false : null
  }
}

export async function checkEmail(email: string): Promise<{ status: EmailStatus; source: string }> {
  const key = process.env.ZEROBOUNCE_API_KEY
  if (key) {
    try {
      const res = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`)
      const j = (await res.json()) as { status?: string }
      const s = j.status ?? 'unknown'
      const status: EmailStatus =
        s === 'valid' ? 'valid' : ['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(s) ? 'invalid' : s === 'catch-all' ? 'risky' : 'unknown'
      return { status, source: 'zerobounce' }
    } catch (err) {
      console.error('zerobounce failed, falling back to built-in checks', err)
    }
  }
  const at = email.lastIndexOf('@')
  const domain = at > 0 ? email.slice(at + 1).toLowerCase() : ''
  if (!domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 'invalid', source: 'builtin' }
  const mail = await domainAcceptsMail(domain)
  if (mail === false) return { status: 'invalid', source: 'builtin' }
  if (DISPOSABLE.has(domain) || ROLE.test(email)) return { status: 'risky', source: 'builtin' }
  return { status: mail ? 'valid' : 'unknown', source: 'builtin' }
}

export async function checkPhone(e164: string): Promise<{ status: PhoneStatus; carrier: string | null; source: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (sid && token) {
    try {
      const res = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      })
      const j = (await res.json()) as { valid?: boolean; line_type_intelligence?: { type?: string; carrier_name?: string } }
      if (j.valid === false) return { status: 'invalid', carrier: null, source: 'twilio' }
      const t = j.line_type_intelligence?.type ?? ''
      const status: PhoneStatus = t === 'mobile' ? 'mobile' : t === 'landline' ? 'fixed' : /voip/i.test(t) ? 'voip' : 'unknown'
      return { status, carrier: j.line_type_intelligence?.carrier_name ?? null, source: 'twilio' }
    } catch (err) {
      console.error('twilio lookup failed, falling back to built-in checks', err)
    }
  }
  const p = parsePhoneNumberFromString(e164)
  if (!p?.isValid()) return { status: 'invalid', carrier: null, source: 'builtin' }
  const t = p.getType()
  const status: PhoneStatus =
    t === 'MOBILE' || t === 'FIXED_LINE_OR_MOBILE' ? 'mobile' : t === 'FIXED_LINE' ? 'fixed' : t === 'VOIP' ? 'voip' : 'unknown'
  // Since number portability, the carrier can't be read from the prefix — only a lookup vendor knows it.
  return { status, carrier: null, source: 'builtin' }
}

/** Validates contacts that were never checked (or not in 180 days). Returns counts. */
export async function validateContacts(limit = 200) {
  const rows = await query<{ id: string; email: string | null; phone: string | null; email_due: boolean; phone_due: boolean }>(
    `SELECT id, email, phone,
            email IS NOT NULL AND (email_checked_at IS NULL OR email_checked_at < now() - interval '180 days') AS email_due,
            phone IS NOT NULL AND (phone_checked_at IS NULL OR phone_checked_at < now() - interval '180 days') AS phone_due
       FROM customers
      WHERE (email IS NOT NULL AND (email_checked_at IS NULL OR email_checked_at < now() - interval '180 days'))
         OR (phone IS NOT NULL AND (phone_checked_at IS NULL OR phone_checked_at < now() - interval '180 days'))
      ORDER BY first_seen_at DESC LIMIT $1`,
    [limit],
  )
  const counts = { checked: 0, invalid_emails: 0, invalid_phones: 0 }
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(async (r) => {
        if (r.email_due && r.email) {
          const e = await checkEmail(r.email)
          if (e.status === 'invalid') counts.invalid_emails++
          await query('UPDATE customers SET email_status = $2, email_check_source = $3, email_checked_at = now() WHERE id = $1', [r.id, e.status, e.source])
        }
        if (r.phone_due && r.phone) {
          const ph = await checkPhone(r.phone)
          if (ph.status === 'invalid') counts.invalid_phones++
          await query(
            'UPDATE customers SET phone_status = $2, phone_carrier = $3, phone_check_source = $4, phone_checked_at = now() WHERE id = $1',
            [r.id, ph.status, ph.carrier, ph.source],
          )
        }
        counts.checked++
      }),
    )
  }
  return counts
}
