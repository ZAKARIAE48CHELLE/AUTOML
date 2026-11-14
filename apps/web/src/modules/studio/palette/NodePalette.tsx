import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Check, Lock, Search, Wand2 } from 'lucide-react'
import type { DatasetColumn, ModelSpec, Task, WorkflowSpec } from '@contracts/src'
import { NODE_TYPE_BY_ID, PIPELINE_TYPES, PREPROCESS_STEPS, pipelineType } from '@contracts/src'
import { SchemaForm } from '@/components/SchemaForm'
import { clsx } from '@/lib/format'
import { BLOCK_MIME, checklist, type Block } from './blocks'
import { NODE_SHAPE, Shape } from './Shape'
import { blockTargetId, sectionTargetId } from '@/modules/auto/targets'

/** Couleur d'un bloc = couleur de son port de sortie sur le canevas (on apprend ce qui se branche à quoi). */
export const NODE_COLOR: Record<string, string> = {
  'data.dataset': '#0e7490', 'data.split': '#7c3aed', 'data.preprocess': '#c2410c', 'train.model': '#2563eb',
  'train.tune': '#2563eb', 'eval.compare': '#65a30d', 'eval.final_test': '#2563eb', 'model.register': '#be185d',
}
export const STEP_CATEGORY: Record<string, { label: string; color: string }> = {
  cleaning: { label: 'Nettoyage', color: '#c2410c' }, encoding: { label: 'Encodage', color: '#b45309' }, scaling: { label: 'Mise à l\'échelle', color: '#a16207' },
  features: { label: 'Variables', color: '#9a3412' }, time: { label: 'Temps', color: '#059669' }, text: { label: 'Texte', color: '#d97706' },
  image: { label: 'Image', color: '#db2777' }, interactions: { label: 'Interactions', color: '#4f46e5' },
}

interface Props {
  spec: WorkflowSpec; mode: 'guided' | 'expert'; columns: DatasetColumn[]; models: (ModelSpec & { disabled?: boolean })[]
  onAdd: (b: Block) => void; onTask: (t: Task) => void; onOptions: (o: Record<string, unknown>) => void; onTemplate?: () => void
}

interface TileDef { key: string; block: Block; label: string; shape: string; color: string; hint: string; locked?: boolean; badge?: string }

function Tile({ t, suggested, onAdd }: { t: TileDef; suggested: boolean; onAdd: (b: Block) => void }) {
  const drag = (e: DragEvent) => { if (t.locked) { e.preventDefault(); return } e.dataTransfer.setData(BLOCK_MIME, JSON.stringify(t.block)); e.dataTransfer.effectAllowed = 'copy' }
  return (
    <button type="button" data-auto-target={blockTargetId(t.block)} draggable={!t.locked} onDragStart={drag} onClick={() => !t.locked && onAdd(t.block)} title={t.hint} aria-label={`Ajouter : ${t.label}`} aria-disabled={t.locked}
      className={clsx('palette-tile group relative flex flex-col items-center gap-1 rounded-xl border bg-white px-1.5 pb-1.5 pt-2 text-center text-[10.5px] font-medium leading-tight text-slate-700',
        t.locked ? 'cursor-not-allowed border-dashed border-slate-200 opacity-50' : 'cursor-grab border-slate-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-lg active:cursor-grabbing',
        suggested && 'tile-suggest')} style={{ ['--tile' as string]: t.color }}>
      <Shape kind={t.shape} color={t.color} size={30} className="transition-transform duration-300 [transition-timing-function:var(--ease-spring)] group-hover:scale-110 group-hover:-rotate-3" />
      <span className="line-clamp-2">{t.label}</span>
      {t.badge && <span className="absolute right-1 top-1 rounded bg-slate-100 px-1 text-[9px] text-slate-500">{t.badge}</span>}
      {t.locked && <Lock className="absolute left-1 top-1 h-3 w-3 text-slate-400" />}
    </button>)
}

export function NodePalette({ spec, mode, columns, models, onAdd, onTask, onOptions, onTemplate }: Props) {
  const task = spec.metadata.task; const pt = pipelineType(task)
  const [q, setQ] = useState(''); const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (mode !== 'expert') return
    const h = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target as HTMLElement)?.closest('input,textarea,select')) { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [mode])

  const node = (type: string): TileDef => { const nt = NODE_TYPE_BY_ID[type]; return { key: type, block: { kind: 'node', type }, label: nt.label, shape: NODE_SHAPE[type], color: NODE_COLOR[type], badge: nt.operation_class, hint: `${nt.label} — ${nt.owner} · classe ${nt.operation_class}\nEntrées : ${nt.input_ports.map((p) => p.type).join(', ') || '—'} · Sorties : ${nt.output_ports.map((p) => p.type).join(', ')}` } }
  const groups = useMemo(() => {
    const steps = PREPROCESS_STEPS.filter((s) => pt.step_types.includes(s.type))
    const byCat = new Map<string, TileDef[]>()
    for (const s of steps) {
      const c = STEP_CATEGORY[s.category ?? 'cleaning'] ?? STEP_CATEGORY.cleaning
      const list = byCat.get(c.label) ?? []
      list.push({ key: `step:${s.type}`, block: { kind: 'step', type: s.type }, label: s.label.replace(' (G-DL)', ''), shape: 'hexagon', color: c.color, locked: !!s.deep_learning, hint: `${s.label}\nS'applique à : ${s.applies_to.join(', ')}${s.deep_learning ? '\nFermé tant que la porte G-DL n\'est pas validée.' : ''}` })
      byCat.set(c.label, list)
    }
    const modelTiles = models.filter((m) => m.task.includes(task)).map<TileDef>((m) => ({ key: `model:${m.id}`, block: { kind: 'model', model_id: m.id }, label: m.label.replace(' (G-DL)', ''), shape: 'chip', color: '#2563eb', locked: m.disabled, badge: m.family === 'Deep learning' ? 'DL' : undefined, hint: `${m.label} — ${m.family}\n${m.dependencies.join(', ')}${m.disabled ? '\nFermé tant que la porte G-DL n\'est pas validée.' : ''}` }))
    return [
      { title: 'Données', tiles: [node('data.dataset')] },
      { title: 'Découpage', tiles: [node('data.split')] },
      ...[...byCat.entries()].map(([title, tiles]) => ({ title: `Prétraitement · ${title}`, tiles })),
      { title: 'Modèles', tiles: modelTiles },
      { title: 'Optimisation', tiles: [node('train.tune')] },
      { title: 'Évaluation', tiles: [node('eval.compare'), node('eval.final_test')] },
      { title: 'Sortie', tiles: [node('model.register')] },
    ]
  }, [task, models]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = checklist(spec); const done = steps.filter((s) => s.done).length
  const next = mode === 'guided' ? steps.find((s) => !s.done) : undefined
  const suggestedKey = next && (next.type === 'data.preprocess' ? `step:${pt.template.steps[0]?.type}` : next.type === 'train.model' ? groups.find((g) => g.title === 'Modèles')?.tiles.find((t) => !t.locked)?.key : next.type)
  const filter = q.trim().toLowerCase()
  const shown = groups.map((g) => ({ ...g, tiles: g.tiles.filter((t) => !filter || t.label.toLowerCase().includes(filter) || g.title.toLowerCase().includes(filter)) })).filter((g) => g.tiles.length)

  return (
    <div className="space-y-4">
      <section>
        <h3 data-auto-target={sectionTargetId('Type de pipeline')} className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type de pipeline</h3>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Type de pipeline">
          {PIPELINE_TYPES.map((p) => { const on = p.id === task
            return <button key={p.id} data-auto-target={`studio.type.${p.id}`} type="button" role="radio" aria-checked={on} title={`${p.label} — ${p.description}`} onClick={() => !on && onTask(p.id)}
              className={clsx('flex flex-col items-center gap-0.5 rounded-lg border p-1 text-[9.5px] leading-tight transition', on ? 'border-transparent bg-white font-semibold shadow-md' : 'border-slate-200 bg-white/60 text-slate-500 hover:-translate-y-0.5 hover:shadow')}
              style={on ? { boxShadow: `0 0 0 2px ${p.color}, 0 6px 16px -6px ${p.color}` } : undefined}>
              <Shape kind={p.shape} color={on ? p.color : '#94a3b8'} size={24} /><span className="line-clamp-2">{p.short_label}</span>
            </button> })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500"><b style={{ color: pt.color }}>{pt.label}</b> — {pt.description}</p>
        {Object.keys(pt.options_schema.properties ?? {}).length > 0 && <div className="mt-2 rounded-lg border border-slate-200 bg-white/70 p-2"><SchemaForm schema={pt.options_schema} value={spec.metadata.task_options ?? {}} onChange={onOptions} /></div>}
        {onTemplate && <button type="button" data-auto-target="studio.template" onClick={onTemplate} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-xs font-medium transition hover:bg-white" style={{ borderColor: pt.color, color: pt.color }}><Wand2 className="h-3.5 w-3.5" />Construire le pipeline type</button>}
      </section>

      {mode === 'guided' && (
        <section aria-label="Progression du pipeline" data-auto-target="studio.progress">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600"><span>Pipeline complet ?</span><span>{done}/{steps.length}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${(done / steps.length) * 100}%`, background: pt.color }} /></div>
          <ul className="mt-2 flex flex-wrap gap-1">{steps.map((s) => <li key={s.type} className={clsx('flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]', s.done ? 'bg-green-100 text-green-800' : s === next ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')}>{s.done && <Check className="h-2.5 w-2.5" />}{s.label}</li>)}</ul>
          {next && <p className="mt-1.5 text-[11px] text-slate-500">Étape suivante : <b>{next.label}</b> — le bloc qui brille ci-dessous se branche tout seul.</p>}
        </section>)}

      {mode === 'expert' && (
        <label className="relative block"><span className="sr-only">Rechercher un bloc</span><Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} className="input !py-1 !pl-7 !text-xs" placeholder="Rechercher un bloc  ( / )" value={q} onChange={(e) => setQ(e.target.value)} /></label>)}

      {shown.map((g) => (
        <section key={g.title}>
          <h3 data-auto-target={sectionTargetId(g.title)} className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
          <div className={clsx('grid gap-1.5', mode === 'expert' ? 'grid-cols-4' : 'grid-cols-3')}>{g.tiles.map((t) => <Tile key={t.key} t={t} suggested={t.key === suggestedKey} onAdd={onAdd} />)}</div>
        </section>))}
      {!shown.length && <p className="text-xs text-slate-500">Aucun bloc ne correspond à « {q} ».</p>}
      <p className="border-t pt-2 text-[11px] leading-relaxed text-slate-400">Cliquez ou glissez un bloc sur le canevas. Les couleurs correspondent aux ports : reliez une sortie à une entrée de même couleur.</p>
    </div>)
}
