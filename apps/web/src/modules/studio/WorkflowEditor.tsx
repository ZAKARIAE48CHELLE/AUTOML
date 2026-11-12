import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, GitCompare, Maximize2, Minimize2, PanelLeft, PanelRight, Plus, Save, ShieldCheck, Trash2, Undo2, X } from 'lucide-react'
import type { JsonSchema, WorkflowSpec, ValidationReport, NodeType, DatasetColumn } from '@contracts/src'
import { NODE_TYPES, NODE_TYPE_BY_ID, validateStructure, contentHash } from '@contracts/src'
import { studioApi } from '@/api/studio'
import { dataApi } from '@/api/data'
import { trainingApi } from '@/api/training'
import { useSession } from '@/lib/session'
import { Button, ErrorBanner, Modal, Note, Spinner, StatusBadge } from '@/components/ui'
import { SchemaForm, type Widgets } from '@/components/SchemaForm'
import { StepsEditor } from '@/components/StepsEditor'
import { ValidationReportView } from '@/components/ValidationReportView'
import { WorkflowCanvas, type Sev } from './WorkflowCanvas'
import { clsx, fmtDate, shortId } from '@/lib/format'

const defaultsFor = (s: JsonSchema): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [k, p] of Object.entries(s.properties ?? {})) { if (p.default !== undefined) out[k] = p.default; else if (p.type === 'object' && p.properties && s.required?.includes(k)) out[k] = defaultsFor(p); else if (p.type === 'array' && s.required?.includes(k)) out[k] = [] }
  return out
}
const sevMap = (issues: { node_id?: string; severity: string }[]): Record<string, Sev> => { const m: Record<string, Sev> = {}; for (const i of issues) if (i.node_id && (i.severity === 'error' || i.severity === 'warning')) { if (m[i.node_id] !== 'error') m[i.node_id] = i.severity as Sev } return m }

// Préférence d'affichage des panneaux, par navigateur (confort uniquement : tout fonctionne sans).
const PANELS_KEY = 'studio.editor.panels'
function readPanels(): { left: boolean; right: boolean } {
  try { const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? ''); return { left: v.left !== false, right: v.right !== false } } catch { return { left: true, right: true } }
}
function writePanels(p: { left: boolean; right: boolean }) { try { localStorage.setItem(PANELS_KEY, JSON.stringify(p)) } catch { /* stockage indisponible */ } }

/** Panneau latéral ancré à côté du canevas (il ne recouvre jamais les nœuds), repliable. */
function SidePanel({ side, title, open, onClose, width, children, actions }: { side: 'left' | 'right'; title: ReactNode; open: boolean; onClose: () => void; width: number; children: ReactNode; actions?: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside key={side} aria-label={typeof title === 'string' ? title : undefined}
          initial={{ width: 0, opacity: 0 }} animate={{ width, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}
          className={clsx('relative z-10 shrink-0 overflow-hidden bg-white', side === 'left' ? 'border-r border-slate-200' : 'border-l border-slate-200')}>
          <div style={{ width }} className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{title}</h2>
              {actions}
              <button onClick={onClose} aria-label="Masquer le panneau" title="Masquer le panneau" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** Languette visible quand un panneau est masqué, pour le rouvrir. */
function PanelTab({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronRight : ChevronLeft
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={clsx('absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 border border-slate-200 bg-white/95 px-1.5 py-3 text-xs font-medium text-slate-600 shadow-md backdrop-blur hover:text-brand-700', side === 'left' ? 'left-0 rounded-r-lg border-l-0' : 'right-0 flex-row-reverse rounded-l-lg border-r-0')}>
      <Icon className="h-4 w-4" /><span className="[writing-mode:vertical-rl]">{label}</span>
    </button>
  )
}

export function WorkflowEditor() {
  const { workflowId } = useParams(); const [sp, setSp] = useSearchParams(); const qc = useQueryClient(); const { projectId } = useSession()
  const wq = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => studioApi.workflow(workflowId!) })
  const versionId = sp.get('v') ?? wq.data?.workflow.latest_version_id
  const vq = useQuery({ queryKey: ['version', workflowId, versionId], queryFn: () => studioApi.version(workflowId!, versionId!), enabled: !!versionId })
  const caps = useQuery({ queryKey: ['resources'], queryFn: trainingApi.resources })
  const [spec, setSpec] = useState<WorkflowSpec>(); const [sel, setSel] = useState<string | null>(null); const [report, setReport] = useState<ValidationReport>(); const [diffOpen, setDiffOpen] = useState(false); const [label, setLabel] = useState('')
  useEffect(() => { if (vq.data) { setSpec(structuredClone(vq.data.spec)); setSel(null); setReport(undefined) } }, [vq.data?.id])
  const orig = vq.data?.spec
  const dirty = !!spec && !!orig && JSON.stringify(spec) !== JSON.stringify(orig)
  const contentChanged = !!spec && !!orig && contentHash(spec) !== contentHash(orig)

  // Panneaux latéraux + plein écran navigateur
  const [panels, setPanels] = useState(readPanels)
  const setPanel = useCallback((side: 'left' | 'right', open: boolean) => setPanels((p) => { const n = { ...p, [side]: open }; writePanels(n); return n }), [])
  // Doit rester stable : WorkflowCanvas resynchronise ses nœuds quand onSelect change.
  const select = useCallback((id: string | null) => { setSel(id); if (id) setPanel('right', true) }, [setPanel])
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => { const h = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h) }, [])
  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }, []) // quitter le plein écran en quittant l'éditeur
  const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void document.documentElement.requestFullscreen?.().catch(() => {}) }

  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!) })
  const dsvId = spec?.nodes.find((n) => n.type === 'data.dataset')?.params.dataset_version_id as string | undefined
  const dsRow = ds.data?.find((d) => d.latest_version_id === dsvId)
  const dsDetail = useQuery({ queryKey: ['dataset', dsRow?.id], queryFn: () => dataApi.dataset(dsRow!.id), enabled: !!dsRow })
  const columns: DatasetColumn[] = dsDetail.data?.versions.find((v) => v.id === dsvId)?.schema ?? []
  const models = useQuery({ queryKey: ['models', spec?.metadata.task], queryFn: () => trainingApi.models(spec?.metadata.task), enabled: !!spec })
  const diffQ = useQuery({ queryKey: ['diff', workflowId, versionId], queryFn: () => studioApi.diff(workflowId!, versionId!, vq.data!.parent_version_id!), enabled: diffOpen && !!vq.data?.parent_version_id })

  const local = useMemo(() => (spec ? validateStructure(spec, { caps: caps.data?.budget_caps }) : []), [spec, caps.data])
  const severity = useMemo(() => sevMap([...local, ...(report && !dirty ? report.layers.flatMap((l) => l.issues) : [])]), [local, report, dirty])

  const save = useMutation({ mutationFn: () => studioApi.newVersion(workflowId!, versionId!, spec!, label || undefined), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['workflow', workflowId] }); qc.invalidateQueries({ queryKey: ['workflows'] }); setLabel(''); if (!r.unchanged) setSp({ v: r.version_id }); } })
  const validate = useMutation({ mutationFn: () => studioApi.validate(workflowId!, versionId!), onSuccess: (r) => { setReport(r); qc.invalidateQueries({ queryKey: ['workflow', workflowId] }); qc.invalidateQueries({ queryKey: ['version', workflowId, versionId] }) } })

  if (wq.isLoading || vq.isLoading || !spec) return <Spinner />
  if (wq.error || vq.error) return <ErrorBanner error={wq.error ?? vq.error} />
  const v = vq.data!; const node = spec.nodes.find((n) => n.id === sel); const nt: NodeType | undefined = node && NODE_TYPE_BY_ID[node.type]
  const add = (t: NodeType) => {
    if (t.type === 'data.dataset' && spec.nodes.some((n) => n.type === 'data.dataset')) return
    const n = Math.max(0, ...spec.nodes.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1; const maxX = Math.max(0, ...spec.nodes.map((x) => x.ui?.x ?? 0))
    const params = defaultsFor(t.params_schema); if (t.type === 'train.model' || t.type === 'train.tune') { params.model_id = models.data?.find((m) => !m.disabled)?.id; params.primary_metric = spec.metadata.objective?.primary_metric ?? params.primary_metric }
    setSpec({ ...spec, nodes: [...spec.nodes, { id: `n${n}`, type: t.type, type_version: t.version, params, ui: { x: maxX + 40, y: 200 } }] }); select(`n${n}`)
  }
  const opts = { dataset_versions: (ds.data ?? []).filter((d) => d.latest_version_id).map((d) => ({ value: d.latest_version_id!, label: `${d.name} (${d.latest_version_id})` })), columns: columns.map((c) => ({ value: c.name, label: `${c.name} (${c.dtype})` })), models: (models.data ?? []).map((m) => ({ value: m.id, label: m.label + (m.disabled ? ' — fermé (G-DL)' : '') })) }
  const widgets: Widgets = {
    steps: ({ value, onChange }) => <StepsEditor value={value} onChange={onChange} columns={columns} />,
    model_params: ({ value, onChange }) => { const m = models.data?.find((x) => x.id === node?.params.model_id); return m ? <div className="rounded-md border border-slate-200 p-3"><SchemaForm schema={m.params_schema} value={value ?? {}} onChange={onChange} /></div> : <p className="text-xs text-slate-500">Choisissez d'abord un modèle.</p> },
    search_space: ({ value, onChange }) => { const m = models.data?.find((x) => x.id === node?.params.model_id); const props = Object.entries(m?.params_schema.properties ?? {}); return props.length ? <div className="space-y-2">{props.map(([k, s]) => { const r = (value?.[k] as number[] | undefined) ?? []; return <div key={k} className="flex items-center gap-2 text-xs"><span className="w-28 truncate font-mono">{k}</span><input className="input" type="number" aria-label={`${k} min`} placeholder={String(s.minimum)} value={r[0] ?? ''} onChange={(e) => onChange({ ...value, [k]: [Number(e.target.value), r[1] ?? s.maximum] })} /><span>→</span><input className="input" type="number" aria-label={`${k} max`} placeholder={String(s.maximum)} value={r[1] ?? ''} onChange={(e) => onChange({ ...value, [k]: [r[0] ?? s.minimum, Number(e.target.value)] })} /></div> })}</div> : <p className="text-xs text-slate-500">Choisissez d'abord un modèle.</p> },
  }
  const nodeIssues = [...local, ...(report && !dirty ? report.layers.flatMap((l) => l.issues) : [])].filter((i) => i.node_id === sel)
  const deleteNode = () => { if (!node) return; setSpec({ ...spec, nodes: spec.nodes.filter((n) => n.id !== node.id), edges: spec.edges.filter((e) => e.from.node !== node.id && e.to.node !== node.id) }); setSel(null) }
  const errorCount = local.filter((i) => i.severity === 'error').length

  // Rendu dans document.body : la transition de page (transform) ferait sinon de `fixed` un positionnement relatif.
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50" data-testid="workflow-editor">
      {/* Barre d'outils */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
        <Link to="/studio" title="Retour au Studio"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" />Studio</Button></Link>
        <div className="min-w-0 max-w-[28rem]">
          <h1 className="truncate text-sm font-semibold text-slate-900">{wq.data!.workflow.name}</h1>
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">Version <b>{shortId(v.id)}</b> · {v.origin === 'ai' ? 'proposée par l\'IA' : 'humaine'} · {fmtDate(v.created_at)} · <StatusBadge status={v.readiness} />{dirty && <span className="font-medium text-amber-700">· modifications non enregistrées</span>}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select className="input !h-8 !w-52 !py-0 !text-xs" aria-label="Version" value={v.id} onChange={(e) => setSp({ v: e.target.value })}>{wq.data!.versions.map((x, i) => <option key={x.id} value={x.id}>{i === 0 ? '★ ' : ''}{shortId(x.id)} — {x.label ?? (x.origin === 'ai' ? 'plan IA' : 'édition')}</option>)}</select>
          <input className="input !h-8 !w-44 !py-0 !text-xs" placeholder="Libellé de version" aria-label="Libellé" value={label} onChange={(e) => setLabel(e.target.value)} disabled={!dirty} />
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}><Save className="h-3.5 w-3.5" />Enregistrer</Button>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setSpec(structuredClone(orig!)); setSel(null) }}><Undo2 className="h-3.5 w-3.5" />Annuler</Button>
          <Button size="sm" variant="secondary" disabled={dirty} loading={validate.isPending} onClick={() => validate.mutate()} title={dirty ? 'Enregistrez d\'abord : une version est immuable' : 'Validation serveur'}><ShieldCheck className="h-3.5 w-3.5" />Valider</Button>
          {v.parent_version_id && <Button size="sm" variant="secondary" onClick={() => setDiffOpen(true)}><GitCompare className="h-3.5 w-3.5" />Différences</Button>}
          <Link to={dirty ? '#' : `/studio/workflows/${workflowId}/review/${v.id}`} onClick={(e) => dirty && e.preventDefault()}><Button size="sm" variant="secondary" disabled={dirty}><ClipboardCheck className="h-3.5 w-3.5" />Revue & exécution</Button></Link>
          <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
          <button onClick={() => setPanel('left', !panels.left)} aria-pressed={panels.left} title={panels.left ? 'Masquer les nœuds' : 'Afficher les nœuds'} className={clsx('rounded-lg p-1.5 transition', panels.left ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}><PanelLeft className="h-4 w-4" /></button>
          <button onClick={() => setPanel('right', !panels.right)} aria-pressed={panels.right} title={panels.right ? 'Masquer les propriétés' : 'Afficher les propriétés'} className={clsx('rounded-lg p-1.5 transition', panels.right ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}><PanelRight className="h-4 w-4" /></button>
          <button onClick={toggleFullscreen} title={fullscreen ? 'Quitter le plein écran' : 'Plein écran (masque le navigateur)'} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100">{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        </div>
      </header>

      {/* Panneau gauche | canevas plein écran | panneau droit */}
      <div className="flex min-h-0 flex-1">
        <SidePanel side="left" title="Nœuds" open={panels.left} onClose={() => setPanel('left', false)} width={232}>
          <ul className="space-y-1">{NODE_TYPES.map((t) => { const off = t.type === 'data.dataset' && spec.nodes.some((n) => n.type === 'data.dataset'); return <li key={t.type}><button disabled={off} onClick={() => add(t)} title={`${t.type} — ${t.owner}${off ? ' (un seul dataset par workflow)' : ''}`} className="flex w-full items-center gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-40"><Plus className="h-3 w-3" />{t.label}<span className="ml-auto text-[10px] text-slate-400">{t.operation_class}</span></button></li> })}</ul>
          <div className="mt-3 border-t pt-2"><label className="label" htmlFor="task">Tâche</label><select id="task" className="input" value={spec.metadata.task} onChange={(e) => setSpec({ ...spec, metadata: { ...spec.metadata, task: e.target.value as 'classification' | 'regression' } })}><option value="classification">classification</option><option value="regression">régression</option></select></div>
          <p className="mt-3 border-t pt-2 text-[11px] leading-relaxed text-slate-400">Glissez d'un port de sortie (●) vers un port d'entrée de même couleur. Seules les connexions de types compatibles sont acceptées. Suppr. pour retirer la sélection.</p>
        </SidePanel>

        <div className="relative min-w-0 flex-1">
          <WorkflowCanvas spec={spec} onChange={setSpec} selected={sel} onSelect={select} severity={severity} height="100%" bare />

          {(v.origin === 'ai' || save.error || validate.error || (dirty && !contentChanged)) && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
              <div className="pointer-events-auto w-full max-w-xl space-y-2">
                <ErrorBanner error={save.error ?? validate.error} />
                {v.origin === 'ai' && !dirty && <Note>Version proposée par l'assistant. L'enregistrement crée une <b>nouvelle version humaine</b>, la proposition d'origine reste intacte.</Note>}
                {dirty && !contentChanged && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 shadow-sm">Mise en page seule : elle n'est pas versionnée si le contenu est identique.</p>}
              </div>
            </div>
          )}

          {!panels.left && <PanelTab side="left" label="Nœuds" onClick={() => setPanel('left', true)} />}
          {!panels.right && <PanelTab side="right" label={errorCount ? `Propriétés · ${errorCount} erreur(s)` : 'Propriétés'} onClick={() => setPanel('right', true)} />}
        </div>

        <SidePanel side="right" open={panels.right} onClose={() => setPanel('right', false)} width={340}
          title={node ? `${nt?.label ?? node.type} · ${node.id}` : 'Propriétés'}
          actions={node && <button aria-label="Supprimer le nœud" title="Supprimer le nœud" onClick={deleteNode} className="rounded p-1 hover:bg-red-50"><Trash2 className="h-4 w-4 text-red-500" /></button>}>
          {node && nt ? <div className="space-y-3"><p className="text-[11px] text-slate-400">{nt.type} v{nt.version} · {nt.owner} · classe {nt.operation_class}</p>
            <SchemaForm schema={nt.params_schema} value={node.params} onChange={(p) => setSpec({ ...spec, nodes: spec.nodes.map((n) => (n.id === node.id ? { ...n, params: p } : n)) })} options={opts} widgets={widgets} hide={[...(node.params.strategy === 'group' ? [] : ['group_column']), ...(node.params.strategy === 'time' ? [] : ['time_column']), ...(node.type === 'data.split' && node.params.cv_folds !== 1 ? ['val_ratio'] : [])]} />
            {nodeIssues.length > 0 && <ul className="space-y-1">{nodeIssues.map((i, k) => <li key={k} className={`rounded border px-2 py-1 text-xs ${i.severity === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><b>{i.code}</b> {i.message}</li>)}</ul>}</div>
            : <p className="text-sm text-slate-500">Sélectionnez un nœud pour éditer ses paramètres.</p>}
          <section className="mt-4 border-t pt-3">
            <h3 className="mb-2 text-xs font-semibold text-slate-600">{`Validation${report && !dirty ? ' (serveur)' : ' locale (structure)'}`}</h3>
            {report && !dirty ? <ValidationReportView report={report} onSelectNode={select} compact /> : local.length ? <ul className="space-y-1">{local.map((i, k) => <li key={k} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"><b>{i.code}</b> — {i.message}{i.node_id && <button className="ml-1 underline" onClick={() => select(i.node_id!)}>{i.node_id}</button>}{i.hint && <div className="opacity-80">→ {i.hint}</div>}</li>)}</ul> : <p className="text-xs text-green-700">Structure valide (V1–V10). Les couches données, entraînement et politique sont évaluées par le serveur.</p>}
          </section>
        </SidePanel>
      </div>

      <Modal open={diffOpen} onClose={() => setDiffOpen(false)} title="Différences avec la version parente">
        {diffQ.isLoading ? <Spinner /> : diffQ.data && <div className="space-y-2 text-sm">
          <p className="text-xs text-slate-500">contre {shortId(diffQ.data.against)}</p>
          {diffQ.data.nodes_added.length > 0 && <p className="text-green-700">+ nœuds : {diffQ.data.nodes_added.join(', ')}</p>}
          {diffQ.data.nodes_removed.length > 0 && <p className="text-red-700">− nœuds : {diffQ.data.nodes_removed.join(', ')}</p>}
          {diffQ.data.edges_added.length > 0 && <p className="text-green-700">+ arêtes : {diffQ.data.edges_added.join(', ')}</p>}
          {diffQ.data.edges_removed.length > 0 && <p className="text-red-700">− arêtes : {diffQ.data.edges_removed.join(', ')}</p>}
          {diffQ.data.nodes_changed.map((n) => <div key={n.id} className="rounded border p-2"><b>{n.id}</b>{n.changes.map((c, i) => <div key={i} className="font-mono text-xs"><span className="text-slate-500">{c.path}</span> : <span className="text-red-700">{JSON.stringify(c.before)}</span> → <span className="text-green-700">{JSON.stringify(c.after)}</span></div>)}</div>)}
          {!diffQ.data.nodes_added.length && !diffQ.data.nodes_removed.length && !diffQ.data.nodes_changed.length && !diffQ.data.edges_added.length && !diffQ.data.edges_removed.length && <p>Aucune différence de contenu.</p>}</div>}
      </Modal>
    </div>,
    document.body,
  )
}
