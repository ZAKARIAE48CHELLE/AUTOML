import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Mode } from '@contracts/src'
import { assistantApi } from '@/api/assistant'
import { useSession } from '@/lib/session'
import { Button, Card, ErrorBanner, Modal, Note, PageHeader, Spinner } from '@/components/ui'
import { clsx } from '@/lib/format'

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'auto', label: 'Auto', desc: 'L\'assistant propose, vous approuvez un plan avec budget. Les versions dérivées dans le budget restent couvertes.' },
  { id: 'guided', label: 'Guidé', desc: 'Une approbation par étape d\'exécution (entraînement, tuning, enregistrement).' },
  { id: 'expert', label: 'Expert', desc: 'Votre clic « Lancer » vaut approbation des étapes coûteuses (journalisé). L\'IA explique seulement.' },
]
export function ModeSettings() {
  const { projectId, mode, setMode } = useSession(); const [pending, setPending] = useState<Mode>(); const [err, setErr] = useState<unknown>(); const [busy, setBusy] = useState(false)
  const pol = useQuery({ queryKey: ['policy'], queryFn: assistantApi.policy, staleTime: Infinity })
  return (
    <>
      <PageHeader title="Mode de l'assistant et politique" subtitle="Le mode du projet détermine quelles approbations sont demandées. La matrice est en lecture seule : elle est appliquée côté serveur." actions={<Link to="/assistant/audit"><Button variant="secondary">Journal des décisions</Button></Link>} />
      <ErrorBanner error={err} />
      <div className="mb-6 grid gap-3 md:grid-cols-3">{MODES.map((m) => (
        <button key={m.id} onClick={() => m.id !== mode && setPending(m.id)} aria-pressed={m.id === mode} className={clsx('card p-4 text-left', m.id === mode ? 'border-brand-500 ring-1 ring-brand-500' : 'hover:border-slate-400')}>
          <div className="mb-1 flex items-center justify-between font-semibold">{m.label}{m.id === mode && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">actif</span>}</div><p className="text-xs text-slate-600">{m.desc}</p></button>))}</div>
      <Card title="Matrice de politique (classe d'opération × mode)">
        {pol.isLoading ? <Spinner shape="table" /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="th">Classe</th>{MODES.map((m) => <th key={m.id} className={clsx('th', m.id === mode && 'bg-brand-50 text-brand-700')}>{m.label}</th>)}</tr></thead>
          <tbody className="divide-y">{pol.data?.classes.map((c) => { const row = pol.data!.matrix.find((r) => r.cls === c.id)!; return (
            <tr key={c.id} className="align-top"><td className="td"><div className="font-semibold">{c.id} — {c.label}</div><div className="text-xs text-slate-500">{c.examples}</div></td>{MODES.map((m) => <td key={m.id} className={clsx('td text-xs', m.id === mode && 'bg-brand-50/50')}>{row[m.id]}</td>)}</tr>) })}</tbody></table></div>}
      </Card>
      <div className="mt-4"><Note>Quel que soit le mode, le test final et la promotion d'un modèle (L3) exigent une approbation individuelle explicite.</Note></div>
      <Modal open={!!pending} onClose={() => setPending(undefined)} title={`Passer en mode ${MODES.find((m) => m.id === pending)?.label}`} footer={<><Button variant="secondary" onClick={() => setPending(undefined)}>Annuler</Button><Button loading={busy} onClick={async () => { setBusy(true); try { await setMode(pending!); setPending(undefined) } catch (e) { setErr(e); setPending(undefined) } finally { setBusy(false) } }}>Confirmer</Button></>}>
        <p className="text-sm">Le changement s'applique à tout le projet ({projectId}) et est journalisé. Les approbations déjà données restent valables pour leur content_hash, mais les exigences des prochaines exécutions suivront le nouveau mode.</p></Modal>
    </>)
}
