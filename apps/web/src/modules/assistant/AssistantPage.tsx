import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import type { PlanProposal } from '@contracts/src'
import { assistantApi } from '@/api/assistant'
import { dataApi } from '@/api/data'
import { useSession } from '@/lib/session'
import { Button, Card, ErrorBanner, Note, PageHeader, SimBadge } from '@/components/ui'
import { ChatPanel } from './ChatPanel'
import { PlanProposalCard } from './PlanProposalCard'

export function AssistantPage() {
  const { projectId } = useSession(); const qc = useQueryClient()
  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!) })
  const [dsId, setDsId] = useState(''); const [goalText, setGoalText] = useState(''); const [proposal, setProposal] = useState<PlanProposal>()
  const dsv = ds.data?.find((d) => d.id === (dsId || ds.data?.find((x) => x.status === 'ready')?.id))?.latest_version_id
  const parse = useMutation({ meta: { toast: 'Objectif analysé' }, mutationFn: () => assistantApi.parseGoal(goalText, dsv!), onSuccess: () => setProposal(undefined) })
  const propose = useMutation({ meta: { toast: { title: 'Plan proposé par l’IA', detail: 'Un nouveau workflow est prêt à être revu.', celebrate: 'small' } }, mutationFn: () => assistantApi.propose(parse.data!.goal.id, dsv!), onSuccess: (p) => { setProposal(p); qc.invalidateQueries({ queryKey: ['workflows'] }); qc.invalidateQueries({ queryKey: ['audit'] }) } })
  const g = parse.data?.goal
  return (
    <>
      <PageHeader title="Assistant" subtitle="Décrivez un objectif : l'assistant le structure puis prépare un plan de workflow que vous relisez avant toute exécution." actions={<><Link to="/assistant/settings"><Button variant="secondary">Mode & politique</Button></Link><Link to="/assistant/audit" data-auto-target="assistant.audit"><Button variant="secondary">Journal</Button></Link></>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2">Du besoin au plan <SimBadge /></span>}>
            <ErrorBanner error={parse.error ?? propose.error} />
            <label className="label" htmlFor="ag-ds">Dataset</label>
            <select id="ag-ds" className="input mb-3" value={dsId} onChange={(e) => setDsId(e.target.value)}>{ds.data?.filter((d) => d.status === 'ready').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <label className="label" htmlFor="ag-g">Objectif</label>
            <textarea id="ag-g" className="input min-h-24" placeholder="Ex. Prédire quels clients vont partir (churn), tuning limité à 10 min." value={goalText} onChange={(e) => setGoalText(e.target.value)} />
            <Button className="mt-3" disabled={!goalText.trim() || !dsv} loading={parse.isPending} onClick={() => parse.mutate()}><Wand2 className="h-4 w-4" />Structurer l'objectif</Button>
            {g && <div className="mt-4 space-y-2 rounded-md border border-slate-200 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2"><div><span className="text-xs text-slate-500">Tâche</span><div>{g.task}</div></div><div><span className="text-xs text-slate-500">Cible</span><div className="font-mono">{g.target}</div></div><div><span className="text-xs text-slate-500">Métrique</span><div>{g.objective.primary_metric} ({g.objective.direction === 'maximize' ? 'max' : 'min'})</div></div><div><span className="text-xs text-slate-500">Contraintes</span><div>{g.constraints.join(', ') || '—'}</div></div></div>
              {g.ambiguities.map((a, i) => <Note key={i} tone="warn">{a}</Note>)}
              {parse.data!.warnings.map((a, i) => <Note key={i} tone="warn">{a}</Note>)}
              {parse.data!.questions.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-600">{parse.data!.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
              <Button loading={propose.isPending} onClick={() => propose.mutate()}>Générer le plan</Button></div>}
          </Card>
          {proposal && <PlanProposalCard proposal={proposal} />}
        </div>
        <Card className="h-[34rem] overflow-hidden !p-0"><ChatPanel /></Card>
      </div>
    </>)
}
