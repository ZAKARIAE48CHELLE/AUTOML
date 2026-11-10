import type { ExecutionEvent } from '@contracts/src'
const log: Record<string, ExecutionEvent[]> = {}
const subs: Record<string, Set<(e: ExecutionEvent) => void>> = {}
export function emit(execution_id: string, type: ExecutionEvent['type'], status: string, node_id?: string) {
  const list = (log[execution_id] ||= [])
  const e: ExecutionEvent = { id: list.length + 1, type, execution_id, node_id, status, ts: new Date().toISOString() }
  list.push(e); subs[execution_id]?.forEach((cb) => cb(e))
}
/** Équivalent mock du flux SSE : rejoue les événements après lastEventId puis diffuse. */
export function subscribe(execution_id: string, cb: (e: ExecutionEvent) => void, lastEventId = 0) {
  ;(log[execution_id] || []).filter((e) => e.id > lastEventId).forEach(cb)
  ;(subs[execution_id] ||= new Set()).add(cb)
  return () => subs[execution_id]?.delete(cb)
}
export const eventsOf = (id: string) => log[id] ?? []
