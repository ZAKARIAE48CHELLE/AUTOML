import type { ExecutionEvent } from '@contracts/src'
import { isMocked } from './client'
import { subscribe } from '../mock'
import { registerAll } from '../mock'

/** Flux d'événements d'exécution : SSE réel (GET /executions/{id}/events) ou bus du mock. Retourne la fonction de fermeture. */
export function openExecutionEvents(executionId: string, onEvent: (e: ExecutionEvent) => void): () => void {
  if (isMocked('studio')) { registerAll(); return subscribe(executionId, onEvent) }
  const base = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'
  const es = new EventSource(`${base}/executions/${executionId}/events`)
  const h = (m: MessageEvent) => onEvent({ ...JSON.parse(m.data), id: Number(m.lastEventId) })
  es.addEventListener('node_status', h as EventListener); es.addEventListener('execution_status', h as EventListener)
  return () => es.close()
}
