import type * as C from '@contracts/src'
import { contentHash, cyrb53 } from '@contracts/src'
import { ago, ahead, uid } from './util'
import { TELECOM_SCHEMA, HOUSING_SCHEMA, telecomRows, housingRows, buildProfile, demoDatasets, type Row } from './seed-data'
import { buildTemplateSpec, PIPELINE_TYPE_BY_ID } from '@contracts/src'
import { makeMetrics, makeCurve, testFrom } from './ml'
import { baselineSpec, twoModelsSpec, fullPlanSpec } from './specs'

export interface Store {
  projects: C.Project[]
  modes: Record<string, C.Mode>
  datasets: { id: string; project_id: string; name: string }[]
  versions: C.DatasetVersion[]
  rows: Record<string, Row[]>
  profiles: Record<string, C.DataProfile>
  jobs: Record<string, C.Job & { kind: string }>
  splits: C.SplitVersion[]
  specs: C.PreprocessSpec[]
  trainingJobs: C.TrainingJob[]
  studies: { id: string; job_id: string; run_id?: string; trials: { n: number; value: number }[]; status: C.JobStatus; execution_ref?: C.ExecutionRef }[]
  runs: C.ExperimentRun[]
  registry: C.ModelVersion[]
  workflows: C.Workflow[]
  versionsMeta: C.WorkflowVersion[]
  reports: Record<string, C.ValidationReport>
  approvals: C.Approval[]
  executions: C.Execution[]
  exports: C.ExportManifest[]
  promotions: C.PromotionRecord[]
  goals: C.GoalSpec[]
  proposals: C.PlanProposal[]
  chats: Record<string, C.ChatMessage[]>
  audit: C.AuditEvent[]
  catalogGateDL: boolean
}

export const USER = { id: 'u_mohamed', name: 'Mohamed' }
export const SERVICE_TOKEN = 'mock-service-token'

function seed(): Store {
  const s: Store = { projects: [], modes: {}, datasets: [], versions: [], rows: {}, profiles: {}, jobs: {}, splits: [], specs: [], trainingJobs: [], studies: [], runs: [], registry: [], workflows: [], versionsMeta: [], reports: {}, approvals: [], executions: [], exports: [], promotions: [], goals: [], proposals: [], chats: {}, audit: [], catalogGateDL: false }
  s.projects = [
    { id: 'p1', name: 'Churn télécom', role: 'owner', created_at: ago(60 * 24 * 12) },
    { id: 'p2', name: 'Prix immobilier', role: 'editor', created_at: ago(60 * 24 * 5) },
    { id: 'p3', name: 'Démo — tous les types de pipeline', role: 'owner', created_at: ago(60 * 24 * 2) },
  ]
  s.modes = { p1: 'guided', p2: 'auto', p3: 'expert' }
  s.datasets = [{ id: 'ds_telecom', project_id: 'p1', name: 'telecom_churn.csv' }, { id: 'ds_housing', project_id: 'p2', name: 'housing.csv' }]
  const tr = telecomRows(), hr = housingRows()
  s.versions = [
    { id: 'dsv_telecom_1', dataset_id: 'ds_telecom', project_id: 'p1', name: 'telecom_churn.csv', version: 1, checksum: 'sha256:9f2c…a41e', schema: TELECOM_SCHEMA, rows: 7043, uri: 's3://datasets/p1/telecom_churn_v1.parquet', created_at: ago(60 * 24 * 11), status: 'ready' },
    { id: 'dsv_housing_1', dataset_id: 'ds_housing', project_id: 'p2', name: 'housing.csv', version: 1, checksum: 'sha256:b7d0…03cc', schema: HOUSING_SCHEMA, rows: 4210, uri: 's3://datasets/p2/housing_v1.parquet', created_at: ago(60 * 24 * 4), status: 'ready' },
  ]
  s.rows = { dsv_telecom_1: tr, dsv_housing_1: hr }
  s.profiles = { dsv_telecom_1: buildProfile('dsv_telecom_1', TELECOM_SCHEMA, tr, 7043) }

  const spCfg = { strategy: 'stratified' as const, test_ratio: 0.2, cv_folds: 5, seed: 42, target: 'churn' }
  s.splits = [{ id: 'sp_01', dataset_version_id: 'dsv_telecom_1', split_spec: spCfg, checksum: 'sha256:51ab…77f0', counts: { train: 4506, validation: 1127, test: 1410 }, target_distribution: [{ label: 'no', train: 0.735, test: 0.735 }, { label: 'yes', train: 0.265, test: 0.265 }] }]
  const steps = [{ type: 'drop_columns', columns: ['customer_id'] }, { type: 'impute_median', columns: ['age', 'data_gb'] }, { type: 'onehot', columns: ['plan', 'contract', 'payment_method'] }]
  s.specs = [{ id: 'ps_01', version: 1, dataset_version_id: 'dsv_telecom_1', steps, content_hash: 'ph_' + cyrb53(JSON.stringify(steps)) }]

  const mk = (id: string, name: string, model: string, params: Record<string, unknown>, seed: number, metric: string, tested: boolean, minAgo: number, exec?: string, wfv?: string): C.ExperimentRun => {
    const { metrics, std } = makeMetrics(model, params, seed, 'classification', 3)
    return { id, project_id: 'p1', name, model_id: model, config_hash: 'cfg_' + cyrb53(model + JSON.stringify(params) + seed).slice(0, 8), protocol_hash: 'proto_' + cyrb53('sp_01|' + metric + '|5').slice(0, 8), split_id: 'sp_01', preprocess_spec_id: 'ps_01', primary_metric: metric, params, metrics, metrics_std: std, test_evaluated: tested, test_metrics: tested ? testFrom(metrics, seed) : undefined, artifacts: [{ name: 'model.pkl', kind: 'mlflow-pyfunc', checksum: 'sha256:' + cyrb53(id).slice(0, 10) + '…' }, { name: 'metrics.json', kind: 'json', checksum: 'sha256:' + cyrb53(id + 'm').slice(0, 10) + '…' }], curve: model === 'gradient_boosting' || model === 'mlp' ? makeCurve(model, seed) : undefined, mlflow_run_id: 'mlf_' + cyrb53(id).slice(0, 10), execution_id: exec, workflow_version_id: wfv, created_at: ago(minAgo), duration_s: 20 + Math.round(Math.random() * 120), seed }
  }
  s.runs = [
    mk('run_rf', 'Forêt aléatoire — baseline', 'random_forest', { n_estimators: 300 }, 42, 'f1', true, 60 * 30, 'ex_ok', 'wfv_base_1'),
    mk('run_gb', 'Gradient boosting', 'gradient_boosting', { n_estimators: 400, learning_rate: 0.08 }, 42, 'f1', true, 60 * 26),
    mk('run_lr', 'Régression logistique', 'logistic_regression', { C: 1, max_iter: 200 }, 42, 'f1', false, 60 * 22),
    mk('run_knn', 'k-NN (k=15)', 'knn', { n_neighbors: 15 }, 42, 'f1', false, 60 * 20),
    mk('run_rf_acc', 'Forêt aléatoire (accuracy)', 'random_forest', { n_estimators: 150 }, 7, 'accuracy', false, 60 * 3),
  ]
  s.registry = [
    { id: 'mv_rf_1', name: 'churn-rf', version: 1, run_id: 'run_rf', alias: 'production', artifact_ref: 'models:/churn-rf/1', created_at: ago(60 * 28), test_evaluated: true, workflow_version_id: 'wfv_base_1', checksum: 'sha256:7e41…c0d2', environment: ['scikit-learn==1.5.2', 'pandas==2.2.3', 'numpy==2.1.2'], input_schema: TELECOM_SCHEMA.filter((c) => c.name !== 'churn' && c.name !== 'customer_id') },
    { id: 'mv_gb_1', name: 'churn-gb', version: 1, run_id: 'run_gb', alias: 'candidate', artifact_ref: 'models:/churn-gb/1', created_at: ago(60 * 25), test_evaluated: true, workflow_version_id: 'wfv_base_1', checksum: 'sha256:1b9a…44e7', environment: ['scikit-learn==1.5.2', 'pandas==2.2.3', 'numpy==2.1.2'], input_schema: TELECOM_SCHEMA.filter((c) => c.name !== 'churn' && c.name !== 'customer_id') },
  ]

  // Workflows
  const wv = (id: string, wf: string, parent: string | null, spec: C.WorkflowSpec, origin: 'human' | 'ai', author: C.WorkflowVersion['author'], min: number, label?: string): C.WorkflowVersion => ({ id, workflow_id: wf, parent_version_id: parent, content_hash: contentHash(spec), author, created_at: ago(min), origin, readiness: 'draft', spec, label })
  const user = { type: 'user' as const, id: USER.id }, ai = { type: 'assistant' as const, id: 'assistant' }
  const v1 = wv('wfv_base_1', 'wf_base', null, baselineSpec('dsv_telecom_1'), 'human', user, 60 * 31, 'Baseline')
  const v2 = wv('wfv_base_2', 'wf_base', 'wfv_base_1', twoModelsSpec('dsv_telecom_1', 'churn', true), 'human', user, 60 * 6, 'Ajout du gradient boosting')
  const v3 = wv('wfv_ai_1', 'wf_ai', null, fullPlanSpec('dsv_telecom_1', 'churn', 'f1', 'goal_seed'), 'ai', ai, 40, 'Plan proposé')
  s.versionsMeta = [v1, v2, v3]
  s.workflows = [
    { id: 'wf_base', project_id: 'p1', name: 'Churn — baseline', created_at: ago(60 * 31), latest_version_id: 'wfv_base_2' },
    { id: 'wf_ai', project_id: 'p1', name: 'Churn — plan proposé par l\'IA', created_at: ago(40), latest_version_id: 'wfv_ai_1' },
  ]
  s.reports[v1.id] = { subject: { kind: 'workflow_version', id: v1.id }, content_hash: v1.content_hash, status: 'ok', layers: ['structure', 'data', 'training', 'policy'].map((l) => ({ layer: l as C.LayerName, status: 'ok' as const, issues: [] })), catalog_version: '1.0.0', created_at: ago(60 * 30) }
  s.approvals = [{ id: 'ap_seed', project_id: 'p1', user_id: USER.id, workflow_version_id: v1.id, content_hash: v1.content_hash, scope: 'version', operation_classes: ['L2'], node_ids: ['n4'], mode: 'guided', method: 'explicit_click', expires_at: ahead(60 * 24 * 20), status: 'active', created_at: ago(60 * 30) }]
  const nr = (node_id: string, status: C.NodeStatus, extra: Partial<C.NodeRun> = {}): C.NodeRun => ({ node_id, attempt: 1, status, cached: false, ...extra })
  s.executions = [
    { id: 'ex_ok', workflow_id: 'wf_base', workflow_version_id: v1.id, approval_ids: ['ap_seed'], status: 'succeeded', created_at: ago(60 * 30), finished_at: ago(60 * 30 - 4), requested_by: USER.id,
      node_runs: [nr('n1', 'succeeded'), nr('n2', 'succeeded', { result_refs: [{ kind: 'split', id: 'sp_01' }] }), nr('n3', 'succeeded', { result_refs: [{ kind: 'preprocess_spec', id: 'ps_01' }] }), nr('n4', 'succeeded', { job_ref: 'job_seed_1', result_refs: [{ kind: 'run', id: 'run_rf' }] }), nr('n5', 'succeeded', { result_refs: [{ kind: 'leaderboard', id: 'run_rf' }] })] },
    { id: 'ex_fail', workflow_id: 'wf_base', workflow_version_id: v2.id, approval_ids: [], status: 'failed', created_at: ago(60 * 5), finished_at: ago(60 * 5 - 3), requested_by: USER.id,
      node_runs: [nr('n1', 'succeeded'), nr('n2', 'succeeded', { cached: true }), nr('n3', 'succeeded', { cached: true }), nr('n4', 'succeeded', { cached: true, result_refs: [{ kind: 'run', id: 'run_rf' }] }), nr('n6', 'failed', { error: { code: 'E2_OOM', message: 'Mémoire insuffisante pendant l\'entraînement (simulé).' } }), nr('n5', 'skipped')] },
  ]
  s.promotions = [{ id: 'pr_seed', model_version_id: 'mv_rf_1', model_name: 'churn-rf', alias: 'production', approval_id: 'ap_prom_seed', actor: USER.id, checks: { test_evaluated: true, reproducible: true }, created_at: ago(60 * 27) }]

  // Plan IA seed
  s.goals = [{ id: 'goal_seed', task: 'classification', target: 'churn', objective: { primary_metric: 'f1', direction: 'maximize' }, constraints: ['durée de tuning ≤ 10 min'], ambiguities: [] }]
  s.proposals = [{ id: 'prop_seed', goal_id: 'goal_seed', workflow_id: 'wf_ai', workflow_version_id: v3.id, simulated: true,
    rationale: { n3: 'customer_id est un identifiant (valeurs uniques) : exclu. Médiane pour age et data_gb (asymétriques, < 7 % de manquants). One-hot pour les 3 catégories de faible cardinalité.', n4: 'Référence linéaire simple, utile pour juger le gain des modèles non linéaires.', n5: 'Forêt aléatoire : robuste aux variables mixtes, peu de réglages.', n6: 'Boosting réglé sur un budget borné (20 essais, 10 min).', n7: 'La sélection se fait sur la validation croisée (f1), jamais sur le test.', n8: 'Le jeu de test est utilisé une seule fois, sur le meilleur modèle (approbation individuelle).', n9: 'Enregistrement du modèle retenu avec le préprocesseur ajusté.' },
    assumptions: ['La cible est la colonne « churn » (valeurs yes/no).', 'f1 retenue car la classe minoritaire représente ≈ 27 %.'], warnings: ['Le profil indique 4 % de valeurs manquantes sur age : l\'imputation peut biaiser légèrement.'],
    evidence_refs: [{ source_type: 'profile', source_id: 'dsv_telecom_1', summary: 'churn : classe « yes » ≈ 27 % des 7 043 lignes' }, { source_type: 'rule', source_id: 'R-ID-01', summary: 'Colonne identifiant exclue' }, { source_type: 'profile', source_id: 'dsv_telecom_1#age', summary: 'age : 4 % de manquants' }],
    required_approvals: [] }]
  s.audit = [
    { id: uid('au'), project_id: 'p1', actor: ai, ts: ago(40), action: 'proposal_created', resource_ref: 'prop_seed', outcome: 'ok', reason: 'Objectif : prédire churn (f1)', request_id: 'req_seed1' },
    { id: uid('au'), project_id: 'p1', actor: user, ts: ago(60 * 30), action: 'approval_created', resource_ref: 'ap_seed', outcome: 'ok', approval_id: 'ap_seed', request_id: 'req_seed2' },
    { id: uid('au'), project_id: 'p1', actor: { type: 'system', id: 'executor' }, ts: ago(60 * 30), action: 'execution_requested', resource_ref: 'ex_ok', outcome: 'ok', request_id: 'req_seed3' },
    { id: uid('au'), project_id: 'p1', actor: ai, ts: ago(35), action: 'tool_refused', resource_ref: 'eval.final_test', outcome: 'refused', reason: 'L3 : l\'assistant ne peut pas lancer le test final (approbation humaine requise).', request_id: 'req_seed4' },
  ]
  s.chats = { p1: [] }

  // Projet de démonstration : un dataset et un workflow prêt à l'emploi par nouveau type de pipeline
  demoDatasets().forEach((d, i) => {
    const dsv = `dsv_${d.id}_1`, ds = `ds_${d.id}`, wf = `wf_${d.id}`, wfv = `wfv_${d.id}_1`
    s.datasets.push({ id: ds, project_id: 'p3', name: d.name })
    s.versions.push({ id: dsv, dataset_id: ds, project_id: 'p3', name: d.name, version: 1, checksum: 'sha256:' + cyrb53(d.name).slice(0, 4) + '…' + cyrb53(d.id).slice(0, 4), schema: d.schema, rows: d.total, uri: `s3://datasets/p3/${d.id}_v1.parquet`, created_at: ago(60 * 24 * 2 - i * 30), status: 'ready' })
    s.rows[dsv] = d.rows
    s.profiles[dsv] = buildProfile(dsv, d.schema, d.rows, d.total)
    const spec = buildTemplateSpec(d.task, dsv, d.schema, { modelName: `${d.id}-model` })
    s.versionsMeta.push(wv(wfv, wf, null, spec, 'human', user, 60 * 24 * 2 - i * 30, 'Gabarit'))
    s.workflows.push({ id: wf, project_id: 'p3', name: `${PIPELINE_TYPE_BY_ID[d.task].label} — ${d.name.replace('.csv', '')}`, created_at: ago(60 * 24 * 2 - i * 30), latest_version_id: wfv })
  })
  s.chats.p3 = []
  return s
}

export let db: Store = seed()
export function resetDb() { db = seed() }
export function logAudit(project_id: string, actor: C.AuditEvent['actor'], action: string, resource_ref?: string, extra: Partial<C.AuditEvent> = {}) {
  db.audit.unshift({ id: uid('au'), project_id, actor, ts: new Date().toISOString(), action, resource_ref, outcome: 'ok', request_id: uid('req'), ...extra })
}
