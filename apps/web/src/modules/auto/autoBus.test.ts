import { describe, expect, it } from 'vitest'
import { autoBus, simulate, simulateResolve, type AutoEvent } from './autoBus'
import { contextRecs } from './recs'

describe('bus d’Auto', () => {
  it('diffuse les notifications puis leur résolution', () => {
    const seen: AutoEvent[] = []
    const off = autoBus.subscribe((e) => seen.push(e))
    const id = autoBus.notify({ level: 'warning', title: 'Attention' })
    autoBus.resolve(id)
    off()
    autoBus.notify({ level: 'tip', title: 'ignorée après désabonnement' })
    expect(seen).toEqual([{ type: 'notice', notice: { id, level: 'warning', title: 'Attention' } }, { type: 'resolve', id }])
  })

  it('résout la plus ancienne erreur simulée', () => {
    const seen: AutoEvent[] = []
    const off = autoBus.subscribe((e) => seen.push(e))
    const a = simulate('error'), b = simulate('error')
    expect(simulateResolve()).toBe(true)
    expect(seen.at(-1)).toEqual({ type: 'resolve', id: a })
    expect(simulateResolve()).toBe(true)
    expect(seen.at(-1)).toEqual({ type: 'resolve', id: b })
    expect(simulateResolve()).toBe(false)
    off()
  })

  it('propose des suggestions adaptées à la page', () => {
    expect(contextRecs('/training/jobs/42').map((r) => r.to)).toContain('/training/experiments')
    expect(contextRecs('/studio/registry').map((r) => r.to)).toEqual(['/studio/executions'])
    expect(contextRecs('/inconnu').every((r) => r.context)).toBe(true)
  })
})
