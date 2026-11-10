import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { trainingApi } from '@/api/training'
import { studioApi } from '@/api/studio'
import { Button, Card, ErrorBanner, JobProgress, Metric, Note, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { TrialsChart } from '@/components/charts'
import { fmtDate, fmtNum } from '@/lib/format'

export function JobDetail() {
  const { jobId } = useParams(); const [sp] = useSearchParams(); const studyId = sp.get('study')
  const q = useQuery({ queryKey: ['job', jobId], queryFn: () => trainingApi.job(jobId!), refetchInterval: (s) => (['queued', 'running'].includes(s.state.data?.status ?? '') ? 600 : false) })
  const st = useQuery({ queryKey: ['study', studyId], queryFn: () => trainingApi.study(studyId!), enabled: !!studyId, refetchInterval: 800 })
  const cancel = useMutation({ mutationFn: () => studioApi.cancel(q.data!.execution_ref!.execution_id) })
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBanner error={q.error} />
  const j = q.data!; const active = j.status === 'queued' || j.status === 'running'
  return (
    <>
      <PageHeader title={`Job ${j.id}`} subtitle={`Modèle : ${j.model_id} · créé le ${fmtDate(j.created_at)}`} actions={<>
        {j.execution_ref && <Link to={`/studio/executions/${j.execution_ref.execution_id}`}><Button variant="secondary">Voir l'exécution</Button></Link>}
        {active && j.execution_ref && <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Annuler l'exécution</Button>}</>} />
      <ErrorBanner error={cancel.error} />
      <Card><div className="flex flex-wrap items-center gap-4"><StatusBadge status={j.status} /><JobProgress value={j.progress} status={j.status} />{j.execution_ref && <span className="text-xs text-slate-500">nœud {j.execution_ref.node_id}, tentative {j.execution_ref.attempt}</span>}</div></Card>
      {j.status === 'failed' && <div className="mt-4"><ErrorBanner error={{ code: j.error_code, message: j.message ?? 'Le job a échoué.' }} /><Note tone="warn">Corrigez la cause, puis relancez l'exécution depuis le Studio en réutilisant les nœuds déjà réussis (« Reprendre »).</Note></div>}
      {j.metrics && <div className="mt-4"><h2 className="mb-2 text-sm font-semibold text-slate-700">Métriques</h2><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(j.metrics).map(([k, v]) => <Metric key={k} label={k} value={fmtNum(v)} />)}</div></div>}
      {j.run_id && <p className="mt-4 text-sm">Run produit : <Link className="text-brand-700 hover:underline" to={`/training/experiments/${j.run_id}`}>{j.run_id}</Link></p>}
      {st.data && <Card className="mt-4" title={`Étude d'optimisation — ${st.data.trials.length} essai(s)`}><TrialsChart data={st.data.trials} />{st.data.best_trial && <p className="text-xs text-slate-500">Meilleur essai : n°{st.data.best_trial.n} ({st.data.best_trial.value})</p>}</Card>}
      <p className="mt-6 text-xs text-slate-400">Les journaux détaillés (logs_ref) ne sont pas exposés par le contrat actuel — voir docs/CONTRACT_GAPS.md.</p>
    </>)
}
