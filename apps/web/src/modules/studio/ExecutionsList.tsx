import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { studioApi } from '@/api/studio'
import { useSession } from '@/lib/session'
import { EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'
import { fmtDate, shortId } from '@/lib/format'

export function ExecutionsList() {
  const { projectId } = useSession()
  const q = useQuery({ queryKey: ['executions', 'project', projectId], queryFn: () => studioApi.executions({ project_id: projectId! }), refetchInterval: 2000 })
  const wf = useQuery({ queryKey: ['workflows', projectId], queryFn: () => studioApi.workflows(projectId!) })
  const name = (id: string) => wf.data?.find((w) => w.id === id)?.name ?? id
  return (
    <>
      <PageHeader title="Exécutions" subtitle="Historique de toutes les exécutions du projet. Chaque exécution est liée à une version immuable et à ses approbations." />
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <EmptyState title="Aucune exécution" hint="Lancez-en une depuis la page de revue d'une version approuvée." /> : (
        <Table head={['Exécution', 'Workflow', 'Version', 'Statut', 'Nœuds', 'Démarrée', 'Terminée']}>{q.data.map((e) => (
          <tr key={e.id} className="hover:bg-slate-50"><td className="td"><Link className="font-mono text-xs text-brand-700 hover:underline" to={`/studio/executions/${e.id}`}>{shortId(e.id)}</Link></td><td className="td">{name(e.workflow_id)}</td><td className="td font-mono text-xs">{shortId(e.workflow_version_id)}</td><td className="td"><StatusBadge status={e.status} /></td>
            <td className="td text-xs text-slate-500">{e.node_runs.filter((n) => n.status === 'succeeded').length}/{e.node_runs.length}{e.node_runs.some((n) => n.cached) ? ' (cache)' : ''}</td><td className="td text-slate-500">{fmtDate(e.created_at)}</td><td className="td text-slate-500">{fmtDate(e.finished_at)}</td></tr>))}</Table>)}
    </>)
}
