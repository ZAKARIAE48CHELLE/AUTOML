import { Link } from 'react-router-dom'
import { FileSearch } from 'lucide-react'
import type { EvidenceRef } from '@contracts/src'

const href = (e: EvidenceRef): string | null => {
  const id = e.source_id.split('#')[0]
  if (e.source_type === 'run') return `/training/experiments/${id}`
  if (e.source_type === 'execution') return `/studio/executions/${id}`
  if (e.source_type === 'profile' || e.source_type === 'dataset') return `/data`
  return null
}
/** Propriétaire : E3. Toute valeur chiffrée affichée par l'assistant doit avoir une EvidenceRef cliquable. */
export function EvidenceChip({ e }: { e: EvidenceRef }) {
  const h = href(e)
  const inner = <><FileSearch className="h-3 w-3" /><span className="font-medium">{e.source_type}</span><span className="truncate">{e.summary}</span></>
  const cls = 'inline-flex max-w-xs items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600'
  return h ? <Link to={h} className={cls + ' hover:bg-slate-100'} title={e.source_id}>{inner}</Link> : <span className={cls} title={e.source_id}>{inner}</span>
}
export const EvidenceList = ({ items }: { items?: EvidenceRef[] }) => (items?.length ? <div className="mt-2 flex flex-wrap gap-1">{items.map((e, i) => <EvidenceChip key={i} e={e} />)}</div> : null)
