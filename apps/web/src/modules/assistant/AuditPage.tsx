import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { assistantApi } from '@/api/assistant'
import { useSession } from '@/lib/session'
import { EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'
import { fmtDate } from '@/lib/format'

const ACTIONS = ['proposal_created', 'validation_run', 'approval_created', 'approval_revoked', 'execution_requested', 'execution_finished', 'final_test_run', 'model_promoted', 'export_created', 'tool_refused', 'mode_changed']
export function AuditPage() {
  const { projectId } = useSession(); const [action, setAction] = useState(''); const [actor, setActor] = useState('')
  const q = useQuery({ queryKey: ['audit', projectId, action, actor], queryFn: () => assistantApi.audit(projectId!, { action: action || undefined, actor_type: actor || undefined }), refetchInterval: 5000 })
  return (
    <>
      <PageHeader title="Journal des décisions" subtitle="Propositions, validations, approbations, exécutions et refus d'outils. Chaque entrée est traçable (request_id)." />
      <div className="mb-3 flex gap-2"><select className="input w-56" aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}><option value="">Toutes les actions</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select><select className="input w-44" aria-label="Acteur" value={actor} onChange={(e) => setActor(e.target.value)}><option value="">Tous les acteurs</option><option value="user">Utilisateur</option><option value="assistant">Assistant</option><option value="system">Système</option></select></div>
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <EmptyState title="Aucun événement" /> : (
        <Table head={['Date', 'Acteur', 'Action', 'Ressource', 'Résultat', 'Détail']}>{q.data.map((e) => <tr key={e.id} className={e.outcome === 'refused' ? 'bg-amber-50/60' : ''}><td className="td whitespace-nowrap text-slate-500">{fmtDate(e.ts)}</td><td className="td">{e.actor.type}</td><td className="td font-mono text-xs">{e.action}</td><td className="td font-mono text-xs">{e.resource_ref ?? '—'}</td><td className="td"><StatusBadge status={e.outcome === 'refused' ? 'warning' : e.outcome} /></td><td className="td text-xs text-slate-600">{e.reason ?? '—'}<div className="font-mono text-[10px] text-slate-400">{e.request_id}{e.approval_id ? ` · ${e.approval_id}` : ''}</div></td></tr>)}</Table>)}
    </>)
}
