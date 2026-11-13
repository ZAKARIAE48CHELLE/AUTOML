import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Code2, FileUp, Info, Plus, Replace, Shield, X, XCircle } from 'lucide-react'
import type { ModelSpec, Task, WorkflowSpec } from '@contracts/src'
import { PIPELINE_TYPES, pipelineType } from '@contracts/src'
import { dataApi } from '@/api/data'
import { Button } from '@/components/ui'
import { clsx } from '@/lib/format'
import { WorkflowCanvas } from '../WorkflowCanvas'
import { autoWire } from '../palette/blocks'
import { Shape } from '../palette/Shape'
import { buildFromCode, mergeInto, parseCode, structureErrors, type Finding } from './parse'
import { CODE_SAMPLES } from './samples'

interface Props { open: boolean; onClose: () => void; projectId?: string; current: WorkflowSpec; models?: (ModelSpec & { disabled?: boolean })[]; onApply: (spec: WorkflowSpec, how: 'replace' | 'merge') => void }

const TONE = { ok: { icon: CheckCircle2, c: 'text-green-600', line: 'bg-green-500/10 border-green-500' }, approx: { icon: AlertTriangle, c: 'text-amber-600', line: 'bg-amber-500/10 border-amber-500' }, unsupported: { icon: XCircle, c: 'text-red-600', line: 'bg-red-500/10 border-red-500' } } as const
const LH = 20 // hauteur de ligne (px), identique pour la zone de saisie, la numérotation et les surlignages

export function CodeImportDialog({ open, onClose, projectId, current, models, onApply }: Props) {
  const [code, setCode] = useState(''); const [debounced, setDebounced] = useState('')
  const [override, setOverride] = useState<Task | ''>(''); const [dsvId, setDsvId] = useState<string>(''); const [manualDs, setManualDs] = useState(false); const [focusNode, setFocusNode] = useState<string | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null); const gutter = useRef<HTMLDivElement>(null); const marks = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(code), 250); return () => clearTimeout(t) }, [code])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (open && e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [open, onClose])

  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!), enabled: open && !!projectId })
  const parsed = useMemo(() => (debounced.trim() ? parseCode(debounced) : null), [debounced])
  // Dataset : celui du pipeline courant, sinon celui dont le nom correspond au fichier lu par le code.
  const codeFile = parsed?.findings.find((f) => f.kind === 'dataset')?.data.file as string | undefined
  useEffect(() => {
    if (manualDs || !ds.data?.length) return
    const file = codeFile
    const byFile = file && ds.data.find((d) => d.name === file || d.name.replace(/\.\w+$/, '') === file.replace(/\.\w+$/, ''))
    const cur = current.nodes.find((n) => n.type === 'data.dataset')?.params.dataset_version_id as string | undefined
    const pick = (byFile && byFile.latest_version_id) || cur || ''
    if (pick && pick !== dsvId) setDsvId(pick)
  }, [ds.data, codeFile, current, manualDs]) // eslint-disable-line react-hooks/exhaustive-deps
  const row = ds.data?.find((d) => d.latest_version_id === dsvId)
  const detail = useQuery({ queryKey: ['dataset', row?.id], queryFn: () => dataApi.dataset(row!.id), enabled: !!row })
  const columns = detail.data?.versions.find((v) => v.id === dsvId)?.schema ?? []
  const task = (override || parsed?.task) as Task | undefined
  const built = useMemo(() => (parsed && task ? buildFromCode(parsed, { dsvId, columns, task, models }) : null), [parsed, task, dsvId, columns, models])
  const errors = built ? structureErrors(built.spec) : []
  const findings = built?.findings ?? parsed?.findings ?? []

  const lines = code.split('\n')
  const lineTone = useMemo(() => {
    const m = new Map<number, { tone: Finding['status']; focus: boolean }>()
    const rank = { unsupported: 3, approx: 2, ok: 1 }
    for (const f of findings) for (let l = f.line; l <= f.end; l++) { const prev = m.get(l); const focus = !!focusNode && f.node === focusNode; if (!prev || rank[f.status] > rank[prev.tone] || focus) m.set(l, { tone: prev && rank[prev.tone] > rank[f.status] ? prev.tone : f.status, focus: focus || !!prev?.focus }) }
    return m
  }, [findings, focusNode])
  const sync = () => { const t = ta.current!; if (gutter.current) gutter.current.scrollTop = t.scrollTop; if (marks.current) { marks.current.scrollTop = t.scrollTop; marks.current.scrollLeft = t.scrollLeft } }
  const goTo = (line: number) => { const t = ta.current; if (!t) return; t.focus(); t.scrollTop = Math.max(0, (line - 4) * LH); const pos = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0); t.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0)); sync() }
  const upload = async (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { setCode(await f.text()); setOverride(''); setManualDs(false); setFocusNode(null) } e.target.value = '' }
  const sample = (t: Task) => { setCode(CODE_SAMPLES[t]); setOverride(''); setManualDs(false); setFocusNode(null) }
  const apply = (how: 'replace' | 'merge') => { if (!built) return; onApply(how === 'replace' ? built.spec : mergeInto(current, built.spec, autoWire), how); onClose() }
  if (!open) return null
  const pt = task ? pipelineType(task) : undefined
  const counts = { ok: findings.filter((f) => f.status === 'ok').length, approx: findings.filter((f) => f.status === 'approx').length, unsupported: findings.filter((f) => f.status === 'unsupported').length }

  return createPortal(
    <motion.div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-modal="true" aria-label="Code vers pipeline" onClick={onClose}>
      <motion.div className="flex h-[min(92vh,880px)] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" initial={{ scale: 0.94, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }} onClick={(e) => e.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
          <Code2 className="h-5 w-5 text-brand-600" /><h2 className="font-semibold text-slate-900">Code → Pipeline</h2>
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-800"><Shield className="h-3 w-3" />Analyse statique : le code n'est jamais exécuté</span>
          <div className="ml-auto flex items-center gap-2">
            <select className="input !h-8 !w-56 !py-0 !text-xs" aria-label="Charger un exemple" value="" onChange={(e) => e.target.value && sample(e.target.value as Task)}><option value="">Charger un exemple…</option>{PIPELINE_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            <label className="btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><FileUp className="h-3.5 w-3.5" />.py / .ipynb<input type="file" accept=".py,.ipynb,.txt" className="sr-only" onChange={upload} /></label>
            <button onClick={onClose} aria-label="Fermer" className="rounded p-1 text-slate-500 transition hover:rotate-90 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Éditeur : numérotation + surlignages synchronisés avec la zone de saisie */}
          <div className="relative flex min-h-0 border-r border-slate-200 bg-slate-50 font-mono text-xs">
            <div ref={gutter} className="w-10 shrink-0 overflow-hidden border-r border-slate-200 py-3 text-right text-slate-400" aria-hidden="true">{lines.map((_, i) => <div key={i} style={{ height: LH, lineHeight: `${LH}px` }} className="pr-2">{i + 1}</div>)}</div>
            <div className="relative min-w-0 flex-1">
              <div ref={marks} className="pointer-events-none absolute inset-0 overflow-hidden py-3" aria-hidden="true">{lines.map((_, i) => { const m = lineTone.get(i + 1); return <div key={i} style={{ height: LH }} className={clsx('border-l-2', m ? TONE[m.tone].line : 'border-transparent', m?.focus && 'ring-1 ring-inset ring-brand-500 !bg-brand-500/20')} /> })}</div>
              <textarea ref={ta} value={code} onChange={(e) => setCode(e.target.value)} onScroll={sync} spellCheck={false} wrap="off" aria-label="Code Python"
                placeholder={'# Collez un script Python (scikit-learn, pandas, statsmodels, implicit, torchvision…)\n# ou chargez un exemple / un fichier .py ou .ipynb.'}
                className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-3 py-3 text-slate-800 outline-none placeholder:text-slate-400" style={{ lineHeight: `${LH}px`, tabSize: 4 }} />
            </div>
          </div>
          {/* Résultat */}
          <div className="flex min-h-0 flex-col overflow-y-auto p-4">
            {!parsed ? <div className="m-auto max-w-sm text-center text-sm text-slate-500"><Code2 className="float mx-auto mb-2 h-8 w-8 text-brand-500/60" />Collez du code ou chargez un exemple : le pipeline se construit ici en direct, chaque ligne reconnue est colorée.</div> : <>
              <div className="flex flex-wrap items-center gap-3">
                {pt && <Shape kind={pt.shape} color={pt.color} size={40} />}
                <div className="min-w-0 flex-1"><p className="text-xs text-slate-500">Type de pipeline détecté{override ? ' (forcé)' : ` · ${parsed.taskReason}`}</p>
                  <select className="input !mt-0.5 !h-8 !py-0 !text-sm !font-semibold" aria-label="Type de pipeline" value={task} onChange={(e) => setOverride(e.target.value as Task)}>{PIPELINE_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
                <label className="w-56 text-xs"><span className="label">Dataset</span><select className="input !h-8 !py-0 !text-xs" value={dsvId} onChange={(e) => { setDsvId(e.target.value); setManualDs(true) }}><option value="">— choisir —</option>{ds.data?.filter((d) => d.latest_version_id).map((d) => <option key={d.id} value={d.latest_version_id!}>{d.name}</option>)}</select></label>
              </div>
              <div className="mt-3 flex gap-2 text-[11px]">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">{counts.ok} reconnu(s)</span>
                {counts.approx > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{counts.approx} approximé(s)</span>}
                {counts.unsupported > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{counts.unsupported} non pris en charge</span>}
                {errors.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{errors.length} erreur(s) de structure</span>}
              </div>
              <div className="mt-3 h-64 shrink-0 overflow-hidden rounded-xl border border-slate-200">{built && <WorkflowCanvas key={`${task}-${dsvId}`} spec={built.spec} readOnly height="100%" selected={focusNode} onSelect={(id) => setFocusNode(id)} />}</div>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Info className="h-3 w-3" />Cliquez un nœud de l'aperçu pour surligner ses lignes de code.</p>
              <ul className="mt-3 space-y-1">{findings.map((f, i) => { const T = TONE[f.status]; const I = T.icon
                return <li key={i}><button type="button" onClick={() => { goTo(f.line); if (f.node) setFocusNode(f.node) }} className={clsx('flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs transition hover:bg-slate-50', f.node && f.node === focusNode && 'bg-brand-50')}>
                  <I className={clsx('mt-0.5 h-3.5 w-3.5 shrink-0', T.c)} /><span className="min-w-0 flex-1 text-slate-700">{f.label}</span><span className="shrink-0 font-mono text-[10px] text-slate-400">L{f.line}{f.node ? ` → ${f.node}` : ''}</span></button></li> })}</ul>
            </>}
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-2.5">
          <p className="mr-auto text-[11px] text-slate-500">Le résultat devient des modifications non enregistrées : « Enregistrer » crée une nouvelle version, l'existante reste intacte.</p>
          <Button variant="secondary" size="sm" disabled={!built} onClick={() => apply('merge')} title="Ajoute les étapes et les modèles du code au pipeline actuel"><Plus className="h-3.5 w-3.5" />Ajouter au pipeline</Button>
          <Button size="sm" disabled={!built || !dsvId} onClick={() => apply('replace')} title={!dsvId ? 'Choisissez d\'abord un dataset' : undefined}><Replace className="h-3.5 w-3.5" />Remplacer le pipeline</Button>
        </footer>
      </motion.div>
    </motion.div>, document.body)
}
