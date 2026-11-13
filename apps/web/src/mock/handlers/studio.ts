import type * as C from '@contracts/src'
import { NODE_TYPES, CATALOG_VERSION, contentHash, structureLayer, aggregateReport, policyLayer, missingRequirements, layerStatus, NODE_TYPE_BY_ID } from '@contracts/src'
import { db, logAudit, USER, SERVICE_TOKEN } from '../db'
import { route, dispatch, SERVICE_HEADERS } from '../router'
import { ApiErr, notFound, bad, uid, nowIso, ahead, sleep, clone } from '../util'
import { dataLayerForPreprocess, dataLayerForSplit, recommend } from './data'
import { trainingLayer, taskFor, RESOURCES } from './training'
import { startExecution } from '../executor'
import { subscribe, eventsOf } from '../bus'
import { fullPlanSpec, baselineSpec } from '../specs'
import { buildTemplateSpec, pipelineType } from '@contracts/src'
import { cyrb53 } from '@contracts/src'

const wfv = (id: string) => db.versionsMeta.find((v) => v.id === id) ?? (() => { throw notFound('WorkflowVersion', id) })()
const wf = (id: string) => db.workflows.find((w) => w.id === id) ?? (() => { throw notFound('Workflow', id) })()
const projectOf = (versionId: string) => wf(wfv(versionId).workflow_id).project_id
export const modeOf = (project_id: string): C.Mode => db.modes[project_id] ?? 'guided'
const userActor = { type: 'user' as const, id: USER.id }

export function lineageIds(versionId: string): Set<string> {
  const out = new Set<string>(); let cur: C.WorkflowVersion | undefined = db.versionsMeta.find((v) => v.id === versionId)
  while (cur) { out.add(cur.id); cur = cur.parent_version_id ? db.versionsMeta.find((v) => v.id === cur!.parent_version_id) : undefined }
  return out
}
export function policyFor(version: C.WorkflowVersion) {
  const project_id = projectOf(version.id), mode = modeOf(project_id), lin = lineageIds(version.id)
  const approvals = db.approvals.filter((a) => a.project_id === project_id)
  const ctx = { contentHash: version.content_hash, inLineage: (a: C.Approval) => lin.has(a.workflow_version_id) }
  return { mode, approvals, ctx, layer: policyLayer(version.spec, mode, approvals, ctx), missing: missingRequirements(version.spec, mode, approvals, ctx) }
}

const skipped = (layer: C.LayerName): C.ValidationLayer => ({ layer, status: 'ok', issues: [{ code: 'SKIPPED', severity: 'info', message: 'Non évaluée : la structure du workflow est invalide.' }] })

/** Validation agrégée en quatre couches (structure E4, data E1, training E2, policy E3). */
export function fullValidate(version: C.WorkflowVersion): C.ValidationReport {
  const spec = version.spec
  const structure = structureLayer(spec, { caps: RESOURCES.budget_caps })
  let data: C.ValidationLayer, training: C.ValidationLayer
  if (structure.status === 'error') { data = skipped('data'); training = skipped('training') }
  else {
    const di: C.ValidationIssue[] = [], ti: C.ValidationIssue[] = []
    const dsNode = spec.nodes.find((n) => n.type === 'data.dataset'); const dsv = dsNode?.params.dataset_version_id
    const splitNode = spec.nodes.find((n) => n.type === 'data.split'); const target = splitNode?.params.target
    if (dsNode && !db.versions.some((v) => v.id === dsv)) di.push({ code: 'D_DATASET', severity: 'error', node_id: dsNode.id, path: 'dataset_version_id', message: `Version de dataset introuvable : ${dsv ?? '—'}.` })
    else if (dsv) for (const n of spec.nodes) {
      if (n.type === 'data.split') di.push(...dataLayerForSplit(dsv, n.params, n.id, spec.metadata.task).issues)
      if (n.type === 'data.preprocess') di.push(...dataLayerForPreprocess(dsv, n.params.steps ?? [], target, n.id, ['text_column', 'image_column', 'user_column', 'item_column', 'time_column', 'group_column'].map((k) => splitNode?.params[k]).filter(Boolean)).issues)
    }
    const task = spec.metadata.task
    const tabular = (t: C.Task) => t === 'classification' || t === 'regression'
    if (dsv && target && tabular(task) && tabular(taskFor(dsv, target)) && taskFor(dsv, target) !== task) ti.push({ code: 'T_TASK_MISMATCH', severity: 'warning', message: `La tâche déclarée (${task}) ne correspond pas au type de la cible « ${target} ».` })
    for (const n of spec.nodes) {
      if (n.type === 'train.model') ti.push(...trainingLayer({ model_id: n.params.model_id, params: n.params.params, primary_metric: n.params.primary_metric, task }, n.id).issues)
      if (n.type === 'train.tune') ti.push(...trainingLayer({ model_id: n.params.model_id, primary_metric: n.params.primary_metric, task, budget: n.params.budget }, n.id).issues)
    }
    data = { layer: 'data', status: layerStatus(di), issues: di }; training = { layer: 'training', status: layerStatus(ti), issues: ti }
  }
  const pol = policyFor(version).layer
  const r = aggregateReport({ id: version.id }, spec, [structure, data, training, pol])
  r.subject = { kind: 'workflow_version', id: version.id, version: version.content_hash }; r.created_at = nowIso(); return r
}

export function readinessOf(v: C.WorkflowVersion): C.Readiness {
  const rep = db.reports[v.id]; if (!rep || rep.content_hash !== v.content_hash || rep.status === 'error') return 'draft'
  const structOk = rep.layers.filter((l) => l.layer !== 'policy').every((l) => l.status !== 'error')
  if (!structOk) return 'draft'
  return policyFor(v).missing.length === 0 ? 'approved' : 'validated'
}
const meta = (v: C.WorkflowVersion): C.WorkflowVersionMeta => { const { spec: _s, ...m } = v; return { ...clone(m), readiness: readinessOf(v) } }

function checkSpecShape(spec: any) {
  if (!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.edges) || !spec.metadata) throw bad('SPEC_INVALID', 'WorkflowSpec invalide : nodes, edges et metadata requis.')
  const ids = new Set<string>(); for (const n of spec.nodes) { if (ids.has(n.id)) throw bad('SPEC_INVALID', `Identifiant de nœud en double : ${n.id}.`); ids.add(n.id) }
}
function newVersion(workflow_id: string, parent: string | null, spec: C.WorkflowSpec, origin: 'human' | 'ai', author: C.WorkflowVersion['author'], label?: string): C.WorkflowVersion {
  const v: C.WorkflowVersion = { id: uid('wfv'), workflow_id, parent_version_id: parent, content_hash: contentHash(spec), author, created_at: nowIso(), origin, readiness: 'draft', spec: clone(spec), label }
  db.versionsMeta.push(v); wf(workflow_id).latest_version_id = v.id; return v
}
export function createWorkflow(project_id: string, name: string, spec: C.WorkflowSpec, origin: 'human' | 'ai', author: C.WorkflowVersion['author']) {
  const w: C.Workflow = { id: uid('wf'), project_id, name, created_at: nowIso(), latest_version_id: '' }
  db.workflows.push(w); const v = newVersion(w.id, null, { ...spec, metadata: { ...spec.metadata, origin } }, origin, author); return { workflow: w, version: v }
}

function diff(a: C.WorkflowSpec, b: C.WorkflowSpec, against: string): C.WorkflowDiff {
  const am = new Map(a.nodes.map((n) => [n.id, n])), bm = new Map(b.nodes.map((n) => [n.id, n]))
  const changed: C.WorkflowDiff['nodes_changed'] = []
  const walk = (x: any, y: any, p: string, out: { path: string; before: unknown; after: unknown }[]) => {
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p ? `${p}.${k}` : k, out) }
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ path: p, before: x, after: y })
  }
  for (const [id, n] of bm) { const o = am.get(id); if (!o) continue; const ch: any[] = []; walk(o.params, n.params, 'params', ch); if (o.type !== n.type) ch.push({ path: 'type', before: o.type, after: n.type }); if (ch.length) changed.push({ id, changes: ch }) }
  const ae = new Set(a.edges.map((e) => e.id)), be = new Set(b.edges.map((e) => e.id))
  return { against, nodes_added: [...bm.keys()].filter((k) => !am.has(k)), nodes_removed: [...am.keys()].filter((k) => !bm.has(k)), nodes_changed: changed, edges_added: [...be].filter((k) => !ae.has(k)), edges_removed: [...ae].filter((k) => !be.has(k)) }
}

const TEMPLATES = [
  { id: 'quick_train', label: 'Entraînement rapide', description: 'Dataset → split → prétraitement recommandé → un modèle → comparaison.', params: ['dataset_version_id', 'target', 'model_id', 'primary_metric'] },
  { id: 'full_pipeline', label: 'Pipeline complet', description: 'Deux modèles + tuning, comparaison, test final, enregistrement.', params: ['dataset_version_id', 'target', 'primary_metric', 'model_name'] },
]

export function registerStudio() {
  route('GET', '/catalog/node-types', () => ({ catalog_version: CATALOG_VERSION, node_types: NODE_TYPES }))
  route('GET', '/catalog/templates', () => TEMPLATES)
  route('POST', '/workflows', ({ body }) => {
    const b = body; if (!db.projects.some((p) => p.id === b?.project_id)) throw notFound('Projet', b?.project_id)
    checkSpecShape(b.spec); if (!['human', 'ai'].includes(b.origin ?? 'human')) throw bad('VALIDATION', 'origin : human ou ai.')
    const { workflow, version } = createWorkflow(b.project_id, b.name || 'Nouveau workflow', b.spec, b.origin ?? 'human', b.origin === 'ai' ? { type: 'assistant', id: 'assistant' } : userActor)
    return { workflow_id: workflow.id, version_id: version.id, content_hash: version.content_hash }
  }, { status: 201 })
  route('GET', '/workflows', ({ query }) => db.workflows.filter((w) => !query.project_id || w.project_id === query.project_id).map((w) => { const lv = wfv(w.latest_version_id); return { ...clone(w), latest: meta(lv), versions_count: db.versionsMeta.filter((v) => v.workflow_id === w.id).length } }))
  route('GET', '/workflows/{workflow_id}', ({ params }) => ({ workflow: clone(wf(params.workflow_id)), versions: db.versionsMeta.filter((v) => v.workflow_id === params.workflow_id).map(meta).reverse() }))
  route('POST', '/workflows/{workflow_id}/versions', ({ params, body }) => {
    const w = wf(params.workflow_id); checkSpecShape(body?.spec)
    const parent = body?.parent_version_id ? wfv(body.parent_version_id) : null
    if (parent && parent.workflow_id !== w.id) throw bad('VALIDATION', 'La version parente appartient à un autre workflow.')
    const h = contentHash(body.spec); if (parent && parent.content_hash === h) return { version_id: parent.id, content_hash: h, unchanged: true }
    const v = newVersion(w.id, parent?.id ?? null, body.spec, 'human', userActor, body.label)
    return { version_id: v.id, content_hash: v.content_hash }
  }, { status: 201 })
  route('GET', '/workflows/{workflow_id}/versions/{version_id}', ({ params }) => { const v = wfv(params.version_id); if (v.workflow_id !== params.workflow_id) throw notFound('WorkflowVersion', params.version_id); return { ...clone(v), readiness: readinessOf(v) } })
  route('GET', '/workflows/{workflow_id}/versions/{version_id}/diff', ({ params, query }) => {
    const v = wfv(params.version_id); const against = wfv(query.against ?? v.parent_version_id ?? ''); return diff(against.spec, v.spec, against.id)
  })
  route('GET', '/workflows/{workflow_id}/versions/{version_id}/validation', ({ params }) => { const r = db.reports[params.version_id]; if (!r) throw notFound('ValidationReport', params.version_id); return clone(r) })
  route('POST', '/workflows/{workflow_id}/versions/{version_id}/validate', ({ params }) => {
    const v = wfv(params.version_id); if (v.workflow_id !== params.workflow_id) throw notFound('WorkflowVersion', params.version_id)
    const r = fullValidate(v); db.reports[v.id] = r; logAudit(projectOf(v.id), userActor, 'validation_run', v.id, { outcome: r.status === 'error' ? 'error' : 'ok' }); return clone(r)
  })
  route('POST', '/workflows/from-template', ({ body }) => {
    const b = body; const dsv = db.versions.find((v) => v.id === b?.dataset_version_id); if (!dsv) throw notFound('DatasetVersion', b?.dataset_version_id)
    const task: C.Task = b.task ?? taskFor(dsv.id, b.target); const pt = pipelineType(task)
    if (!b.target && pt.roles.some((r) => r.role === 'target' && r.required)) throw bad('VALIDATION', `target requis pour ${pt.label}.`)
    const metric = b.primary_metric && pt.metrics.includes(b.primary_metric) ? b.primary_metric : pt.default_metric
    if (!TEMPLATES.some((t) => t.id === b.template_id)) throw bad('TEMPLATE_UNKNOWN', `Gabarit inconnu : ${b.template_id}.`)
    let spec: C.WorkflowSpec
    if (task !== 'classification' && task !== 'regression') {
      // Autres types : gabarit du catalogue (rôles de colonnes, étapes et modèles adaptés au type).
      spec = buildTemplateSpec(task, dsv.id, dsv.schema, { target: b.target, metric, modelName: b.model_name, gateDL: db.catalogGateDL, full: b.template_id !== 'quick_train' })
      const t = spec.nodes.find((n) => n.type === 'train.model')
      if (b.template_id === 'quick_train' && t) { spec.nodes = spec.nodes.filter((n) => n.type !== 'train.model' || n.id === t.id); spec.edges = spec.edges.filter((e) => spec.nodes.some((n) => n.id === e.from.node) && spec.nodes.some((n) => n.id === e.to.node)); if (b.model_id) t.params = { model_id: b.model_id, params: b.params ?? {}, primary_metric: metric, seed: b.seed ?? 42 } }
    } else if (b.template_id === 'quick_train') {
      spec = baselineSpec(dsv.id, b.target); spec.metadata.task = task; spec.metadata.objective = { primary_metric: metric, direction: metric === 'rmse' || metric === 'mae' ? 'minimize' : 'maximize' }
      spec.nodes.find((n) => n.type === 'data.preprocess')!.params.steps = recommend(dsv.id, b.target).spec.steps
      const t = spec.nodes.find((n) => n.type === 'train.model')!; t.params = { model_id: b.model_id ?? 'random_forest', params: b.params ?? {}, primary_metric: metric, seed: b.seed ?? 42 }
    } else if (b.template_id === 'full_pipeline') { spec = fullPlanSpec(dsv.id, b.target, metric, undefined, 'human', task); spec.nodes.find((n) => n.type === 'data.preprocess')!.params.steps = recommend(dsv.id, b.target).spec.steps; const r = spec.nodes.find((n) => n.type === 'model.register'); if (r && b.model_name) r.params.name = b.model_name }
    else throw bad('TEMPLATE_UNKNOWN', `Gabarit inconnu : ${b.template_id}.`)
    spec.metadata.task = task
    const { workflow, version } = createWorkflow(dsv.project_id, b.name ?? `${TEMPLATES.find((t) => t.id === b.template_id)!.label} — ${b.target ?? pt.label}`, spec, 'human', userActor)
    return { workflow_id: workflow.id, version_id: version.id, content_hash: version.content_hash }
  }, { status: 201 })

  route('POST', '/approvals', ({ body }) => {
    const b = body; const v = wfv(b?.workflow_version_id); const project_id = projectOf(v.id); const mode = modeOf(project_id)
    const classes: C.OpClass[] = b.operation_classes ?? []; if (!classes.length) throw bad('VALIDATION', 'operation_classes requis.')
    if (!['explicit_click', 'chat_confirm'].includes(b.method)) throw bad('VALIDATION', 'method : explicit_click ou chat_confirm.')
    if (classes.includes('L3')) {
      if (b.method !== 'explicit_click') throw new ApiErr(403, 'L3_REQUIRES_CLICK', 'Une approbation L3 exige un clic explicite de l\'utilisateur.')
      if (!b.node_ids?.length) throw bad('VALIDATION', 'Une approbation L3 est individuelle : node_ids requis.')
    }
    if (classes.includes('L2') && mode === 'guided' && !b.node_ids?.length) throw bad('VALIDATION', 'Mode Guidé : une approbation par étape (node_ids requis).')
    let scope: C.Approval['scope'] = 'version'
    if (mode === 'auto' && classes.includes('L2') && !classes.includes('L3')) {
      if (!b.budget) throw bad('BUDGET_REQUIRED', 'Mode Auto : un budget (essais, durée, nombre de modèles) est requis.')
      const caps = RESOURCES.budget_caps; if (b.budget.trials > caps.trials || b.budget.max_minutes > caps.max_minutes || b.budget.models > caps.models) throw bad('BUDGET_EXCEEDED', 'Le budget dépasse les plafonds de GET /training/resources.', caps)
      scope = b.scope === 'version' ? 'version' : 'lineage'
    }
    const a: C.Approval = { id: uid('ap'), project_id, user_id: USER.id, workflow_version_id: v.id, content_hash: v.content_hash, scope, operation_classes: classes, node_ids: b.node_ids, budget: b.budget, mode, method: b.method, expires_at: ahead(60 * 24 * 7), status: 'active', created_at: nowIso() }
    db.approvals.push(a); logAudit(project_id, userActor, 'approval_created', a.id, { approval_id: a.id }); return { approval_id: a.id, approval: clone(a) }
  }, { status: 201 })
  route('GET', '/approvals', ({ query }) => clone(db.approvals.filter((a) => !query.workflow_version_id || a.workflow_version_id === query.workflow_version_id)))
  route('POST', '/approvals/{approval_id}/revoke', ({ params }) => {
    const a = db.approvals.find((x) => x.id === params.approval_id); if (!a) throw notFound('Approbation', params.approval_id)
    a.status = 'revoked'; logAudit(a.project_id, userActor, 'approval_revoked', a.id, { approval_id: a.id }); return clone(a)
  })

  route('POST', '/executions', ({ body }) => {
    const v = wfv(body?.workflow_version_id); const project_id = projectOf(v.id)
    const rep = fullValidate(v); db.reports[v.id] = rep
    if (rep.layers.some((l) => l.layer !== 'policy' && l.status === 'error')) throw new ApiErr(422, 'VALIDATION_FAILED', 'Le workflow comporte des erreurs de validation : exécution refusée.', rep)
    const ids: string[] = body?.approval_ids ?? []
    const unknown = ids.filter((i) => !db.approvals.some((a) => a.id === i)); if (unknown.length) throw notFound('Approbation', unknown[0])
    const mode = modeOf(project_id); const lin = lineageIds(v.id)
    const chosen = db.approvals.filter((a) => ids.includes(a.id) && a.project_id === project_id)
    const missing = missingRequirements(v.spec, mode, chosen, { contentHash: v.content_hash, inLineage: (a) => lin.has(a.workflow_version_id) })
    if (missing.length) { logAudit(project_id, userActor, 'execution_requested', v.id, { outcome: 'refused', reason: 'Approbations manquantes' }); throw new ApiErr(403, 'APPROVAL_REQUIRED', 'Approbations manquantes ou invalides pour ce content_hash.', { missing: missing.map((m) => ({ operation_class: m.operation_class, node_ids: m.node_ids, kind: m.kind })) }) }
    if (body?.reuse_from_execution_id && !db.executions.some((e) => e.id === body.reuse_from_execution_id)) throw notFound('Exécution', body.reuse_from_execution_id)
    const ex: C.Execution = { id: uid('ex'), workflow_id: v.workflow_id, workflow_version_id: v.id, approval_ids: ids, status: 'queued', reuse_from: body?.reuse_from_execution_id, created_at: nowIso(), requested_by: USER.id, node_runs: v.spec.nodes.map((n) => ({ node_id: n.id, attempt: 1, status: 'pending' as C.NodeStatus, cached: false })) }
    db.executions.unshift(ex); logAudit(project_id, userActor, 'execution_requested', ex.id)
    // Les approbations individuelles L3 sont consommées à l'utilisation.
    chosen.filter((a) => a.operation_classes.includes('L3')).forEach((a) => (a.status = 'expired'))
    startExecution(ex, v)
    return { execution_id: ex.id }
  }, { status: 202 })
  route('GET', '/executions', ({ query }) => db.executions.filter((e) => (!query.workflow_id || e.workflow_id === query.workflow_id) && (!query.project_id || wf(e.workflow_id).project_id === query.project_id)).map(clone))
  route('GET', '/executions/{execution_id}', ({ params }) => clone(db.executions.find((e) => e.id === params.execution_id) ?? (() => { throw notFound('Exécution', params.execution_id) })()))
  route('GET', '/executions/{execution_id}/events', ({ params, query }) => ({ events: eventsOf(params.execution_id).filter((e) => e.id > Number(query['last-event-id'] ?? 0)) }))
  route('POST', '/executions/{execution_id}/cancel', async ({ params }) => {
    const e = db.executions.find((x) => x.id === params.execution_id); if (!e) throw notFound('Exécution', params.execution_id)
    if (['succeeded', 'failed', 'cancelled'].includes(e.status)) throw new ApiErr(409, 'ALREADY_FINISHED', 'Exécution déjà terminée.')
    ;(e as any)._cancel = true
    for (const n of e.node_runs) if (n.status === 'running' && n.job_ref) await dispatch('POST', `/training/jobs/${n.job_ref}/cancel`, {}, {}, SERVICE_HEADERS)
    logAudit(wf(e.workflow_id).project_id, userActor, 'execution_cancel_requested', e.id); return clone(e)
  })

  route('POST', '/exports', ({ body }) => {
    const e = db.executions.find((x) => x.id === body?.execution_id); if (!e) throw notFound('Exécution', body?.execution_id)
    if (e.status !== 'succeeded') throw new ApiErr(409, 'EXECUTION_NOT_SUCCEEDED', 'Seule une exécution réussie peut être exportée.')
    const v = wfv(e.workflow_version_id), project_id = projectOf(v.id)
    if (body?.include_data) {
      const a = db.approvals.find((x) => x.id === body.approval_id)
      if (!a || a.status !== 'active' || !a.operation_classes.includes('L3') || a.workflow_version_id !== v.id || !a.node_ids?.includes('export')) throw new ApiErr(403, 'APPROVAL_REQUIRED', 'L\'inclusion de données dans un export exige une approbation L3 individuelle (node_ids = ["export"]).')
      a.status = 'expired'
    }
    const trains = v.spec.nodes.filter((n) => n.type.startsWith('train.'))
    const m: C.ExportManifest = { export_id: uid('exp'), workflow_version_id: v.id, content_hash: v.content_hash, execution_id: e.id, status: 'running',
      dataset_refs: v.spec.nodes.filter((n) => n.type === 'data.dataset').map((n) => n.params.dataset_version_id), split_refs: e.node_runs.flatMap((r) => r.result_refs ?? []).filter((r) => r.kind === 'split').map((r) => r.id),
      preprocess_spec: JSON.stringify(v.spec.nodes.find((n) => n.type === 'data.preprocess')?.params.steps ?? []), model_configs: trains.map((n) => ({ node: n.id, ...n.params })), seeds: [...new Set([...trains.map((n) => n.params.seed), v.spec.nodes.find((n) => n.type === 'data.split')?.params.seed])].filter((x) => x !== undefined) as number[],
      environment: ['python==3.11.9', 'scikit-learn==1.5.2', 'pandas==2.2.3', 'numpy==2.1.2', 'mlflow==2.17.0'],
      code: ['train.py', 'preprocess.py', 'requirements.lock', 'README.md'].map((p) => ({ path: p, sha256: cyrb53(p + v.content_hash) + cyrb53(p).slice(0, 8), template_id: p.endsWith('.py') ? 'tpl_sklearn_pipeline_v1' : 'tpl_static' })),
      artifacts: e.node_runs.flatMap((r) => r.result_refs ?? []).filter((r) => r.kind === 'run').map((r) => ({ ref: `run:${r.id}`, checksum: 'sha256:' + cyrb53(r.id).slice(0, 10) + '…', included: true })).concat(body?.include_data ? [{ ref: `dataset:${v.spec.nodes.find((n) => n.type === 'data.dataset')?.params.dataset_version_id}`, checksum: 'sha256:' + cyrb53('data').slice(0, 10) + '…', included: true }] : []),
      limitations: ['Les poids des modèles ne sont reproductibles à l\'identique que pour les modèles à déterminisme « exact ».', body?.include_data ? 'Les données sont incluses : vérifiez la confidentialité avant partage.' : 'Les données ne sont pas incluses : le rejeu exige l\'accès au dataset référencé.'], integrity: 'sha256:' + cyrb53(v.content_hash + e.id) }
    db.exports.unshift(m); logAudit(project_id, userActor, 'export_created', m.export_id)
    sleep(1500).then(() => { m.status = 'succeeded'; m.bundle_uri = `s3://exports/${m.export_id}.zip` })
    return { export_id: m.export_id }
  }, { status: 202 })
  route('GET', '/exports/{export_id}', ({ params }) => clone(db.exports.find((x) => x.export_id === params.export_id) ?? (() => { throw notFound('Export', params.export_id) })()))

  route('POST', '/registry/promotions', async ({ body }) => {
    const mv = db.registry.find((m) => m.id === body?.model_version_id); if (!mv) throw notFound('ModelVersion', body?.model_version_id)
    if (!['staging', 'production'].includes(body?.alias)) throw bad('VALIDATION', 'alias : staging ou production.')
    const a = db.approvals.find((x) => x.id === body?.approval_id)
    if (!a || a.status !== 'active' || !a.operation_classes.includes('L3') || !a.node_ids?.includes(`promote:${mv.id}`)) throw new ApiErr(403, 'APPROVAL_REQUIRED', 'La promotion exige une approbation L3 individuelle liée à cette version de modèle (node_ids = ["promote:<model_version_id>"]).')
    const run = db.runs.find((r) => r.id === mv.run_id)!
    const checks = { test_evaluated: !!run.test_evaluated, reproducible: !!run.execution_id || run.artifacts.length > 0 }
    if (!checks.test_evaluated) throw bad('TEST_NOT_EVALUATED', 'Promotion refusée : le run n\'a pas été évalué sur le jeu de test.')
    const id = uid('pr'); await dispatch('PUT', `/models/registry/${mv.id}/alias`, {}, { alias: body.alias, promotion_id: id }, SERVICE_HEADERS)
    a.status = 'expired'
    const rec: C.PromotionRecord = { id, model_version_id: mv.id, model_name: mv.name, alias: body.alias, approval_id: a.id, actor: USER.id, checks, created_at: nowIso() }
    db.promotions.unshift(rec); logAudit(a.project_id, userActor, 'model_promoted', mv.id, { approval_id: a.id }); return rec
  }, { status: 201 })
  route('GET', '/registry/promotions', ({ query }) => clone(db.promotions.filter((p) => !query.model_name || p.model_name === query.model_name)))
  void SERVICE_TOKEN; void NODE_TYPE_BY_ID; void subscribe
}
