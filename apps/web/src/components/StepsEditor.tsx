import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import type { PreprocessStep, DatasetColumn } from '@contracts/src'
import { dataApi } from '@/api/data'
import { Button } from './ui'
import { SchemaForm } from './SchemaForm'

/** Éditeur d'étapes de prétraitement (type PreprocessStep). Partagé : onglet Prétraitement (E1) et propriétés du nœud data.preprocess (E4). */
export function StepsEditor({ value, onChange, columns, readOnly, allowed }: { value?: PreprocessStep[]; onChange: (v: PreprocessStep[]) => void; columns: DatasetColumn[]; readOnly?: boolean; /** Étapes adaptées au type de pipeline. */ allowed?: string[] }) {
  const steps = value ?? []
  const tq = useQuery({ queryKey: ['transforms'], queryFn: dataApi.transforms, staleTime: Infinity })
  const set = (i: number, s: PreprocessStep) => onChange(steps.map((x, k) => (k === i ? s : x)))
  const move = (i: number, d: number) => { const a = [...steps]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a) }
  return (
    <div className="space-y-2">
      {steps.length === 0 && <p className="text-xs text-slate-500">Aucune étape : les données sont utilisées telles quelles.</p>}
      {steps.map((s, i) => {
        const t = tq.data?.find((x) => x.type === s.type); const cols = columns.filter((c) => !t || t.applies_to.includes(c.dtype))
        return (
          <div key={i} className="rounded-md border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{i + 1}</span>
              <select className="input" aria-label={`Type de l'étape ${i + 1}`} disabled={readOnly} value={s.type} onChange={(e) => set(i, { ...s, type: e.target.value })}>{tq.data?.filter((x) => !allowed || allowed.includes(x.type) || x.type === s.type).map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}</select>
              {!readOnly && <><button aria-label="Monter" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button><button aria-label="Descendre" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button><button aria-label="Supprimer l'étape" onClick={() => onChange(steps.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5 text-red-500" /></button></>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {cols.map((c) => { const on = s.columns?.includes(c.name); return <button key={c.name} type="button" disabled={readOnly} onClick={() => set(i, { ...s, columns: on ? s.columns!.filter((x) => x !== c.name) : [...(s.columns ?? []), c.name] })} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{c.name}</button> })}
              {cols.length === 0 && <span className="text-xs text-slate-400">Aucune colonne compatible.</span>}
            </div>
            {t && Object.keys(t.params_schema.properties ?? {}).length > 0 && <div className="mt-2 rounded border border-slate-100 bg-slate-50/60 p-2"><SchemaForm schema={t.params_schema} value={s.params ?? {}} readOnly={readOnly} onChange={(p) => set(i, { ...s, params: p })} /></div>}
          </div>)
      })}
      {!readOnly && <Button variant="secondary" size="sm" onClick={() => onChange([...steps, { type: (tq.data?.find((x) => !allowed || allowed.includes(x.type)) ?? tq.data?.[0])?.type ?? 'impute_median', columns: [] }])}><Plus className="h-3.5 w-3.5" />Ajouter une étape</Button>}
    </div>)
}
