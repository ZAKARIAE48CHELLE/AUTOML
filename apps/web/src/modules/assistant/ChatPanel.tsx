import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { motion } from 'framer-motion'
import type { PlanProposal, ProposedAction } from '@contracts/src'
import { assistantApi } from '@/api/assistant'
import { dataApi } from '@/api/data'
import { useSession } from '@/lib/session'
import { Button, ErrorBanner, SimBadge, Spinner } from '@/components/ui'
import { EvidenceList } from '@/components/Evidence'
import { PlanProposalCard } from './PlanProposalCard'

const SUGGESTIONS = ['Quelle est la qualité de mes données ?', 'Je veux prédire churn avec un budget de 10 min', 'Lance le test final maintenant']

export function ChatPanel({ compact }: { compact?: boolean }) {
  const { projectId } = useSession(); const qc = useQueryClient(); const end = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(''); const [proposals, setProposals] = useState<Record<string, PlanProposal>>({})
  const msgs = useQuery({ queryKey: ['chat', projectId], queryFn: () => assistantApi.messages(projectId!) })
  const ds = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!) })
  const dsv = ds.data?.find((d) => d.status === 'ready')?.latest_version_id
  const send = useMutation({ mutationFn: (m: string) => assistantApi.send(projectId!, m, dsv ? [dsv] : []), onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['chat', projectId] }); qc.invalidateQueries({ queryKey: ['audit'] }) } })
  const propose = useMutation({ meta: { toast: 'Plan proposé par l’IA' }, mutationFn: ({ a }: { a: ProposedAction; id: string }) => assistantApi.propose(a.ref, dsv!), onSuccess: (p, v) => { setProposals((s) => ({ ...s, [v.id]: p })); qc.invalidateQueries({ queryKey: ['audit'] }); qc.invalidateQueries({ queryKey: ['workflows'] }) } })
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }) }, [msgs.data?.length, send.isPending, Object.keys(proposals).length])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-2.5 text-sm font-semibold">Assistant <SimBadge /></div>
      <div className="flex-1 space-y-3 overflow-auto p-4" aria-live="polite">
        {msgs.isLoading && <Spinner shape="chat" />}
        {!msgs.isLoading && !msgs.data?.length && <div className="space-y-2 text-sm text-slate-500"><p>Je peux décrire vos données, structurer un objectif et préparer un plan de workflow à relire. Je n'exécute jamais rien moi-même.</p>{SUGGESTIONS.map((s) => <button key={s} className="block w-full rounded-md border border-slate-200 p-2 text-left text-xs hover:bg-slate-50" onClick={() => send.mutate(s)}>{s}</button>)}</div>}
        {msgs.data?.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 26 }} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.role === 'user' ? 'bg-gradient-to-br from-brand-600 to-brand-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
              <p>{m.text}</p>{m.role === 'assistant' && <EvidenceList items={m.evidence_refs} />}
              {m.proposed_actions?.map((a) => a.kind === 'create_proposal' && !proposals[m.id] && <Button key={a.ref} size="sm" className="mt-2" disabled={!dsv} loading={propose.isPending && propose.variables?.id === m.id} onClick={() => propose.mutate({ a, id: m.id })}>{a.label}</Button>)}
            </div>
            {proposals[m.id] && <div className="mt-2"><PlanProposalCard proposal={proposals[m.id]} /></div>}
          </motion.div>))}
        {send.isPending && <div className="flex w-16 items-center justify-center gap-1 rounded-lg bg-slate-100 px-3 py-3" aria-label="L'assistant écrit">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-brand-500" style={{ animation: `bounceDot 1s ease-in-out ${i * 0.15}s infinite` }} />)}</div>}
        <div ref={end} />
      </div>
      <div className="border-t p-3"><ErrorBanner error={send.error ?? propose.error} />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text.trim()) }}>
          <input className="input" placeholder={compact ? 'Message…' : 'Décrivez votre objectif ou posez une question…'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
          <Button type="submit" loading={send.isPending} disabled={!text.trim()} aria-label="Envoyer"><Send className="h-4 w-4" /></Button></form></div>
    </div>)
}
