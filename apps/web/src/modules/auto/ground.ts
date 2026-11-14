/* Le sol d'Auto est le bord bas de la fenêtre. Certaines zones de ce bord sont occupées par l'interface
 * (barre latérale, panneau de chat, notifications, contrôles du canevas) : Auto ne marche jamais dessus.
 * Toutes les valeurs sont en unités du monde (pixels / échelle), sur l'axe horizontal. */

export type Span = readonly [number, number]

/** Fusionne des intervalles qui se chevauchent ; ignore les intervalles vides. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Portions libres du sol entre `edge` et `width - edge`, privées des zones bloquées ; les portions plus étroites que `minWidth` sont écartées. */
export function freeSegments(width: number, blocked: readonly Span[], edge = 9, minWidth = 12): Span[] {
  const out: Span[] = []
  let x = edge
  for (const [a, b] of mergeSpans(blocked)) {
    if (a - x >= minWidth) out.push([x, a])
    x = Math.max(x, b)
  }
  if (width - edge - x >= minWidth) out.push([x, width - edge])
  return out
}

/** Coin de repos : extrémité gauche de la première portion libre, ou droite de la dernière. */
export function homeX(segments: readonly Span[], side: 'left' | 'right'): number {
  return side === 'left' ? segments[0][0] : segments[segments.length - 1][1]
}

/** Auto se trouve-t-il sur une zone bloquée ? (les bords d'une zone restent libres) */
export const isBlocked = (x: number, blocked: readonly Span[]) => blocked.some(([a, b]) => x > a && x < b)

/** Le trajet de `from` à `to` traverse-t-il une zone bloquée ? Si oui, Auto passe par un portail. */
export function crossesBlocked(from: number, to: number, blocked: readonly Span[]): boolean {
  const lo = Math.min(from, to), hi = Math.max(from, to)
  return blocked.some(([a, b]) => a < hi && b > lo)
}
