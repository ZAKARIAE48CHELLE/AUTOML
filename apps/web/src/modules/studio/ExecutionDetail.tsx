import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Download, RotateCcw, Sparkles } from 'lucide-react'
import type { ExecutionEvent, NodeStatus } from '@contracts/src'
import { NODE_TYPE_BY_ID } from '@contracts/src'
import { studioApi } from '@/api/studio'
import { assistantApi } from '@/api/assistant'
import { openExecutionEvents } from '@/api/events'
import { Button, Card, ErrorBanner, JobProgress, Modal, PageHeader, SimBadge, Spinner, StatusBadge, Table } from '@/components/ui'
import { celebrate, toast } from '@/components/Feedback'
import { EvidenceList } from '@/components/Evidence'
import { WorkflowCanvas } from './WorkflowCanvas'
import { fmtDate, shortId } from '@/lib/format'

const TERMINAL = ['succeeded', 'failed', 'cancelled']
const refHref = (k: string, id: string, job?: string) => k === 'run' ? `/training/experiments/${id}` : k === 'model_version' ? '/studio/registry' : k === 'split' || k === 'dataset_version' ? '/data' : k === 'study' ? `/training/jobs/${job}?study=${id}` : null

export function ExecutionDetail() {
  const { executionId } = useParams(); const nav = useNavigate(); const qc = useQueryClient()
  const q = useQuery({ queryKey: ['execution', executionId], queryFn: () => studioApi.execution(executionId!), refetchInterval: (s) => (TERMINAL.includes(s.state.data?.status ?? '') ? false : 2500) })
  const e = q.data
  const prev = useRef<string>()
  useEffect(() => { if (e && prev.current && prev.current !== 'succeeded' && e.status === 'succeeded') { celebrate('big'); toast('Exécution réussie !', { tone: 'celebrate', detail: 'Tous les nœuds se sont terminés avec succès.' }) } prev.current = e?.status }, [e?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const vq = useQuery({ queryKey: ['version', e?.workflow_id, e?.workflow_version_id], queryFn: () => studioApi.version(e!.workflow_id, e!.workflow_version_id), enabled: !!e })
  const [events, setEvents] = useState<ExecutionEvent[]>([])
  useEffect(() => { if (!executionId) return; setEvents([]); return openExecutionEvents(executionId, (ev) => { setEvents((s) => [...s.slice(-49), ev]); qc.invalidateQueries({ queryKey: ['execution', executionId] }); if (ev.type === 'execution_status') { qc.invalidateQueries({ queryKey: ['runs'] }); qc.invalidateQueries({ queryKey: ['jobs'] }) } }) }, [executionId, qc])
  const cancel = useMutation({ meta: { toast: { title: 'Exécution annulée', tone: 'info' } }, mutationFn: () => studioApi.cancel(executionId!), onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', executionId] }) })
  const ex = useMutation({ mutationFn: () => assistantApi.explain(`execution:${executionId}`) })
  const [expOpen, setExpOpen] = useState(false); const [inclData, setInclData] = useState(false)
  const exp = useMutation({ meta: { toast: 'Export prêt' }, mutationFn: async () => { let ap: string | undefined; if (inclData) ap = (await studioApi.approve({ workflow_version_id: e!.workflow_version_id, operation_classes: ['L3'], node_ids: ['export'], method: 'explicit_click' })).approval_id; return studioApi.createExport(executionId!, inclData, ap) }, onSuccess: (r) => nav(`/studio/exports/${r.export_id}`) })
  if (q.isLoading) return <Spinner shape="detail" />
  if (!e) return <ErrorBanner error={q.error} />
  const status: Record<string, { status: NodeStatus; cached?: boolean }> = Object.fromEntries(e.node_runs.map((n) => [n.node_id, { status: n.status, cached: n.cached }]))
  const running = !TERMINAL.includes(e.status); const spec = vq.data?.spec
  const label = (id: string) => { const n = spec?.nodes.find((x) => x.id === id); return n ? `${NODE_TYPE_BY_ID[n.type]?.label ?? n.type}` : '' }
  return (
    <>
      <PageHeader title={`Exécution ${shortId(e.id)}`} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={e.status} /> démarrée {fmtDate(e.created_at)}{e.finished_at && <> · terminée {fmtDate(e.finished_at)}</>} · version <Link className="text-brand-700 hover:underline" to={`/studio/workflows/${e.workflow_id}/review/${e.workflow_version_id}`}>{shortId(e.workflow_version_id)}</Link>{e.reuse_from && <> · reprise depuis {shortId(e.reuse_from)}</>}</span>}
        actions={<>
          {running && <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}><Ban className="h-4 w-4" />Annuler</Button>}
          {!running && <Link to={`/studio/workflows/${e.workflow_id}/review/${e.workflow_version_id}?reuse=${e.id}`}><Button variant="secondary"><RotateCcw className="h-4 w-4" />Reprendre</Button></Link>}
          {e.status === 'succeeded' && <Button onClick={() => setExpOpen(true)}><Download className="h-4 w-4" />Exporter</Button>}
          <Button variant="secondary" loading={ex.isPending} onClick={() => ex.mutate()}><Sparkles className="h-4 w-4" />Expliquer</Button></>} />
      <ErrorBanner error={cancel.error ?? ex.error} />
      {ex.data && <Card className="mb-4" title={<span className="flex items-center gap-2">Explication de l'assistant <SimBadge /></span>}><p className="text-sm">{ex.data.text}</p><EvidenceList items={ex.data.evidence_refs} /></Card>}
      {spec && <div className="mb-4"><WorkflowCanvas spec={spec} readOnly status={status} height={340} /></div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Table head={['Nœud', 'Statut', 'Progression', 'Résultats', 'Erreur']}>{e.node_runs.map((n) => (
          <tr key={n.node_id} className={n.status === 'failed' ? 'bg-red-50/50' : ''}><td className="td"><span className="font-medium">{label(n.node_id)}</span> <span className="font-mono text-xs text-slate-400">{n.node_id}</span></td><td className="td"><StatusBadge status={n.status} cached={n.cached} /></td>
            <td className="td">{n.status === 'running' ? <JobProgress value={n.progress ?? 0} /> : <span className="text-xs text-slate-400">{n.finished_at ? fmtDate(n.finished_at) : '—'}</span>}</td>
            <td className="td text-xs">{n.result_refs?.map((r) => { const h = refHref(r.kind, r.id, n.job_ref); return <div key={r.kind + r.id}>{h ? <Link className="text-brand-700 hover:underline" to={h}>{r.kind} {shortId(r.id)}</Link> : <span>{r.kind} {shortId(r.id)}</span>}</div> })}{n.job_ref && !n.result_refs?.some((r) => r.kind === 'study') && <Link className="text-slate-500 hover:underline" to={`/training/jobs/${n.job_ref}`}>job {shortId(n.job_ref)}</Link>}</td>
            <td className="td text-xs text-red-700">{n.error && <><b>{n.error.code}</b> {n.error.message}</>}</td></tr>))}</Table>
        <Card title="Événements (SSE)" className="max-h-80 overflow-auto"><ul className="space-y-1 font-mono text-[11px] text-slate-600">{events.length === 0 && <li className="text-slate-400">En attente…</li>}{events.map((ev) => <li key={ev.id}>#{ev.id} {ev.type === 'node_status' ? `${ev.node_id} → ${ev.status}` : `exécution → ${ev.status}`}</li>)}</ul></Card>
      </div>
      <Modal open={expOpen} onClose={() => setExpOpen(false)} title="Export reproductible" footer={<><Button variant="secondary" onClick={() => setExpOpen(false)}>Annuler</Button><Button loading={exp.isPending} onClick={() => exp.mutate()}>Générer l'export</Button></>}>
        <ErrorBanner error={exp.error} />
        <p className="mb-3 text-sm">Manifeste, dépendances verrouillées, code généré depuis des gabarits approuvés, configurations, graines et checksums.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={inclData} onChange={(e) => setInclData(e.target.checked)} /><span>Inclure les données du dataset <span className="block text-xs text-red-700">Action engageante (L3) : une approbation individuelle sera créée par votre clic. Vérifiez la confidentialité des données avant tout partage.</span></span></label>
      </Modal>
    </>)
}
