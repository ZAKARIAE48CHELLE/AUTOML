import { describe, expect, it } from 'vitest'
import { crossesBlocked, freeSegments, homeX, isBlocked, mergeSpans } from './ground'

describe('sol d’Auto', () => {
  it('fusionne les zones qui se chevauchent', () => {
    expect(mergeSpans([[50, 60], [10, 20], [15, 30], [70, 70]])).toEqual([[10, 30], [50, 60]])
  })

  it('sans zone bloquée, tout le bord bas est libre (moins les marges)', () => {
    const segs = freeSegments(300, [])
    expect(segs).toEqual([[9, 291]])
    expect(homeX(segs, 'right')).toBe(291)
    expect(homeX(segs, 'left')).toBe(9)
  })

  it('le coin droit se décale à gauche du panneau de chat', () => {
    const segs = freeSegments(300, [[0, 63], [200, 300]]) // barre latérale + chat
    expect(segs).toEqual([[63, 200]])
    expect(homeX(segs, 'right')).toBe(200)
    expect(homeX(segs, 'left')).toBe(63)
  })

  it('écarte les portions trop étroites pour Auto', () => {
    expect(freeSegments(300, [[20, 280]])).toEqual([])
    expect(freeSegments(300, [[100, 150]])).toEqual([[9, 100], [150, 291]])
  })

  it('les bords d’une zone restent libres, son intérieur non', () => {
    expect(isBlocked(200, [[200, 300]])).toBe(false)
    expect(isBlocked(250, [[200, 300]])).toBe(true)
  })

  it('un trajet qui traverse une zone passe par un portail', () => {
    const controls: [number, number][] = [[130, 170]]
    expect(crossesBlocked(100, 250, controls)).toBe(true)
    expect(crossesBlocked(180, 250, controls)).toBe(false)
    expect(crossesBlocked(250, 170, controls)).toBe(false)
  })
})
