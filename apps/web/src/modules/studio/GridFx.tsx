import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '@xyflow/react'
import { useDarkPalette, useTheme } from '@/lib/theme'

/* Grille de points interactive du canevas : ondes au clic, à l'ajout, à la suppression, à la connexion,
 * pulsations d'erreur et d'exécution, projecteur pendant le glissement. Dessin sur <canvas>, animé
 * uniquement quand un effet est actif (aucun coût au repos) ; grille fixe si le mouvement est réduit. */

export type FxKind = 'ripple' | 'add' | 'remove' | 'connect' | 'error' | 'run'
interface Effect { kind: FxKind; x: number; y: number; t0: number; dur: number; color: string }
export interface FxBus {
  /** Déclenche un effet ; coordonnées en unités du flux (indépendantes du zoom). */
  emit: (kind: FxKind, x: number, y: number) => void
  /** Projecteur sous le pointeur (coordonnées écran relatives au canevas), null pour l'éteindre. */
  spot: (p: { x: number; y: number } | null) => void
  _sub?: (e: Effect) => void
  _spot?: (p: { x: number; y: number } | null) => void
}

const COLORS: Record<FxKind, string> = { ripple: '79,129,189', add: '59,130,246', remove: '148,163,184', connect: '34,197,94', error: '239,68,68', run: '56,189,248' }
const DUR: Record<FxKind, number> = { ripple: 900, add: 1100, remove: 700, connect: 900, error: 1300, run: 1600 }
const GAP = 18

export function createFxBus(): FxBus {
  const bus: FxBus = {
    emit: (kind, x, y) => bus._sub?.({ kind, x, y, t0: performance.now(), dur: DUR[kind], color: COLORS[kind] }),
    spot: (p) => bus._spot?.(p),
  }
  return bus
}

export function GridFx({ bus }: { bus: FxBus }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const dark = useTheme() === 'dark'
  const palette = useDarkPalette()
  // Couleurs des points et du halo de glissement : celles de la palette sombre active (variables --d-* de styles.css).
  const colors = useMemo(() => {
    if (!dark) return { base: 'rgba(148,163,184,0.55)', spot: '79,129,189' }
    const cs = getComputedStyle(document.documentElement)
    const base = cs.getPropertyValue('--d-grid').trim() || 'rgba(52,70,105,0.6)'
    const spot = cs.getPropertyValue('--d-accent').trim().split(/\s+/).join(',') || '79,129,189'
    return { base, spot }
  }, [dark, palette])
  const st = useRef({ effects: [] as Effect[], spot: null as { x: number; y: number } | null, raf: 0, view: [0, 0, 1], colors, reduce: false, kick: () => {} }).current
  st.view = [tx, ty, zoom]; st.colors = colors

  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!
    st.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const draw = () => {
      st.raf = 0
      const dpr = window.devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
      const [vx, vy, z] = st.view
      let gap = GAP * z; while (gap < 9) gap *= 2
      const now = performance.now()
      st.effects = st.effects.filter((e) => now - e.t0 < e.dur)
      const fx = st.effects.map((e) => ({ ...e, sx: e.x * z + vx, sy: e.y * z + vy, p: (now - e.t0) / e.dur, reach: (e.kind === 'run' ? 140 : 260) * Math.max(0.6, Math.sqrt(z)) }))
      const base = st.colors.base
      const r0 = Math.max(0.8, Math.min(1.5, Math.sqrt(z)))
      const ox = ((vx % gap) + gap) % gap, oy = ((vy % gap) + gap) % gap
      ctx.fillStyle = base
      for (let y = oy; y < h; y += gap) {
        for (let x = ox; x < w; x += gap) {
          let boost = 0, dx = 0, dy = 0, col = ''
          for (const e of fx) {
            const ddx = x - e.sx, ddy = y - e.sy
            if (Math.abs(ddx) > e.reach + 60 || Math.abs(ddy) > e.reach + 60) continue
            const d = Math.hypot(ddx, ddy)
            const front = e.kind === 'remove' ? e.reach * (1 - e.p) : e.reach * e.p
            const width = e.kind === 'error' ? 24 : 32
            let k = Math.exp(-((d - front) ** 2) / (2 * width * width)) * (1 - e.p)
            if (e.kind === 'error') k *= 0.55 + 0.45 * Math.abs(Math.sin(e.p * Math.PI * 3))
            if (k > 0.03) { if (k > boost) { boost = k; col = e.color } if (d > 0) { dx += (ddx / d) * k * 3; dy += (ddy / d) * k * 3 } }
          }
          if (st.spot) { const k = Math.max(0, 1 - Math.hypot(x - st.spot.x, y - st.spot.y) / 130) * 0.9; if (k > boost) { boost = k; col = st.colors.spot } }
          if (boost > 0.03) {
            ctx.fillStyle = `rgba(${col},${0.3 + boost * 0.65})`; ctx.beginPath(); ctx.arc(x + dx, y + dy, r0 + boost * 2.3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = base
          } else ctx.fillRect(x - r0 / 2, y - r0 / 2, r0, r0)
        }
      }
      if (!st.reduce && (st.effects.length || st.spot)) st.raf = requestAnimationFrame(draw)
    }
    st.kick = () => { if (!st.raf) st.raf = requestAnimationFrame(draw) }
    bus._sub = (e) => { if (st.reduce) return; st.effects.push(e); if (st.effects.length > 24) st.effects.shift(); st.kick() }
    bus._spot = (p) => { if (st.reduce) return; st.spot = p; st.kick() }
    const ro = new ResizeObserver(() => st.kick()); ro.observe(cv)
    st.kick()
    return () => { cancelAnimationFrame(st.raf); st.raf = 0; ro.disconnect(); bus._sub = undefined; bus._spot = undefined }
  }, [bus, st])

  // Redessin au déplacement / zoom du canevas et au changement de thème.
  useEffect(() => { st.kick() }, [tx, ty, zoom, colors, st])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
}
