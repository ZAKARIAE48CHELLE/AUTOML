import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Lightbulb } from 'lucide-react'
import { AUTO_NAME } from './constants'
import type { AutoNotice } from './autoBus'
import type { Anchor } from './engine'
import { useAboveAnchor, useDismiss } from './AutoMenu'

/** Carte ouverte en cliquant sur l'ampoule : la suggestion de l'agent pour le pipeline ou l'application. */
export function TipCard({ at, notice, onGo, onDismiss, onClose }: { at: Anchor; notice: AutoNotice; onGo: () => void; onDismiss: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pos = useAboveAnchor(ref, at, [notice.id])
  useDismiss(ref, onClose)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus() }, [notice.id])
  const warn = notice.level === 'warning'
  const I = warn ? AlertTriangle : Lightbulb
  return createPortal(
    <motion.div ref={ref} data-auto role="dialog" aria-label={`Suggestion d’${AUTO_NAME}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 480, damping: 30 }}
      style={{ left: pos.left, top: pos.top, transformOrigin: 'bottom center' }}
      className="fixed z-[61] w-80 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${warn ? 'bg-amber-100 text-amber-600' : 'bg-amber-100 text-amber-500'}`}><I className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-400">{warn ? 'Attention' : 'Idée'} · {AUTO_NAME}</p>
          <p className="text-sm font-semibold text-slate-800">{notice.title}</p>
          {notice.detail && <p className="mt-1 text-xs leading-relaxed text-slate-600">{notice.detail}</p>}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {notice.to && <button type="button" onClick={onGo} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Voir<ArrowRight className="h-3 w-3" /></button>}
        <button type="button" data-primary onClick={onDismiss} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">Compris</button>
      </div>
    </motion.div>,
    document.body,
  )
}
