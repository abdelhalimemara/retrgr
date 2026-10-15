import { existsSync } from 'node:fs'
import { join } from 'node:path'
import maxmind, { type AsnResponse, type CityResponse, type Reader } from 'maxmind'

/**
 * Offline IP enrichment with the free DB-IP Lite databases (scripts/fetch-geo.mjs).
 * Lookups run in-process: no IP is sent to any third party, and scans store only the
 * derived city / region / country / network operator — never the IP itself.
 * Attribution required by the licence: "IP Geolocation by DB-IP" (https://db-ip.com).
 */
export interface IpInfo {
  ip_city: string | null
  ip_region: string | null
  ip_country: string | null
  asn: number | null
  carrier: string | null
}

const EMPTY: IpInfo = { ip_city: null, ip_region: null, ip_country: null, asn: null, carrier: null }

// Friendly names for Saudi operators (matched on the network owner's name, which is stabler than ASN lists).
const OPERATORS: [RegExp, string][] = [
  [/saudi telecom|\bstc\b/i, 'STC'],
  [/etihad etisalat|mobily/i, 'Mobily'],
  [/zain|mobile telecommunication company saudi/i, 'Zain'],
  [/integrated telecom|salam/i, 'Salam'],
  [/atheeb|go telecom/i, 'GO'],
  [/virgin mobile/i, 'Virgin Mobile'],
  [/lebara/i, 'Lebara'],
]

// Known operator ASNs, checked first.
const OPERATOR_ASNS: Record<number, string> = { 25019: 'STC', 39891: 'STC', 35819: 'Mobily', 43766: 'Zain' }

export function operatorName(org: string | null | undefined, asn?: number | null): string | null {
  if (asn && OPERATOR_ASNS[asn]) return OPERATOR_ASNS[asn]
  if (!org) return null
  return OPERATORS.find(([re]) => re.test(org))?.[1] ?? org.slice(0, 80)
}

let readers: Promise<{ city: Reader<CityResponse> | null; asn: Reader<AsnResponse> | null }> | null = null

function open() {
  const dir = process.env.GEO_DIR ?? join(process.cwd(), 'geo')
  const load = async <T extends CityResponse | AsnResponse>(file: string) => {
    const path = join(dir, file)
    if (!existsSync(path)) return null
    try {
      return await maxmind.open<T>(path)
    } catch (err) {
      console.error(`geoip: cannot open ${path}`, err)
      return null
    }
  }
  readers ??= Promise.all([load<CityResponse>('dbip-city-lite.mmdb'), load<AsnResponse>('dbip-asn-lite.mmdb')]).then(
    ([city, asn]) => {
      if (!city && !asn) console.warn('geoip: no databases found — IP enrichment disabled')
      return { city, asn }
    },
  )
  return readers
}

export async function lookupIp(ip: string | null | undefined): Promise<IpInfo> {
  if (!ip || !maxmind.validate(ip)) return EMPTY
  const { city, asn } = await open()
  const c = city?.get(ip)
  const a = asn?.get(ip)
  return {
    ip_city: c?.city?.names?.en ?? null,
    ip_region: c?.subdivisions?.[0]?.names?.en ?? null,
    ip_country: c?.country?.iso_code ?? null,
    asn: a?.autonomous_system_number ?? null,
    carrier: operatorName(a?.autonomous_system_organization, a?.autonomous_system_number),
  }
}
