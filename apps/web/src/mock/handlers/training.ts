import type * as C from '@contracts/src'
import { cyrb53, aggregateReport, layerStatus, validateSchema, inferTask, CATALOG_VERSION } from '@contracts/src'
import { db, logAudit } from '../db'
import { route } from '../router'
import { ApiErr, notFound, bad, uid, nowIso, sleep, clone } from '../util'
import { MODELS, METRICS_BY_TASK, MINIMIZE, makeMetrics, makeCurve, testFrom } from '../ml'

export const RESOURCES: C.TrainingResources = { cpu: 8, gpu: 0, max_minutes: 60, concurrency: 2, budget_caps: { trials: 100, max_minutes: 60, models: 8 } }
export const jobWaiters: Record<string, Promise<C.TrainingJob>> = {}
const resolvers: Record<string, (j: C.TrainingJob) => void> = {}

export function taskFor(dsvId: string, target?: string): C.Task {
  return inferTask(db.versions.find((v) => v.id === dsvId)?.schema ?? [], target)
}
/** Contexte d'un split. `task` : type déclaré par le workflow (prioritaire) — sinon déduit du dataset. */
const splitCtx = (splitId: string, task?: C.Task) => { const s = db.splits.find((x) => x.id === splitId); if (!s) throw notFound('Split', splitId); const v = db.versions.find((x) => x.id === s.dataset_version_id)!; return { s, v, project_id: v.project_id, task: task ?? taskFor(v.id, s.split_spec.target) } }

/** Couche « training » (E2) : paramètres dans les plages, compatibilité modèle / tâche, métrique, ressources. */
export function trainingLayer(cfg: { model_id?: string; params?: Record<string, unknown>; primary_metric?: string; task?: C.Task; budget?: { trials: number; max_minutes: number } }, nodeId?: string): C.ValidationLayer {
  const issues: C.ValidationIssue[] = []; const m = MODELS.find((x) => x.id === cfg.model_id)
  if (!m) issues.push({ code: 'T_MODEL', severity: 'error', node_id: nodeId, path: 'model_id', message: `Modèle inconnu : ${cfg.model_id ?? '—'}.` })
  else {
    if (m.deep_learning && !db.catalogGateDL) issues.push({ code: 'T_GATE_DL', severity: 'error', node_id: nodeId, path: 'model_id', message: 'Les modèles de deep learning sont fermés tant que la porte G-DL n\'est pas validée (hors MVP).' })
    if (cfg.task && !m.task.includes(cfg.task)) issues.push({ code: 'T_TASK', severity: 'error', node_id: nodeId, path: 'model_id', message: `${m.label} ne gère pas la tâche « ${cfg.task} ».` })
    for (const i of validateSchema(cfg.params ?? {}, m.params_schema)) issues.push({ code: 'T_PARAM', severity: 'error', node_id: nodeId, path: i.path, message: `${m.label} — ${i.path} : ${i.message}` })
  }
  if (cfg.task && cfg.primary_metric && !METRICS_BY_TASK[cfg.task].includes(cfg.primary_metric)) issues.push({ code: 'T_METRIC', severity: 'error', node_id: nodeId, path: 'primary_metric', message: `La métrique « ${cfg.primary_metric} » ne convient pas à la tâche ${cfg.task}.`, hint: `Choisissez parmi : ${METRICS_BY_TASK[cfg.task].join(', ')}.` })
  if (cfg.budget) {
    if (cfg.budget.trials > RESOURCES.budget_caps.trials) issues.push({ code: 'T_BUDGET', severity: 'error', node_id: nodeId, path: 'budget.trials', message: `Essais > plafond (${RESOURCES.budget_caps.trials}).` })
    if (cfg.budget.max_minutes > RESOURCES.budget_caps.max_minutes) issues.push({ code: 'T_BUDGET', severity: 'error', node_id: nodeId, path: 'budget.max_minutes', message: `Durée > plafond (${RESOURCES.budget_caps.max_minutes} min).` })
  }
  return { layer: 'training', status: layerStatus(issues), issues }
}

function finishJob(job: C.TrainingJob) { resolvers[job.id]?.(clone(job)) }
function startJob(job: C.TrainingJob, steps: number, onSuccess: (j: C.TrainingJob) => void, failIf: boolean) {
  jobWaiters[job.id] = new Promise((r) => (resolvers[job.id] = r))
  ;(async () => {
    const st = () => job.status as C.JobStatus
    await sleep(500); if (st() === 'cancelled') return finishJob(job)
    job.status = 'running'
    for (let i = 1; i <= steps; i++) {
      await sleep(450)
      if (st() === 'cancelled') return finishJob(job)
      if (failIf && i === Math.ceil(steps / 2)) { job.status = 'failed'; job.error_code = 'E2_OOM'; job.message = 'Mémoire insuffisante pendant l\'entraînement (simulé, seed = 13).'; return finishJob(job) }
      job.progress = Math.round((i / steps) * 100) / 100
    }
    onSuccess(job); job.status = 'succeeded'; job.progress = 1; finishJob(job)
  })()
}
export function buildRun(cfg: any, ref?: C.ExecutionRef, name?: string): C.ExperimentRun {
  const { s, v, project_id, task } = splitCtx(cfg.split_id, cfg.task); const spec = db.specs.find((x) => x.id === cfg.preprocess_spec_id)
  const { metrics, std } = makeMetrics(cfg.model_id, cfg.params ?? {}, cfg.seed ?? 42, task, spec?.steps.length ?? 0)
  const exec = ref && db.executions.find((e) => e.id === ref.execution_id)
  const model = MODELS.find((m) => m.id === cfg.model_id)!
  const run: C.ExperimentRun = { id: uid('run'), project_id, name: name ?? model.label, model_id: cfg.model_id, config_hash: 'cfg_' + cyrb53(cfg.model_id + JSON.stringify(cfg.params ?? {}) + cfg.seed).slice(0, 8), protocol_hash: 'proto_' + cyrb53(`${s.id}|${cfg.primary_metric}|${s.split_spec.cv_folds}`).slice(0, 8), split_id: s.id, preprocess_spec_id: cfg.preprocess_spec_id, primary_metric: cfg.primary_metric, params: cfg.params ?? {}, metrics, metrics_std: std, test_evaluated: false, artifacts: [{ name: 'model.pkl', kind: 'mlflow-pyfunc', checksum: 'sha256:' + cyrb53(uid('a')).slice(0, 10) + '…' }, { name: 'metrics.json', kind: 'json', checksum: 'sha256:' + cyrb53(uid('b')).slice(0, 10) + '…' }], curve: model.family === 'Boosting' || model.deep_learning ? makeCurve(cfg.model_id, cfg.seed ?? 42) : undefined, mlflow_run_id: 'mlf_' + cyrb53(uid('m')).slice(0, 10), execution_id: ref?.execution_id, workflow_version_id: exec?.workflow_version_id, created_at: nowIso(), duration_s: 15 + Math.round(Math.random() * 90), seed: cfg.seed ?? 42 }
  db.runs.unshift(run); void v; return run
}

export function registerTraining() {
  route('GET', '/models/catalog', ({ query }) => clone(MODELS.filter((m) => (!query.task || m.task.includes(query.task as C.Task)) && (!query.modality || m.modality === query.modality)).map((m) => ({ ...m, disabled: !!m.deep_learning && !db.catalogGateDL }))))
  route('GET', '/training/resources', () => RESOURCES)
  route('POST', '/training/validate', ({ body }) => {
    const b = body ?? {}; const issues: C.ValidationIssue[] = []
    let task: C.Task | undefined
    if (b.split_id) { try { task = splitCtx(b.split_id, b.task).task } catch { issues.push({ code: 'T_SPLIT', severity: 'error', path: 'split_id', message: `Split introuvable : ${b.split_id}.` }) } }
    if (b.preprocess_spec_id && !db.specs.some((s) => s.id === b.preprocess_spec_id)) issues.push({ code: 'T_SPEC', severity: 'error', path: 'preprocess_spec_id', message: `PreprocessSpec introuvable : ${b.preprocess_spec_id}.` })
    const layer = trainingLayer({ model_id: b.model_id, params: b.params, primary_metric: b.primary_metric, task, budget: b.budget })
    layer.issues.unshift(...issues); layer.status = layerStatus(layer.issues)
    const r = aggregateReport({ id: 'training_config' }, { schema_version: '1.0', catalog_version: CATALOG_VERSION, nodes: [], edges: [], metadata: { task: task ?? 'classification', origin: 'human' } }, [layer])
    r.subject = { kind: 'training_config', id: 'draft' }; r.content_hash = 'tc_' + cyrb53(JSON.stringify(b)); return r
  })
  route('POST', '/training/jobs', ({ body }) => {
    const b = body; if (!b?.execution_ref) throw bad('EXECUTION_REF_REQUIRED', 'execution_ref requis : l\'entraînement ne se lance que via une exécution.')
    const { task } = splitCtx(b.split_id, b.task)
    const layer = trainingLayer({ ...b, task }); if (layer.status === 'error') throw bad('TRAINING_INVALID', layer.issues[0].message, layer.issues)
    const job: C.TrainingJob = { id: uid('job'), status: 'queued', progress: 0, model_id: b.model_id, created_at: nowIso(), execution_ref: b.execution_ref }
    db.trainingJobs.unshift(job)
    startJob(job, 5, (j) => { j.run_id = buildRun(b, b.execution_ref).id; j.metrics = db.runs[0].metrics }, b.seed === 13)
    return { job_id: job.id }
  }, { internal: true, status: 202 })
  route('GET', '/training/jobs', ({ query }) => clone(db.trainingJobs.filter((j) => { if (!query.project_id) return true; const r = db.runs.find((x) => x.id === j.run_id); return !r || r.project_id === query.project_id })))
  route('GET', '/training/jobs/{job_id}', ({ params }) => clone(db.trainingJobs.find((j) => j.id === params.job_id) ?? (() => { throw notFound('Job', params.job_id) })()))
  route('POST', '/training/jobs/{job_id}/cancel', ({ params }) => {
    const j = db.trainingJobs.find((x) => x.id === params.job_id); if (!j) throw notFound('Job', params.job_id)
    if (j.status === 'queued' || j.status === 'running') j.status = 'cancelled'; return clone(j)
  }, { internal: true })
  route('POST', '/tuning/studies', ({ body }) => {
    const b = body; if (!b?.execution_ref) throw bad('EXECUTION_REF_REQUIRED', 'execution_ref requis.')
    const { task } = splitCtx(b.base_config.split_id, b.base_config.task)
    const layer = trainingLayer({ ...b.base_config, primary_metric: b.primary_metric, task, budget: b.budget }); if (layer.status === 'error') throw bad('TRAINING_INVALID', layer.issues[0].message, layer.issues)
    const job: C.TrainingJob = { id: uid('job'), status: 'queued', progress: 0, model_id: b.base_config.model_id, created_at: nowIso(), execution_ref: b.execution_ref }
    db.trainingJobs.unshift(job)
    const study = { id: uid('study'), job_id: job.id, trials: [] as { n: number; value: number }[], status: 'queued' as C.JobStatus, run_id: undefined as string | undefined, execution_ref: b.execution_ref }
    db.studies.unshift(study)
    const n = Math.min(b.budget.trials, 12)
    startJob(job, n, (j) => {
      const cfg = { ...b.base_config, primary_metric: b.primary_metric, params: { ...(b.base_config.params ?? {}), n_estimators: 450, learning_rate: 0.06 } }
      const run = buildRun(cfg, b.execution_ref, `${MODELS.find((m) => m.id === cfg.model_id)!.label} (tuning)`); run.metrics[b.primary_metric] = Math.min(0.95, (run.metrics[b.primary_metric] ?? 0.7) + 0.012)
      j.run_id = run.id; study.run_id = run.id; j.metrics = run.metrics
    }, false)
    ;(async () => { const base = 0.6; for (let i = 1; i <= n; i++) { await sleep(450); study.trials.push({ n: i, value: Math.round((base + 0.06 * (1 - Math.exp(-i / 4)) + Math.random() * 0.01) * 1000) / 1000 }); study.status = 'running' } })()
    const iv = setInterval(() => { study.status = job.status; if (['succeeded', 'failed', 'cancelled'].includes(job.status)) clearInterval(iv) }, 200)
    return { study_id: study.id }
  }, { internal: true, status: 202 })
  route('GET', '/tuning/studies/{study_id}', ({ params }) => {
    const s = db.studies.find((x) => x.id === params.study_id); if (!s) throw notFound('Étude', params.study_id)
    const job = db.trainingJobs.find((j) => j.id === s.job_id)!
    const best = s.trials.length ? s.trials.reduce((a, b) => (b.value > a.value ? b : a)) : undefined
    return { ...clone(s), job: clone(job), best_trial: best }
  })

  route('GET', '/experiments', ({ query }) => clone(db.runs.filter((r) => (!query.project_id || r.project_id === query.project_id) && (!query.model_id || r.model_id === query.model_id) && (!query.execution_id || r.execution_id === query.execution_id))))
  route('GET', '/experiments/{run_id}', ({ params }) => clone(db.runs.find((r) => r.id === params.run_id) ?? (() => { throw notFound('Run', params.run_id) })()))
  route('POST', '/experiments/compare', ({ body }) => {
    const ids: string[] = body?.run_ids ?? []; if (!ids.length) throw bad('VALIDATION', 'Au moins un run est requis.')
    const runs = ids.map((id) => db.runs.find((r) => r.id === id) ?? (() => { throw notFound('Run', id) })())
    if (new Set(runs.map((r) => r.protocol_hash)).size > 1) throw new ApiErr(422, 'PROTOCOL_MISMATCH', 'Les runs ne partagent pas le même protocole (split, métrique principale, validation).', { protocols: runs.map((r) => ({ run_id: r.id, protocol_hash: r.protocol_hash, primary_metric: r.primary_metric })) })
    const metric = runs[0].primary_metric, dir = MINIMIZE.has(metric) ? 'minimize' : 'maximize'
    const sorted = [...runs].sort((a, b) => (dir === 'maximize' ? b.metrics[metric] - a.metrics[metric] : a.metrics[metric] - b.metrics[metric]))
    const lb: C.Leaderboard = { protocol_hash: runs[0].protocol_hash, primary_metric: metric, direction: dir, entries: sorted.map((r, i) => ({ run_id: r.id, rank: i + 1, metrics: r.metrics })) }
    return lb
  })
  route('POST', '/experiments/{run_id}/final-evaluation', ({ params, body }) => {
    const run = db.runs.find((r) => r.id === params.run_id); if (!run) throw notFound('Run', params.run_id)
    if (!body?.execution_ref) throw bad('EXECUTION_REF_REQUIRED', 'execution_ref requis.')
    if (run.test_evaluated) throw new ApiErr(409, 'TEST_ALREADY_USED', 'Le jeu de test a déjà été utilisé pour ce run (usage unique).')
    const job: C.TrainingJob = { id: uid('job'), status: 'queued', progress: 0, model_id: run.model_id, created_at: nowIso(), execution_ref: body.execution_ref }
    db.trainingJobs.unshift(job)
    run.test_evaluated = true // réservation immédiate : un seul usage, même en cas de nouvelle tentative
    startJob(job, 2, (j) => { run.test_metrics = testFrom(run.metrics, run.seed); j.run_id = run.id; j.metrics = run.test_metrics }, false)
    logAudit(run.project_id, { type: 'system', id: 'executor' }, 'final_test_run', run.id)
    return { job_id: job.id, run_id: run.id }
  }, { internal: true, status: 202 })
  route('POST', '/models/registry', ({ body }) => {
    const run = db.runs.find((r) => r.id === body?.run_id); if (!run) throw notFound('Run', body?.run_id)
    if (!body?.execution_ref) throw bad('EXECUTION_REF_REQUIRED', 'execution_ref requis.')
    if (!run.test_evaluated) throw bad('TEST_NOT_EVALUATED', 'Le run doit avoir été évalué sur le jeu de test avant l\'enregistrement.')
    const name = String(body.name ?? '').trim(); if (!name) throw bad('VALIDATION', 'name requis.')
    const version = db.registry.filter((m) => m.name === name).length + 1
    const spec = db.specs.find((s) => s.id === run.preprocess_spec_id); const sp = db.splits.find((s) => s.id === run.split_id); const dsv = db.versions.find((v) => v.id === sp?.dataset_version_id)
    const mv: C.ModelVersion = { id: uid('mv'), name, version, run_id: run.id, alias: 'candidate', artifact_ref: `models:/${name}/${version}`, created_at: nowIso(), test_evaluated: true, workflow_version_id: run.workflow_version_id, checksum: 'sha256:' + cyrb53(run.id + name).slice(0, 10) + '…', environment: ['scikit-learn==1.5.2', 'pandas==2.2.3', 'numpy==2.1.2'], input_schema: dsv?.schema.filter((c) => c.name !== sp?.split_spec.target && !(spec?.steps.some((s) => s.type === 'drop_columns' && s.columns?.includes(c.name)))) }
    db.registry.unshift(mv); return { model_version_id: mv.id }
  }, { internal: true, status: 201 })
  route('GET', '/models/registry', ({ query }) => clone(db.registry.filter((m) => !query.project_id || db.runs.find((r) => r.id === m.run_id)?.project_id === query.project_id)))
  route('GET', '/models/registry/{model_version_id}', ({ params }) => {
    const m = db.registry.find((x) => x.id === params.model_version_id); if (!m) throw notFound('ModelVersion', params.model_version_id)
    return { ...clone(m), run: clone(db.runs.find((r) => r.id === m.run_id)) }
  })
  route('PUT', '/models/registry/{model_version_id}/alias', ({ params, body }) => {
    const m = db.registry.find((x) => x.id === params.model_version_id); if (!m) throw notFound('ModelVersion', params.model_version_id)
    if (!body?.promotion_id) throw bad('PROMOTION_REQUIRED', 'promotion_id requis : le changement d\'alias passe par la porte de promotion (E4).')
    db.registry.filter((x) => x.name === m.name && x.alias === body.alias).forEach((x) => (x.alias = 'candidate')); m.alias = body.alias; return clone(m)
  }, { internal: true })

  route('POST', '/inference/predict', ({ body }) => {
    const m = db.registry.find((x) => x.id === body?.model_version_id); if (!m) throw notFound('ModelVersion', body?.model_version_id)
    let records: Record<string, any>[] = body?.records ?? []
    if (body?.dataset_version_id) { records = (db.rows[body.dataset_version_id] ?? []).slice(0, 25) }
    if (!records.length) throw bad('VALIDATION', 'records ou dataset_version_id requis.')
    if (records.length > 500) throw bad('TOO_MANY_RECORDS', 'Maximum 500 enregistrements par appel.')
    const expected = (m.input_schema ?? []).map((c) => c.name); const warnings = new Set<string>()
    const seen = new Set(records.flatMap((r) => Object.keys(r)))
    expected.filter((c) => !seen.has(c)).forEach((c) => warnings.add(`Colonne attendue absente : ${c} (valeur manquante imputée).`))
    ;[...seen].filter((c) => !expected.includes(c)).forEach((c) => warnings.add(`Colonne inconnue ignorée : ${c}.`))
    ;(m.input_schema ?? []).filter((c) => c.dtype === 'int' || c.dtype === 'float').forEach((c) => { if (records.some((r) => r[c.name] !== undefined && r[c.name] !== null && r[c.name] !== '' && Number.isNaN(Number(r[c.name])))) warnings.add(`Type invalide pour ${c.name} (numérique attendu).`) })
    const probs = records.map((r) => { const t = Number(r.tenure_months ?? 24), c = Number(r.support_calls ?? 1), mtm = r.contract === 'month-to-month' ? 0.28 : 0, ch = Number(r.monthly_charge ?? 50)
      const p = Math.max(0.02, Math.min(0.97, 0.1 + mtm - Math.min(t, 48) * 0.004 + c * 0.05 + (ch > 70 ? 0.07 : 0) + (m.name === 'churn-gb' ? 0.02 : 0))); return [Math.round((1 - p) * 1000) / 1000, Math.round(p * 1000) / 1000] })
    return { predictions: probs.map((p) => (p[1] >= 0.5 ? 'yes' : 'no')), probabilities: probs, classes: ['no', 'yes'], schema_warnings: [...warnings] } as C.PredictResult
  })
}
