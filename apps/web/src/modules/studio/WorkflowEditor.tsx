import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, GitCompare, ClipboardCheck, ShieldCheck, Undo2 } from 'lucide-react'
import type { JsonSchema, WorkflowSpec, ValidationReport, NodeType, DatasetColumn } from '@contracts/src'
import { NODE_TYPES, NODE_TYPE_BY_ID, validateStructure, contentHash } from '@contracts/src'
import { studioApi } from '@/api/studio'
import { dataApi } from '@/api/data'
import { trainingApi } from '@/api/training'
import { useSession } from '@/lib/session'
import { Button, Card, ErrorBanner, Modal, Note, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { SchemaForm, type Widgets } from '@/components/SchemaForm'
import { StepsEditor } from '@/components/StepsEditor'
import { ValidationReportView } from '@/components/ValidationReportView'
import { WorkflowCanvas, type Sev } from './WorkflowCanvas'
import { fmtDate, shortId } from '@/lib/format'

const defaultsFor = (s: JsonSchema): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [k, p] of Object.entries(s.properties ?? {})) { if (p.default !== undefined) out[k] = p.default; else if (p.type === 'object' && p.properties && s.required?.includes(k)) out[k] = defaultsFor(p); else if (p.type === 'array' && s.required?.includes(k)) out[k] = [] }
  return out
}
const sevMap = (issues: { node_id?: string; severity: string }[]): Record<string, Sev> => { const m: Record<string, Sev> = {}; for (const i of issues) if (i.node_id && (i.severity === 'error' || i.severity === 'warning')) { if (m[i.node_id] !== 'error') m[i.node_id] = i.severity as Sev } return m }

export function WorkflowEditor() {
  const { workflowId } = useParams(); const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const qc = useQueryClient(); const { projectId } = useSession()
  const wq = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => studioApi.workflow(workflowId!) })
  const versionId = sp.get('v') ?? wq.data?.workflow.latest_version_id
  const vq = useQuery({ queryKey: ['version', workflowId, versionId], queryFn: () => studioApi.version(workflowId!, versionId!), enabled: !!versionId })
  const caps = useQuery({ queryKey: ['resources'], queryFn: trainingApi.resources })
  const [spec, setSpec] = useState<WorkflowSpec>(); const [sel, setSel] = useState<string | null>(null); const [report, setReport] = useState<ValidationReport>(); const [diffOpen, setDiffOpen] = useState(false); const [label, setLabel] = useState('')
  useEffect(() => { if (vq.data) { setSpec(structuredClone(vq.data.spec)); setSel(null); setReport(undefined) } }, [vq.data?.id])
  const orig = vq.data?.spec
  const dirty = !!spec && !!orig && JSON.stringify(spec) !== JSON.stringify(orig)
  const contentChanged = !!spec && !!orig && contentHash(spec) !== contentHash(orig)

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
    setSpec({ ...spec, nodes: [...spec.nodes, { id: `n${n}`, type: t.type, type_version: t.version, params, ui: { x: maxX + 40, y: 200 } }] }); setSel(`n${n}`)
  }
  const opts = { dataset_versions: (ds.data ?? []).filter((d) => d.latest_version_id).map((d) => ({ value: d.latest_version_id!, label: `${d.name} (${d.latest_version_id})` })), columns: columns.map((c) => ({ value: c.name, label: `${c.name} (${c.dtype})` })), models: (models.data ?? []).map((m) => ({ value: m.id, label: m.label + (m.disabled ? ' — fermé (G-DL)' : '') })) }
  const widgets: Widgets = {
    steps: ({ value, onChange }) => <StepsEditor value={value} onChange={onChange} columns={columns} />,
    model_params: ({ value, onChange }) => { const m = models.data?.find((x) => x.id === node?.params.model_id); return m ? <div className="rounded-md border border-slate-200 p-3"><SchemaForm schema={m.params_schema} value={value ?? {}} onChange={onChange} /></div> : <p className="text-xs text-slate-500">Choisissez d'abord un modèle.</p> },
    search_space: ({ value, onChange }) => { const m = models.data?.find((x) => x.id === node?.params.model_id); const props = Object.entries(m?.params_schema.properties ?? {}); return props.length ? <div className="space-y-2">{props.map(([k, s]) => { const r = (value?.[k] as number[] | undefined) ?? []; return <div key={k} className="flex items-center gap-2 text-xs"><span className="w-28 truncate font-mono">{k}</span><input className="input" type="number" aria-label={`${k} min`} placeholder={String(s.minimum)} value={r[0] ?? ''} onChange={(e) => onChange({ ...value, [k]: [Number(e.target.value), r[1] ?? s.maximum] })} /><span>→</span><input className="input" type="number" aria-label={`${k} max`} placeholder={String(s.maximum)} value={r[1] ?? ''} onChange={(e) => onChange({ ...value, [k]: [r[0] ?? s.minimum, Number(e.target.value)] })} /></div> })}</div> : <p className="text-xs text-slate-500">Choisissez d'abord un modèle.</p> },
  }
  const nodeIssues = [...local, ...(report && !dirty ? report.layers.flatMap((l) => l.issues) : [])].filter((i) => i.node_id === sel)
  return (
    <>
      <PageHeader title={wq.data!.workflow.name} subtitle={<span className="flex flex-wrap items-center gap-2">Version <b>{shortId(v.id)}</b> · {v.origin === 'ai' ? 'proposée par l\'IA' : 'humaine'} · {fmtDate(v.created_at)} · <StatusBadge status={v.readiness} /></span>}
        actions={<>
          <select className="input w-56" aria-label="Version" value={v.id} onChange={(e) => setSp({ v: e.target.value })}>{wq.data!.versions.map((x, i) => <option key={x.id} value={x.id}>{i === 0 ? '★ ' : ''}{shortId(x.id)} — {x.label ?? (x.origin === 'ai' ? 'plan IA' : 'édition')}</option>)}</select>
          {v.parent_version_id && <Button variant="secondary" onClick={() => setDiffOpen(true)}><GitCompare className="h-4 w-4" />Différences</Button>}
          <Link to={dirty ? '#' : `/studio/workflows/${workflowId}/review/${v.id}`} onClick={(e) => dirty && e.preventDefault()}><Button variant="secondary" disabled={dirty}><ClipboardCheck className="h-4 w-4" />Revue & exécution</Button></Link></>} />
      {v.origin === 'ai' && <div className="mb-3"><Note>Version proposée par l'assistant. Vous pouvez la modifier librement : l'enregistrement crée une <b>nouvelle version humaine</b>, la proposition d'origine reste intacte.</Note></div>}
      <ErrorBanner error={save.error ?? validate.error} />
      <div className="grid gap-3 xl:grid-cols-[200px_1fr_320px]">
        <Card title="Nœuds" className="!p-0 [&>div]:!p-2"><ul className="space-y-1">{NODE_TYPES.map((t) => { const off = t.type === 'data.dataset' && spec.nodes.some((n) => n.type === 'data.dataset'); return <li key={t.type}><button disabled={off} onClick={() => add(t)} title={`${t.type} — ${t.owner}${off ? ' (un seul dataset par workflow)' : ''}`} className="flex w-full items-center gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:opacity-40"><Plus className="h-3 w-3" />{t.label}<span className="ml-auto text-[10px] text-slate-400">{t.operation_class}</span></button></li> })}</ul>
          <div className="mt-3 border-t pt-2"><label className="label" htmlFor="task">Tâche</label><select id="task" className="input" value={spec.metadata.task} onChange={(e) => setSpec({ ...spec, metadata: { ...spec.metadata, task: e.target.value as 'classification' | 'regression' } })}><option value="classification">classification</option><option value="regression">régression</option></select></div></Card>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-xs" placeholder="Libellé de version (optionnel)" aria-label="Libellé" value={label} onChange={(e) => setLabel(e.target.value)} disabled={!dirty} />
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}><Save className="h-4 w-4" />Enregistrer une version</Button>
            <Button variant="ghost" disabled={!dirty} onClick={() => { setSpec(structuredClone(orig!)); setSel(null) }}><Undo2 className="h-4 w-4" />Annuler</Button>
            <Button variant="secondary" disabled={dirty} loading={validate.isPending} onClick={() => validate.mutate()} title={dirty ? 'Enregistrez d\'abord : une version est immuable' : ''}><ShieldCheck className="h-4 w-4" />Valider (serveur)</Button>
            {dirty && !contentChanged && <span className="text-xs text-amber-700">Mise en page seule : elle n'est pas versionnée si le contenu est identique.</span>}
          </div>
          <WorkflowCanvas spec={spec} onChange={setSpec} selected={sel} onSelect={setSel} severity={severity} />
          <p className="text-[11px] text-slate-400">Glissez d'un port de sortie (●) vers un port d'entrée de même couleur. Seules les connexions de types compatibles sont acceptées. Suppr. pour retirer la sélection.</p>
        </div>
        <div className="space-y-3">
          <Card title={node ? `${nt?.label ?? node.type} · ${node.id}` : 'Propriétés'} actions={node && <button aria-label="Supprimer le nœud" onClick={() => { setSpec({ ...spec, nodes: spec.nodes.filter((n) => n.id !== node.id), edges: spec.edges.filter((e) => e.from.node !== node.id && e.to.node !== node.id) }); setSel(null) }}><Trash2 className="h-4 w-4 text-red-500" /></button>}>
            {node && nt ? <div className="space-y-3"><p className="text-[11px] text-slate-400">{nt.type} v{nt.version} · {nt.owner} · classe {nt.operation_class}</p>
              <SchemaForm schema={nt.params_schema} value={node.params} onChange={(p) => setSpec({ ...spec, nodes: spec.nodes.map((n) => (n.id === node.id ? { ...n, params: p } : n)) })} options={opts} widgets={widgets} hide={[...(node.params.strategy === 'group' ? [] : ['group_column']), ...(node.params.strategy === 'time' ? [] : ['time_column']), ...(node.type === 'data.split' && node.params.cv_folds !== 1 ? ['val_ratio'] : [])]} />
              {nodeIssues.length > 0 && <ul className="space-y-1">{nodeIssues.map((i, k) => <li key={k} className={`rounded border px-2 py-1 text-xs ${i.severity === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><b>{i.code}</b> {i.message}</li>)}</ul>}</div>
              : <p className="text-sm text-slate-500">Sélectionnez un nœud pour éditer ses paramètres.</p>}
          </Card>
          <Card title={`Validation${report && !dirty ? ' (serveur)' : ' locale (structure)'}`}>
            {report && !dirty ? <ValidationReportView report={report} onSelectNode={setSel} compact /> : local.length ? <ul className="space-y-1">{local.map((i, k) => <li key={k} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"><b>{i.code}</b> — {i.message}{i.node_id && <button className="ml-1 underline" onClick={() => setSel(i.node_id!)}>{i.node_id}</button>}{i.hint && <div className="opacity-80">→ {i.hint}</div>}</li>)}</ul> : <p className="text-xs text-green-700">Structure valide (V1–V10). Les couches données, entraînement et politique sont évaluées par le serveur.</p>}
          </Card>
        </div>
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
    </>)
}


