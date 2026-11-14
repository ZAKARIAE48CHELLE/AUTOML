import type { DatasetColumn, ModelSpec, WorkflowSpec } from '@contracts/src'
import { MODEL_CATALOG, NODE_TYPE_BY_ID, PREPROCESS_STEP_BY_TYPE, guessRoles, pipelineType, templateSteps } from '@contracts/src'
import { STAGE, checklist, defaultModel, type Block } from './blocks'

/* Recommandations du menu contextuel (clic droit) : quels blocs ajouter ensuite, selon le pipeline courant,
 * son type et les colonnes du dataset. Logique pure, testée dans recommend.test.ts. */

export interface Recommendation {
  key: string; block: Block; label: string; reason: string
  /** Prochaine étape manquante du parcours (mise en avant). */
  next?: boolean
}

type Models = (ModelSpec & { disabled?: boolean })[]
const MAX = 7
/** Étape du parcours où se range une recommandation (pour filtrer « après ce bloc »). */
const stageOf = (b: Block) => (b.kind === 'step' ? STAGE['data.preprocess'] : b.kind === 'model' ? STAGE['train.model'] : STAGE[b.type] ?? 9)
/** Étape du parcours satisfaite par un bloc (pour marquer la prochaine étape). */
const checklistType = (b: Block) => (b.kind === 'step' ? 'data.preprocess' : b.kind === 'model' ? 'train.model' : b.type)

export function recommend(spec: WorkflowSpec, ctx: { columns: DatasetColumn[]; models?: Models; nodeId?: string }): Recommendation[] {
  const task = spec.metadata.task; const pt = pipelineType(task)
  const has = (t: string) => spec.nodes.some((n) => n.type === t)
  const nodeLabel = (t: string) => NODE_TYPE_BY_ID[t]?.label ?? t
  const catalog: Models = ctx.models?.some((m) => m.task.includes(task)) ? ctx.models : MODEL_CATALOG
  const usable = catalog.filter((m) => m.task.includes(task) && !m.disabled)
  const trained = spec.nodes.filter((n) => n.type === 'train.model' || n.type === 'train.tune')
  const usedModels = new Set(trained.map((n) => n.params.model_id as string))
  const pre = spec.nodes.find((n) => n.type === 'data.preprocess')
  const presentSteps = new Set(((pre?.params.steps ?? []) as { type: string }[]).map((s) => s.type))
  const split = spec.nodes.find((n) => n.type === 'data.split')?.params ?? {}
  const out: Recommendation[] = []
  const node = (type: string, reason: string) => out.push({ key: type, block: { kind: 'node', type }, label: nodeLabel(type), reason })
  const model = (m: ModelSpec, reason: string) => out.push({ key: `model:${m.id}`, block: { kind: 'model', model_id: m.id }, label: m.label, reason })

  if (!has('data.dataset')) node('data.dataset', 'Point de départ : la version de dataset à utiliser.')
  if (!has('data.split')) node('data.split', `Sépare entraînement et test (stratégie « ${pt.default_split} »), sans fuite de données.`)

  // Étapes de prétraitement du gabarit, résolues sur les vraies colonnes ; sans dataset, celles du gabarit seul.
  const roles = { ...guessRoles(ctx.columns, task, spec.metadata.target), ...Object.fromEntries(Object.entries(split).filter(([, v]) => typeof v === 'string')) }
  const steps = ctx.columns.length
    ? templateSteps(ctx.columns, task, roles).map((s) => ({ type: s.type, columns: s.columns ?? [] }))
    : pt.template.steps.map((s) => ({ type: s.type, columns: [] as string[] }))
  for (const s of steps.filter((x) => !presentSteps.has(x.type) && pt.step_types.includes(x.type)).slice(0, 3)) {
    const def = PREPROCESS_STEP_BY_TYPE[s.type]; if (!def || def.deep_learning) continue
    const cols = s.columns.length ? ` · ${s.columns.slice(0, 3).join(', ')}${s.columns.length > 3 ? '…' : ''}` : ''
    out.push({ key: `step:${s.type}`, block: { kind: 'step', type: s.type }, label: def.label, reason: `Recommandé pour ${pt.label}${cols}` })
  }

  // Modèles : un modèle de référence, puis d'autres familles pour comparer.
  if (!trained.length) {
    const first = defaultModel(task, catalog)
    if (first && !first.deep_learning) model(first, `Modèle de référence pour ${pt.label}.`)
    for (const id of pt.template.models) {
      const m = usable.find((x) => x.id === id && x.id !== first?.id && !x.deep_learning)
      if (m && out.filter((r) => r.block.kind === 'model').length < 2) model(m, `Deuxième candidat (${m.family}) pour comparer.`)
    }
  } else {
    const families = new Set(catalog.filter((m) => usedModels.has(m.id)).map((m) => m.family))
    const other = usable.filter((m) => !usedModels.has(m.id) && !m.deep_learning).sort((a, b) => Number(families.has(a.family)) - Number(families.has(b.family)))
    for (const m of other.slice(0, trained.length >= 3 ? 1 : 2)) model(m, families.has(m.family) ? 'Une variante de plus à comparer.' : `Autre famille (${m.family}) : la comparaison sera plus parlante.`)
    if (!has('train.tune')) { const lbl = catalog.find((m) => m.id === trained[0].params.model_id)?.label; node('train.tune', `Optimise les hyperparamètres${lbl ? ` de ${lbl}` : ''}.`) }
  }

  if (trained.length && !has('eval.compare')) node('eval.compare', trained.length >= 2 ? `Choisit le meilleur des ${trained.length} modèles.` : 'Désigne le meilleur modèle (ajoutez-en un 2e pour vraiment comparer).')
  if (has('eval.compare') && !has('eval.final_test')) node('eval.final_test', 'Mesure le modèle retenu sur le jeu de test, une seule fois.')
  if (has('eval.final_test') && !has('model.register')) node('model.register', 'Publie le modèle validé dans le registre.')

  // Prochaine étape manquante du parcours guidé : première recommandation qui la satisfait.
  const nextType = checklist(spec).find((s) => !s.done)?.type
  const first = out.find((r) => checklistType(r.block) === nextType); if (first) first.next = true

  // Clic droit sur un bloc : uniquement ce qui vient après lui.
  const at = ctx.nodeId ? spec.nodes.find((n) => n.id === ctx.nodeId) : undefined
  const scoped = at ? out.filter((r) => stageOf(r.block) >= (STAGE[at.type] ?? 9) && !(r.block.kind === 'node' && r.block.type === at.type)) : out
  return [...scoped.filter((r) => r.next), ...scoped.filter((r) => !r.next)].slice(0, MAX)
}
