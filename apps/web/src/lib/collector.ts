import { API_URL } from './api'

/**
 * Loads public/retrgtr.js on the hosted consent page once analytics consent is
 * granted — the same collector partners install via GTM. Events go to sGTM when
 * VITE_COLLECT_URL is set (e.g. https://sgtm.brand.sa/retrgtr), else straight to the API.
 */
type CaptureFields = Record<string, string | boolean | null | undefined>

declare global {
  interface Window {
    retrgtr?: { capture: (fields: CaptureFields) => Promise<void>; scanId: string }
  }
}

const CONSENT_KEY = 'retrgtr_analytics_consent'
const COLLECT_URL = import.meta.env.VITE_COLLECT_URL as string | undefined

export function analyticsChoice(): 'granted' | 'denied' | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

export function setAnalyticsChoice(choice: 'granted' | 'denied') {
  try {
    localStorage.setItem(CONSENT_KEY, choice)
    if (choice === 'denied') {
      // Revoking consent clears the first-party repeat-exposure identifiers.
      for (const k of ['retrgtr_vid', 'retrgtr_bids', 'retrgtr_scans']) localStorage.removeItem(k)
    }
  } catch {
    /* storage unavailable — consent simply isn't remembered */
  }
}

let loading: Promise<void> | null = null

export function loadCollector(campaign: string, policyVersion: string): Promise<void> {
  if (window.retrgtr) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/retrgtr.js'
    s.async = true
    s.dataset.endpoint = COLLECT_URL ?? `${API_URL || window.location.origin}/api/public`
    s.dataset.path = ''
    s.dataset.campaign = campaign
    s.dataset.policyVersion = policyVersion
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('collector failed to load'))
    document.head.appendChild(s)
  })
  return loading
}
