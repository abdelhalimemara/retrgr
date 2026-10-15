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

  // First-party insights — one EXISTS over the customer_insights view.
  const ins: string[] = []
  if (filters.minIntent) ins.push(`i.intent_score >= ${p(filters.minIntent)}::int`)
  if (filters.minPlacements) ins.push(`i.placements >= ${p(filters.minPlacements)}::int`)
  if (filters.dayparts?.length) ins.push(`i.daypart = ANY(${p(filters.dayparts)}::text[])`)
  if (filters.languages?.length) ins.push(`i.language = ANY(${p(filters.languages)}::text[])`)
  if (filters.deviceTiers?.length) ins.push(`i.device_tier = ANY(${p(filters.deviceTiers)}::text[])`)
  if (filters.emailTypes?.length) ins.push(`i.email_type = ANY(${p(filters.emailTypes)}::text[])`)
  if (filters.carriers?.length) ins.push(`i.carrier = ANY(${p(filters.carriers)}::text[])`)
  if (filters.commerce === 'buyers') ins.push('i.purchases > 0')
  if (filters.commerce === 'cart_abandoners') ins.push('i.cart_adds > 0 AND i.purchases = 0')
  if (filters.commerce === 'non_buyers') ins.push('i.purchases = 0')
  if (filters.minPurchaseValue) ins.push(`i.purchase_value >= ${p(filters.minPurchaseValue)}::numeric`)
  if (filters.purchasedWithinDays) ins.push(`i.last_purchase_at >= now() - make_interval(days => ${p(filters.purchasedWithinDays)}::int)`)
  if (ins.length) clauses.push(`EXISTS (SELECT 1 FROM customer_insights i WHERE i.customer_id = c.id AND ${ins.join(' AND ')})`)

  if (filters.validContactsOnly) {
    clauses.push(
      `((c.email IS NOT NULL AND c.email_status IS DISTINCT FROM 'invalid') OR (c.phone IS NOT NULL AND c.phone_status IS DISTINCT FROM 'invalid'))`,
    )
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
