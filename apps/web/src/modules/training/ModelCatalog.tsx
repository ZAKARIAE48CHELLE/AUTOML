import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { trainingApi } from '@/api/training'
import { Card, ErrorBanner, PageHeader, Spinner, Note } from '@/components/ui'

export function ModelCatalog() {
  const q = useQuery({ queryKey: ['models', 'all'], queryFn: () => trainingApi.models() })
  const res = useQuery({ queryKey: ['resources'], queryFn: trainingApi.resources })
  if (q.isLoading) return <Spinner shape="cards" />
  return (
    <>
      <PageHeader title="Catalogue des modèles" subtitle="Modèles disponibles, paramètres, prérequis et déterminisme. Le deep learning reste fermé tant que la porte G-DL n'est pas validée." />
      <ErrorBanner error={q.error} />
      {res.data && <Note>Ressources : {res.data.cpu} CPU, {res.data.gpu} GPU · durée max {res.data.max_minutes} min · concurrence {res.data.concurrency} · plafonds de budget : {res.data.budget_caps.trials} essais, {res.data.budget_caps.max_minutes} min, {res.data.budget_caps.models} modèles.</Note>}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{q.data?.map((m) => (
        <Card key={m.id} className={m.disabled ? 'opacity-60' : ''} title={<span className="flex items-center gap-2">{m.label}{m.disabled && <Lock className="h-3.5 w-3.5" />}</span>}>
          <div className="mb-2 flex flex-wrap gap-1 text-[11px]"><span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{m.family}</span>{m.task.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5">{t}</span>)}<span className={`rounded px-1.5 py-0.5 ${m.determinism === 'exact' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>déterminisme : {m.determinism}</span></div>
          <table className="w-full text-xs"><tbody>{Object.entries(m.params_schema.properties ?? {}).map(([k, s]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 font-mono">{k}</td><td className="py-1 text-slate-500">{s.title}</td><td className="py-1 text-right text-slate-500">{s.minimum}–{s.maximum} (déf. {String(s.default)})</td></tr>)}</tbody></table>
          <p className="mt-2 text-[11px] text-slate-400">Prérequis : {m.dependencies.join(', ')}</p>{m.disabled && <p className="mt-1 text-xs text-amber-700">Fermé : porte G-DL non validée.</p>}
        </Card>))}</div>
    </>)
}
