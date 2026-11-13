// Contrats partagés — source : documents v2 E1–E4 (objets de la section « Objets du domaine »).
export type Mode = 'auto' | 'guided' | 'expert'
export type OpClass = 'L0' | 'L1' | 'L2' | 'L3'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type NodeStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'
export type ExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type Readiness = 'draft' | 'validated' | 'approved'
export type ApprovalStatus = 'active' | 'revoked' | 'expired'
export type PortType = 'Dataset' | 'Split' | 'PreprocessSpecRef' | 'ModelRun' | 'Leaderboard' | 'ModelVersion'
/** Types de pipeline pris en charge (catalogue `pipeline_types`). */
export type Task = 'classification' | 'regression' | 'clustering' | 'anomaly_detection' | 'forecasting' | 'text_classification' | 'image_classification' | 'recommendation'
export type Modality = 'tabular' | 'timeseries' | 'text' | 'image' | 'interactions'
export type ColumnDtype = 'int' | 'float' | 'category' | 'string' | 'bool' | 'datetime' | 'text' | 'image_path'
/** Rôle d'une colonne dans un pipeline (paramètres du nœud data.split). */
export type ColumnRole = 'target' | 'time_column' | 'group_column' | 'text_column' | 'image_column' | 'user_column' | 'item_column'

export interface ApiError { code: string; message: string; details?: unknown; request_id: string }

export interface Project { id: string; name: string; role: 'owner' | 'editor' | 'viewer'; created_at: string }
export interface DatasetColumn { name: string; dtype: ColumnDtype; nullable: boolean }
export interface DatasetVersion { status?: 'importing' | 'ready' | 'failed'; job_id?: string; id: string; dataset_id: string; project_id: string; name: string; version: number; checksum: string; schema: DatasetColumn[]; rows: number; uri: string; created_at: string }
export interface DataProfileColumn { name: string; dtype: string; missing_pct: number; unique: number; mean?: number; std?: number; min?: number; max?: number; top?: { value: string; count: number }[]; histogram?: { bin: string; count: number }[] }
export interface DataAlert { code: string; severity: 'info' | 'warning' | 'error'; column?: string; message: string }
export interface DataProfile { dataset_version_id: string; columns: DataProfileColumn[]; alerts: DataAlert[]; computed_by: string; rows: number }
export interface Job { id: string; status: JobStatus; progress: number; error_code?: string; message?: string }

export interface SplitSpec { strategy: 'random' | 'stratified' | 'group' | 'time'; test_ratio: number; cv_folds: number; val_ratio?: number; seed: number; target?: string; group_column?: string; time_column?: string; text_column?: string; image_column?: string; user_column?: string; item_column?: string }
export interface SplitVersion { id: string; dataset_version_id: string; split_spec: SplitSpec; checksum: string; counts: { train: number; validation: number; test: number }; target_distribution: { label: string; train: number; test: number }[] }
export interface PreprocessStep { type: string; columns?: string[]; params?: Record<string, unknown> }
export interface PreprocessSpec { id: string; version: number; dataset_version_id: string; steps: PreprocessStep[]; content_hash: string }
export interface PreprocessTransform { type: string; label: string; applies_to: string[]; params_schema: JsonSchema; category?: string; tasks?: Task[]; deep_learning?: boolean; /** Calcul sur les valeurs passées de la cible (lags) : pas de fuite. */ target_safe?: boolean }
export interface EvidenceRef { source_type: 'profile' | 'run' | 'execution' | 'rule' | 'dataset'; source_id: string; summary: string }

export interface ModelSpec { id: string; version: string; family: string; label: string; task: Task[]; modality: Modality; params_schema: JsonSchema; dependencies: string[]; determinism: 'exact' | 'tolerance'; deep_learning?: boolean; gpu?: boolean }
export interface TrainingResources { cpu: number; gpu: number; max_minutes: number; concurrency: number; budget_caps: { trials: number; max_minutes: number; models: number } }
export interface ExperimentRun { id: string; project_id: string; name: string; model_id: string; config_hash: string; protocol_hash: string; split_id: string; preprocess_spec_id: string; primary_metric: string; params: Record<string, unknown>; metrics: Record<string, number>; metrics_std?: Record<string, number>; test_metrics?: Record<string, number>; test_evaluated: boolean; artifacts: { name: string; kind: string; checksum: string }[]; curve?: { epoch: number; train: number; validation: number }[]; mlflow_run_id: string; execution_id?: string; workflow_version_id?: string; created_at: string; duration_s: number; seed: number }
export interface TrainingJob { id: string; status: JobStatus; progress: number; metrics?: Record<string, number>; logs_ref?: string; run_id?: string; error_code?: string; message?: string; model_id: string; created_at: string; execution_ref?: ExecutionRef }
export interface LeaderboardEntry { run_id: string; rank: number; metrics: Record<string, number> }
export interface Leaderboard { protocol_hash: string; primary_metric: string; direction: 'maximize' | 'minimize'; entries: LeaderboardEntry[] }
export interface ModelVersion { id: string; name: string; version: number; run_id: string; alias: 'candidate' | 'staging' | 'production' | null; artifact_ref: string; created_at: string; input_schema?: DatasetColumn[]; environment?: string[]; checksum?: string; test_evaluated: boolean; workflow_version_id?: string }
export interface PredictResult { predictions: (string | number)[]; probabilities?: number[][]; classes?: string[]; schema_warnings: string[] }

export interface GoalSpec { id: string; task: Task; target?: string; objective: { primary_metric: string; direction: 'maximize' | 'minimize' }; constraints: string[]; ambiguities: string[] }
export interface PlanProposal { id: string; goal_id: string; workflow_id: string; workflow_version_id: string; rationale: Record<string, string>; assumptions: string[]; warnings: string[]; evidence_refs: EvidenceRef[]; required_approvals: { operation_class: OpClass; node_ids: string[]; individual: boolean }[]; validation_report_ref?: string; simulated?: boolean }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; ts: string; evidence_refs?: EvidenceRef[]; proposed_actions?: ProposedAction[]; simulated?: boolean }
export interface ProposedAction { kind: 'create_proposal' | 'open_proposal' | 'open_workflow' | 'open_dataset' | 'run_profile'; label: string; ref: string }
export interface Explanation { subject_ref: string; text: string; evidence_refs: EvidenceRef[]; simulated?: boolean }
export interface AuditEvent { id: string; project_id: string; actor: { type: 'user' | 'assistant' | 'system'; id: string }; ts: string; action: string; resource_ref?: string; outcome: 'ok' | 'refused' | 'error'; reason?: string; approval_id?: string; request_id: string }

export interface NodeUi { x: number; y: number }
export interface WorkflowNode { id: string; type: string; type_version: string; params: Record<string, any>; ui?: NodeUi }
export interface WorkflowEdge { id: string; from: { node: string; port: string }; to: { node: string; port: string } }
export interface WorkflowMetadata { task: Task; target?: string; /** Options propres au type (horizon, k, contamination…) — cf. pipeline_types[].options_schema. */ task_options?: Record<string, unknown>; objective?: { primary_metric: string; direction: 'maximize' | 'minimize' }; origin: 'human' | 'ai'; goal_id?: string }
export interface WorkflowSpec { schema_version: string; catalog_version: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; metadata: WorkflowMetadata }
export interface Workflow { id: string; project_id: string; name: string; created_at: string; latest_version_id: string }
export interface WorkflowVersionMeta { id: string; workflow_id: string; parent_version_id: string | null; content_hash: string; author: { type: 'user' | 'assistant'; id: string }; created_at: string; origin: 'human' | 'ai'; readiness: Readiness; label?: string }
export interface WorkflowVersion extends WorkflowVersionMeta { spec: WorkflowSpec }
export interface WorkflowDiff { against: string; nodes_added: string[]; nodes_removed: string[]; nodes_changed: { id: string; changes: { path: string; before: unknown; after: unknown }[] }[]; edges_added: string[]; edges_removed: string[] }

export interface PortDef { name: string; type: PortType; multiple: boolean }
export interface NodeType { type: string; version: string; label: string; owner: string; operation_class: OpClass; adapter: string; input_ports: PortDef[]; output_ports: PortDef[]; params_schema: JsonSchema; params_doc: string }
export interface JsonSchema { type?: string; title?: string; description?: string; properties?: Record<string, JsonSchema>; required?: string[]; enum?: (string | number)[]; minimum?: number; maximum?: number; minLength?: number; default?: unknown; items?: JsonSchema; [k: `x-${string}`]: unknown }

export type IssueSeverity = 'error' | 'warning' | 'info'
export interface ValidationIssue { code: string; severity: IssueSeverity; node_id?: string; path?: string; message: string; hint?: string }
export type LayerName = 'structure' | 'data' | 'training' | 'policy'
export interface ValidationLayer { layer: LayerName; status: 'ok' | 'warning' | 'error'; issues: ValidationIssue[] }
export interface ValidationReport { subject: { kind: string; id: string; version?: string }; content_hash: string; status: 'ok' | 'warning' | 'error'; layers: ValidationLayer[]; catalog_version: string; created_at?: string }

export interface BudgetSpec { trials: number; max_minutes: number; models: number }
export interface Approval { id: string; project_id: string; user_id: string; workflow_version_id: string; content_hash: string; scope: 'version' | 'lineage'; operation_classes: OpClass[]; node_ids?: string[]; budget?: BudgetSpec; mode: Mode; method: 'explicit_click' | 'chat_confirm'; expires_at: string; status: ApprovalStatus; created_at: string }
export interface ExecutionRef { execution_id: string; node_id: string; attempt: number }
export interface NodeRun { node_id: string; attempt: number; status: NodeStatus; cached: boolean; job_ref?: string; error?: { code: string; message: string }; result_refs?: { kind: string; id: string }[]; progress?: number; started_at?: string; finished_at?: string }
export interface Execution { id: string; workflow_id: string; workflow_version_id: string; approval_ids: string[]; status: ExecutionStatus; reuse_from?: string; node_runs: NodeRun[]; created_at: string; finished_at?: string; requested_by: string }
export interface ExecutionEvent { id: number; type: 'node_status' | 'execution_status'; execution_id: string; node_id?: string; status: string; ts: string }
export interface ExportManifest { export_id: string; workflow_version_id: string; content_hash: string; execution_id: string; status: JobStatus; dataset_refs: string[]; split_refs: string[]; preprocess_spec: string; model_configs: Record<string, unknown>[]; seeds: number[]; environment: string[]; code: { path: string; sha256: string; template_id: string }[]; artifacts: { ref: string; checksum: string; included: boolean }[]; limitations: string[]; integrity: string; bundle_uri?: string }
export interface PromotionRecord { id: string; model_version_id: string; model_name: string; alias: 'staging' | 'production'; approval_id: string; actor: string; checks: { test_evaluated: boolean; reproducible: boolean }; created_at: string }

/* ---------- Types de pipeline (catalogue partagé) ---------- */
export interface MetricDef { id: string; label: string; direction: 'maximize' | 'minimize' }
export interface RoleDef { role: ColumnRole; label: string; required: boolean; dtypes: ColumnDtype[] }
export interface TemplateStep { type: string; dtypes?: ColumnDtype[]; role?: ColumnRole }
export interface PipelineTypeDef {
  id: Task; label: string; short_label: string; description: string; modality: Modality; shape: string; color: string
  /** Faux : pas de cible obligatoire (clustering, anomalies). */
  supervised: boolean
  roles: RoleDef[]; split_strategies: SplitSpec['strategy'][]; default_split: SplitSpec['strategy']
  metrics: string[]; default_metric: string; step_types: string[]
  template: { models: string[]; steps: TemplateStep[] }
  options_schema: JsonSchema; deep_learning_only: boolean
}
