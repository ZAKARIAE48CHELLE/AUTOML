import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { studioApi } from '@/api/studio'
import { Button, Card, ErrorBanner, JobProgress, Note, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'

export function ExportPage() {
  const { exportId } = useParams()
  const q = useQuery({ queryKey: ['export', exportId], queryFn: () => studioApi.exportManifest(exportId!), refetchInterval: (s) => (s.state.data?.status === 'running' || s.state.data?.status === 'queued' ? 800 : false) })
  if (q.isLoading) return <Spinner />
  if (!q.data) return <ErrorBanner error={q.error} />
  const m = q.data; const ready = m.status === 'succeeded'
  const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${m.export_id}-manifest.json`; a.click(); URL.revokeObjectURL(url) }
  return (
    <>
      <PageHeader title={`Export ${m.export_id}`} subtitle={<>Exécution <Link className="text-brand-700 hover:underline" to={`/studio/executions/${m.execution_id}`}>{m.execution_id}</Link> · content_hash {m.content_hash}</>} actions={<Button onClick={download} disabled={!ready}><Download className="h-4 w-4" />Télécharger le manifeste</Button>} />
      {!ready ? <Card><div className="flex items-center gap-3"><StatusBadge status={m.status} /><JobProgress value={0.6} /><span className="text-sm text-slate-500">Génération du bundle…</span></div></Card> : <div className="space-y-4">
        <Card title="Bundle"><p className="font-mono text-sm">{m.bundle_uri}</p><p className="mt-1 text-xs text-slate-500">Intégrité : <code>{m.integrity}</code></p></Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Références"><dl className="space-y-1 text-xs"><div><dt className="inline text-slate-500">Datasets : </dt><dd className="inline font-mono">{m.dataset_refs.join(', ')}</dd></div><div><dt className="inline text-slate-500">Splits : </dt><dd className="inline font-mono">{m.split_refs.join(', ')}</dd></div><div><dt className="inline text-slate-500">Graines : </dt><dd className="inline font-mono">{m.seeds.join(', ')}</dd></div><div><dt className="text-slate-500">Prétraitement :</dt><dd className="break-all font-mono">{m.preprocess_spec}</dd></div></dl></Card>
          <Card title="Environnement (lockfile)"><ul className="font-mono text-xs">{m.environment.map((x) => <li key={x}>{x}</li>)}</ul></Card></div>
        <Card title="Code généré (gabarits approuvés)"><Table head={['Fichier', 'Gabarit', 'sha256']}>{m.code.map((c) => <tr key={c.path}><td className="td font-mono text-xs">{c.path}</td><td className="td text-xs">{c.template_id}</td><td className="td font-mono text-xs text-slate-500">{c.sha256}</td></tr>)}</Table></Card>
        <Card title="Artefacts"><Table head={['Référence', 'Checksum', 'Inclus']}>{m.artifacts.map((a) => <tr key={a.ref}><td className="td font-mono text-xs">{a.ref}</td><td className="td font-mono text-xs text-slate-500">{a.checksum}</td><td className="td">{a.included ? 'oui' : 'non'}</td></tr>)}</Table></Card>
        <Note tone="warn"><b>Limites :</b><ul className="mt-1 list-disc pl-4">{m.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Note></div>}
    </>)
}
