export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const
export const GENDERS = ['male', 'female', 'undisclosed'] as const
export const PLATFORMS = ['meta', 'google', 'tiktok', 'snapchat'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  meta: 'Meta (Facebook & Instagram)',
  google: 'Google & YouTube',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
}

export interface Partner {
  id: string
  key: string
  name: string
  allowed_origins: string[]
  analytics_basis: 'consent' | 'notice'
  privacy_notice_url: string | null
  marketing_basis: 'checkbox' | 'form_notice'
  marketing_notice: string | null
  notice_covers_ads: boolean
  typed_notice: string | null
  contact_email: string | null
  notes: string | null
  campaign_count: number
  created_at: string
}

export interface Campaign {
  id: string
  partner_id: string
  partner_name: string
  name: string
  slug: string
  location: string | null
  city: string | null
  starts_on: string | null
  ends_on: string | null
  status: 'draft' | 'active' | 'ended'
  headline: string | null
  consent_version: string
  customer_count: number
  created_at: string
}

export interface Customer {
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  age_range: string | null
  gender: string | null
  city: string | null
  country: string
  first_seen_at: string
  last_seen_at: string
  consent_active: boolean
  touchpoint_count: number
  scan_count: number
  email_status: 'valid' | 'risky' | 'invalid' | 'unknown' | null
  phone_status: 'mobile' | 'fixed' | 'voip' | 'invalid' | 'unknown' | null
  phone_carrier?: string | null
  intent_score: number | null
}

/** First-party insights (customer_insights view). */
export interface CustomerInsights {
  scans: number
  placements: number
  avg_dwell_seconds: number
  max_scroll_pct: number
  cta_clicks: number
  cart_adds: number
  purchases: number
  purchase_value: string
  last_purchase_at: string | null
  daypart: string | null
  language: string | null
  carrier: string | null
  ip_city: string | null
  device_tier: string | null
  email_type: 'personal' | 'work' | null
  intent_score: number
}

export interface CustomerDetail {
  customer: Customer
  insights: CustomerInsights | null
  consents: {
    id: string
    policy_version: string
    purposes: string[]
    granted_at: string
    withdrawn_at: string | null
    basis: 'checkbox' | 'form_notice'
    notice_text: string | null
    campaign_name: string | null
  }[]
  touchpoints: {
    id: string
    campaign_name: string | null
    placement_name: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    device_type: string | null
    language: string | null
    fbclid: string | null
    gclid: string | null
    ttclid: string | null
    sccid: string | null
    source: 'hosted' | 'auto'
    form_id: string | null
    form_data: Record<string, string> | null
    created_at: string
  }[]
}

export interface SegmentFilters {
  campaignIds?: string[]
  placementIds?: string[]
  minScans?: number
  partnerIds?: string[]
  ageRanges?: string[]
  genders?: string[]
  cities?: string[]
  capturedFrom?: string
  capturedTo?: string
  minIntent?: number
  minPlacements?: number
  dayparts?: string[]
  languages?: string[]
  deviceTiers?: string[]
  emailTypes?: string[]
  carriers?: string[]
  commerce?: 'buyers' | 'cart_abandoners' | 'non_buyers'
  minPurchaseValue?: number
  purchasedWithinDays?: number
  validContactsOnly?: boolean
}

export const DAYPARTS = ['morning', 'midday', 'evening', 'night'] as const
export const DEVICE_TIERS = [
  { value: 'ios', label: 'iPhone / iPad' },
  { value: 'android_premium', label: 'Android premium' },
  { value: 'android', label: 'Android' },
  { value: 'desktop', label: 'Desktop' },
]
export const CARRIERS = ['STC', 'Mobily', 'Zain', 'Salam', 'GO', 'Virgin Mobile', 'Lebara']

export interface SegmentSize {
  total: number
  with_email: number
  with_phone: number
}

export interface Segment {
  id: string
  name: string
  description: string | null
  filters: SegmentFilters
  size: SegmentSize
  created_at: string
}

export interface ExportRecord {
  id: string
  segment_name: string
  platform: Platform
  identifier: string
  record_count: number
  created_by: string
  created_at: string
}

export interface Stats {
  totals: { customers: number; consented: number; active_campaigns: number; exports: number }
  daily: { date: string; captures: number }[]
  byCampaign: { name: string; captures: number }[]
  demographics: { age_range: string; gender: string; count: number }[]
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fullName = (c: Pick<Customer, 'first_name' | 'last_name'>) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'

export interface Placement {
  id: string
  campaign_id: string
  campaign_slug: string
  campaign_name: string
  code: string
  name: string
  format: string | null
  city: string | null
  district: string | null
  latitude: string | null
  longitude: string | null
  cost_sar: string | null
  match_param: string | null
  match_value: string | null
  match_path: string | null
  destination_url: string | null
}

export interface PlacementScore {
  id: string
  code: string
  name: string
  city: string | null
  district: string | null
  format: string | null
  campaign_name: string
  cost_sar: number | null
  qr_opens: number
  scans: number
  unique_scanners: number
  repeat_scans: number
  leads: number
  avg_dwell_seconds: number | null
  mobile_pct: number | null
  cost_per_scan: number | null
  cost_per_lead: number | null
  scan_to_lead_pct: number | null
}

export interface Attribution {
  totals: { scans: number; unique_scanners: number; leads: number; unattributed_scans: number; qr_opens: number }
  placements: PlacementScore[]
  hourly: { hour: number; scans: number }[]
}

export const sar = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 })

export interface FormReport {
  form_id: string
  campaign_id: string
  campaign_name: string
  starts: number
  submits: number
  abandons: number
  completion_pct: number
  fields_total: number
  fields: { field: string; filled: number; pct: number }[]
  dropoffs: { field: string; abandons: number }[]
}

export interface PartialLead {
  scan_id: string
  form_id: string
  email: string | null
  phone: string | null
  data: { first_name: string | null; last_name: string | null; city: string | null; extra: Record<string, string> | null }
  notice_text: string
  created_at: string
  updated_at: string
  expires_at: string | null
  campaign_name: string
  partner_name: string
  placement_name: string | null
}
