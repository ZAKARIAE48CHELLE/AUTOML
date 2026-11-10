// Contrat E2 — Model Training. Les routes « internal » (jobs, études, final-evaluation, registre POST, alias PUT) ne sont jamais appelées par le frontend : seul E4 les appelle avec un jeton de service.
import type * as C from '@contracts/src'
import { get, post } from './client'

export type CatalogModel = C.ModelSpec & { disabled?: boolean }
export interface ModelDetail extends C.ModelVersion { run: C.ExperimentRun }
export interface Study { id: string; job_id: string; status: C.JobStatus; run_id?: string; trials: { n: number; value: number }[]; best_trial?: { n: number; value: number }; job: C.TrainingJob }

export const trainingApi = {
  models: (task?: C.Task) => get<CatalogModel[]>('/models/catalog', { task, modality: 'tabular' }),
  resources: () => get<C.TrainingResources>('/training/resources'),
  validate: (cfg: { split_id: string; preprocess_spec_id: string; model_id: string; params: Record<string, unknown>; primary_metric: string; budget?: { trials: number; max_minutes: number } }) => post<C.ValidationReport>('/training/validate', cfg),
  job: (id: string) => get<C.TrainingJob>(`/training/jobs/${id}`),
  jobs: (project_id: string) => get<C.TrainingJob[]>('/training/jobs', { project_id }),
  study: (id: string) => get<Study>(`/tuning/studies/${id}`),
  runs: (project_id: string, filters: { model_id?: string; execution_id?: string } = {}) => get<C.ExperimentRun[]>('/experiments', { project_id, ...filters }),
  run: (id: string) => get<C.ExperimentRun>(`/experiments/${id}`),
  compare: (run_ids: string[]) => post<C.Leaderboard>('/experiments/compare', { run_ids }),
  registry: (project_id: string) => get<C.ModelVersion[]>('/models/registry', { project_id }),
  modelVersion: (id: string) => get<ModelDetail>(`/models/registry/${id}`),
  predict: (model_version_id: string, input: { records?: Record<string, unknown>[]; dataset_version_id?: string }) => post<C.PredictResult>('/inference/predict', { model_version_id, ...input }),
}
