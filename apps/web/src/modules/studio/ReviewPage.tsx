import { useMemo, useState } from 'react'
import { validationToast } from '@/components/Feedback'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertOctagon, CheckCircle2, Play, ShieldCheck } from 'lucide-react'
import type { Approval, BudgetSpec } from '@contracts/src'
import { requirements, satisfies, budgetNeeds, NODE_TYPE_BY_ID } from '@contracts/src'
import { studioApi } from '@/api/studio'
import { assistantApi } from '@/api/assistant'
import { useSession } from '@/lib/session'
import { Button, Card, ErrorBanner, Modal, Note, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { ValidationReportView } from '@/components/ValidationReportView'
import { PlanProposalCard } from '../assistant/PlanProposalCard'
import { WorkflowCanvas, type Sev } from './WorkflowCanvas'
import { fmtDate, shortId } from '@/lib/format'

export function ReviewPage() {
  const { workflowId, versionId } = useParams(); const [sp] = useSearchParams(); const nav = useNavigate(); const qc = useQueryClient(); const { mode, projectId } = useSession()
  const proposalId = sp.get('proposal'); const [reuse, setReuse] = useState(sp.get('reuse') ?? '')
  const vq = useQuery({ queryKey: ['version', workflowId, versionId], queryFn: () => studioApi.version(workflowId!, versionId!) })
  const wq = useQuery({ queryKey: ['workflow', workflowId], queryFn: () => studioApi.workflow(workflowId!) })
  const rq = useQuery({ queryKey: ['report', versionId], queryFn: () => studioApi.report(workflowId!, versionId!), retry: false })
  const aq = useQuery({ queryKey: ['approvals', versionId], queryFn: () => studioApi.approvals(versionId!) })
  const pq = useQuery({ queryKey: ['proposal', proposalId], queryFn: () => assistantApi.proposal(proposalId!), enabled: !!proposalId })
  const xq = useQuery({ queryKey: ['executions', workflowId], queryFn: () => studioApi.executions({ workflow_id: workflowId }) })
  const dq = useQuery({ queryKey: ['diff', workflowId, versionId], queryFn: () => studioApi.diff(workflowId!, versionId!, vq.data!.parent_version_id!), enabled: !!vq.data?.parent_version_id })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['approvals', versionId] }); qc.invalidateQueries({ queryKey: ['report', versionId] }); qc.invalidateQueries({ queryKey: ['version', workflowId, versionId] }); qc.invalidateQueries({ queryKey: ['audit'] }); qc.invalidateQueries({ queryKey: ['workflows'] }) }
  const validate = useMutation({ meta: { toast: validationToast }, mutationFn: () => studioApi.validate(workflowId!, versionId!), onSuccess: refresh })
  const [confirm, setConfirm] = useState<{ node_ids: string[]; cls: 'L2' | 'L3'; kind: string } | null>(null)
  const [budget, setBudget] = useState<BudgetSpec>()
  const approve = useMutation({ meta: { toast: 'Approbation accordée' }, mutationFn: (r: { cls: 'L2' | 'L3'; node_ids?: string[]; budget?: BudgetSpec }) => studioApi.approve({ workflow_version_id: versionId!, operation_classes: [r.cls], node_ids: r.node_ids, budget: r.budget, method: 'explicit_click', scope: 'lineage' }), onSuccess: () => { setConfirm(null); refresh() } })
  const revoke = useMutation({ meta: { toast: { title: 'Approbation révoquée', tone: 'info' } }, mutationFn: (id: string) => studioApi.revoke(id), onSuccess: refresh })
  const run = useMutation({ meta: { toast: { title: 'Exécution lancée', detail: 'Suivez la progression en direct.' } }, mutationFn: () => studioApi.execute(versionId!, (aq.data ?? []).filter((a) => a.status === 'active').map((a) => a.id), reuse || undefined), onSuccess: (r) => nav(`/studio/executions/${r.execution_id}`) })

  const v = vq.data
  const lineage = useMemo(() => { const m = new Map((wq.data?.versions ?? []).map((x) => [x.id, x.parent_version_id])); const s = new Set<string>(); let c: string | null | undefined = versionId; while (c) { s.add(c); c = m.get(c) } return s }, [wq.data, versionId])
  if (vq.isLoading) return <Spinner shape="detail" />
  if (!v) return <ErrorBanner error={vq.error} />
  const reqs = requirements(v.spec, mode); const active = (aq.data ?? []).filter((a) => a.status === 'active')
  const ctx = { contentHash: v.content_hash, spec: v.spec, inLineage: (a: Approval) => lineage.has(a.workflow_version_id) }
  const done = (r: (typeof reqs)[number]) => r.kind === 'click' || active.some((a) => satisfies(a, r, ctx))
  const missing = reqs.filter((r) => !done(r)); const report = rq.data
  const blocked = !!report?.layers.some((l) => l.layer !== 'policy' && l.status === 'error')
  const sev: Record<string, Sev> = {}; report?.layers.forEach((l) => l.issues.forEach((i) => { if (i.node_id && l.layer !== 'policy' && (i.severity === 'error' || i.severity === 'warning') && sev[i.node_id] !== 'error') sev[i.node_id] = i.severity as Sev }))
  const label = (id: string) => { const n = v.spec.nodes.find((x) => x.id === id); return `${NODE_TYPE_BY_ID[n?.type ?? '']?.label ?? n?.type} (${id})` }
  const canRun = !!report && !blocked && missing.length === 0
  return (
    <>
      <PageHeader title={<span>Revue — {wq.data?.workflow.name}</span>} subtitle={<span className="flex flex-wrap items-center gap-2">Version <b>{shortId(v.id)}</b> · {v.origin === 'ai' ? 'proposée par l\'IA' : 'humaine'} · {fmtDate(v.created_at)} · <StatusBadge status={v.readiness} /> · content_hash <code>{v.content_hash}</code></span>}
        actions={<Link to={`/studio/workflows/${workflowId}?v=${v.id}`}><Button variant="secondary">Ouvrir dans l'éditeur</Button></Link>} />
      <ErrorBanner error={validate.error ?? approve.error ?? revoke.error ?? run.error} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <WorkflowCanvas spec={v.spec} readOnly severity={sev} height={360} />
          {pq.data && <PlanProposalCard proposal={pq.data} hideActions />}
          {v.parent_version_id && dq.data && <Card title={`Différences avec la version parente (${shortId(dq.data.against)})`}><ul className="space-y-1 text-sm">
            {dq.data.nodes_added.length > 0 && <li className="text-green-700">+ nœuds : {dq.data.nodes_added.join(', ')}</li>}{dq.data.nodes_removed.length > 0 && <li className="text-red-700">− nœuds : {dq.data.nodes_removed.join(', ')}</li>}
            {dq.data.nodes_changed.map((n) => <li key={n.id}><b>{n.id}</b> : {n.changes.map((c) => `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`).join(' ; ')}</li>)}
            {!dq.data.nodes_added.length && !dq.data.nodes_removed.length && !dq.data.nodes_changed.length && <li className="text-slate-500">Aucune différence de contenu.</li>}</ul></Card>}
        </div>
        <div className="space-y-4">
          <Card title="1. Validation" actions={<Button size="sm" variant="secondary" loading={validate.isPending} onClick={() => validate.mutate()}><ShieldCheck className="h-3.5 w-3.5" />{report ? 'Revalider' : 'Valider'}</Button>}>
            {report ? <ValidationReportView report={report} compact /> : <p className="text-sm text-slate-500">Aucun rapport pour cette version. Lancez la validation (4 couches).</p>}</Card>
          <Card title={`2. Approbations — mode ${mode === 'auto' ? 'Auto' : mode === 'guided' ? 'Guidé' : 'Expert'}`}>
            {reqs.length === 0 ? <p className="text-sm text-slate-500">Aucune opération coûteuse : aucune approbation requise.</p> : <ul className="space-y-2">{reqs.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2.5 text-sm">
                <div><div className="font-medium">{r.operation_class} — {r.kind === 'plan' ? 'Plan avec budget' : r.kind === 'click' ? 'Clic « Lancer » (Expert)' : r.kind === 'individual' ? 'Approbation individuelle' : 'Étape'}</div><div className="text-xs text-slate-500">{r.node_ids.map(label).join(', ')}</div></div>
                {done(r) ? <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-4 w-4" />{r.kind === 'click' ? 'au lancement' : 'approuvé'}</span> : <Button size="sm" onClick={() => { setBudget(budgetNeeds(v.spec)); setConfirm({ node_ids: r.node_ids, cls: r.operation_class as 'L2' | 'L3', kind: r.kind }) }}>Approuver</Button>}</li>))}</ul>}
            {active.length > 0 && <div className="mt-3 border-t pt-2"><h4 className="mb-1 text-xs font-semibold text-slate-600">Approbations actives sur cette version</h4><ul className="space-y-1">{active.map((a) => <li key={a.id} className="flex items-center justify-between text-xs"><span><code>{shortId(a.id)}</code> {a.operation_classes.join('+')} {a.node_ids?.join(',')}{a.budget ? ` · ${a.budget.trials} essais / ${a.budget.max_minutes} min / ${a.budget.models} modèles` : ''} · {a.scope}</span><button className="text-red-600 hover:underline" onClick={() => revoke.mutate(a.id)}>révoquer</button></li>)}</ul></div>}
          </Card>
          <Card title="3. Exécution">
            <div className="mb-3"><label className="label" htmlFor="reuse">Reprise (réutiliser les nœuds identiques)</label><select id="reuse" className="input" value={reuse} onChange={(e) => setReuse(e.target.value)}><option value="">Exécution complète</option>{xq.data?.map((x) => <option key={x.id} value={x.id}>{shortId(x.id)} — {x.status} · {fmtDate(x.created_at)}</option>)}</select></div>
            <Button className="w-full" disabled={!canRun} loading={run.isPending} onClick={() => run.mutate()}><Play className="h-4 w-4" />Lancer l'exécution</Button>
            {!canRun && <p className="mt-2 text-xs text-slate-500">{!report ? 'Validez d\'abord la version.' : blocked ? 'Corrigez les erreurs de validation.' : `${missing.length} approbation(s) manquante(s).`}</p>}
            <p className="mt-2 text-[11px] text-slate-400">Le serveur revérifie validation et approbations (content_hash) au lancement : ces contrôles d'interface ne sont qu'une aide.</p></Card>
        </div>
      </div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.cls === 'L3' ? 'Approbation individuelle (action engageante)' : confirm?.kind === 'plan' ? 'Approuver le plan et son budget' : 'Approuver cette étape'}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Annuler</Button><Button variant={confirm?.cls === 'L3' ? 'danger' : 'primary'} loading={approve.isPending} onClick={() => approve.mutate({ cls: confirm!.cls, node_ids: confirm!.kind === 'plan' ? undefined : confirm!.node_ids, budget: confirm!.kind === 'plan' ? budget : undefined })}>{confirm?.cls === 'L3' ? 'Je comprends, approuver' : 'Approuver'}</Button></>}>
        {confirm?.cls === 'L3' && <div className="mb-3 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertOctagon className="h-5 w-5 shrink-0" /><div>Le jeu de test sera utilisé <b>une seule fois</b> pour ce modèle. Après cela, ce run ne pourra plus être évalué sur le test. L'approbation est consommée à l'exécution.</div></div>}
        <p className="text-sm">Contenu approuvé : version <b>{shortId(v.id)}</b>, content_hash <code>{v.content_hash}</code>.</p>
        <p className="mt-1 text-sm">Nœuds : {confirm?.node_ids.map(label).join(', ')}.</p>
        {confirm?.kind === 'plan' && budget && <div className="mt-3 grid grid-cols-3 gap-2">{(['trials', 'max_minutes', 'models'] as const).map((k) => <div key={k}><label className="label" htmlFor={`b-${k}`}>{k === 'trials' ? 'Essais' : k === 'max_minutes' ? 'Durée (min)' : 'Modèles'}</label><input id={`b-${k}`} className="input" type="number" min={0} value={budget[k]} onChange={(e) => setBudget({ ...budget, [k]: Number(e.target.value) })} /></div>)}<p className="col-span-3 text-xs text-slate-500">Le plan est couvert tant que les versions dérivées restent dans ce budget (portée « lignée », jamais L3).</p></div>}
      </Modal>
      <div className="mt-4 text-xs text-slate-400">projet {projectId}</div>
    </>)
}
void Note
