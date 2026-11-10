import { registerAll, dispatch, speed } from '../mock'
import { ApiErr, jitter } from '../mock/util'

export type Module = 'data' | 'training' | 'assistant' | 'studio'
const env = (import.meta as any).env ?? {}
const MOCKED = new Set<string>(String(env.VITE_MOCK_MODULES ?? '').split(',').map((s: string) => s.trim()).filter(Boolean))
const BASE: string = env.VITE_API_BASE_URL ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : 'http://localhost:8080')

/** Propriétaire d'une route d'après son préfixe (cf. docs/OWNERSHIP.md). */
export function moduleOf(path: string): Module {
  if (/^\/(auth|projects|datasets|preprocessing|splits)(\/|$)/.test(path)) return 'data'
  if (/^\/(models|training|tuning|experiments|inference)(\/|$)/.test(path)) return 'training'
  if (/^\/(assistant|policy)(\/|$)/.test(path)) return 'assistant'
  return 'studio'
}
export const isMocked = (m: Module) => MOCKED.has(m)
export const mockedModules = () => [...MOCKED]

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public request_id?: string) { super(message) }
}

let token: string | null = null
export const setToken = (t: string | null) => { token = t }

export interface Opts { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; form?: FormData }

export async function api<T>(method: string, path: string, o: Opts = {}): Promise<T> {
  const query = Object.fromEntries(Object.entries(o.query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
  if (isMocked(moduleOf(path))) {
    registerAll()
    if (speed.factor > 0) await jitter(80, 260)
    try {
      const r = await dispatch(method, path, query, o.form ?? o.body)
      return (r.data === undefined ? undefined : structuredClone(r.data)) as T
    } catch (e) {
      if (e instanceof ApiErr) throw new HttpError(e.status, e.code, e.message, e.details, 'req_mock')
      throw e
    }
  }
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (o.form) body = o.form
  else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body) }
  let res: Response
  try { res = await fetch(BASE + path + qs, { method, headers, body }) }
  catch { throw new HttpError(0, 'NETWORK', `Backend injoignable (${BASE}). Le module « ${moduleOf(path)} » est configuré en mode réel.`) }
  const text = await res.text(); const data = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new HttpError(res.status, data?.code ?? 'ERROR', data?.message ?? res.statusText, data?.details, data?.request_id)
  return data as T
}
export const get = <T,>(path: string, query?: Opts['query']) => api<T>('GET', path, { query })
export const post = <T,>(path: string, body?: unknown, query?: Opts['query']) => api<T>('POST', path, { body, query })
export const put = <T,>(path: string, body?: unknown) => api<T>('PUT', path, { body })
