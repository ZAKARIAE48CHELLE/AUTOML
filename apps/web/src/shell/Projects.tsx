import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Plus } from 'lucide-react'
import { dataApi } from '@/api/data'
import { useSession } from '@/lib/session'
import { Button, ErrorBanner, Spinner, SimulationBanner } from '@/components/ui'
import { fmtDate } from '@/lib/format'

export function Projects() {
  const { user, setProjectId } = useSession(); const nav = useNavigate(); const qc = useQueryClient()
  const q = useQuery({ queryKey: ['projects'], queryFn: dataApi.projects, enabled: !!user })
  const [name, setName] = useState('')
  const create = useMutation({ mutationFn: () => dataApi.createProject(name), onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['projects'] }); setProjectId(p.project_id); nav('/data') } })
  if (!user) return <Navigate to="/login" replace />
  return (
    <div className="relative h-full overflow-auto"><div className="aurora" aria-hidden="true"><i /><i /><i /></div><div className="relative z-10"><SimulationBanner />
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="mb-1 text-xl font-semibold">Vos projets</h1><p className="mb-5 text-sm text-slate-500">Choisissez un projet pour accéder aux données, aux entraînements et aux workflows.</p>
        <ErrorBanner error={q.error ?? create.error} />
        {q.isLoading ? <Spinner /> : <ul className="stagger space-y-2">{q.data?.map((p) => (
          <li key={p.id}><button onClick={() => { setProjectId(p.id); nav('/data') }} className="card flex w-full items-center gap-3 p-4 text-left"><FolderOpen className="nav-icon h-5 w-5 text-brand-600" /><div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">Rôle : {p.role} · créé le {fmtDate(p.created_at)}</div></div></button></li>))}</ul>}
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
          <input className="input" placeholder="Nom du nouveau projet" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du projet" />
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}><Plus className="h-4 w-4" />Créer</Button></form>
      </div></div></div>)
}
