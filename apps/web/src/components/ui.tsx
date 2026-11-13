import { useId, type CSSProperties, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CountUp } from './Motion'
import { Loader2, AlertTriangle, Info, X, FlaskConical, CheckCircle2, XCircle, Clock, Ban, MinusCircle, Database } from 'lucide-react'
import { clsx } from '@/lib/format'
import { HttpError, mockedModules } from '@/api/client'

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; loading?: boolean }) {
  const v = { primary: 'btn-primary text-white', secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50', danger: 'bg-gradient-to-r from-red-600 to-rose-500 text-white', ghost: 'text-slate-600 hover:bg-slate-100' }[variant]
  return <button {...p} disabled={p.disabled || loading} className={clsx('btn inline-flex items-center justify-center gap-1.5 rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-50', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', v, className)}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}</button>
}
export const Skeleton = ({ className, style }: { className?: string; style?: CSSProperties }) => <div className={clsx('skeleton', className)} style={style} />
/** Squelettes de chargement à la forme du contenu attendu (tableau, cartes, page détail, canevas, conversation). */
export type SkeletonShape = 'lines' | 'table' | 'cards' | 'detail' | 'canvas' | 'chat'
const SK_W = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5']
function SkeletonBody({ shape }: { shape: SkeletonShape }) {
  switch (shape) {
    case 'table': return (
      <div className="card overflow-hidden"><div className="flex gap-4 border-b border-slate-100 bg-slate-50 px-3 py-2.5">{[24, 16, 20, 12].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}</div>
        {Array.from({ length: 6 }, (_, r) => <div key={r} className="flex items-center gap-4 border-b border-slate-100 px-3 py-3 last:border-0" style={{ animation: `fadeIn .4s ${r * 0.05}s both` }}><Skeleton className="h-3.5 w-[24%]" /><Skeleton className="h-3.5 w-[16%]" /><Skeleton className="h-5 w-16 !rounded-full" /><Skeleton className="ml-auto h-3.5 w-[12%]" /></div>)}</div>)
    case 'cards': return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4" style={{ animation: `fadeIn .4s ${i * 0.06}s both` }}><div className="flex items-center gap-2"><Skeleton className="h-8 w-8 !rounded-lg" /><Skeleton className="h-4 w-1/2" /></div><Skeleton className="mt-3 h-3 w-full" /><Skeleton className="mt-2 h-3 w-4/5" /><div className="mt-4 flex gap-2"><Skeleton className="h-5 w-14 !rounded-full" /><Skeleton className="h-5 w-20 !rounded-full" /></div></div>)}</div>)
    case 'detail': return (
      <div className="space-y-4"><div><Skeleton className="h-6 w-64" /><Skeleton className="mt-2 h-3.5 w-96 max-w-full" /></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-3"><Skeleton className="h-3 w-1/2" /><Skeleton className="mt-2 h-6 w-2/3" /></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2"><Skeleton className="h-4 w-40" /><Skeleton className="mt-4 h-40 w-full" /></div><div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"><Skeleton className="h-4 w-28" />{SK_W.map((w, i) => <Skeleton key={i} className={clsx('h-3', w)} />)}</div></div></div>)
    case 'canvas': return (
      <div className="relative h-[60vh] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] dark:[background-image:radial-gradient(#1e2a44_1px,transparent_1px)] [background-size:18px_18px]">
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true"><path d="M 230 130 C 300 130, 300 230, 370 230 M 550 230 C 620 230, 620 130, 690 130" className="fill-none stroke-slate-300" strokeWidth="2" strokeDasharray="6 5" style={{ animation: 'dashFlow .9s linear infinite' }} /></svg>
        {[[50, 90], [370, 190], [690, 90]].map(([x, y], i) => <div key={i} className="absolute w-44 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm" style={{ left: x, top: y, animation: `popIn .5s var(--ease-spring) ${i * 0.12}s both` }}><Skeleton className="h-3.5 w-2/3" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-1.5 h-3 w-1/2" /></div>)}</div>)
    case 'chat': return (
      <div className="space-y-3">{[['w-3/5', false], ['w-4/5', true], ['w-2/5', false]].map(([w, me], i) => <div key={i} className={clsx('flex', me ? 'justify-end' : 'justify-start')}><Skeleton className={clsx('h-10 !rounded-2xl', w as string)} /></div>)}</div>)
    default: return <div className="space-y-2.5">{SK_W.slice(0, 3).map((w, i) => <Skeleton key={i} className={clsx('h-4', w)} />)}<Skeleton className="h-24 w-full" /></div>
  }
}
export const Spinner = ({ label, shape = 'lines' }: { label?: string; shape?: SkeletonShape }) => (
  <div className="space-y-3 p-2" role="status" aria-live="polite" aria-busy="true"><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-brand-500" />{label ?? 'Chargement…'}</div>
    <SkeletonBody shape={shape} /></div>)
export const Card = ({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) => (
  <section className={clsx('card', className)}>{(title || actions) && <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><h3 className="text-sm font-semibold text-slate-700">{title}</h3>{actions}</header>}<div className="p-4">{children}</div></section>)
export const PageHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="bg-gradient-to-r from-brand-900 to-brand-600 bg-clip-text text-xl font-semibold text-transparent" style={{ animation: 'fadeUp .5s var(--ease-out) both' }}>{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-500" style={{ animation: 'fadeUp .6s var(--ease-out) .08s both' }}>{subtitle}</p>}</div><div className="flex gap-2" style={{ animation: 'fadeUp .6s var(--ease-out) .14s both' }}>{actions}</div></div>)
export const EmptyState = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-brand-100 bg-white/80 p-10 text-center" style={{ animation: 'fadeUp .5s var(--ease-out) both' }}><Database className="float h-7 w-7 text-brand-500/60" /><p className="text-sm font-medium text-slate-600">{title}</p>{hint && <p className="max-w-md text-xs text-slate-500">{hint}</p>}{action}</div>)

export function ErrorBanner({ error, onClose }: { error: unknown; onClose?: () => void }) {
  if (!error) return null
  const e = error as HttpError; const details = (e.details && typeof e.details === 'object') ? e.details as any : null
  return (
    <div role="alert" className="shake-once mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1"><div className="font-medium">{e.code ? `${e.code} — ` : ''}{e.message}</div>
        {details?.missing && <ul className="mt-1 list-disc pl-5 text-xs">{details.missing.map((m: any, i: number) => <li key={i}>{m.operation_class} sur {m.node_ids.join(', ')}</li>)}</ul>}
        {e.request_id && <div className="mt-1 text-xs text-red-600">request_id : {e.request_id}</div>}</div>
      {onClose && <button onClick={onClose} aria-label="Fermer"><X className="h-4 w-4" /></button>}</div>)
}
/** Bandeau permanent : indique quels modules répondent via le mock. */
export function SimulationBanner() {
  const m = mockedModules(); if (!m.length) return null
  return <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800"><FlaskConical className="h-3.5 w-3.5" />Données simulées (mock) — modules : {m.join(', ')}. Aucune donnée réelle n'est lue ni écrite.</div>
}
export const SimBadge = () => <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"><FlaskConical className="h-3 w-3" />simulé</span>
export const Note = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) => <div style={{ animation: 'fadeUp .45s var(--ease-out) both' }} className={clsx('flex gap-2 rounded-lg border p-3 text-xs', tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50 text-blue-800')}><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div>{children}</div></div>

const ST: Record<string, { c: string; l: string; i: any }> = {
  succeeded: { c: 'bg-green-100 text-green-800', l: 'Réussi', i: CheckCircle2 }, failed: { c: 'bg-red-100 text-red-800', l: 'Échec', i: XCircle },
  running: { c: 'bg-blue-100 text-blue-800', l: 'En cours', i: Loader2 }, queued: { c: 'bg-slate-100 text-slate-700', l: 'En file', i: Clock },
  pending: { c: 'bg-slate-100 text-slate-600', l: 'En attente', i: Clock }, cancelled: { c: 'bg-orange-100 text-orange-800', l: 'Annulé', i: Ban },
  skipped: { c: 'bg-slate-100 text-slate-500', l: 'Ignoré', i: MinusCircle }, importing: { c: 'bg-blue-100 text-blue-800', l: 'Import…', i: Loader2 }, ready: { c: 'bg-green-100 text-green-800', l: 'Prêt', i: CheckCircle2 },
  draft: { c: 'bg-slate-100 text-slate-700', l: 'Brouillon', i: Clock }, validated: { c: 'bg-blue-100 text-blue-800', l: 'Validé', i: CheckCircle2 }, approved: { c: 'bg-green-100 text-green-800', l: 'Approuvé', i: CheckCircle2 },
  active: { c: 'bg-green-100 text-green-800', l: 'Active', i: CheckCircle2 }, revoked: { c: 'bg-red-100 text-red-800', l: 'Révoquée', i: Ban }, expired: { c: 'bg-slate-100 text-slate-600', l: 'Consommée/expirée', i: Clock },
  ok: { c: 'bg-green-100 text-green-800', l: 'OK', i: CheckCircle2 }, warning: { c: 'bg-amber-100 text-amber-800', l: 'Avertissement', i: AlertTriangle }, error: { c: 'bg-red-100 text-red-800', l: 'Erreur', i: XCircle },
}
export function StatusBadge({ status, cached }: { status: string; cached?: boolean }) {
  const s = ST[status] ?? { c: 'bg-slate-100 text-slate-700', l: status, i: Clock }; const I = s.i
  const live = status === 'running' || status === 'importing'
  return <span key={status} className={clsx('badge-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.c, live && 'badge-running')}><I className={clsx('h-3 w-3', live && 'animate-spin', (status === 'succeeded' || status === 'ok' || status === 'ready') && '[animation:checkPop_.5s_var(--ease-spring)_both]')} />{s.l}{cached && <span className="ml-1 rounded bg-white/60 px-1 text-[10px]">cache</span>}</span>
}
export const JobProgress = ({ value, status }: { value: number; status?: string }) => (
  <div className="flex items-center gap-2"><div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200"><div className={clsx('h-full rounded-full transition-all duration-500 ease-out', status === 'failed' ? 'bg-red-500' : 'bg-gradient-to-r from-brand-500 to-sky-400', value < 1 && status !== 'failed' && status !== 'cancelled' && 'progress-stripes')} style={{ width: `${Math.round(value * 100)}%` }} /></div><span className="w-9 text-xs text-slate-500">{Math.round(value * 100)} %</span></div>)

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  const id = useId()
  return <div className="mb-4 flex gap-1 border-b border-slate-200">{tabs.map((t) => <button key={t.id} onClick={() => onChange(t.id)} className={clsx('relative px-3 py-2 text-sm font-medium transition-colors', value === t.id ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800')}>{t.label}{value === t.id && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-brand-600" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}</button>)}</div>
}
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <AnimatePresence>{open && (
      <motion.div key="m" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
        <motion.div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white shadow-2xl" initial={{ opacity: 0, scale: 0.9, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }} onClick={(e) => e.stopPropagation()}>
          <header className="flex items-center justify-between border-b px-4 py-3"><h2 className="font-semibold">{title}</h2><button onClick={onClose} aria-label="Fermer" className="rounded p-1 transition hover:rotate-90 hover:bg-slate-100"><X className="h-4 w-4" /></button></header><div className="p-4">{children}</div>{footer && <footer className="flex justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
        </motion.div></motion.div>)}</AnimatePresence>)
}
export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => <div className="card overflow-x-auto"><table className="w-full"><thead className="border-b bg-slate-50"><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>
export const Metric = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => <div className="card-hover rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all duration-300" style={{ animation: 'popIn .5s var(--ease-spring) both' }}><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold tabular-nums text-slate-900"><CountUp value={value} /></div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
