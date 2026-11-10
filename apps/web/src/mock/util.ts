export class ApiErr extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) }
}
export const notFound = (what: string, id: string) => new ApiErr(404, 'NOT_FOUND', `${what} introuvable : ${id}`)
export const bad = (code: string, message: string, details?: unknown) => new ApiErr(422, code, message, details)

let counter = 1000
export const uid = (prefix: string) => `${prefix}_${(++counter).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
export const nowIso = () => new Date().toISOString()
export const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
export const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const clone = <T,>(v: T): T => structuredClone(v)

export const speed = { factor: 1 } // 0 = instantané (tests)
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * speed.factor))
export const jitter = (a = 120, b = 320) => sleep(a + Math.random() * (b - a))
