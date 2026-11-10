import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { trainingApi } from '@/api/training'
import { assistantApi } from '@/api/assistant'
import { Button, Card, ErrorBanner, Metric, Note, PageHeader, SimBadge, Spinner, Table } from '@/components/ui'
import { CurveChart } from '@/components/charts'
import { EvidenceList } from '@/components/Evidence'
import { fmtDate, fmtNum } from '@/lib/format'

export function RunDetail() {
  const { runId } = useParams()
  const q = useQuery({ queryKey: ['run', runId], queryFn: () => trainingApi.run(runId!) })
  const ex = useMutation({ mutationFn: () => assistantApi.explain(`run:${runId}`) })
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBanner error={q.error} />
  const r = q.data!
  return (
    <>
      <PageHeader title={r.name} subtitle={`${r.model_id} · ${fmtDate(r.created_at)} · ${r.duration_s} s · graine ${r.seed}`} actions={<Button variant="secondary" loading={ex.isPending} onClick={() => ex.mutate()}><Sparkles className="h-4 w-4" />Expliquer ce résultat</Button>} />
      {ex.data && <Card className="mb-4" title={<span className="flex items-center gap-2">Explication de l'assistant <SimBadge /></span>}><p className="text-sm">{ex.data.text}</p><EvidenceList items={ex.data.evidence_refs} /></Card>}
      <ErrorBanner error={ex.error} />
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Validation croisée</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(r.metrics).map(([k, v]) => <Metric key={k} label={k + (k === r.primary_metric ? ' ★' : '')} value={fmtNum(v)} sub={r.metrics_std ? `± ${fmtNum(r.metrics_std[k])}` : undefined} />)}</div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Jeu de test</h2>
      {r.test_evaluated && r.test_metrics ? <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(r.test_metrics).map(([k, v]) => <Metric key={k} label={k} value={fmtNum(v)} />)}</div> : <div className="mb-4"><Note>Le jeu de test n'a pas été utilisé pour ce run. Il ne peut l'être qu'une fois, via un nœud eval.final_test approuvé individuellement.</Note></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {r.curve && <Card title="Courbe d'apprentissage"><CurveChart data={r.curve} /></Card>}
        <Card title="Configuration"><pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify({ model_id: r.model_id, params: r.params, primary_metric: r.primary_metric, seed: r.seed }, null, 2)}</pre></Card>
        <Card title="Provenance"><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"><dt className="text-slate-500">Split</dt><dd className="font-mono">{r.split_id}</dd><dt className="text-slate-500">Prétraitement</dt><dd className="font-mono">{r.preprocess_spec_id}</dd><dt className="text-slate-500">config_hash</dt><dd className="font-mono">{r.config_hash}</dd><dt className="text-slate-500">protocol_hash</dt><dd className="font-mono">{r.protocol_hash}</dd><dt className="text-slate-500">MLflow</dt><dd className="font-mono">{r.mlflow_run_id}</dd><dt className="text-slate-500">Exécution</dt><dd>{r.execution_id ? <Link className="font-mono text-brand-700 hover:underline" to={`/studio/executions/${r.execution_id}`}>{r.execution_id}</Link> : <span className="text-slate-400">— (aucun lien : voir CONTRACT_GAPS)</span>}</dd></dl></Card>
        <Card title="Artefacts"><Table head={['Nom', 'Type', 'Checksum']}>{r.artifacts.map((a) => <tr key={a.name}><td className="td">{a.name}</td><td className="td">{a.kind}</td><td className="td font-mono text-xs text-slate-500">{a.checksum}</td></tr>)}</Table></Card>
      </div>
    </>)
}
