import { ApiErr } from './util'
import { SERVICE_TOKEN } from './db'

export interface Ctx { params: Record<string, string>; query: Record<string, string>; body: any; headers: Record<string, string> }
export type Handler = (c: Ctx) => unknown | Promise<unknown>
interface Route { method: string; pattern: string; re: RegExp; keys: string[]; handler: Handler; internal: boolean; status: number }
const routes: Route[] = []

export function route(method: string, pattern: string, handler: Handler, opts: { internal?: boolean; status?: number } = {}) {
  const keys: string[] = []
  const re = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_m, k) => { keys.push(k); return '([^/]+)' }) + '$')
  routes.push({ method, pattern, re, keys, handler, internal: !!opts.internal, status: opts.status ?? 200 })
}
export const registeredRoutes = () => routes.map((r) => `${r.method} ${r.pattern}`)

export async function dispatch(method: string, path: string, query: Record<string, string>, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.re.exec(path)
    if (!m) continue
    if (r.internal && headers['x-service-token'] !== SERVICE_TOKEN) throw new ApiErr(403, 'FORBIDDEN_INTERNAL', `Endpoint interne : jeton de service requis (${method} ${r.pattern}). Appelez l'exécuteur (POST /executions).`)
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    const data = await r.handler({ params, query, body, headers })
    return { status: r.status, data }
  }
  throw new ApiErr(404, 'ROUTE_NOT_FOUND', `Aucune route : ${method} ${path}`)
}
export const SERVICE_HEADERS = { 'x-service-token': SERVICE_TOKEN }
