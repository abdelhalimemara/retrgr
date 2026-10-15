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
}

export interface CustomerDetail {
  customer: Customer
  consents: {
    id: string
    policy_version: string
    purposes: string[]
    granted_at: string
    withdrawn_at: string | null
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
}

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
