import type { ModelSpec, Task } from '@contracts/src'
import { cyrb53, MODEL_CATALOG, METRICS_BY_TASK, MINIMIZE_METRICS } from '@contracts/src'
import { rng } from './util'

const BASE: Record<string, number> = {
  random_forest: 0.64, gradient_boosting: 0.67, logistic_regression: 0.58, knn: 0.53, mlp: 0.62, linear_regression: 0.7, ridge: 0.72,
  kmeans: 0.62, gaussian_mixture: 0.64, dbscan: 0.55, agglomerative: 0.6, isolation_forest: 0.66, local_outlier_factor: 0.6, one_class_svm: 0.56,
  seasonal_naive: 0.55, exponential_smoothing: 0.63, arima: 0.62, gbm_lag_regressor: 0.7, linear_svm: 0.7, naive_bayes: 0.63, transformer_finetune: 0.8,
  hog_svm: 0.62, resnet_transfer: 0.85, efficientnet_transfer: 0.86, popularity: 0.45, item_knn: 0.6, als: 0.66, svd_mf: 0.62,
}
export const MINIMIZE = MINIMIZE_METRICS
/** Échelle d'erreur absolue selon le type (prix immobiliers vs ventes quotidiennes). */
const ERR_SCALE: Partial<Record<Task, number>> = { regression: 52000, forecasting: 210 }

/** Métriques simulées mais cohérentes : un score de qualité q dérivé du modèle, de ses paramètres et du prétraitement. */
export function makeMetrics(modelId: string, params: Record<string, unknown>, seed: number, task: Task, preprocessSteps: number) {
  const r = rng(parseInt(cyrb53(modelId + JSON.stringify(params) + seed).slice(0, 8), 16))
  const n = Number(params.n_estimators ?? params.max_iter ?? params.iterations ?? 100)
  const bonus = Math.min(0.03, Math.log10(Math.max(n, 10)) * 0.012) + Math.min(preprocessSteps, 4) * 0.008
  const q = Math.min(0.93, (BASE[modelId] ?? 0.6) + bonus + (r() - 0.5) * 0.03)
  const rd = (x: number) => Math.round(x * 1000) / 1000
  const err = (1 - q) * (ERR_SCALE[task] ?? 1000) + r() * (ERR_SCALE[task] ?? 1000) * 0.015
  const gen: Record<string, () => number> = {
    f1: () => q, accuracy: () => Math.min(0.97, q + 0.12 + r() * 0.02), roc_auc: () => Math.min(0.98, q + 0.18 + r() * 0.02),
    precision: () => q + 0.02 + r() * 0.03, recall: () => q - 0.02 - r() * 0.03,
    rmse: () => err, mae: () => err * 0.74, r2: () => Math.min(0.95, q + 0.1),
    mape: () => (1 - q) * 38 + r() * 2, smape: () => (1 - q) * 35 + r() * 2,
    silhouette: () => 0.12 + q * 0.48, davies_bouldin: () => 0.45 + (1 - q) * 1.7, calinski_harabasz: () => 140 + q * 900,
    average_precision: () => q * 0.82, precision_at_k: () => (task === 'recommendation' ? 0.05 + q * 0.3 : q * 0.78),
    recall_at_k: () => 0.06 + q * 0.32, ndcg_at_k: () => 0.1 + q * 0.38, map_at_k: () => 0.04 + q * 0.26,
  }
  const ids = METRICS_BY_TASK[task] ?? METRICS_BY_TASK.classification
  const metrics = Object.fromEntries(ids.map((k) => [k, rd(gen[k]?.() ?? q)]))
  const std = Object.fromEntries(ids.map((k) => [k, rd(MINIMIZE.has(k) || k === 'calinski_harabasz' ? metrics[k] * (0.02 + r() * 0.02) : 0.006 + r() * 0.012)]))
  return { metrics, std }
}
export const testFrom = (m: Record<string, number>, seed: number) => {
  const r = rng(seed + 99)
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v + (MINIMIZE.has(k) ? 1 : -1) * (0.005 + r() * 0.02) * (MINIMIZE.has(k) || k === 'calinski_harabasz' ? v : 1)) * 1000) / 1000]))
}
export function makeCurve(modelId: string, seed: number) {
  const r = rng(seed + 5), top = BASE[modelId] ?? 0.6
  return Array.from({ length: 20 }, (_, i) => ({ epoch: i + 1, train: Math.round((top + 0.2 * (1 - Math.exp(-i / 5)) - 0.12 + r() * 0.01) * 1000) / 1000, validation: Math.round((top - 0.15 + 0.15 * (1 - Math.exp(-i / 6)) + r() * 0.012) * 1000) / 1000 }))
}

/** Catalogue partagé (contracts/models.json) : mêmes identifiants que le service E2. */
export const MODELS: ModelSpec[] = MODEL_CATALOG
export { METRICS_BY_TASK }
