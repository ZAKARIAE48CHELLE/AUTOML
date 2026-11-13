import { METRICS_BY_TASK, MINIMIZE_METRICS, METRIC_BY_ID } from '@contracts/src'
/** Métriques par type de pipeline : source unique, le catalogue partagé. */
export const METRICS = METRICS_BY_TASK
export const MINIMIZE = MINIMIZE_METRICS
export const metricLabel = (id: string) => METRIC_BY_ID[id]?.label ?? id
