import type { DatasetColumn, DataProfile, DataProfileColumn } from '@contracts/src'
import { rng } from './util'
import { idColumns } from '@contracts/src'

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
  const ids = new Set(idColumns(schema))
  const columns: DataProfileColumn[] = schema.map((c) => {
    const vals = rows.map((x) => x[c.name]), present = vals.filter((v) => v !== null && v !== undefined && v !== '')
    const base: DataProfileColumn = { name: c.name, dtype: c.dtype, missing_pct: Math.round(((vals.length - present.length) / vals.length) * 1000) / 10, unique: ids.has(c.name) ? totalRows : c.dtype === 'text' || c.dtype === 'image_path' ? Math.round(new Set(present).size * scale) : new Set(present).size }
    if (c.dtype === 'int' || c.dtype === 'float') {
      const nums = present as number[]; const mean = nums.reduce((a, b) => a + b, 0) / nums.length
      const min = Math.min(...nums), max = Math.max(...nums)
      const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length)
      const bins = 8, w = (max - min) / bins || 1, hist = Array.from({ length: bins }, (_, i) => ({ bin: `${Math.round(min + i * w)}`, count: 0 }))
      nums.forEach((v) => { hist[Math.min(bins - 1, Math.floor((v - min) / w))].count += Math.round(scale) })
      Object.assign(base, { mean: Math.round(mean * 100) / 100, std: Math.round(std * 100) / 100, min, max, histogram: hist })
    } else if (!ids.has(c.name) && c.dtype !== 'text' && c.dtype !== 'image_path') {
      const m = new Map<string, number>(); present.forEach((v) => m.set(String(v), (m.get(String(v)) ?? 0) + 1))
      base.top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count: Math.round(count * scale) }))
    }
    return base
  })
  const alerts: DataProfile['alerts'] = []
  columns.forEach((c) => {
    if (ids.has(c.name)) alerts.push({ code: 'HIGH_CARDINALITY', severity: 'warning', column: c.name, message: 'Colonne identifiant (valeurs uniques) : à exclure des variables explicatives.' })
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

/* ---------- Jeux de démonstration : un par type de pipeline ---------- */
export interface DemoDataset { id: string; name: string; task: import('@contracts/src').Task; schema: DatasetColumn[]; rows: Row[]; total: number }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]
const isoDay = (d: number) => new Date(Date.UTC(2024, 0, 1) + d * 86400000).toISOString().slice(0, 10)

export function demoDatasets(): DemoDataset[] {
  const r = rng(23)
  // Clustering : segmentation clients (4 segments latents)
  const seg = Array.from({ length: 360 }, (_, i) => { const s = i % 4; const inc = [28, 55, 85, 120][s] + (r() - 0.5) * 18
    return { customer_id: `S-${1000 + i}`, annual_income_k: Math.round(inc * 10) / 10, spending_score: Math.max(1, Math.min(100, Math.round([75, 40, 20, 82][s] + (r() - 0.5) * 22))), age: 20 + Math.floor(r() * 50), visits_per_month: Math.round([9, 4, 2, 6][s] + r() * 3), region: pick(r, ['nord', 'sud', 'est', 'ouest']) } })
  // Anomalies : transactions par carte (≈ 3 % de fraudes)
  const tx = Array.from({ length: 400 }, (_, i) => { const fraud = r() < 0.03
    return { tx_id: `T-${50000 + i}`, amount: Math.round((fraud ? 600 + r() * 2400 : 8 + Math.pow(r(), 2) * 220) * 100) / 100, hour: fraud ? pick(r, [1, 2, 3, 4, 23]) : 7 + Math.floor(r() * 15), merchant_category: pick(r, ['épicerie', 'carburant', 'en ligne', 'restaurant', 'voyage']), distance_km: Math.round((fraud ? 300 + r() * 4000 : r() * 25) * 10) / 10, is_fraud: fraud ? 'true' : 'false' } })
  // Prévision : ventes quotidiennes (tendance + saisonnalité hebdomadaire)
  const sales = Array.from({ length: 365 }, (_, d) => { const wd = (d + 1) % 7
    return { date: isoDay(d), sales: Math.round((420 + d * 0.6 + (wd === 5 || wd === 6 ? 140 : 0) + Math.sin((d / 365) * Math.PI * 2) * 60 + (r() - 0.5) * 70) * 10) / 10, promo: r() < 0.12 ? 'true' : 'false', temperature: Math.round((12 + Math.sin(((d - 100) / 365) * Math.PI * 2) * 10 + (r() - 0.5) * 4) * 10) / 10 } })
  // NLP : avis produits
  const pos = ['Excellent produit, je recommande vivement', 'Livraison rapide et qualité au rendez-vous', 'Très satisfait, conforme à la description', 'Super rapport qualité prix, parfait']
  const neg = ['Produit arrivé cassé, très déçu', 'Qualité médiocre, ne fonctionne plus après une semaine', 'Service client injoignable, à éviter', 'Ne correspond pas du tout à la description']
  const neu = ['Produit correct sans plus', 'Fait le travail, emballage moyen', 'Conforme mais livraison un peu lente', 'Ni bon ni mauvais, prix dans la moyenne']
  const reviews = Array.from({ length: 300 }, (_, i) => { const s = pick(r, ['positive', 'positive', 'negative', 'neutral'])
    const base = s === 'positive' ? pick(r, pos) : s === 'negative' ? pick(r, neg) : pick(r, neu)
    return { review_id: `R-${7000 + i}`, review_text: `${base}. ${pick(r, ['Acheté pour la maison.', 'Utilisé tous les jours.', 'Cadeau pour un proche.', 'Deuxième commande.'])}`, product: pick(r, ['casque', 'cafetière', 'lampe', 'clavier']), sentiment: s } })
  // Vision : inspection de pièces
  const imgs = Array.from({ length: 240 }, (_, i) => { const lab = pick(r, ['ok', 'ok', 'ok', 'rayure', 'bosse', 'fissure'])
    return { image_path: `images/ligne-a/${lab}/piece_${String(i).padStart(4, '0')}.jpg`, label: lab, camera: pick(r, ['cam-1', 'cam-2']) } })
  // Recommandation : notes utilisateur × film
  const ratings = Array.from({ length: 420 }, (_, i) => { const u = Math.floor(Math.pow(r(), 1.5) * 60), it = Math.floor(Math.pow(r(), 2) * 80)
    return { user_id: `U-${u}`, item_id: `F-${it}`, rating: Math.max(1, Math.min(5, Math.round(3.4 + ((u + it) % 5 - 2) * 0.5 + (r() - 0.5) * 1.6))), timestamp: isoDay(Math.floor(r() * 300)) } })
  return [
    { id: 'segmentation', name: 'clients_segmentation.csv', task: 'clustering', total: 12000, rows: seg, schema: [{ name: 'customer_id', dtype: 'string', nullable: false }, { name: 'annual_income_k', dtype: 'float', nullable: false }, { name: 'spending_score', dtype: 'int', nullable: false }, { name: 'age', dtype: 'int', nullable: false }, { name: 'visits_per_month', dtype: 'int', nullable: false }, { name: 'region', dtype: 'category', nullable: false }] },
    { id: 'transactions', name: 'transactions_cartes.csv', task: 'anomaly_detection', total: 98000, rows: tx, schema: [{ name: 'tx_id', dtype: 'string', nullable: false }, { name: 'amount', dtype: 'float', nullable: false }, { name: 'hour', dtype: 'int', nullable: false }, { name: 'merchant_category', dtype: 'category', nullable: false }, { name: 'distance_km', dtype: 'float', nullable: false }, { name: 'is_fraud', dtype: 'bool', nullable: false }] },
    { id: 'sales', name: 'ventes_quotidiennes.csv', task: 'forecasting', total: 365, rows: sales, schema: [{ name: 'date', dtype: 'datetime', nullable: false }, { name: 'sales', dtype: 'float', nullable: false }, { name: 'promo', dtype: 'bool', nullable: false }, { name: 'temperature', dtype: 'float', nullable: false }] },
    { id: 'reviews', name: 'avis_produits.csv', task: 'text_classification', total: 25000, rows: reviews, schema: [{ name: 'review_id', dtype: 'string', nullable: false }, { name: 'review_text', dtype: 'text', nullable: false }, { name: 'product', dtype: 'category', nullable: false }, { name: 'sentiment', dtype: 'category', nullable: false }] },
    { id: 'images', name: 'inspection_pieces.csv', task: 'image_classification', total: 4800, rows: imgs, schema: [{ name: 'image_path', dtype: 'image_path', nullable: false }, { name: 'label', dtype: 'category', nullable: false }, { name: 'camera', dtype: 'category', nullable: false }] },
    { id: 'ratings', name: 'notes_films.csv', task: 'recommendation', total: 100000, rows: ratings, schema: [{ name: 'user_id', dtype: 'string', nullable: false }, { name: 'item_id', dtype: 'string', nullable: false }, { name: 'rating', dtype: 'int', nullable: false }, { name: 'timestamp', dtype: 'datetime', nullable: false }] },
  ]
}
