import type { WorkflowSpec } from './types'
// Sérialisation canonique : clés triées, `ui` exclu (la mise en page ne change pas le content_hash).
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) o[k] = canon((v as Record<string, unknown>)[k])
    return o
  }
  return v
}
export function canonicalSpec(spec: WorkflowSpec): string {
  const s = {
    ...spec,
    nodes: [...spec.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(({ ui: _ui, ...n }) => n),
    edges: [...spec.edges].sort((a, b) => a.id.localeCompare(b.id)),
  }
  return JSON.stringify(canon(s))
}
// cyrb53 : hash non cryptographique réservé au mock. Le backend (E4) doit utiliser SHA-256 sur canonicalSpec().
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}
export function contentHash(spec: WorkflowSpec): string {
  return 'ch_' + cyrb53(canonicalSpec(spec))
}
