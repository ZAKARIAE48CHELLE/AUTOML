import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { PartyPopper, Sparkles, Trash2 } from 'lucide-react'
import { PREPROCESS_STEP_BY_TYPE } from '@contracts/src'
import { NODE_SHAPE, Shape } from './palette/Shape'
import { NODE_COLOR, STEP_CATEGORY } from './palette/NodePalette'
import type { Recommendation } from './palette/recommend'
import type { Block } from './palette/blocks'

/** Forme et couleur d'un bloc, identiques à sa tuile dans la palette. */
const look = (b: Block): { shape: string; color: string } =>
  b.kind === 'step' ? { shape: 'hexagon', color: (STEP_CATEGORY[PREPROCESS_STEP_BY_TYPE[b.type]?.category ?? 'cleaning'] ?? STEP_CATEGORY.cleaning).color }
    : b.kind === 'model' ? { shape: 'chip', color: '#2563eb' }
      : { shape: NODE_SHAPE[b.type], color: NODE_COLOR[b.type] ?? '#64748b' }

interface Props {
  x: number; y: number; title: string; accent: string
  items: Recommendation[]
  onPick: (r: Recommendation) => void
  onDelete?: () => void
  onClose: () => void
}

/** Menu du clic droit sur le canevas : blocs recommandés pour la suite du pipeline. */
export function RecommendMenu({ x, y, title, accent, items, onPick, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // Reste dans la fenêtre (ouvre vers la gauche / le haut près des bords).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const { width: w, height: h } = el.getBoundingClientRect(); const m = 8
    setPos({ left: x + w + m > window.innerWidth ? Math.max(m, x - w) : x, top: y + h + m > window.innerHeight ? Math.max(m, y - h) : y })
  }, [x, y, items.length])
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const close = () => onClose()
    // Molette sur le canevas (zoom/pan) : le menu ne suivrait plus ; molette dans le menu : simple défilement.
    window.addEventListener('pointerdown', away, true); window.addEventListener('wheel', away, { passive: true }); window.addEventListener('resize', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('wheel', away); window.removeEventListener('resize', close); window.removeEventListener('blur', close) }
  }, [onClose])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]; if (!all.length) return
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    all[j].focus()
  }

  return createPortal(
    <motion.div ref={ref} role="menu" aria-label={title} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
      initial={{ opacity: 0, scale: 0.9, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      style={{ left: pos.left, top: pos.top, transformOrigin: 'top left' }}
      className="fixed z-[60] w-80 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2" style={{ background: `linear-gradient(90deg, ${accent}1f, transparent)` }}>
        <Sparkles className="h-3.5 w-3.5" style={{ color: accent }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{title}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1.5">
        {items.length === 0 && (
          <p className="flex items-center gap-2 px-2 py-3 text-xs text-slate-500"><PartyPopper className="h-4 w-4 shrink-0" style={{ color: accent }} />Rien à ajouter ici : cette partie du pipeline est complète.</p>)}
        {items.map((r, i) => {
          const l = look(r.block)
          return (
            <motion.button key={r.key} role="menuitem" type="button" onClick={() => onPick(r)}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i, duration: 0.2 }}
              className="recommend-item group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none"
              style={{ ['--tile' as string]: l.color }}>
              <Shape kind={l.shape} color={l.color} size={26} className="mt-0.5 shrink-0 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-110 group-focus-visible:scale-110" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
                  <span className="truncate">{r.label}</span>
                  {r.next && <span className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold text-white" style={{ background: accent }}>Étape suivante</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{r.reason}</span>
              </span>
            </motion.button>)
        })}
      </div>
      {onDelete && (
        <div className="border-t border-slate-100 p-1.5">
          <button role="menuitem" type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />Supprimer ce bloc<kbd className="ml-auto rounded border border-slate-200 px-1 text-[10px] text-slate-400">Suppr</kbd>
          </button>
        </div>)}
      <p className="border-t border-slate-100 px-3 py-1.5 text-[10.5px] text-slate-400">Clic droit sur un bloc : suggestions pour la suite · ↑↓ Entrée · Échap</p>
    </motion.div>,
    document.body,
  )
}
