import catalogJson from '../catalog.json'
import policyJson from '../policy.json'
import validationJson from '../validation.json'
import endpointsJson from '../endpoints.json'
import modelsJson from '../models.json'
import type { NodeType, OpClass, PipelineTypeDef, MetricDef, PreprocessTransform, ModelSpec, Task } from './types'

export const CATALOG_VERSION: string = catalogJson.catalog_version
export const NODE_TYPES = catalogJson.node_types as unknown as NodeType[]
export const NODE_TYPE_BY_ID: Record<string, NodeType> = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]))
/** Compatibilité : même version majeure de catalogue (les ajouts mineurs restent rétrocompatibles). */
export const isCompatibleCatalog = (v: string) => v.split('.')[0] === CATALOG_VERSION.split('.')[0]

/* ---------- Types de pipeline, métriques, étapes, modèles ---------- */
export const PIPELINE_TYPES = catalogJson.pipeline_types as unknown as PipelineTypeDef[]
export const PIPELINE_TYPE_BY_ID = Object.fromEntries(PIPELINE_TYPES.map((p) => [p.id, p])) as Record<Task, PipelineTypeDef>
export const METRIC_DEFS = catalogJson.metrics as unknown as MetricDef[]
export const METRIC_BY_ID: Record<string, MetricDef> = Object.fromEntries(METRIC_DEFS.map((m) => [m.id, m]))
export const MINIMIZE_METRICS = new Set(METRIC_DEFS.filter((m) => m.direction === 'minimize').map((m) => m.id))
export const metricDirection = (id: string): 'maximize' | 'minimize' => (MINIMIZE_METRICS.has(id) ? 'minimize' : 'maximize')
export const PREPROCESS_STEPS = catalogJson.preprocess_steps as unknown as PreprocessTransform[]
export const PREPROCESS_STEP_BY_TYPE: Record<string, PreprocessTransform> = Object.fromEntries(PREPROCESS_STEPS.map((s) => [s.type, s]))
/** Catalogue de modèles partagé (propriété E2) : mêmes identifiants côté serveur et mock. */
export const MODEL_CATALOG = modelsJson.models as unknown as ModelSpec[]
export const METRICS_BY_TASK = Object.fromEntries(PIPELINE_TYPES.map((p) => [p.id, p.metrics])) as Record<Task, string[]>
export const pipelineType = (task: Task | string | undefined): PipelineTypeDef => PIPELINE_TYPE_BY_ID[(task ?? 'classification') as Task] ?? PIPELINE_TYPE_BY_ID.classification
export const POLICY = policyJson as { classes: { id: OpClass; label: string; examples: string }[]; modes: string[]; matrix: { cls: OpClass; auto: string; guided: string; expert: string }[] }
export const VALIDATION = validationJson as { rules: { id: string; text: string }[]; layers: { layer: string; owner: string; text: string }[] }
export type EndpointDef = { index: number; owner: 'E1' | 'E2' | 'E3' | 'E4'; method: string; path: string; purpose: string; inp: string; out: string; access: 'public' | 'internal'; consumers: string[] }
export const ENDPOINTS = endpointsJson as EndpointDef[]
// Limites MVP (V10)
export const MAX_NODES = 40
