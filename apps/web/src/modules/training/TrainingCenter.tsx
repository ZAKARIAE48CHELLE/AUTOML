import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Rocket } from 'lucide-react'
import type { Task, ValidationReport, WorkflowVersion } from '@contracts/src'
import { requirements } from '@contracts/src'
import { dataApi } from '@/api/data'
import { trainingApi } from '@/api/training'
import { studioApi } from '@/api/studio'
import { useSession } from '@/lib/session'
import { Button, Card, EmptyState, ErrorBanner, JobProgress, Modal, Note, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'
import { SchemaForm } from '@/components/SchemaForm'
import { ValidationReportView } from '@/components/ValidationReportView'
import { createApprovals } from '../studio/approvals'
import { METRICS } from './metrics'
import { fmtDate, shortId } from '@/lib/format'

export function TrainingCenter() {
  const { projectId, mode } = useSession(); const nav = useNavigate()
  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!) })
  const jobs = useQuery({ queryKey: ['jobs', projectId], queryFn: () => trainingApi.jobs(projectId!), refetchInterval: 1500 })
  const [dsId, setDsId] = useState(''); const [target, setTarget] = useState(''); const [modelId, setModelId] = useState('random_forest'); const [params, setParams] = useState<Record<string, any>>({}); const [metric, setMetric] = useState('f1')
  const selected = ds.data?.find((d) => d.id === dsId)
  const dq = useQuery({ queryKey: ['dataset', dsId], queryFn: () => dataApi.dataset(dsId), enabled: !!dsId })
  const schema = dq.data?.versions.at(-1)?.schema ?? []
  const task: Task = schema.find((c) => c.name === target)?.dtype === 'float' ? 'regression' : 'classification'
  const models = useQuery({ queryKey: ['models', task], queryFn: () => trainingApi.models(task) })
  const model = models.data?.find((m) => m.id === modelId)
  const [prepared, setPrepared] = useState<{ wf: string; version: WorkflowVersion; report: ValidationReport }>()
  const [confirm, setConfirm] = useState(false)

  const prepare = useMutation({ mutationFn: async () => {
    const t = await studioApi.fromTemplate({ template_id: 'quick_train', dataset_version_id: selected!.latest_version_id, target, model_id: modelId, params, primary_metric: metric })
    const report = await studioApi.validate(t.workflow_id, t.version_id); const version = await studioApi.version(t.workflow_id, t.version_id)
    return { wf: t.workflow_id, version, report }
  }, onSuccess: setPrepared })
  const run = useMutation({ mutationFn: async () => {
    const p = prepared!; const ids = await createApprovals(p.version.id, p.version.spec, mode)
    const { execution_id } = await studioApi.execute(p.version.id, ids)
    for (let i = 0; i < 40; i++) { const e = await studioApi.execution(execution_id); const j = e.node_runs.find((n) => n.job_ref); if (j) return { job: j.job_ref! }; if (e.status === 'failed') break; await new Promise((r) => setTimeout(r, 500)) }
    return { exec: execution_id }
  }, onSuccess: (r) => nav('job' in r ? `/training/jobs/${r.job}` : `/studio/executions/${r.exec}`) })

  const reqs = prepared ? requirements(prepared.version.spec, mode) : []
  const blocked = prepared?.report.layers.some((l) => l.layer !== 'policy' && l.status === 'error')
  return (
    <>
      <PageHeader title="Centre d'entraînement" subtitle="Entraînement rapide d'un modèle : un gabarit de workflow est créé, validé, approuvé puis exécuté par le Studio (une seule voie d'exécution)." actions={<><Link to="/training/models"><Button variant="secondary">Catalogue</Button></Link><Link to="/training/experiments"><Button variant="secondary">Expériences</Button></Link></>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Nouvel entraînement">
          <ErrorBanner error={prepare.error ?? run.error} />
          <div className="space-y-3">
            <div><label className="label" htmlFor="tc-ds">Dataset</label><select id="tc-ds" className="input" value={dsId} onChange={(e) => { setDsId(e.target.value); setTarget(''); setPrepared(undefined) }}><option value="">— choisir —</option>{ds.data?.filter((d) => d.status === 'ready').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="label" htmlFor="tc-t">Colonne cible</label><select id="tc-t" className="input" disabled={!schema.length} value={target} onChange={(e) => { setTarget(e.target.value); setMetric(schema.find((c) => c.name === e.target.value)?.dtype === 'float' ? 'rmse' : 'f1'); setPrepared(undefined) }}><option value="">— choisir —</option>{schema.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.dtype})</option>)}</select>{target && <p className="mt-1 text-xs text-slate-500">Tâche détectée : <b>{task === 'classification' ? 'classification' : 'régression'}</b></p>}</div>
            <div><label className="label" htmlFor="tc-m">Modèle</label><select id="tc-m" className="input" value={modelId} onChange={(e) => { setModelId(e.target.value); setParams({}); setPrepared(undefined) }}>{models.data?.map((m) => <option key={m.id} value={m.id} disabled={m.disabled}>{m.label}{m.disabled ? ' — fermé (G-DL)' : ''}</option>)}</select></div>
            {model && <SchemaForm schema={model.params_schema} value={params} onChange={(p) => { setParams(p); setPrepared(undefined) }} />}
            <div><label className="label" htmlFor="tc-me">Métrique principale</label><select id="tc-me" className="input" value={metric} onChange={(e) => { setMetric(e.target.value); setPrepared(undefined) }}>{METRICS[task].map((m) => <option key={m}>{m}</option>)}</select></div>
            <Button className="w-full" disabled={!dsId || !target} loading={prepare.isPending} onClick={() => prepare.mutate()}>Préparer et valider</Button>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-3">
          {prepared ? <Card title="Validation du workflow généré" actions={<Link className="text-xs text-brand-700 hover:underline" to={`/studio/workflows/${prepared.wf}`}>Ouvrir dans le Studio</Link>}>
            <ValidationReportView report={prepared.report} />
            <div className="mt-4"><Button disabled={blocked} onClick={() => setConfirm(true)}><Rocket className="h-4 w-4" />Approuver et lancer</Button>{blocked && <span className="ml-2 text-xs text-red-600">Corrigez les erreurs avant de lancer.</span>}</div></Card>
            : <Note>Renseignez le formulaire puis « Préparer et valider » : vous verrez le rapport de validation (structure, données, entraînement, politique) avant tout lancement.</Note>}
          <Card title="Jobs récents">{jobs.isLoading ? <Spinner /> : !jobs.data?.length ? <EmptyState title="Aucun job" hint="Les jobs apparaissent ici dès qu'une exécution lance un entraînement." /> : (
            <Table head={['Job', 'Modèle', 'Statut', 'Progression', 'Créé']}>{jobs.data.slice(0, 8).map((j) => <tr key={j.id}><td className="td"><Link className="font-mono text-xs text-brand-700 hover:underline" to={`/training/jobs/${j.id}`}>{shortId(j.id)}</Link></td><td className="td">{j.model_id}</td><td className="td"><StatusBadge status={j.status} /></td><td className="td"><JobProgress value={j.progress} status={j.status} /></td><td className="td text-slate-500">{fmtDate(j.created_at)}</td></tr>)}</Table>)}</Card>
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Confirmer l'approbation" footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Annuler</Button><Button loading={run.isPending} onClick={() => run.mutate()}>Je confirme et je lance</Button></>}>
        <p className="mb-3 text-sm">Mode <b>{mode === 'auto' ? 'Auto' : mode === 'guided' ? 'Guidé' : 'Expert'}</b>. En cliquant, vous approuvez ce contenu précis (content_hash {prepared?.version.content_hash}).</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{reqs.length ? reqs.map((r, i) => <li key={i}>{r.operation_class} — {r.kind === 'plan' ? 'plan avec budget' : r.kind === 'click' ? 'clic « Lancer » valant approbation (Expert, journalisé)' : `étape ${r.node_ids.join(', ')}`}</li>) : <li>Aucune approbation requise.</li>}</ul>
      </Modal>
    </>)
}
