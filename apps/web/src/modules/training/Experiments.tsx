import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import { trainingApi } from '@/api/training'
import { useSession } from '@/lib/session'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@/components/ui'
import { MetricBars } from '@/components/charts'
import { fmtDate, fmtNum, shortId } from '@/lib/format'

export function Experiments() {
  const { projectId } = useSession(); const [sel, setSel] = useState<string[]>([]); const [modelF, setModelF] = useState('')
  const q = useQuery({ queryKey: ['runs', projectId], queryFn: () => trainingApi.runs(projectId!), refetchInterval: 4000 })
  const cmp = useMutation({ mutationFn: () => trainingApi.compare(sel) })
  const runs = (q.data ?? []).filter((r) => !modelF || r.model_id === modelF)
  const byId = Object.fromEntries((q.data ?? []).map((r) => [r.id, r]))
  const toggle = (id: string) => { setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]); cmp.reset() }
  const mismatch = (cmp.error as any)?.code === 'PROTOCOL_MISMATCH'
  return (
    <>
      <PageHeader title="Expériences" subtitle="Comparez uniquement des runs du même protocole (même split, métrique principale et validation)." actions={<Button disabled={sel.length < 1} loading={cmp.isPending} onClick={() => cmp.mutate()}><Scale className="h-4 w-4" />Comparer ({sel.length})</Button>} />
      {mismatch ? <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>Comparaison refusée : protocoles différents.</b> Un classement n'a de sens que sur le même protocole.<ul className="mt-1 list-disc pl-5 text-xs">{(cmp.error as any).details.protocols.map((p: any) => <li key={p.run_id}>{byId[p.run_id]?.name ?? p.run_id} — métrique {p.primary_metric}, protocole {p.protocol_hash}</li>)}</ul></div> : <ErrorBanner error={cmp.error ?? q.error} />}
      {cmp.data && <Card className="mb-4" title={`Classement — ${cmp.data.primary_metric} (${cmp.data.direction === 'maximize' ? 'à maximiser' : 'à minimiser'})`}>
        <MetricBars keys={[cmp.data.primary_metric]} rows={cmp.data.entries.map((e) => ({ name: byId[e.run_id]?.name ?? e.run_id, [cmp.data!.primary_metric]: e.metrics[cmp.data!.primary_metric] }))} />
        <Table head={['Rang', 'Run', ...Object.keys(cmp.data.entries[0].metrics)]}>{cmp.data.entries.map((e) => <tr key={e.run_id}><td className="td font-semibold">{e.rank}</td><td className="td"><Link className="text-brand-700 hover:underline" to={`/training/experiments/${e.run_id}`}>{byId[e.run_id]?.name}</Link></td>{Object.values(e.metrics).map((v, i) => <td key={i} className="td">{fmtNum(v)}</td>)}</tr>)}</Table>
        <p className="mt-2 text-xs text-slate-400">protocole {cmp.data.protocol_hash}</p></Card>}
      <div className="mb-3 flex items-center gap-2"><label className="text-xs text-slate-500" htmlFor="mf">Modèle</label><select id="mf" className="input w-48" value={modelF} onChange={(e) => setModelF(e.target.value)}><option value="">Tous</option>{[...new Set((q.data ?? []).map((r) => r.model_id))].map((m) => <option key={m}>{m}</option>)}</select></div>
      {q.isLoading ? <Spinner /> : !runs.length ? <EmptyState title="Aucune expérience" hint="Les runs apparaissent après une exécution d'entraînement." /> : (
        <Table head={['', 'Run', 'Modèle', 'Métrique', 'Validation', 'Test', 'Protocole', 'Date']}>{runs.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50"><td className="td"><input type="checkbox" aria-label={`Sélectionner ${r.name}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>
            <td className="td font-medium"><Link className="text-brand-700 hover:underline" to={`/training/experiments/${r.id}`}>{r.name}</Link><div className="font-mono text-[10px] text-slate-400">{shortId(r.id)}</div></td>
            <td className="td">{r.model_id}</td><td className="td">{r.primary_metric}</td><td className="td">{fmtNum(r.metrics[r.primary_metric])} <span className="text-xs text-slate-400">± {fmtNum(r.metrics_std?.[r.primary_metric])}</span></td>
            <td className="td">{r.test_evaluated ? fmtNum(r.test_metrics?.[r.primary_metric]) : <span className="text-slate-300">non utilisé</span>}</td><td className="td font-mono text-xs text-slate-500">{r.protocol_hash}</td><td className="td text-slate-500">{fmtDate(r.created_at)}</td></tr>))}</Table>)}
    </>)
}
