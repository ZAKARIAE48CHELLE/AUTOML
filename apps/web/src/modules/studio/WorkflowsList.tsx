import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { dataApi } from '@/api/data'
import { studioApi } from '@/api/studio'
import { useSession } from '@/lib/session'
import { Button, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'
import { ago } from '@/lib/format'

export function WorkflowsList() {
  const { projectId } = useSession(); const nav = useNavigate(); const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['workflows', projectId], queryFn: () => studioApi.workflows(projectId!) })
  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!) })
  const tpl = useQuery({ queryKey: ['templates'], queryFn: studioApi.templates })
  const [t, setT] = useState('full_pipeline'); const [dsId, setDsId] = useState(''); const [target, setTarget] = useState('')
  const dq = useQuery({ queryKey: ['dataset', dsId], queryFn: () => dataApi.dataset(dsId), enabled: !!dsId })
  const row = ds.data?.find((d) => d.id === dsId)
  const create = useMutation({ mutationFn: () => studioApi.fromTemplate({ template_id: t, dataset_version_id: row!.latest_version_id, target }), onSuccess: (r) => nav(`/studio/workflows/${r.workflow_id}`) })
  const blank = useMutation({ mutationFn: () => studioApi.createWorkflow(projectId!, 'Nouveau workflow', { schema_version: '1.0', catalog_version: '1.0.0', nodes: [], edges: [], metadata: { task: 'classification', origin: 'human' } }), onSuccess: (r) => nav(`/studio/workflows/${r.workflow_id}`) })
  return (
    <>
      <PageHeader title="Studio — Workflows" subtitle="Graphes ML versionnés. Une modification crée toujours une nouvelle version ; l'exécution ne se fait que depuis la revue." actions={<><Link to="/studio/executions"><Button variant="secondary">Exécutions</Button></Link><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nouveau workflow</Button></>} />
      <ErrorBanner error={q.error ?? blank.error} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <EmptyState title="Aucun workflow" hint="Créez-en un depuis un gabarit, ou demandez un plan à l'assistant." action={<Button onClick={() => setOpen(true)}>Nouveau workflow</Button>} /> : (
        <Table head={['Nom', 'Origine', 'Versions', 'Dernière version', 'État', 'Actions']}>{q.data.map((w) => (
          <tr key={w.id} className="hover:bg-slate-50"><td className="td font-medium"><Link className="text-brand-700 hover:underline" to={`/studio/workflows/${w.id}`}>{w.name}</Link></td>
            <td className="td">{w.latest.origin === 'ai' ? <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-800">IA</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">humain</span>}</td><td className="td">{w.versions_count}</td><td className="td text-slate-500">{ago(w.latest.created_at)}</td><td className="td"><StatusBadge status={w.latest.readiness} /></td>
            <td className="td"><Link className="text-xs text-brand-700 hover:underline" to={`/studio/workflows/${w.id}/review/${w.latest.id}`}>Revue & exécution</Link></td></tr>))}</Table>)}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau workflow" footer={<><Button variant="ghost" loading={blank.isPending} onClick={() => blank.mutate()}>Workflow vide</Button><Button disabled={!dsId || !target} loading={create.isPending} onClick={() => create.mutate()}>Créer depuis le gabarit</Button></>}>
        <ErrorBanner error={create.error} />
        <div className="space-y-3"><div><label className="label" htmlFor="nw-t">Gabarit</label><select id="nw-t" className="input" value={t} onChange={(e) => setT(e.target.value)}>{tpl.data?.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">{tpl.data?.find((x) => x.id === t)?.description}</p></div>
          <div><label className="label" htmlFor="nw-d">Dataset</label><select id="nw-d" className="input" value={dsId} onChange={(e) => { setDsId(e.target.value); setTarget('') }}><option value="">— choisir —</option>{ds.data?.filter((d) => d.status === 'ready').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className="label" htmlFor="nw-c">Colonne cible</label><select id="nw-c" className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!dq.data}><option value="">— choisir —</option>{dq.data?.versions.at(-1)?.schema.map((c) => <option key={c.name}>{c.name}</option>)}</select></div></div>
      </Modal>
    </>)
}
