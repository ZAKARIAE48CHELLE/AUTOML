import type { Approval, BudgetSpec, Mode, OpClass, ValidationIssue, ValidationLayer, WorkflowSpec } from './types'
import { NODE_TYPE_BY_ID } from './catalog'
import { layerStatus } from './validator'

/** Réplique minimale de packages/policy (E3). À remplacer par la bibliothèque réelle ; le contrat est : (spec, mode) → exigences. */
export interface Requirement { operation_class: OpClass; node_ids: string[]; individual: boolean; kind: 'plan' | 'step' | 'individual' | 'click' }

export function classOf(nodeType: string): OpClass { return NODE_TYPE_BY_ID[nodeType]?.operation_class ?? 'L0' }

export function requirements(spec: WorkflowSpec, mode: Mode): Requirement[] {
  const ids = (c: OpClass) => spec.nodes.filter((n) => classOf(n.type) === c).map((n) => n.id)
  const out: Requirement[] = []
  const l2 = ids('L2'), l3 = ids('L3')
  if (l2.length) {
    if (mode === 'auto') out.push({ operation_class: 'L2', node_ids: l2, individual: false, kind: 'plan' })
    else if (mode === 'guided') l2.forEach((id) => out.push({ operation_class: 'L2', node_ids: [id], individual: true, kind: 'step' }))
    else out.push({ operation_class: 'L2', node_ids: l2, individual: false, kind: 'click' })
  }
  l3.forEach((id) => out.push({ operation_class: 'L3', node_ids: [id], individual: true, kind: 'individual' }))
  return out
}

export interface SatisfyCtx { contentHash: string; spec: WorkflowSpec; /** vrai si la version de l'approbation est la version exécutée ou l'un de ses ancêtres */ inLineage: (a: Approval) => boolean; now?: number }

/** Besoins de budget d'un workflow (somme des nœuds L2). */
export function budgetNeeds(spec: WorkflowSpec): BudgetSpec {
  const tune = spec.nodes.filter((n) => n.type === 'train.tune')
  return { trials: tune.reduce((a, n) => a + (n.params?.budget?.trials ?? 0), 0), max_minutes: tune.reduce((a, n) => a + (n.params?.budget?.max_minutes ?? 0), 0), models: spec.nodes.filter((n) => n.type.startsWith('train.')).length }
}
export const withinBudget = (need: BudgetSpec, b?: BudgetSpec) => !!b && need.trials <= b.trials && need.max_minutes <= b.max_minutes && need.models <= b.models

/** Une exigence est satisfaite par une approbation active, non expirée, de la bonne classe ; liée au content_hash, ou à la lignée (mode Auto, jamais L3) dans le budget. */
export function satisfies(a: Approval, r: Requirement, c: SatisfyCtx): boolean {
  if (a.status !== 'active' || new Date(a.expires_at).getTime() < (c.now ?? Date.now())) return false
  if (!a.operation_classes.includes(r.operation_class)) return false
  const exact = a.content_hash === c.contentHash
  if (!exact) {
    if (!(a.scope === 'lineage' && r.operation_class !== 'L3' && c.inLineage(a))) return false
  }
  if (r.kind === 'plan') return withinBudget(budgetNeeds(c.spec), a.budget)
  if (r.kind === 'step' || r.kind === 'individual') return !!a.node_ids && r.node_ids.every((id) => a.node_ids!.includes(id))
  return true
}

export function missingRequirements(spec: WorkflowSpec, mode: Mode, approvals: Approval[], c: Omit<SatisfyCtx, 'spec'>): Requirement[] {
  return requirements(spec, mode).filter((r) => r.kind !== 'click' && !approvals.some((a) => satisfies(a, r, { ...c, spec })))
}

/** Couche « policy » du ValidationReport : opérations autorisées dans le mode, approbations manquantes. */
export function policyLayer(spec: WorkflowSpec, mode: Mode, approvals: Approval[], c: Omit<SatisfyCtx, 'spec'>): ValidationLayer {
  const issues: ValidationIssue[] = []
  for (const r of missingRequirements(spec, mode, approvals, c)) {
    issues.push({ code: 'P_APPROVAL', severity: 'warning', node_id: r.node_ids.length === 1 ? r.node_ids[0] : undefined,
      message: r.kind === 'plan' ? 'Approbation de plan (avec budget) requise pour les étapes coûteuses.' : r.kind === 'individual' ? 'Approbation individuelle explicite requise (action engageante).' : 'Approbation requise pour cette étape.',
      hint: 'Approuvez cette version dans le mode revue avant de lancer l\'exécution.' })
  }
  if (mode === 'expert') issues.push({ code: 'P_EXPERT', severity: 'info', message: 'Mode Expert : le clic « Lancer » vaut approbation des étapes L2 (journalisé).' })
  return { layer: 'policy', status: layerStatus(issues), issues }
}
