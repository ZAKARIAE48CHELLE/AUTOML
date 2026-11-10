// Contrat E4 — Visual Workflow Studio & MLOps. Seule voie d'exécution du produit : POST /executions.
import type * as C from '@contracts/src'
import { get, post } from './client'

export interface WorkflowRow extends C.Workflow { latest: C.WorkflowVersionMeta; versions_count: number }
export interface Template { id: string; label: string; description: string; params: string[] }

export const studioApi = {
  nodeTypes: () => get<{ catalog_version: string; node_types: C.NodeType[] }>('/catalog/node-types'),
  templates: () => get<Template[]>('/catalog/templates'),
  workflows: (project_id: string) => get<WorkflowRow[]>('/workflows', { project_id }),
  createWorkflow: (project_id: string, name: string, spec: C.WorkflowSpec) => post<{ workflow_id: string; version_id: string; content_hash: string }>('/workflows', { project_id, name, spec, origin: 'human' }),
  fromTemplate: (p: Record<string, unknown>) => post<{ workflow_id: string; version_id: string; content_hash: string }>('/workflows/from-template', p),
  workflow: (id: string) => get<{ workflow: C.Workflow; versions: C.WorkflowVersionMeta[] }>(`/workflows/${id}`),
  version: (wf: string, v: string) => get<C.WorkflowVersion>(`/workflows/${wf}/versions/${v}`),
  newVersion: (wf: string, parent_version_id: string, spec: C.WorkflowSpec, label?: string) => post<{ version_id: string; content_hash: string; unchanged?: boolean }>(`/workflows/${wf}/versions`, { parent_version_id, spec, label }),
  diff: (wf: string, v: string, against: string) => get<C.WorkflowDiff>(`/workflows/${wf}/versions/${v}/diff`, { against }),
  validate: (wf: string, v: string) => post<C.ValidationReport>(`/workflows/${wf}/versions/${v}/validate`),
  report: (wf: string, v: string) => get<C.ValidationReport>(`/workflows/${wf}/versions/${v}/validation`),
  approvals: (workflow_version_id: string) => get<C.Approval[]>('/approvals', { workflow_version_id }),
  approve: (p: { workflow_version_id: string; operation_classes: C.OpClass[]; node_ids?: string[]; budget?: C.BudgetSpec; method: 'explicit_click' | 'chat_confirm'; scope?: 'version' | 'lineage' }) => post<{ approval_id: string; approval: C.Approval }>('/approvals', p),
  revoke: (id: string) => post<C.Approval>(`/approvals/${id}/revoke`),
  execute: (workflow_version_id: string, approval_ids: string[], reuse_from_execution_id?: string) => post<{ execution_id: string }>('/executions', { workflow_version_id, approval_ids, reuse_from_execution_id }),
  executions: (q: { workflow_id?: string; project_id?: string }) => get<C.Execution[]>('/executions', q),
  execution: (id: string) => get<C.Execution>(`/executions/${id}`),
  cancel: (id: string) => post<C.Execution>(`/executions/${id}/cancel`),
  createExport: (execution_id: string, include_data = false, approval_id?: string) => post<{ export_id: string }>('/exports', { execution_id, include_data, approval_id }),
  exportManifest: (id: string) => get<C.ExportManifest>(`/exports/${id}`),
  promote: (model_version_id: string, alias: 'staging' | 'production', approval_id: string) => post<C.PromotionRecord>('/registry/promotions', { model_version_id, alias, approval_id }),
  promotions: (model_name?: string) => get<C.PromotionRecord[]>('/registry/promotions', { model_name }),
}
