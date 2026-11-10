import type { Task } from '@contracts/src'
export const METRICS: Record<Task, string[]> = { classification: ['f1', 'accuracy', 'roc_auc', 'precision', 'recall'], regression: ['rmse', 'mae', 'r2'] }
export const MINIMIZE = new Set(['rmse', 'mae'])
