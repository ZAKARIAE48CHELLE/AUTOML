import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { dataApi } from '@/api/data'
import { useSession } from '@/lib/session'
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui'
import { fmtDate, fmtNum } from '@/lib/format'

const MAX_MB = 50
export function DatasetsPage() {
  const { projectId } = useSession(); const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null)
  const [localErr, setLocalErr] = useState<string>()
  const q = useQuery({ queryKey: ['datasets', projectId], queryFn: () => dataApi.datasets(projectId!), refetchInterval: (s) => (s.state.data?.some((d) => d.status === 'importing') ? 800 : false) })
  const imp = useMutation({ meta: { toast: (_: unknown, f: File) => ({ title: 'Jeu de données importé', detail: f.name, celebrate: 'small' }) }, mutationFn: (f: File) => dataApi.importDataset(projectId!, f), onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }) })
  const pick = (f?: File) => {
    setLocalErr(undefined); if (!f) return
    if (!/\.(csv|xlsx)$/i.test(f.name)) return setLocalErr('Format non supporté : utilisez un fichier CSV ou XLSX.')
    if (f.size > MAX_MB * 1024 * 1024) return setLocalErr(`Fichier trop volumineux (max ${MAX_MB} Mo).`)
    imp.mutate(f)
  }
  return (
    <>
      <PageHeader title="Données" subtitle="Importez un fichier, explorez-le, profilez-le et préparez-le. Les versions de dataset sont immuables." actions={<>
        <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Choisir un fichier" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <Button onClick={() => input.current?.click()} loading={imp.isPending}><Upload className="h-4 w-4" />Importer un fichier</Button></>} />
      {localErr && <ErrorBanner error={new Error(localErr)} onClose={() => setLocalErr(undefined)} />}
      <ErrorBanner error={imp.error ?? q.error} />
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]) }}>
        {q.isLoading ? <Spinner shape="table" /> : !q.data?.length ? <EmptyState title="Aucun dataset dans ce projet" hint="Glissez un CSV ici ou utilisez « Importer un fichier ». Colonnes, types et lignes sont détectés automatiquement." /> : (
          <Table head={['Nom', 'Lignes', 'Colonnes', 'Statut', 'Créé le']}>{q.data.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50"><td className="td font-medium"><Link className="text-brand-700 hover:underline" to={`/data/${d.id}`}>{d.name}</Link></td><td className="td">{fmtNum(d.rows)}</td><td className="td">{d.columns}</td><td className="td"><StatusBadge status={d.status ?? 'ready'} /></td><td className="td text-slate-500">{fmtDate(d.created_at)}</td></tr>))}</Table>)}
      </div>
    </>)
}
