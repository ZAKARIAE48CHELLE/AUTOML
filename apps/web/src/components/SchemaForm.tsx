import type { ReactNode } from 'react'
import type { JsonSchema } from '@contracts/src'
import { validateSchema } from '@contracts/src'

export type Options = Record<string, { value: string; label: string }[]>
export type Widgets = Record<string, (p: { value: any; onChange: (v: any) => void; schema: JsonSchema; path: string }) => ReactNode>
interface Props { schema: JsonSchema; value: Record<string, any>; onChange: (v: Record<string, any>) => void; options?: Options; widgets?: Widgets; readOnly?: boolean; hide?: string[]; path?: string }

/** Propriétaire : E4. Rend un sous-ensemble de JSON Schema (string/enum/number/integer/boolean/object + x-source, x-widget). */
export function SchemaForm({ schema, value, onChange, options = {}, widgets = {}, readOnly, hide = [], path = '' }: Props) {
  const issues = validateSchema(value, schema, path)
  const set = (k: string, v: unknown) => { const n = { ...value }; if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) delete n[k]; else n[k] = v; onChange(n) }
  const entries = Object.entries(schema.properties ?? {}).filter(([k]) => !hide.includes(k))
  if (!entries.length) return <p className="text-xs text-slate-500">Aucun paramètre.</p>
  return (
    <div className="space-y-3">
      {entries.map(([k, s]) => {
        const p = path ? `${path}.${k}` : k; const required = schema.required?.includes(k); const v = value[k]
        const own = issues.filter((i) => i.path === p || (s.type !== 'object' && i.path.startsWith(p + '[')))
        const err = own[0]?.message ?? (required && (v === undefined || v === '') ? 'Champ requis.' : undefined)
        const src = s['x-source'] as string | undefined, wid = s['x-widget'] as string | undefined
        let input: ReactNode
        if (wid && widgets[wid]) input = widgets[wid]({ value: v, onChange: (x) => set(k, x), schema: s, path: p })
        else if (s.type === 'object' && s.properties) input = <div className="rounded-md border border-slate-200 p-3"><SchemaForm schema={s} value={v ?? {}} onChange={(x) => set(k, x)} options={options} widgets={widgets} readOnly={readOnly} path={p} /></div>
        else if (s.enum || src) {
          const opts = s.enum ? s.enum.map((e) => ({ value: String(e), label: String(e) })) : options[src!] ?? []
          input = <select className="input" disabled={readOnly} value={v ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">— choisir —</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        } else if (s.type === 'integer' || s.type === 'number') input = <input className="input" type="number" disabled={readOnly} min={s.minimum} max={s.maximum} step={s.type === 'integer' ? 1 : 'any'} value={v ?? ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} />
        else if (s.type === 'boolean') input = <input type="checkbox" disabled={readOnly} checked={!!v} onChange={(e) => set(k, e.target.checked)} />
        else input = <input className="input" disabled={readOnly} value={v ?? ''} onChange={(e) => set(k, e.target.value)} />
        return (
          <div key={k}>
            <label className="label" htmlFor={`f-${p}`}>{s.title ?? k}{required && <span className="text-red-500"> *</span>}{s.minimum !== undefined && s.maximum !== undefined && <span className="ml-1 font-normal text-slate-400">({s.minimum}–{s.maximum})</span>}</label>
            <div id={`f-${p}`}>{input}</div>
            {err && !readOnly && <p className="mt-1 text-xs text-red-600">{err}</p>}
          </div>)
      })}
    </div>)
}
