import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, PartyPopper, X, XCircle } from 'lucide-react'
import { clsx } from '@/lib/format'

/* ------------------------------------------------------------------------------------------------
 * Notifications (toasts) et célébrations globales.
 * Stores au niveau module : appelables hors React (ex. MutationCache de React Query).
 * ---------------------------------------------------------------------------------------------- */

export type ToastTone = 'success' | 'error' | 'info' | 'celebrate'
interface ToastItem { id: number; tone: ToastTone; title: string; detail?: string }

let toasts: ToastItem[] = []; let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function dismissToast(id: number) { toasts = toasts.filter((t) => t.id !== id); emit() }
/** Affiche une notification ; disparaît seule (plus longtemps pour les erreurs). */
export function toast(title: string, opts: { tone?: ToastTone; detail?: string } = {}) {
  const t: ToastItem = { id: ++seq, tone: opts.tone ?? 'success', title, detail: opts.detail }
  toasts = [...toasts.slice(-3), t]; emit() // au plus 4 visibles
  setTimeout(() => dismissToast(t.id), t.tone === 'error' ? 6500 : 3800)
  return t.id
}

const TONE = {
  success: { icon: CheckCircle2, c: 'text-green-600', bar: 'bg-green-500' },
  error: { icon: XCircle, c: 'text-red-600', bar: 'bg-red-500' },
  info: { icon: Info, c: 'text-brand-600', bar: 'bg-brand-500' },
  celebrate: { icon: PartyPopper, c: 'text-fuchsia-600', bar: 'bg-gradient-to-r from-brand-500 via-fuchsia-500 to-amber-400' },
} as const

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {list.map((t) => { const s = TONE[t.tone]; const I = s.icon
          return (
            <motion.div key={t.id} layout initial={{ opacity: 0, x: 60, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 60, scale: 0.9, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="pointer-events-auto relative overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-3 pr-8 shadow-lg backdrop-blur">
              <div className="flex gap-2.5">
                <I className={clsx('mt-0.5 h-5 w-5 shrink-0 [animation:checkPop_.5s_var(--ease-spring)_both]', s.c)} />
                <div className="min-w-0"><p className="text-sm font-medium text-slate-800">{t.title}</p>{t.detail && <p className="mt-0.5 text-xs text-slate-500">{t.detail}</p>}</div>
              </div>
              <button onClick={() => dismissToast(t.id)} aria-label="Fermer" className="absolute right-2 top-2 rounded p-0.5 text-slate-400 transition hover:rotate-90 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
              <span className={clsx('toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left', s.bar)} style={{ animationDuration: t.tone === 'error' ? '6.5s' : '3.8s' }} />
            </motion.div>) })}
      </AnimatePresence>
    </div>)
}

/* ---------------------------------- Célébrations ---------------------------------- */

type Burst = { id: number; size: 'small' | 'big'; x: number; y: number }
let bursts: Burst[] = []; const bl = new Set<() => void>()
const bemit = () => bl.forEach((l) => l())
const bsub = (l: () => void) => { bl.add(l); return () => { bl.delete(l) } }

/**
 * Lance des confettis. `small` : petite gerbe (validation, enregistrement) ; `big` : grand moment (exécution réussie, promotion).
 * `origin` : point de départ en pixels (par défaut le centre de l'écran).
 */
export function celebrate(size: 'small' | 'big' = 'big', origin?: { x: number; y: number }) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const b: Burst = { id: ++seq, size, x: origin?.x ?? window.innerWidth / 2, y: origin?.y ?? window.innerHeight * 0.4 }
  bursts = [...bursts, b]; bemit()
  setTimeout(() => { bursts = bursts.filter((x) => x.id !== b.id); bemit() }, 2200)
}

const COLORS = ['#4f81bd', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#38bdf8']
function BurstView({ b }: { b: Burst }) {
  const n = b.size === 'big' ? 70 : 28; const reach = b.size === 'big' ? 380 : 160
  return (
    <>{Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + Math.random(), d = reach * (0.4 + Math.random() * 0.6)
      return <span key={i} className={clsx('confetti-piece', i % 3 === 0 && 'confetti-round')} style={{ left: b.x, top: b.y, background: COLORS[i % COLORS.length], ['--x' as string]: `${Math.cos(a) * d}px`, ['--y' as string]: `${Math.sin(a) * d * 0.7 + (b.size === 'big' ? 260 : 120)}px`, ['--r' as string]: `${(Math.random() - 0.5) * 900}deg`, animationDelay: `${Math.random() * 0.12}s` }} /> })}</>)
}

export function Celebrations() {
  const list = useSyncExternalStore(bsub, () => bursts)
  if (!list.length) return null
  return <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden="true">{list.map((b) => <BurstView key={b.id} b={b} />)}</div>
}

/** Point de départ d'une célébration : centre de l'élément donné. */
export const originOf = (el: Element | null | undefined) => { if (!el) return undefined; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

/** Notification adaptée au résultat d'une validation : petite célébration si tout est vert. */
export const validationToast = (r: { status: 'ok' | 'warning' | 'error' } | undefined) =>
  !r ? undefined
    : r.status === 'ok' ? { title: 'Validation réussie', detail: 'Tous les contrôles sont au vert.', celebrate: 'small' as const }
    : r.status === 'warning' ? { title: 'Validé avec avertissements', detail: 'Consultez le rapport avant de continuer.', tone: 'info' as const }
    : { title: 'La validation a relevé des erreurs', detail: 'Corrigez les points signalés dans le rapport.', tone: 'error' as const }
