import { useState } from 'react'
import { validationToast } from '@/components/Feedback'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PreprocessStep, SplitSpec, ValidationReport, Task } from '@contracts/src'
import { NODE_TYPE_BY_ID } from '@contracts/src'
import { dataApi, isProfile } from '@/api/data'
import { Button, Card, EmptyState, ErrorBanner, JobProgress, Metric, Note, PageHeader, Spinner, StatusBadge, Table, Tabs } from '@/components/ui'
import { SchemaForm } from '@/components/SchemaForm'
import { StepsEditor } from '@/components/StepsEditor'
import { ValidationReportView } from '@/components/ValidationReportView'
import { Histogram } from '@/components/charts'
import { EvidenceList } from '@/components/Evidence'
import { fmtDate, fmtNum, pct, shortId } from '@/lib/format'

type Tab = 'preview' | 'profile' | 'splits' | 'prep'
export function DatasetDetail() {
  const { datasetId } = useParams(); const [tab, setTab] = useState<Tab>('preview')
  const dq = useQuery({ queryKey: ['dataset', datasetId], queryFn: () => dataApi.dataset(datasetId!), refetchInterval: (s) => (s.state.data?.versions.some((v) => v.status === 'importing') ? 800 : false) })
  if (dq.isLoading) return <Spinner shape="detail" />
  if (dq.error) return <ErrorBanner error={dq.error} />
  const d = dq.data!; const v = d.versions[d.versions.length - 1]
  return (
    <>
      <PageHeader title={d.name} subtitle={<>Version {v.version} · {fmtNum(v.rows)} lignes · {v.schema.length} colonnes · checksum {v.checksum}</>} actions={<StatusBadge status={v.status ?? 'ready'} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Lignes" value={fmtNum(v.rows)} /><Metric label="Colonnes" value={v.schema.length} /><Metric label="Version" value={shortId(v.id)} /><Metric label="Créé le" value={fmtDate(v.created_at)} /></div>
      {v.status === 'importing' ? <Note>Import en cours : l'aperçu et le profilage seront disponibles à la fin.</Note> : <>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'preview', label: 'Aperçu' }, { id: 'profile', label: 'Profil' }, { id: 'splits', label: 'Splits' }, { id: 'prep', label: 'Prétraitement' }]} />
        {tab === 'preview' && <PreviewTab datasetId={d.id} versionId={v.id} />}
        {tab === 'profile' && <ProfileTab datasetId={d.id} versionId={v.id} />}
        {tab === 'splits' && <SplitsTab versionId={v.id} schema={v.schema} />}
        {tab === 'prep' && <PrepTab versionId={v.id} schema={v.schema} />}
      </>}
    </>)
}

function PreviewTab({ datasetId, versionId }: { datasetId: string; versionId: string }) {
  const [page, setPage] = useState(0); const size = 15
  const q = useQuery({ queryKey: ['preview', datasetId, versionId, page], queryFn: () => dataApi.preview(datasetId, versionId, size, page * size), placeholderData: (p) => p })
  if (q.isLoading) return <Spinner shape="table" />
  if (q.error) return <ErrorBanner error={q.error} />
  const p = q.data!
  return (
    <div><div className="card overflow-x-auto"><table className="w-full"><thead className="border-b bg-slate-50"><tr>{p.columns.map((c) => <th key={c.name} className="th whitespace-nowrap">{c.name}<div className="font-normal normal-case text-slate-400">{c.dtype}</div></th>)}</tr></thead>
      <tbody className="divide-y">{p.rows.map((r, i) => <tr key={i}>{p.columns.map((c) => <td key={c.name} className={`td whitespace-nowrap ${r[c.name] === null ? 'text-slate-300' : ''}`}>{r[c.name] === null ? 'null' : String(r[c.name])}</td>)}</tr>)}</tbody></table></div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500"><span>Lignes {page * size + 1}–{Math.min((page + 1) * size, p.total)} sur {fmtNum(p.total)} (échantillon d'aperçu)</span>
        <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</Button><Button variant="secondary" size="sm" disabled={(page + 1) * size >= Math.min(p.total, 400)} onClick={() => setPage(page + 1)}>Suivant</Button></div></div></div>)
}

function ProfileTab({ datasetId, versionId }: { datasetId: string; versionId: string }) {
  const qc = useQueryClient(); const [started, setStarted] = useState(false)
  const q = useQuery({ queryKey: ['profile', versionId], queryFn: () => dataApi.profile(datasetId, versionId), retry: false, refetchInterval: (s) => (s.state.data && !isProfile(s.state.data) ? 700 : false) })
  const start = useMutation({ meta: { toast: 'Profilage lancé' }, mutationFn: () => dataApi.startProfile(datasetId, versionId), onSuccess: () => { setStarted(true); qc.invalidateQueries({ queryKey: ['profile', versionId] }) } })
  const r = q.data
  if (r && isProfile(r)) return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Calculé par {r.computed_by} · {fmtNum(r.rows)} lignes</p>
      {r.alerts.length > 0 && <Card title="Alertes">{<ul className="space-y-1">{r.alerts.map((a, i) => <li key={i} className="flex items-center gap-2 text-sm"><StatusBadge status={a.severity === 'info' ? 'queued' : a.severity} />{a.column && <code className="rounded bg-slate-100 px-1 text-xs">{a.column}</code>}{a.message}</li>)}</ul>}</Card>}
      <div className="grid gap-3 md:grid-cols-2">{r.columns.map((c) => (
        <Card key={c.name} title={<span>{c.name} <span className="font-normal text-slate-400">· {c.dtype}</span></span>}>
          <div className="mb-2 flex gap-4 text-xs text-slate-500"><span>manquants : <b className={c.missing_pct > 0 ? 'text-amber-700' : ''}>{c.missing_pct} %</b></span><span>valeurs uniques : <b>{fmtNum(c.unique)}</b></span>{c.mean !== undefined && <span>moy. {c.mean} · σ {c.std} · [{c.min}, {c.max}]</span>}</div>
          {c.histogram && <Histogram data={c.histogram} />}
          {c.top && <ul className="space-y-1">{c.top.map((t) => <li key={t.value} className="flex items-center gap-2 text-xs"><span className="w-28 truncate">{t.value}</span><div className="h-2 flex-1 rounded bg-slate-100"><div className="h-full rounded bg-brand-500" style={{ width: `${Math.round((t.count / r.rows) * 100)}%` }} /></div><span className="w-12 text-right text-slate-500">{pct(t.count / r.rows)}</span></li>)}</ul>}
        </Card>))}</div></div>)
  if (r && !isProfile(r)) return <Card><div className="flex items-center gap-3"><StatusBadge status={r.status} /><JobProgress value={r.progress} status={r.status} /><span className="text-sm text-slate-500">Profilage en cours…</span></div></Card>
  return (
    <>{q.error && !started && !(q.error as any).status?.toString().startsWith('4') ? <ErrorBanner error={q.error} /> : null}
      <EmptyState title="Ce dataset n'a pas encore de profil" hint="Le profilage calcule types, valeurs manquantes, distributions et alertes. Il alimente les recommandations de prétraitement et l'assistant." action={<Button onClick={() => start.mutate()} loading={start.isPending}>Lancer le profilage</Button>} />
      <ErrorBanner error={start.error} /></>)
}

function SplitsTab({ versionId, schema }: { versionId: string; schema: { name: string; dtype: string; nullable: boolean }[] }) {
  const qc = useQueryClient(); const nt = NODE_TYPE_BY_ID['data.split']
  const [spec, setSpec] = useState<Record<string, any>>({ strategy: 'stratified', test_ratio: 0.2, cv_folds: 5, seed: 42, target: schema[schema.length - 1].name })
  const q = useQuery({ queryKey: ['splits', versionId], queryFn: () => dataApi.splits(versionId) })
  const create = useMutation({ meta: { toast: 'Découpage créé' }, mutationFn: () => dataApi.createSplit(versionId, spec as SplitSpec), onSuccess: () => qc.invalidateQueries({ queryKey: ['splits', versionId] }) })
  const cols = schema.map((c) => ({ value: c.name, label: `${c.name} (${c.dtype})` }))
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">{q.isLoading ? <Spinner shape="table" /> : !q.data?.length ? <EmptyState title="Aucun split" hint="Un split fige les indices train / validation / test de façon déterministe. Le jeu de test reste réservé à l'évaluation finale." /> : (
        <Table head={['Split', 'Stratégie', 'Train', 'Validation', 'Test', 'Plis', 'Checksum']}>{q.data.map((s) => <tr key={s.id}><td className="td font-mono text-xs">{shortId(s.id)}</td><td className="td">{s.split_spec.strategy}</td><td className="td">{fmtNum(s.counts.train)}</td><td className="td">{fmtNum(s.counts.validation)}</td><td className="td">{fmtNum(s.counts.test)}</td><td className="td">{s.split_spec.cv_folds}</td><td className="td font-mono text-xs text-slate-500">{s.checksum}</td></tr>)}</Table>)}
        <p className="mt-2 text-xs text-slate-500">Les indices du jeu de test ne sont jamais exposés ici (accès réservé à l'évaluation finale).</p></div>
      <Card title="Nouveau split">
        <ErrorBanner error={create.error} />
        <SchemaForm schema={nt.params_schema} value={spec} onChange={setSpec} options={{ columns: cols }} hide={[...(spec.strategy === 'group' ? [] : ['group_column']), ...(spec.strategy === 'time' ? [] : ['time_column']), ...(spec.cv_folds === 1 ? [] : ['val_ratio'])]} />
        <Button className="mt-4 w-full" onClick={() => create.mutate()} loading={create.isPending}>Créer le split</Button></Card>
    </div>)
}

function PrepTab({ versionId, schema }: { versionId: string; schema: { name: string; dtype: any; nullable: boolean }[] }) {
  const qc = useQueryClient()
  const [steps, setSteps] = useState<PreprocessStep[]>([]); const [target, setTarget] = useState(schema[schema.length - 1].name)
  const [report, setReport] = useState<ValidationReport>(); const [splitId, setSplitId] = useState('')
  const task: Task = ['float'].includes(schema.find((c) => c.name === target)?.dtype ?? '') ? 'regression' : 'classification'
  const specs = useQuery({ queryKey: ['specs', versionId], queryFn: () => dataApi.specs(versionId) })
  const splits = useQuery({ queryKey: ['splits', versionId], queryFn: () => dataApi.splits(versionId) })
  const rec = useMutation({ meta: { toast: 'Recommandation appliquée' }, mutationFn: () => dataApi.recommend(versionId, target, task), onSuccess: (r) => { setSteps(r.spec.steps); setReport(undefined) } })
  const val = useMutation({ meta: { toast: validationToast }, mutationFn: () => dataApi.validatePreprocess(versionId, steps, target, splitId || undefined), onSuccess: setReport })
  const save = useMutation({ meta: { toast: 'Spécification enregistrée' }, mutationFn: () => dataApi.saveSpec(versionId, steps), onSuccess: () => qc.invalidateQueries({ queryKey: ['specs', versionId] }) })
  const [prevSpec, setPrevSpec] = useState('')
  const prev = useQuery({ queryKey: ['specprev', prevSpec, splitId], queryFn: () => dataApi.specPreview(prevSpec, splitId), enabled: !!prevSpec && !!splitId })
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card title="Étapes ordonnées" actions={<div className="flex items-center gap-2"><select className="input w-40" aria-label="Colonne cible" value={target} onChange={(e) => setTarget(e.target.value)}>{schema.map((c) => <option key={c.name}>{c.name}</option>)}</select><Button variant="secondary" size="sm" onClick={() => rec.mutate()} loading={rec.isPending}>Recommander</Button></div>}>
          <ErrorBanner error={rec.error ?? val.error ?? save.error} />
          {rec.data && <div className="mb-3 rounded-md bg-blue-50 p-2 text-xs text-blue-800">Recommandations par règles déterministes : {rec.data.rule_ids.join(', ')}.<EvidenceList items={rec.data.evidence_refs} /></div>}
          <StepsEditor value={steps} onChange={(s) => { setSteps(s); setReport(undefined) }} columns={schema} />
          <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => val.mutate()} loading={val.isPending}>Valider</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={report?.status === 'error'}>Enregistrer une version</Button></div>
          {save.data && <p className="mt-2 text-xs text-green-700">Version {save.data.version} enregistrée ({save.data.content_hash}).</p>}
        </Card>
        {report && <Card title="Validation (couche données)"><ValidationReportView report={report} /></Card>}
      </div>
      <div className="space-y-4 lg:col-span-2">
        <Card title="Versions enregistrées">{!specs.data?.length ? <p className="text-sm text-slate-500">Aucune version.</p> : <ul className="space-y-1.5">{specs.data.map((s) => <li key={s.id} className="flex items-center justify-between text-sm"><button className="text-brand-700 hover:underline" onClick={() => { setSteps(s.steps); setPrevSpec(s.id) }}>v{s.version} · {s.steps.length} étape(s)</button><code className="text-xs text-slate-400">{s.content_hash}</code></li>)}</ul>}</Card>
        <Card title="Effet sur l'échantillon d'apprentissage">
          <select className="input mb-3" aria-label="Split" value={splitId} onChange={(e) => setSplitId(e.target.value)}><option value="">— choisir un split —</option>{splits.data?.map((s) => <option key={s.id} value={s.id}>{shortId(s.id)} ({s.split_spec.strategy})</option>)}</select>
          {!prevSpec ? <p className="text-xs text-slate-500">Cliquez sur une version enregistrée puis choisissez un split.</p> : prev.isLoading ? <Spinner /> : prev.data && <div className="space-y-2 text-sm"><p>Colonnes : {prev.data.columns_before} → <b>{prev.data.columns_after}</b></p><p>Manquants avant : {prev.data.missing_before.map((m) => `${m.column} ${m.pct} %`).join(', ') || '—'}</p><p>Manquants après : {prev.data.missing_after.map((m) => `${m.column} ${m.pct} %`).join(', ') || <b className="text-green-700">aucun</b>}</p><p className="text-xs text-slate-400">Calculé sur : {prev.data.sample}</p></div>}
          <ErrorBanner error={prev.error} />
        </Card>
        <Note>Le préprocesseur n'est jamais ajusté ici : E2 l'ajuste sur chaque pli d'apprentissage pour éviter toute fuite.</Note>
      </div>
    </div>)
}
void Link
