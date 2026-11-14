import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Compass, Lightbulb, PartyPopper, Sparkles, XCircle } from 'lucide-react'
import { AUTO_NAME } from './constants'
import type { Anchor } from './engine'
import type { AutoMenuItem } from './recs'

/** Place un panneau au-dessus d'Auto, sans sortir de la fenêtre. */
export function useAboveAnchor(ref: RefObject<HTMLElement>, at: Anchor, deps: unknown[] = []) {
  const [pos, setPos] = useState({ left: at.x, top: at.y })
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const { width: w, height: h } = el.getBoundingClientRect(), m = 8
    setPos({ left: Math.min(Math.max(m, at.x - w / 2), window.innerWidth - w - m), top: Math.max(m, at.y - h - 10) })
  }, [at.x, at.y, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return pos
}

/** Ferme sur clic extérieur, redimensionnement ou perte de focus de la fenêtre. */
export function useDismiss(ref: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const away = (e: Event) => { const t = e.target as Element | null; if (!ref.current?.contains(t) && !t?.closest?.('[data-auto]')) onClose() }
    const close = () => onClose()
    window.addEventListener('pointerdown', away, true); window.addEventListener('resize', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close) }
  }, [ref, onClose])
}

const ICON = {
  error: { I: XCircle, c: 'text-red-500', l: 'Erreur' },
  warning: { I: AlertTriangle, c: 'text-amber-500', l: 'Attention' },
  tip: { I: Lightbulb, c: 'text-amber-500', l: 'Idée' },
} as const

/** Menu du clic droit sur Auto : recommandations pour toute l'application (et non pour le seul éditeur). */
export function AutoMenu({ at, items, onPick, onClose }: { at: Anchor; items: AutoMenuItem[]; onPick: (i: AutoMenuItem) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pos = useAboveAnchor(ref, at, [items.length])
  useDismiss(ref, onClose)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }, [])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]; if (!all.length) return
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    all[j].focus()
  }
  const agent = items.filter((i) => !i.context), ctx = items.filter((i) => i.context)
  const row = (r: AutoMenuItem, k: number) => {
    const s = r.context ? { I: Compass, c: 'text-brand-500', l: '' } : ICON[r.level]
    return (
      <motion.button key={r.id} role="menuitem" type="button" onClick={() => onPick(r)}
        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * k, duration: 0.2 }}
        className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-slate-100 focus-visible:bg-slate-100">
        <s.I className={`mt-0.5 h-4 w-4 shrink-0 ${s.c}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-slate-800">{s.l && <span className="sr-only">{s.l} : </span>}{r.title}</span>
          {r.detail && <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{r.detail}</span>}
        </span>
      </motion.button>)
  }
  return createPortal(
    <motion.div ref={ref} data-auto role="menu" aria-label={`Suggestions d’${AUTO_NAME}`} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
      initial={{ opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      style={{ left: pos.left, top: pos.top, transformOrigin: 'bottom center' }}
      className="fixed z-[61] w-80 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-transparent px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-700">Suggestions d’{AUTO_NAME}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1.5">
        {agent.length > 0 && <>{agent.map(row)}<div className="mx-2 my-1 border-t border-slate-100" /></>}
        {agent.length === 0 && <p className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500"><PartyPopper className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />Rien à signaler pour l’instant.</p>}
        <p className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Sur cette page</p>
        {ctx.map((r, k) => row(r, agent.length + k))}
      </div>
      <p className="border-t border-slate-100 px-3 py-1.5 text-[10.5px] text-slate-400">↑↓ Entrée · Échap</p>
    </motion.div>,
    document.body,
  )
}
