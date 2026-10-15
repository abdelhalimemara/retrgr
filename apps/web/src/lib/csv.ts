/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM, ; or , separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  // Excel in Arabic/European locales often saves with semicolons.
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (field += '"'), i++
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) row.push(field), (field = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim()))
}

/** Accepted header names → placement fields. */
const HEADERS: Record<string, string> = {
  code: 'code', bid: 'code', placement_code: 'code',
  name: 'name', placement: 'name', placement_name: 'name',
  format: 'format', type: 'format',
  city: 'city', district: 'district', area: 'district',
  latitude: 'latitude', lat: 'latitude',
  longitude: 'longitude', lng: 'longitude', lon: 'longitude', long: 'longitude',
  cost_sar: 'cost_sar', cost: 'cost_sar', 'cost (sar)': 'cost_sar', flight_cost: 'cost_sar',
}
const NUMERIC = new Set(['latitude', 'longitude', 'cost_sar'])

export const PLACEMENT_CSV_TEMPLATE =
  'code,name,format,city,district,latitude,longitude,cost_sar\n' +
  'kfr-01,King Fahd Rd unipole,Unipole,Riyadh,Al Olaya,24.7136,46.6753,45000\n' +
  'olaya-02,Olaya St digital screen,Digital screen,Riyadh,Al Olaya,24.6950,46.6850,30000\n'

/**
 * Turns CSV text into placement rows for /admin/placements/bulk. Codes are lowercased,
 * blanks become null and numbers are parsed ("45,000" works); the API validates the rest.
 */
export function placementsFromCsv(text: string): { rows: Record<string, unknown>[]; unknownColumns: string[] } {
  const [header, ...body] = parseCsv(text)
  if (!header) return { rows: [], unknownColumns: [] }
  const keys = header.map((h) => HEADERS[h.trim().toLowerCase()] ?? null)
  const unknownColumns = header.filter((_, i) => !keys[i]).map((h) => h.trim()).filter(Boolean)
  const rows = body.map((cells) => {
    const r: Record<string, unknown> = {}
    keys.forEach((k, i) => {
      if (!k) return
      const v = (cells[i] ?? '').trim()
      if (!v) r[k] = null
      else if (NUMERIC.has(k)) r[k] = Number(v.replace(/[,\s]/g, '')) // NaN → rejected by the API with the row number
      else r[k] = k === 'code' ? v.toLowerCase() : v
    })
    return r
  })
  return { rows, unknownColumns }
}
