import type { ColumnRole, DatasetColumn, ModelSpec, PreprocessStep, Task, WorkflowNode, WorkflowSpec } from '@contracts/src'
import { MODEL_CATALOG, NODE_TYPE_BY_ID, PREPROCESS_STEP_BY_TYPE, guessRoles, idColumns, metricDirection, pipelineType } from '@contracts/src'

/* Logique pure de la palette : ajout de blocs, câblage automatique, changement de type de pipeline. */

export type Block = { kind: 'node'; type: string } | { kind: 'step'; type: string } | { kind: 'model'; model_id: string }
export const BLOCK_MIME = 'application/x-aistudio-block'

/** Étape (colonne) de chaque type de nœud dans la mise en page automatique. */
export const STAGE: Record<string, number> = { 'data.dataset': 0, 'data.split': 1, 'data.preprocess': 2, 'train.model': 3, 'train.tune': 3, 'eval.compare': 4, 'eval.final_test': 5, 'model.register': 6 }
/** Étapes qui portent sur une colonne de rôle plutôt que sur les variables explicatives. */
const STEP_ROLE: Record<string, ColumnRole[]> = {
  text_clean: ['text_column'], tfidf: ['text_column'], text_embed: ['text_column'],
  image_resize: ['image_column'], image_normalize: ['image_column'], image_augment: ['image_column'],
  lag_features: ['target'], rolling_features: ['target'], min_interactions: ['user_column', 'item_column'],
}

type Props = Record<string, { default?: unknown }>
const defaults = (props: Props = {}) => Object.fromEntries(Object.entries(props).filter(([, s]) => s.default !== undefined).map(([k, s]) => [k, s.default]))
const nextId = (prefix: string, list: { id: string }[]) => `${prefix}${Math.max(0, ...list.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1}`
const splitParams = (spec: WorkflowSpec): Record<string, any> => spec.nodes.find((n) => n.type === 'data.split')?.params ?? {}

/** Colonnes auxquelles appliquer une étape : colonne de rôle, sinon variables compatibles (hors rôles et identifiants). */
export function stepColumns(type: string, columns: DatasetColumn[], spec: WorkflowSpec): string[] {
  const roles = splitParams(spec)
  if (STEP_ROLE[type]) return STEP_ROLE[type].map((r) => roles[r]).filter(Boolean)
  if (type === 'date_features' && roles.time_column && columns.find((c) => c.name === roles.time_column)?.dtype === 'datetime') return [roles.time_column]
  const def = PREPROCESS_STEP_BY_TYPE[type]; if (!def) return []
  const roleCols = Object.values(roles).filter((v): v is string => typeof v === 'string')
  if (type === 'drop_columns') return idColumns(columns).filter((c) => !roleCols.includes(c))
  const taken = new Set([...roleCols, ...idColumns(columns)])
  return columns.filter((c) => !taken.has(c.name) && def.applies_to.includes(c.dtype) && (!type.startsWith('impute') || c.nullable)).map((c) => c.name)
}

/** Premier modèle utilisable (porte G-DL fermée) pour le type de pipeline. */
export function defaultModel(task: Task, models: (ModelSpec & { disabled?: boolean })[] = MODEL_CATALOG): ModelSpec | undefined {
  // La liste reçue peut dater de l'ancien type (requête par type) : repli sur le catalogue partagé.
  const list: (ModelSpec & { disabled?: boolean })[] = models.some((m) => m.task.includes(task)) ? models : MODEL_CATALOG
  return list.find((m) => m.task.includes(task) && !m.disabled && !m.deep_learning) ?? list.find((m) => m.task.includes(task))
}

function nodeParams(type: string, spec: WorkflowSpec, columns: DatasetColumn[], models?: ModelSpec[]): Record<string, unknown> {
  const pt = pipelineType(spec.metadata.task)
  const cur = spec.metadata.objective?.primary_metric
  const metric = cur && pt.metrics.includes(cur) ? cur : pt.default_metric
  const base = defaults(NODE_TYPE_BY_ID[type]?.params_schema.properties as Props)
  if (type === 'data.split') return { ...base, strategy: pt.default_split, test_ratio: 0.2, cv_folds: 5, seed: 42, ...guessRoles(columns, spec.metadata.task, spec.metadata.target) }
  if (type === 'data.preprocess') return { steps: [] }
  if (type === 'train.model' || type === 'train.tune') {
    const m = defaultModel(spec.metadata.task, models)
    const p: Record<string, unknown> = { ...base, model_id: m?.id, primary_metric: metric, seed: 42 }
    if (type === 'train.model') p.params = defaults(m?.params_schema.properties as Props)
    return p
  }
  if (type === 'model.register') return { name: `${spec.metadata.task.replace(/_/g, '-')}-model` }
  if (type === 'eval.compare') return { min_succeeded: 1 }
  return base
}

/**
 * Câble un nœud à ses voisins compatibles (mêmes types de ports) : entrées depuis l'amont le plus récent
 * (toutes les sources pour un port multiple), sorties vers les entrées libres en aval.
 */
export function autoWire(spec: WorkflowSpec, nodeId: string): WorkflowSpec {
  const node = spec.nodes.find((n) => n.id === nodeId); const nt = node && NODE_TYPE_BY_ID[node.type]
  if (!node || !nt) return spec
  const edges = [...spec.edges]
  const has = (f: string, fp: string, t: string, tp: string) => edges.some((e) => e.from.node === f && e.from.port === fp && e.to.node === t && e.to.port === tp)
  const add = (f: string, fp: string, t: string, tp: string) => { if (!has(f, fp, t, tp)) edges.push({ id: nextId('e', edges), from: { node: f, port: fp }, to: { node: t, port: tp } }) }
  const stage = STAGE[node.type] ?? 9
  const num = (id: string) => Number(id.replace(/\D/g, '')) || 0
  for (const ip of nt.input_ports) {
    if (!ip.multiple && edges.some((e) => e.to.node === node.id && e.to.port === ip.name)) continue
    const sources = spec.nodes.filter((n) => n.id !== node.id && (STAGE[n.type] ?? 9) < stage)
      .flatMap((n) => (NODE_TYPE_BY_ID[n.type]?.output_ports ?? []).filter((op) => op.type === ip.type).map((op) => ({ n, op })))
      .sort((a, b) => num(b.n.id) - num(a.n.id) || (a.op.name === 'best' ? -1 : 1))
    for (const s of ip.multiple ? sources : sources.slice(0, 1)) add(s.n.id, s.op.name, node.id, ip.name)
  }
  for (const op of nt.output_ports) {
    for (const n of spec.nodes.filter((x) => x.id !== node.id && (STAGE[x.type] ?? 9) > stage)) {
      for (const ip of (NODE_TYPE_BY_ID[n.type]?.input_ports ?? []).filter((p) => p.type === op.type)) {
        const busy = edges.some((e) => e.to.node === n.id && e.to.port === ip.name)
        if (!busy || ip.multiple) add(node.id, op.name, n.id, ip.name)
      }
    }
  }
  return { ...spec, edges }
}

export interface AddResult { spec: WorkflowSpec; nodeId?: string; message?: string }

/** Ajoute un bloc de la palette au pipeline (nœud, étape de prétraitement ou modèle préréglé). */
export function addBlock(spec: WorkflowSpec, block: Block, ctx: { columns: DatasetColumn[]; models?: (ModelSpec & { disabled?: boolean })[]; pos?: { x: number; y: number }; wire: boolean }): AddResult {
  const placeAt = (type: string, s: WorkflowSpec) => {
    if (ctx.pos) return { x: Math.round(ctx.pos.x), y: Math.round(ctx.pos.y) }
    const col = STAGE[type] ?? 3; const same = s.nodes.filter((n) => (STAGE[n.type] ?? 3) === col)
    return { x: col * 250, y: same.length ? Math.max(...same.map((n) => n.ui?.y ?? 0)) + 150 : 0 }
  }
  const create = (s: WorkflowSpec, type: string, params: Record<string, unknown>): AddResult => {
    const t = NODE_TYPE_BY_ID[type]; if (!t) return { spec: s }
    if (type === 'data.dataset' && s.nodes.some((n) => n.type === 'data.dataset')) return { spec: s, message: 'Un seul dataset par workflow.' }
    const id = nextId('n', s.nodes)
    const node: WorkflowNode = { id, type, type_version: t.version, params, ui: placeAt(type, s) }
    let next: WorkflowSpec = { ...s, nodes: [...s.nodes, node] }
    if (ctx.wire) next = autoWire(next, id)
    return { spec: next, nodeId: id }
  }
  if (block.kind === 'node') return create(spec, block.type, nodeParams(block.type, spec, ctx.columns, ctx.models))
  if (block.kind === 'model') {
    const m = (ctx.models ?? MODEL_CATALOG).find((x) => x.id === block.model_id) as (ModelSpec & { disabled?: boolean }) | undefined
    if (m?.disabled) return { spec, message: `${m.label} : fermé tant que la porte G-DL n'est pas validée.` }
    const p = nodeParams('train.model', spec, ctx.columns, ctx.models)
    return create(spec, 'train.model', { ...p, model_id: block.model_id, params: defaults(m?.params_schema.properties as Props) })
  }
  // Étape : ajoutée au nœud de prétraitement (créé au besoin).
  let s = spec; let pre = s.nodes.find((n) => n.type === 'data.preprocess')
  if (!pre) { const r = create(s, 'data.preprocess', { steps: [] }); s = r.spec; pre = s.nodes.find((n) => n.id === r.nodeId) }
  if (!pre) return { spec }
  const step: PreprocessStep = { type: block.type, columns: stepColumns(block.type, ctx.columns, s) }
  const params = defaults(PREPROCESS_STEP_BY_TYPE[block.type]?.params_schema.properties as Props)
  if (Object.keys(params).length) step.params = params
  const preId = pre.id
  return { spec: { ...s, nodes: s.nodes.map((n) => (n.id === preId ? { ...n, params: { ...n.params, steps: [...(n.params.steps ?? []), step] } } : n)) }, nodeId: preId }
}

/**
 * Change le type de pipeline : métrique et options par défaut, stratégie et rôles du split, modèles et métriques
 * des entraînements, étapes non adaptées retirées. Renvoie aussi un résumé des ajustements.
 */
export function changeTask(spec: WorkflowSpec, task: Task, columns: DatasetColumn[], models?: (ModelSpec & { disabled?: boolean })[]): { spec: WorkflowSpec; changes: string[] } {
  const pt = pipelineType(task); const changes: string[] = []
  const cur = spec.metadata.objective?.primary_metric
  const metric = cur && pt.metrics.includes(cur) ? cur : pt.default_metric
  const roles = guessRoles(columns, task, spec.metadata.target)
  const roleKeys = new Set<string>(pt.roles.map((r) => r.role))
  const nodes = spec.nodes.map((n) => {
    const p: Record<string, any> = { ...n.params }
    if (n.type === 'data.split') {
      if (!pt.split_strategies.includes(p.strategy)) { p.strategy = pt.default_split; changes.push(`stratégie de split → ${pt.default_split}`) }
      for (const k of ['target', 'text_column', 'image_column', 'user_column', 'item_column']) if (p[k] && !roleKeys.has(k)) delete p[k]
      if (p.time_column && !roleKeys.has('time_column') && p.strategy !== 'time') delete p.time_column
      for (const r of pt.roles) if (!p[r.role] && roles[r.role]) p[r.role] = roles[r.role]
    }
    if (n.type === 'data.preprocess') {
      const all: PreprocessStep[] = p.steps ?? []
      const kept = all.filter((s) => pt.step_types.includes(s.type))
      if (kept.length !== all.length) changes.push(`${all.length - kept.length} étape(s) non adaptée(s) retirée(s)`)
      p.steps = kept
    }
    if (n.type === 'train.model' || n.type === 'train.tune') {
      if (!pt.metrics.includes(p.primary_metric)) p.primary_metric = metric
      const m = MODEL_CATALOG.find((x) => x.id === p.model_id)
      if (!m || !m.task.includes(task)) {
        const d = defaultModel(task, models); p.model_id = d?.id
        if (n.type === 'train.model') p.params = defaults(d?.params_schema.properties as Props)
        changes.push(`${n.id} : modèle → ${d?.label ?? '—'}`)
      }
    }
    return { ...n, params: p }
  })
  const target = pt.roles.some((r) => r.role === 'target') ? (nodes.find((n) => n.type === 'data.split')?.params.target ?? roles.target) : undefined
  const options = { ...defaults(pt.options_schema.properties as Props), ...(spec.metadata.task === task ? spec.metadata.task_options : {}) }
  return { spec: { ...spec, nodes, metadata: { ...spec.metadata, task, target, objective: { primary_metric: metric, direction: metricDirection(metric) }, task_options: options } }, changes }
}

/** Étapes du parcours guidé et leur état dans le pipeline courant. */
export function checklist(spec: WorkflowSpec): { type: string; label: string; done: boolean }[] {
  const has = (t: string) => spec.nodes.some((n) => n.type === t)
  return [
    { type: 'data.dataset', label: 'Dataset', done: has('data.dataset') },
    { type: 'data.split', label: 'Découpage', done: has('data.split') },
    { type: 'data.preprocess', label: 'Prétraitement', done: spec.nodes.some((n) => n.type === 'data.preprocess' && (n.params.steps ?? []).length > 0) },
    { type: 'train.model', label: 'Modèle(s)', done: has('train.model') || has('train.tune') },
    { type: 'eval.compare', label: 'Comparaison', done: has('eval.compare') },
    { type: 'eval.final_test', label: 'Test final', done: has('eval.final_test') },
    { type: 'model.register', label: 'Enregistrement', done: has('model.register') },
  ]
}
