import { normalizeToken, sha256 } from './normalize.js'

export type Platform = 'meta' | 'google' | 'tiktok' | 'snapchat'
export type Identifier = 'email' | 'phone'

export interface ExportRow {
  email: string | null
  phone: string | null // E.164
  first_name: string | null
  last_name: string | null
  city: string | null
  country: string
  gender: string | null
}

/** Platforms won't serve to lists below these sizes; surfaced as a warning in the UI. */
export const MIN_AUDIENCE: Record<Platform, number> = { meta: 100, google: 1000, tiktok: 1000, snapchat: 1000 }

const h = (v: string | null | undefined) => (v ? sha256(v) : '')
const digits = (e164: string | null) => (e164 ? e164.replace(/\D/g, '') : null)
const csvLine = (cells: string[]) => cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')

/**
 * Builds a Customer Match / Custom Audience CSV with identifiers SHA-256 hashed
 * per each platform's normalisation rules, so no plaintext PII leaves the platform.
 * Column layouts follow each platform's upload template — re-check them against the
 * current templates if a platform rejects a file.
 */
export function buildExportCsv(platform: Platform, rows: ExportRow[], identifier: Identifier = 'email'): string {
  const lines: string[] = []

  switch (platform) {
    case 'meta': {
      // Meta: phone as digits incl. country code without '+'; names/city lowercase without punctuation.
      lines.push('email,phone,fn,ln,ct,country,gen')
      for (const r of rows) {
        lines.push(
          csvLine([
            h(r.email),
            h(digits(r.phone)),
            h(normalizeToken(r.first_name)),
            h(normalizeToken(r.last_name)),
            h(normalizeToken(r.city)),
            h(r.country.toLowerCase()),
            h(r.gender === 'male' ? 'm' : r.gender === 'female' ? 'f' : null),
          ]),
        )
      }
      break
    }
    case 'google': {
      // Google Customer Match: phone hashed in E.164 incl. '+'. Name matching also needs Zip, which we don't collect.
      lines.push('Email,Phone')
      for (const r of rows) lines.push(csvLine([h(r.email), h(r.phone)]))
      break
    }
    case 'tiktok':
    case 'snapchat': {
      // One identifier type per file. Phone: digits with country code, no '+'.
      lines.push(identifier === 'email' ? 'EMAIL_SHA256' : 'PHONE_SHA256')
      for (const r of rows) {
        const v = identifier === 'email' ? r.email : digits(r.phone)
        if (v) lines.push(sha256(v))
      }
      break
    }
  }

  return lines.join('\n') + '\n'
}

export const countCsvRows = (csv: string) => csv.trimEnd().split('\n').length - 1

/**
 * Hashed match keys for real-time server-side activation (sGTM → Meta CAPI,
 * TikTok Events API, Snap CAPI, GA4/Google Ads user-provided data).
 * Phone is provided both ways: E.164 with '+' (Google) and digits only (Meta/TikTok/Snap).
 */
export function matchKeys(r: {
  email: string | null
  phone: string | null
  first_name?: string | null
  last_name?: string | null
  city?: string | null
  gender?: string | null
  country?: string
}) {
  return {
    em: r.email ? sha256(r.email) : null,
    ph_e164: r.phone ? sha256(r.phone) : null,
    ph_digits: r.phone ? sha256(r.phone.replace(/\D/g, '')) : null,
    fn: h(normalizeToken(r.first_name)) || null,
    ln: h(normalizeToken(r.last_name)) || null,
    ct: h(normalizeToken(r.city)) || null,
    ge: r.gender === 'male' ? sha256('m') : r.gender === 'female' ? sha256('f') : null,
    country: sha256((r.country ?? 'SA').toLowerCase()),
  }
}
