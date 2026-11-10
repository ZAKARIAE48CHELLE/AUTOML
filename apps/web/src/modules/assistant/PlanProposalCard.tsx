import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { PlanProposal } from '@contracts/src'
import { NODE_TYPE_BY_ID } from '@contracts/src'
import { studioApi } from '@/api/studio'
import { Button, Card, Note, SimBadge, Spinner, StatusBadge } from '@/components/ui'
import { EvidenceList } from '@/components/Evidence'

/** Propriétaire : E3 (contenu) — affiché dans le chat et la revue (E4). Le plan est une version de workflow, jamais une exécution. */
export function PlanProposalCard({ proposal, hideActions }: { proposal: PlanProposal; hideActions?: boolean }) {
  const v = useQuery({ queryKey: ['version', proposal.workflow_id, proposal.workflow_version_id], queryFn: () => studioApi.version(proposal.workflow_id, proposal.workflow_version_id) })
  const rep = useQuery({ queryKey: ['report', proposal.workflow_version_id], queryFn: () => studioApi.report(proposal.workflow_id, proposal.workflow_version_id), retry: false })
  return (
    <Card title={<span className="flex items-center gap-2">Plan proposé {proposal.simulated && <SimBadge />}</span>} actions={rep.data && <StatusBadge status={rep.data.status} />}>
      <Note>Ce plan est une <b>version de workflow à relire</b>. Rien n'est exécuté tant que vous ne l'avez pas approuvé dans le Studio.</Note>
      {v.isLoading ? <Spinner /> : <ol className="mt-3 space-y-2">{v.data?.spec.nodes.map((n) => (
        <li key={n.id} className="rounded-md border border-slate-200 p-2.5 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{NODE_TYPE_BY_ID[n.type]?.label ?? n.type} <span className="font-mono text-xs text-slate-400">{n.id}</span></span><span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{NODE_TYPE_BY_ID[n.type]?.operation_class}</span></div>
          {proposal.rationale[n.id] && <p className="mt-1 text-xs text-slate-600">{proposal.rationale[n.id]}</p>}</li>))}</ol>}
      {proposal.assumptions.length > 0 && <div className="mt-3"><h4 className="text-xs font-semibold text-slate-600">Hypothèses</h4><ul className="list-disc pl-5 text-xs text-slate-600">{proposal.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      {proposal.warnings.length > 0 && <div className="mt-3"><Note tone="warn"><ul className="list-disc pl-4">{proposal.warnings.map((a, i) => <li key={i}>{a}</li>)}</ul></Note></div>}
      <div className="mt-3"><h4 className="text-xs font-semibold text-slate-600">Preuves</h4><EvidenceList items={proposal.evidence_refs} /></div>
      <div className="mt-3 text-xs text-slate-600"><b>Approbations requises :</b> {proposal.required_approvals.length ? proposal.required_approvals.map((r) => `${r.operation_class}${r.individual ? ' (individuelle)' : ''} ${r.node_ids.join(', ')}`).join(' · ') : 'aucune'}</div>
      {!hideActions && <div className="mt-4 flex gap-2"><Link to={`/studio/workflows/${proposal.workflow_id}/review/${proposal.workflow_version_id}?proposal=${proposal.id}`}><Button>Relire et approuver</Button></Link><Link to={`/studio/workflows/${proposal.workflow_id}`}><Button variant="secondary">Ouvrir dans l'éditeur</Button></Link></div>}
    </Card>)
}
