import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertOctagon, CheckCircle2, XCircle } from 'lucide-react'
import type { ModelVersion } from '@contracts/src'
import { trainingApi } from '@/api/training'
import { studioApi } from '@/api/studio'
import { dataApi } from '@/api/data'
import { useSession } from '@/lib/session'
import { Button, Card, EmptyState, ErrorBanner, Modal, Note, PageHeader, Spinner, Table } from '@/components/ui'
import { fmtDate, fmtNum } from '@/lib/format'

const ALIAS: Record<string, string> = { production: 'bg-green-100 text-green-800', staging: 'bg-blue-100 text-blue-800', candidate: 'bg-slate-100 text-slate-700' }
export function RegistryPage() {
  const { projectId } = useSession(); const qc = useQueryClient(); const [sel, setSel] = useState<string>()
  const q = useQuery({ queryKey: ['registry', projectId], queryFn: () => trainingApi.registry(projectId!), refetchInterval: 4000 })
  const runs = useQuery({ queryKey: ['runs', projectId], queryFn: () => trainingApi.runs(projectId!) })
  const run = (id: string) => runs.data?.find((r) => r.id === id)
  const sorted = [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version)
  const mv = sorted.find((m) => m.id === sel) ?? sorted[0]
  return (
    <>
      <PageHeader title="Registre de modèles" subtitle="Versions enregistrées après test final. La promotion (staging, production) exige une approbation L3 individuelle." />
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Spinner shape="cards" /> : !sorted.length ? <EmptyState title="Aucun modèle enregistré" hint="Un modèle est enregistré par un nœud model.register, en aval d'un test final." /> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
          <Table head={['Modèle', 'Version', 'Alias', 'Métrique (val.)', 'Test', 'Créé']}>{sorted.map((m) => { const r = run(m.run_id); return (
            <tr key={m.id} onClick={() => setSel(m.id)} className={`cursor-pointer hover:bg-slate-50 ${mv?.id === m.id ? 'bg-brand-50/60' : ''}`}><td className="td font-medium">{m.name}</td><td className="td">v{m.version}</td><td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALIAS[m.alias ?? 'candidate']}`}>{m.alias ?? '—'}</span></td><td className="td">{r ? `${r.primary_metric} ${fmtNum(r.metrics[r.primary_metric])}` : '—'}</td><td className="td">{m.test_evaluated ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td><td className="td text-slate-500">{fmtDate(m.created_at)}</td></tr>) })}</Table>
          {mv && <ModelPanel key={mv.id} mv={mv} onChanged={() => { qc.invalidateQueries({ queryKey: ['registry'] }); qc.invalidateQueries({ queryKey: ['promotions'] }); qc.invalidateQueries({ queryKey: ['audit'] }) }} />}
        </div>)}
    </>)
}

function ModelPanel({ mv, onChanged }: { mv: ModelVersion; onChanged: () => void }) {
  const { projectId } = useSession()
  const d = useQuery({ queryKey: ['mv', mv.id], queryFn: () => trainingApi.modelVersion(mv.id) })
  const prom = useQuery({ queryKey: ['promotions', mv.name], queryFn: () => studioApi.promotions(mv.name) })
  const [alias, setAlias] = useState<'staging' | 'production' | null>(null)
  const promote = useMutation({ meta: { toast: { title: 'Modèle promu', detail: 'Le nouvel alias est actif.', celebrate: 'big' } }, mutationFn: async () => { const a = await studioApi.approve({ workflow_version_id: mv.workflow_version_id!, operation_classes: ['L3'], node_ids: [`promote:${mv.id}`], method: 'explicit_click' }); return studioApi.promote(mv.id, alias!, a.approval_id) }, onSuccess: () => { setAlias(null); onChanged(); d.refetch() } })
  const run = d.data?.run; const checks = { test: !!mv.test_evaluated, repro: !!run?.execution_id || !!run?.artifacts.length }
  return (
    <div className="space-y-4">
      <Card title={`${mv.name} v${mv.version}`} actions={<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALIAS[mv.alias ?? 'candidate']}`}>{mv.alias}</span>}>
        {d.isLoading ? <Spinner /> : <dl className="space-y-1 text-xs"><div><dt className="inline text-slate-500">Artefact : </dt><dd className="inline font-mono">{d.data!.artifact_ref}</dd></div><div><dt className="inline text-slate-500">Checksum : </dt><dd className="inline font-mono">{d.data!.checksum}</dd></div><div><dt className="inline text-slate-500">Run : </dt><dd className="inline"><Link className="font-mono text-brand-700 hover:underline" to={`/training/experiments/${mv.run_id}`}>{mv.run_id}</Link></dd></div>
          <div><dt className="text-slate-500">Schéma d'entrée (colonnes brutes) :</dt><dd className="font-mono">{d.data!.input_schema?.map((c) => `${c.name}:${c.dtype}`).join(', ')}</dd></div><div><dt className="text-slate-500">Environnement :</dt><dd className="font-mono">{d.data!.environment?.join(', ')}</dd></div></dl>}
        <div className="mt-4 flex gap-2"><Button size="sm" disabled={!mv.workflow_version_id || mv.alias === 'staging'} onClick={() => setAlias('staging')}>Promouvoir en staging</Button><Button size="sm" disabled={!mv.workflow_version_id || mv.alias === 'production'} onClick={() => setAlias('production')}>Promouvoir en production</Button></div>
        {!mv.workflow_version_id && <p className="mt-2 text-xs text-amber-700">Version de workflow d'origine inconnue : impossible de lier l'approbation (voir CONTRACT_GAPS).</p>}
        {prom.data && prom.data.length > 0 && <div className="mt-4 border-t pt-2"><h4 className="mb-1 text-xs font-semibold text-slate-600">Historique des promotions</h4><ul className="space-y-0.5 text-xs">{prom.data.map((p) => <li key={p.id}>{fmtDate(p.created_at)} — {p.model_version_id} → <b>{p.alias}</b> ({p.actor})</li>)}</ul></div>}
      </Card>
      <PredictCard mv={mv} projectId={projectId!} />
      <Modal open={!!alias} onClose={() => setAlias(null)} title={`Promouvoir en ${alias}`} footer={<><Button variant="secondary" onClick={() => setAlias(null)}>Annuler</Button><Button variant="danger" loading={promote.isPending} disabled={!checks.test} onClick={() => promote.mutate()}>Je comprends, promouvoir</Button></>}>
        <ErrorBanner error={promote.error} />
        <div className="mb-3 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertOctagon className="h-5 w-5 shrink-0" />Action engageante (L3) : votre clic crée une approbation individuelle liée à cette version de modèle. L'alias précédent repassera en « candidate ».</div>
        <ul className="space-y-1 text-sm"><li className="flex items-center gap-2">{checks.test ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}Évalué sur le jeu de test</li><li className="flex items-center gap-2">{checks.repro ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}Informations de reproductibilité (exécution, artefacts)</li></ul>
      </Modal>
    </div>)
}

function PredictCard({ mv, projectId }: { mv: ModelVersion; projectId: string }) {
  const d = useQuery({ queryKey: ['mv', mv.id], queryFn: () => trainingApi.modelVersion(mv.id) })
  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId) })
  const [rec, setRec] = useState<Record<string, string>>({})
  const schema = d.data?.input_schema ?? []
  const one = useMutation({ meta: { toast: 'Prédiction calculée' }, mutationFn: () => trainingApi.predict(mv.id, { records: [Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== '').map(([k, v]) => { const c = schema.find((x) => x.name === k); return [k, c && (c.dtype === 'int' || c.dtype === 'float') ? Number(v) : v] }))] }) })
  const batch = useMutation({ meta: { toast: 'Prédictions par lot calculées' }, mutationFn: (dsv: string) => trainingApi.predict(mv.id, { dataset_version_id: dsv }) })
  const r = one.data
  return (
    <Card title="Prédire">
      <ErrorBanner error={one.error ?? batch.error} />
      <div className="grid grid-cols-2 gap-2">{schema.map((c) => <div key={c.name}><label className="label" htmlFor={`p-${c.name}`}>{c.name}</label><input id={`p-${c.name}`} className="input" type={c.dtype === 'int' || c.dtype === 'float' ? 'number' : 'text'} value={rec[c.name] ?? ''} onChange={(e) => setRec({ ...rec, [c.name]: e.target.value })} /></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" loading={one.isPending} onClick={() => one.mutate()}>Prédire cet enregistrement</Button>
        {ds.data?.filter((x) => x.status === 'ready' && x.latest_version_id?.includes('telecom')).map((x) => <Button key={x.id} size="sm" variant="secondary" loading={batch.isPending} onClick={() => batch.mutate(x.latest_version_id!)}>25 lignes de {x.name}</Button>)}</div>
      {r && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><b>Prédiction : {String(r.predictions[0])}</b>{r.probabilities && <span className="ml-2 text-slate-600">({r.classes?.map((c, i) => `${c} ${Math.round(r.probabilities![0][i] * 100)} %`).join(' · ')})</span>}</div>}
      {[...(r?.schema_warnings ?? []), ...(batch.data?.schema_warnings ?? [])].length > 0 && <div className="mt-2"><Note tone="warn"><ul className="list-disc pl-4">{[...new Set([...(r?.schema_warnings ?? []), ...(batch.data?.schema_warnings ?? [])])].map((w) => <li key={w}>{w}</li>)}</ul></Note></div>}
      {batch.data && <p className="mt-2 text-xs text-slate-600">{batch.data.predictions.length} prédictions : {batch.data.predictions.filter((p) => p === 'yes').length} « yes », {batch.data.predictions.filter((p) => p === 'no').length} « no ».</p>}
    </Card>)
}
