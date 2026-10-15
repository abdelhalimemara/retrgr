import { useCallback, useEffect, useState } from 'react'
import { getIdToken } from './auth'

export const API_URL = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getIdToken()
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join(', ')
    throw new ApiError(res.status, detail || body.error || res.statusText, body)
  }
  return res
}

export const api = {
  get: async <T>(path: string) => (await request(path)).json() as Promise<T>,
  post: async <T>(path: string, body: unknown) =>
    (await request(path, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>,
  put: async <T>(path: string, body: unknown) =>
    (await request(path, { method: 'PUT', body: JSON.stringify(body) })).json() as Promise<T>,
  delete: async (path: string) => {
    await request(path, { method: 'DELETE' })
  },
  /** POSTs and saves the response as a file download; returns the response headers. */
  download: async (path: string, body: unknown) => {
    const res = await request(path, { method: 'POST', body: JSON.stringify(body) })
    const name = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'export.csv'
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
    URL.revokeObjectURL(url)
    return res.headers
  },
}

/** Minimal data-fetching hook: loads on mount / when `path` changes, exposes reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      setData(await api.get<T>(path))
      setError(null)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload }
}
