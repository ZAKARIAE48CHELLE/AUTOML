import type { ColumnRole, DatasetColumn, PreprocessStep, Task, WorkflowEdge, WorkflowNode, WorkflowSpec } from './types'
import { CATALOG_VERSION, MODEL_CATALOG, metricDirection, pipelineType } from './catalog'

/* Outils partagés (mock, éditeur, import de code) pour construire un pipeline selon son type. */

export type Roles = Partial<Record<ColumnRole, string>>
const byName = (schema: DatasetColumn[], re: RegExp, dtypes?: string[]) => schema.find((c) => re.test(c.name) && (!dtypes || dtypes.includes(c.dtype)))?.name
const ofType = (schema: DatasetColumn[], dtypes: string[]) => schema.filter((c) => dtypes.includes(c.dtype))
/** Colonnes identifiants (valeurs uniques) : à exclure des variables explicatives. */
export const idColumns = (schema: DatasetColumn[]) => schema.filter((c) => /(^|_)id$/i.test(c.name) && ['string', 'int', 'category'].includes(c.dtype)).map((c) => c.name)

/** Devine les rôles de colonnes pour un type de pipeline (cible, temps, texte, image, utilisateur, article). */
export function guessRoles(schema: DatasetColumn[], task: Task, target?: string): Roles {
  const r: Roles = {}
  const cat = ['category', 'bool', 'string']
  const num = ['float', 'int']
  if (target && schema.some((c) => c.name === target)) r.target = target
  switch (task) {
    case 'classification':
      r.target ??= byName(schema, /^(churn|label|class|target|y|outcome)$|^is_/i, [...cat, 'int']) ?? [...schema].reverse().find((c) => ['category', 'bool'].includes(c.dtype))?.name; break
    case 'regression':
      r.target ??= byName(schema, /price|prix|amount|value|target|^y$/i, num) ?? [...schema].reverse().find((c) => c.dtype === 'float')?.name; break
    case 'anomaly_detection':
      r.target ??= byName(schema, /fraud|anomal|outlier|^is_|label/i, ['bool', 'int', 'category']); break
    case 'forecasting':
      r.time_column = byName(schema, /date|time|day|timestamp|period/i, ['datetime', 'int']) ?? ofType(schema, ['datetime'])[0]?.name
      r.target ??= byName(schema, /sales|ventes|demand|value|load|traffic|count|qty|quantity/i, num) ?? [...schema].reverse().find((c) => c.dtype === 'float' && c.name !== r.time_column)?.name; break
    case 'text_classification':
      r.text_column = ofType(schema, ['text'])[0]?.name ?? byName(schema, /text|review|comment|message|body|content/i, ['string'])
      r.target ??= byName(schema, /sentiment|label|class|category|topic|target/i, [...cat, 'int']) ?? schema.find((c) => c.dtype === 'category' && c.name !== r.text_column)?.name; break
    case 'image_classification':
      r.image_column = ofType(schema, ['image_path'])[0]?.name ?? byName(schema, /image|img|path|file/i, ['string'])
      r.target ??= byName(schema, /label|class|category|target/i, [...cat, 'int']) ?? schema.find((c) => c.dtype === 'category' && c.name !== r.image_column)?.name; break
    case 'recommendation':
      r.user_column = byName(schema, /user|client|customer/i)
      r.item_column = byName(schema, /item|product|movie|article|produit|song/i)
      r.target ??= byName(schema, /rating|note|score|stars|weight|count/i, num)
      r.time_column = byName(schema, /date|time|timestamp/i, ['datetime', 'int']); break
    case 'clustering':
      delete r.target; break
  }
  for (const k of Object.keys(r) as ColumnRole[]) if (!r[k]) delete r[k]
  return r
}

/**
 * Déduit le type de pipeline le plus probable pour un dataset (et une cible éventuelle).
 * Sert d'aide (assistant, avertissement de cohérence) — le type déclaré reste le choix de l'utilisateur.
 */
export function inferTask(schema: DatasetColumn[], target?: string): Task {
  if (ofType(schema, ['image_path']).length) return 'image_classification'
  if (ofType(schema, ['text']).length) return 'text_classification'
  if (byName(schema, /user|client/i) && byName(schema, /item|product|movie|article/i)) return 'recommendation'
  const col = schema.find((c) => c.name === target)
  if (!col) return 'clustering'
  if (col.dtype === 'float' && ofType(schema, ['datetime']).length) return 'forecasting'
  if (col.dtype === 'float' || (col.dtype === 'int' && !/^(is_|has_)|churn|label|class/i.test(col.name))) return 'regression'
  return 'classification'
}

/** Étapes de prétraitement par défaut du type de pipeline, résolues sur les colonnes du dataset. */
export function templateSteps(schema: DatasetColumn[], task: Task, roles: Roles): PreprocessStep[] {
  const pt = pipelineType(task)
  const roleCols = new Set(Object.values(roles))
  const ids = idColumns(schema).filter((c) => !roleCols.has(c))
  const features = schema.filter((c) => !roleCols.has(c.name) && !ids.includes(c.name))
  const steps: PreprocessStep[] = []
  if (ids.length && pt.step_types.includes('drop_columns')) steps.push({ type: 'drop_columns', columns: ids })
  for (const t of pt.template.steps) {
    if (t.type === 'min_interactions') { steps.push({ type: t.type, columns: [roles.user_column, roles.item_column].filter(Boolean) as string[] }); continue }
    const columns = t.role ? [roles[t.role]].filter(Boolean) as string[]
      : features.filter((c) => t.dtypes?.includes(c.dtype) && (!t.type.startsWith('impute') || c.nullable)).map((c) => c.name)
    if (columns.length) steps.push({ type: t.type, columns })
  }
  return steps
}

const N = (id: string, type: string, params: Record<string, unknown>, col: number, row = 0): WorkflowNode => ({ id, type, type_version: '1.0', params, ui: { x: col * 250, y: row * 150 } })
const E = (id: string, fn: string, fp: string, tn: string, tp: string): WorkflowEdge => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } })
const defaults = (props: Record<string, { default?: unknown }> = {}) => Object.fromEntries(Object.entries(props).filter(([, s]) => s.default !== undefined).map(([k, s]) => [k, s.default]))

export interface TemplateOptions { target?: string; metric?: string; origin?: 'human' | 'ai'; goal_id?: string; modelName?: string; gateDL?: boolean; full?: boolean }

/**
 * Pipeline complet et valide pour un type : dataset → split → prétraitement → modèles → comparaison → test final → enregistrement.
 * Les modèles du gabarit soumis à la porte G-DL sont écartés tant qu'elle est fermée.
 */
export function buildTemplateSpec(task: Task, dsvId: string, schema: DatasetColumn[], o: TemplateOptions = {}): WorkflowSpec {
  const pt = pipelineType(task)
  const roles = guessRoles(schema, task, o.target)
  const metric = o.metric && pt.metrics.includes(o.metric) ? o.metric : pt.default_metric
  const models = pt.template.models.filter((id) => o.gateDL || !MODEL_CATALOG.find((m) => m.id === id)?.deep_learning)
  if (!models.length) models.push(pt.template.models[0])
  const split: Record<string, unknown> = { strategy: pt.default_split, test_ratio: 0.2, cv_folds: task === 'image_classification' || task === 'forecasting' ? 3 : 5, seed: 42 }
  for (const [k, v] of Object.entries(roles)) split[k] = v
  const nodes: WorkflowNode[] = [
    N('n1', 'data.dataset', { dataset_version_id: dsvId }, 0),
    N('n2', 'data.split', split, 1),
    N('n3', 'data.preprocess', { steps: templateSteps(schema, task, roles) }, 2),
  ]
  const edges: WorkflowEdge[] = [E('e1', 'n1', 'dataset', 'n2', 'dataset'), E('e2', 'n2', 'split', 'n3', 'split')]
  const trainIds: string[] = []
  models.forEach((id, i) => {
    const m = MODEL_CATALOG.find((x) => x.id === id)
    const nid = `n${4 + i}`; trainIds.push(nid)
    nodes.push(N(nid, 'train.model', { model_id: id, params: defaults(m?.params_schema.properties as Record<string, { default?: unknown }>), primary_metric: metric, seed: 42 }, 3, i - (models.length - 1) / 2))
    edges.push(E(`e${edges.length + 1}`, 'n2', 'split', nid, 'split'), E(`e${edges.length + 2}`, 'n3', 'spec', nid, 'spec'))
  })
  const k = 4 + models.length
  nodes.push(N(`n${k}`, 'eval.compare', { min_succeeded: 1 }, 4))
  trainIds.forEach((t) => edges.push(E(`e${edges.length + 1}`, t, 'run', `n${k}`, 'runs')))
  if (o.full !== false) {
    nodes.push(N(`n${k + 1}`, 'eval.final_test', {}, 5), N(`n${k + 2}`, 'model.register', { name: o.modelName ?? `${task.replace(/_/g, '-')}-model` }, 6))
    edges.push(E(`e${edges.length + 1}`, `n${k}`, 'best', `n${k + 1}`, 'run'), E(`e${edges.length + 2}`, `n${k + 1}`, 'run', `n${k + 2}`, 'run'))
  }
  return {
    schema_version: '1.0', catalog_version: CATALOG_VERSION, nodes, edges,
    metadata: { task, target: roles.target, origin: o.origin ?? 'human', goal_id: o.goal_id, objective: { primary_metric: metric, direction: metricDirection(metric) }, task_options: defaults(pt.options_schema.properties as Record<string, { default?: unknown }>) },
  }
}

/** Type de pipeline évoqué par un objectif en langage naturel (FR/EN), sinon undefined. */
export function detectTaskFromText(text: string): Task | undefined {
  const t = text.toLowerCase()
  const rules: [Task, RegExp][] = [
    ['recommendation', /recommand|recommend|suggér|suggest|proposer des (articles|produits|films)/],
    ['image_classification', /\bimages?\b|photos?|vision|visuel|caméra|camera|pixels?/],
    ['text_classification', /\btextes?\b|avis|commentaires?|sentiment|e-?mails?|tickets?|\bnlp\b|reviews?|messages?/],
    ['forecasting', /prévi|prévoir|prevoir|forecast|série temporelle|serie temporelle|time series|semaines? prochaines?|mois prochains?|futur/],
    ['anomaly_detection', /anomal|fraud|outlier|atypique|intrusion|panne|aberrant/],
    ['clustering', /segment|cluster|regroup|groupes? (de|d')|typolog|profils? (de )?clients/],
    ['regression', /\bprix\b|montant|valeur numérique|régression|regression|estimer (le|la|un)/],
    ['classification', /classer|classification|catégori|churn|prédire si|predict whether/],
  ]
  return rules.find(([, re]) => re.test(t))?.[0]
}
