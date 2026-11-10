import type { ModelSpec, Task } from '@contracts/src'
import { cyrb53 } from '@contracts/src'
import { rng } from './util'

const BASE: Record<string, number> = { random_forest: 0.64, gradient_boosting: 0.67, logistic_regression: 0.58, knn: 0.53, mlp: 0.62, linear_regression: 0.7, ridge: 0.72 }
export const MINIMIZE = new Set(['rmse', 'mae'])

export function makeMetrics(modelId: string, params: Record<string, unknown>, seed: number, task: Task, preprocessSteps: number) {
  const r = rng(parseInt(cyrb53(modelId + JSON.stringify(params) + seed).slice(0, 8), 16))
  const n = Number(params.n_estimators ?? params.max_iter ?? 100)
  const bonus = Math.min(0.03, Math.log10(Math.max(n, 10)) * 0.012) + Math.min(preprocessSteps, 4) * 0.008
  const q = Math.min(0.93, (BASE[modelId] ?? 0.6) + bonus + (r() - 0.5) * 0.03)
  const rd = (x: number) => Math.round(x * 1000) / 1000
  if (task === 'classification') {
    const f1 = rd(q), acc = rd(Math.min(0.97, q + 0.12 + r() * 0.02)), auc = rd(Math.min(0.98, q + 0.18 + r() * 0.02))
    const m = { f1, accuracy: acc, roc_auc: auc, precision: rd(q + 0.02 + r() * 0.03), recall: rd(q - 0.02 - r() * 0.03) }
    const std = Object.fromEntries(Object.keys(m).map((k) => [k, rd(0.006 + r() * 0.012)]))
    return { metrics: m, std }
  }
  const rmse = rd((1 - q) * 52000 + r() * 800)
  const m = { rmse, mae: rd(rmse * 0.74), r2: rd(Math.min(0.95, q + 0.1)) }
  return { metrics: m, std: { rmse: rd(rmse * 0.03), mae: rd(rmse * 0.02), r2: 0.01 } }
}
export const testFrom = (m: Record<string, number>, seed: number) => {
  const r = rng(seed + 99)
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v + (MINIMIZE.has(k) ? 1 : -1) * (0.005 + r() * 0.02) * (k === 'rmse' || k === 'mae' ? v : 1)) * 1000) / 1000]))
}
export function makeCurve(modelId: string, seed: number) {
  const r = rng(seed + 5), top = BASE[modelId] ?? 0.6
  return Array.from({ length: 20 }, (_, i) => ({ epoch: i + 1, train: Math.round((top + 0.2 * (1 - Math.exp(-i / 5)) - 0.12 + r() * 0.01) * 1000) / 1000, validation: Math.round((top - 0.15 + 0.15 * (1 - Math.exp(-i / 6)) + r() * 0.012) * 1000) / 1000 }))
}

const intP = (title: string, def: number, min: number, max: number) => ({ type: 'integer', title, default: def, minimum: min, maximum: max })
const numP = (title: string, def: number, min: number, max: number) => ({ type: 'number', title, default: def, minimum: min, maximum: max })
export const MODELS: ModelSpec[] = [
  { id: 'logistic_regression', version: '1.0', family: 'Linéaire', label: 'Régression logistique', task: ['classification'], modality: 'tabular', determinism: 'exact', dependencies: ['scikit-learn==1.5.2'],
    params_schema: { type: 'object', properties: { C: numP('Régularisation C', 1, 0.001, 100), max_iter: intP('Itérations max', 200, 50, 2000) } } },
  { id: 'random_forest', version: '1.0', family: 'Arbres', label: 'Forêt aléatoire', task: ['classification', 'regression'], modality: 'tabular', determinism: 'exact', dependencies: ['scikit-learn==1.5.2'],
    params_schema: { type: 'object', properties: { n_estimators: intP('Nombre d\'arbres', 200, 10, 1000), max_depth: intP('Profondeur max', 12, 2, 50), min_samples_leaf: intP('Échantillons min / feuille', 2, 1, 50) } } },
  { id: 'gradient_boosting', version: '1.0', family: 'Boosting', label: 'Gradient boosting', task: ['classification', 'regression'], modality: 'tabular', determinism: 'tolerance', dependencies: ['scikit-learn==1.5.2'],
    params_schema: { type: 'object', properties: { n_estimators: intP('Itérations', 300, 20, 2000), learning_rate: numP('Taux d\'apprentissage', 0.1, 0.005, 1), max_depth: intP('Profondeur max', 4, 1, 16) } } },
  { id: 'knn', version: '1.0', family: 'Voisinage', label: 'k plus proches voisins', task: ['classification', 'regression'], modality: 'tabular', determinism: 'exact', dependencies: ['scikit-learn==1.5.2'],
    params_schema: { type: 'object', properties: { n_neighbors: intP('k', 15, 1, 100) } } },
  { id: 'linear_regression', version: '1.0', family: 'Linéaire', label: 'Régression linéaire', task: ['regression'], modality: 'tabular', determinism: 'exact', dependencies: ['scikit-learn==1.5.2'], params_schema: { type: 'object', properties: {} } },
  { id: 'ridge', version: '1.0', family: 'Linéaire', label: 'Ridge', task: ['regression'], modality: 'tabular', determinism: 'exact', dependencies: ['scikit-learn==1.5.2'],
    params_schema: { type: 'object', properties: { alpha: numP('alpha', 1, 0.0001, 1000) } } },
  { id: 'mlp', version: '0.1', family: 'Deep learning', label: 'Perceptron multicouche (G-DL)', task: ['classification', 'regression'], modality: 'tabular', determinism: 'tolerance', deep_learning: true, dependencies: ['torch==2.4.1'],
    params_schema: { type: 'object', properties: { hidden_units: intP('Neurones cachés', 64, 8, 512), epochs: intP('Époques', 30, 1, 200) } } },
]
export const METRICS_BY_TASK: Record<Task, string[]> = { classification: ['f1', 'accuracy', 'roc_auc', 'precision', 'recall'], regression: ['rmse', 'mae', 'r2'] }
