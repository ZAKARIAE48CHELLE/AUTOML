// Contrat E1 — Data Intelligence + socle (auth, projets). Le backend E1 implémente exactement ces appels.
import type * as C from '@contracts/src'
import { api, get, post } from './client'

export interface DatasetRow { id: string; project_id: string; name: string; latest_version_id?: string; rows?: number; columns?: number; status?: C.DatasetVersion['status']; created_at?: string }
export interface Preview { dataset_version_id: string; columns: C.DatasetColumn[]; rows: Record<string, string | number | null>[]; total: number; limit: number; offset: number }
export type ProfileResult = C.DataProfile | (C.Job & { kind?: string })
export const isProfile = (p: ProfileResult): p is C.DataProfile => 'columns' in p

export const dataApi = {
  login: (email: string, password: string) => post<{ access_token: string; refresh_token: string; user: { id: string; name: string; email: string } }>('/auth/login', { email, password }),
  projects: () => get<C.Project[]>('/projects'),
  createProject: (name: string) => post<C.Project & { project_id: string }>('/projects', { name }),
  datasets: (project_id: string) => get<DatasetRow[]>('/datasets', { project_id }),
  dataset: (id: string) => get<{ id: string; name: string; project_id: string; versions: C.DatasetVersion[] }>(`/datasets/${id}`),
  importDataset: (project_id: string, file: File) => { const f = new FormData(); f.append('file', file); f.append('project_id', project_id); return api<{ dataset_id: string; version_id: string; job_id: string }>('POST', '/datasets', { form: f }) },
  preview: (id: string, dataset_version_id?: string, limit = 25, offset = 0) => get<Preview>(`/datasets/${id}/preview`, { dataset_version_id, limit, offset }),
  startProfile: (id: string, dataset_version_id: string) => post<{ job_id: string }>(`/datasets/${id}/profile`, { dataset_version_id }),
  profile: (id: string, dataset_version_id: string) => get<ProfileResult>(`/datasets/${id}/profile`, { dataset_version_id }),
  transforms: () => get<C.PreprocessTransform[]>('/preprocessing/catalog'),
  recommend: (dataset_version_id: string, target: string, task: C.Task) => post<{ spec: { dataset_version_id: string; steps: C.PreprocessStep[] }; rule_ids: string[]; evidence_refs: C.EvidenceRef[] }>('/preprocessing/recommendations', { dataset_version_id, target, task }),
  validatePreprocess: (dataset_version_id: string, steps: C.PreprocessStep[], target?: string, split_id?: string) => post<C.ValidationReport>('/preprocessing/validate', { dataset_version_id, spec: { steps }, target, split_id }),
  saveSpec: (dataset_version_id: string, steps: C.PreprocessStep[]) => post<{ spec_id: string; version: number; content_hash: string }>('/preprocessing/specs', { dataset_version_id, spec: { steps } }),
  specs: (dataset_version_id: string) => get<C.PreprocessSpec[]>('/preprocessing/specs', { dataset_version_id }),
  specPreview: (spec_id: string, split_id: string) => post<{ columns_before: number; columns_after: number; missing_before: { column: string; pct: number }[]; missing_after: { column: string; pct: number }[]; sample: string }>(`/preprocessing/specs/${spec_id}/preview`, { split_id }),
  createSplit: (dataset_version_id: string, split_spec: C.SplitSpec) => post<{ split_id: string; checksum: string }>('/splits', { dataset_version_id, split_spec }),
  splits: (dataset_version_id: string) => get<C.SplitVersion[]>('/splits', { dataset_version_id }),
  split: (id: string) => get<C.SplitVersion>(`/splits/${id}`),
}
