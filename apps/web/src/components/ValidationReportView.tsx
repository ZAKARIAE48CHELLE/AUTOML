import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ValidationReport, ValidationIssue } from '@contracts/src'
import { StatusBadge } from './ui'
import { clsx } from '@/lib/format'

const LAYER_LABEL: Record<string, string> = { structure: 'Structure (E4)', data: 'Données (E1)', training: 'Entraînement (E2)', policy: 'Politique (E3)' }
const SEV = { error: 'border-red-200 bg-red-50 text-red-800', warning: 'border-amber-200 bg-amber-50 text-amber-800', info: 'border-slate-200 bg-slate-50 text-slate-600' }

/** Rapport de validation unique, quatre couches. onSelectNode permet de pointer le nœud fautif dans l'éditeur. */
export function ValidationReportView({ report, onSelectNode, compact }: { report: ValidationReport; onSelectNode?: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><span className="text-sm font-medium">Résultat global</span><StatusBadge status={report.status} /></div>
      {report.layers.map((l) => {
        const isOpen = open[l.layer] ?? l.status !== 'ok'
        return (
          <div key={l.layer} className="rounded-md border border-slate-200">
            <button className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setOpen({ ...open, [l.layer]: !isOpen })} aria-expanded={isOpen}>
              <span className="flex items-center gap-1.5 text-sm font-medium">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{LAYER_LABEL[l.layer] ?? l.layer}<span className="text-xs font-normal text-slate-500">· {l.issues.length} point(s)</span></span>
              <StatusBadge status={l.status} />
            </button>
            {isOpen && (l.issues.length ? <ul className={clsx('space-y-1.5 px-3 pb-3', compact && 'text-xs')}>{l.issues.map((i: ValidationIssue, k) => (
              <li key={k} className={clsx('rounded border px-2.5 py-1.5 text-xs', SEV[i.severity])}>
                <div className="flex items-start justify-between gap-2"><span><b>{i.code}</b> — {i.message}</span>{i.node_id && <button className="shrink-0 underline" onClick={() => onSelectNode?.(i.node_id!)}>nœud {i.node_id}</button>}</div>
                {i.hint && <div className="mt-0.5 opacity-80">→ {i.hint}</div>}</li>))}</ul> : <p className="px-3 pb-3 text-xs text-slate-500">Aucun problème.</p>)}
          </div>)
      })}
      <p className="text-[11px] text-slate-400">catalogue {report.catalog_version} · content_hash {report.content_hash}</p>
    </div>)
}
