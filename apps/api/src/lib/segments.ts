import type { SegmentFilters } from './schemas.js'

/**
 * Builds a parameterised WHERE clause over `customers c`. Every segment is
 * hard-limited to people with an active (non-withdrawn) marketing consent —
 * there is no filter combination that can bypass this.
 */
export function buildSegmentWhere(filters: SegmentFilters): { where: string; params: unknown[] } {
  const params: unknown[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }

  const purposes = filters.requireAdPersonalization ? ['marketing', 'ad_personalization'] : ['marketing']
  const clauses = [
    `EXISTS (SELECT 1 FROM consents k WHERE k.customer_id = c.id AND k.withdrawn_at IS NULL AND k.purposes @> ${p(purposes)}::text[])`,
  ]

  if (filters.ageRanges?.length) clauses.push(`c.age_range = ANY(${p(filters.ageRanges)}::text[])`)
  if (filters.genders?.length) clauses.push(`c.gender = ANY(${p(filters.genders)}::text[])`)
  if (filters.cities?.length) {
    clauses.push(`lower(c.city) = ANY(${p(filters.cities.map((s) => s.toLowerCase()))}::text[])`)
  }

  // Scans are linked to the customer when they submit, including earlier anonymous scans from the same device.
  if (filters.placementIds?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM scans s WHERE s.customer_id = c.id AND s.placement_id = ANY(${p(filters.placementIds)}::uuid[]))`,
    )
  }
  if (filters.minScans) {
    clauses.push(`(SELECT count(*) FROM scans s WHERE s.customer_id = c.id AND NOT s.is_bot) >= ${p(filters.minScans)}::int`)
  }

  const tp: string[] = []
  if (filters.campaignIds?.length) tp.push(`t.campaign_id = ANY(${p(filters.campaignIds)}::uuid[])`)
  if (filters.partnerIds?.length) tp.push(`cp.partner_id = ANY(${p(filters.partnerIds)}::uuid[])`)
  if (filters.capturedFrom) tp.push(`t.created_at >= ${p(filters.capturedFrom)}::date`)
  if (filters.capturedTo) tp.push(`t.created_at < (${p(filters.capturedTo)}::date + 1)`)
  if (tp.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM touchpoints t LEFT JOIN campaigns cp ON cp.id = t.campaign_id WHERE t.customer_id = c.id AND ${tp.join(' AND ')})`,
    )
  }

  return { where: clauses.join(' AND '), params }
}
