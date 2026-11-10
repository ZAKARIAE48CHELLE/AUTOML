import type { DatasetColumn, DataProfile, DataProfileColumn } from '@contracts/src'
import { rng } from './util'

export type Row = Record<string, string | number | null>
export const TELECOM_SCHEMA: DatasetColumn[] = [
  { name: 'customer_id', dtype: 'string', nullable: false },
  { name: 'age', dtype: 'int', nullable: true },
  { name: 'tenure_months', dtype: 'int', nullable: false },
  { name: 'plan', dtype: 'category', nullable: false },
  { name: 'monthly_charge', dtype: 'float', nullable: false },
  { name: 'data_gb', dtype: 'float', nullable: true },
  { name: 'support_calls', dtype: 'int', nullable: false },
  { name: 'contract', dtype: 'category', nullable: false },
  { name: 'payment_method', dtype: 'category', nullable: false },
  { name: 'churn', dtype: 'category', nullable: false },
]
export const HOUSING_SCHEMA: DatasetColumn[] = [
  { name: 'surface_m2', dtype: 'float', nullable: false },
  { name: 'rooms', dtype: 'int', nullable: false },
  { name: 'building_age', dtype: 'int', nullable: true },
  { name: 'district', dtype: 'category', nullable: false },
  { name: 'price', dtype: 'float', nullable: false },
]

export function telecomRows(n = 400): Row[] {
  const r = rng(7)
  const plans = ['basic', 'standard', 'premium'], contracts = ['month-to-month', 'one-year', 'two-year'], pays = ['card', 'transfer', 'cash', 'mobile']
  const rows: Row[] = []
  for (let i = 0; i < n; i++) {
    const plan = plans[Math.floor(r() * 3)], contract = contracts[Math.floor(Math.pow(r(), 1.4) * 3)]
    const tenure = Math.floor(r() * 73), calls = Math.floor(Math.pow(r(), 2.2) * 9)
    const charge = Math.round((plan === 'basic' ? 29 : plan === 'standard' ? 49 : 79) + (r() - 0.5) * 14 + (plan === 'premium' ? 5 : 0))
    const risk = 0.1 + (contract === 'month-to-month' ? 0.28 : 0) - Math.min(tenure, 48) * 0.003 + calls * 0.035 + (charge > 70 ? 0.06 : 0)
    rows.push({
      customer_id: `C-${(100000 + i * 7).toString()}`,
      age: r() < 0.04 ? null : 18 + Math.floor(r() * 62),
      tenure_months: tenure, plan, monthly_charge: charge,
      data_gb: r() < 0.06 ? null : Math.round(r() * 400) / 10,
      support_calls: calls, contract, payment_method: pays[Math.floor(r() * 4)],
      churn: r() < risk ? 'yes' : 'no',
    })
  }
  return rows
}
export function housingRows(n = 300): Row[] {
  const r = rng(11)
  const d = ['centre', 'nord', 'sud', 'est', 'ouest']
  return Array.from({ length: n }, () => {
    const s = 25 + r() * 160, rooms = Math.max(1, Math.round(s / 32 + (r() - 0.5) * 2)), dist = d[Math.floor(r() * 5)]
    return { surface_m2: Math.round(s * 10) / 10, rooms, building_age: r() < 0.05 ? null : Math.floor(r() * 80), district: dist,
      price: Math.round((s * (dist === 'centre' ? 4200 : 2800) + (r() - 0.5) * 30000) / 100) * 100 }
  })
}

export function buildProfile(versionId: string, schema: DatasetColumn[], rows: Row[], totalRows: number): DataProfile {
  const scale = totalRows / rows.length
  const columns: DataProfileColumn[] = schema.map((c) => {
    const vals = rows.map((x) => x[c.name]), present = vals.filter((v) => v !== null && v !== undefined && v !== '')
    const base: DataProfileColumn = { name: c.name, dtype: c.dtype, missing_pct: Math.round(((vals.length - present.length) / vals.length) * 1000) / 10, unique: c.name === 'customer_id' ? totalRows : new Set(present).size }
    if (c.dtype === 'int' || c.dtype === 'float') {
      const nums = present as number[]; const mean = nums.reduce((a, b) => a + b, 0) / nums.length
      const min = Math.min(...nums), max = Math.max(...nums)
      const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length)
      const bins = 8, w = (max - min) / bins || 1, hist = Array.from({ length: bins }, (_, i) => ({ bin: `${Math.round(min + i * w)}`, count: 0 }))
      nums.forEach((v) => { hist[Math.min(bins - 1, Math.floor((v - min) / w))].count += Math.round(scale) })
      Object.assign(base, { mean: Math.round(mean * 100) / 100, std: Math.round(std * 100) / 100, min, max, histogram: hist })
    } else if (c.name !== 'customer_id') {
      const m = new Map<string, number>(); present.forEach((v) => m.set(String(v), (m.get(String(v)) ?? 0) + 1))
      base.top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count: Math.round(count * scale) }))
    }
    return base
  })
  const alerts: DataProfile['alerts'] = []
  columns.forEach((c) => {
    if (c.name === 'customer_id') alerts.push({ code: 'HIGH_CARDINALITY', severity: 'warning', column: c.name, message: 'Colonne identifiant (valeurs uniques) : à exclure des variables explicatives.' })
    if (c.missing_pct > 0) alerts.push({ code: 'MISSING', severity: c.missing_pct > 10 ? 'warning' : 'info', column: c.name, message: `${c.missing_pct} % de valeurs manquantes.` })
  })
  const churn = columns.find((c) => c.name === 'churn')
  if (churn?.top) {
    const yes = churn.top.find((t) => t.value === 'yes')?.count ?? 0
    const pct = Math.round((yes / totalRows) * 100)
    if (pct < 35) alerts.push({ code: 'CLASS_IMBALANCE', severity: 'warning', column: 'churn', message: `Classe minoritaire à ${pct} % : privilégier f1 / roc_auc plutôt que accuracy.` })
  }
  return { dataset_version_id: versionId, columns, alerts, computed_by: 'profiler-1.0 (simulé)', rows: totalRows }
}
