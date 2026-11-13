import type * as C from '@contracts/src'
import { POLICY, requirements } from '@contracts/src'
import { db, logAudit, USER } from '../db'
import { route } from '../router'
import { notFound, bad, uid, nowIso, jitter, clone } from '../util'
import { recommend } from './data'
import { taskFor } from './training'
import { createWorkflow, fullValidate, modeOf } from './studio'
import { fullPlanSpec } from '../specs'
import { buildTemplateSpec, detectTaskFromText, guessRoles, inferTask, pipelineType } from '@contracts/src'
import { MINIMIZE } from '../ml'

const AI = { type: 'assistant' as const, id: 'assistant' }
const evProfile = (dsv: string, col: string, summary: string): C.EvidenceRef => ({ source_type: 'profile', source_id: `${dsv}#${col}`, summary })

function parseGoal(text: string, dsvId: string): { goal: C.GoalSpec; questions: string[]; warnings: string[] } {
  const v = db.versions.find((x) => x.id === dsvId); if (!v) throw notFound('DatasetVersion', dsvId)
  const lower = text.toLowerCase(); const questions: string[] = [], warnings: string[] = [], ambiguities: string[] = []
  let col = v.schema.find((c) => lower.includes(c.name.toLowerCase()))
  // Type de pipeline : d'abord l'intention exprimée, sinon la forme du dataset.
  const task: C.Task = detectTaskFromText(lower) ?? taskFor(v.id, col?.name ?? guessRoles(v.schema, inferTask(v.schema)).target)
  const pt = pipelineType(task); const needsTarget = pt.roles.some((r) => r.role === 'target' && r.required)
  if (!col && pt.roles.some((r) => r.role === 'target')) {
    const guessed = guessRoles(v.schema, task).target; col = v.schema.find((c) => c.name === guessed)
    if (col) { ambiguities.push(`Cible non précisée : « ${col.name} » supposée.`); questions.push(`La cible est-elle bien « ${col.name} » ?`) }
    else if (needsTarget) { col = v.schema[v.schema.length - 1]; ambiguities.push(`Cible non précisée : « ${col.name} » supposée (dernière colonne).`); questions.push(`La cible est-elle bien « ${col.name} » ?`) }
  }
  if (task === 'clustering') col = undefined
  let metric = pt.default_metric
  const want = (m: string, re: RegExp) => { if (re.test(lower) && pt.metrics.includes(m)) metric = m }
  want('accuracy', /accuracy|exactitude|précision globale/); want('roc_auc', /auc/); want('mae', /\bmae\b/); want('rmse', /rmse/); want('mape', /mape/); want('ndcg_at_k', /ndcg/); want('silhouette', /silhouette/)
  if (metric === 'accuracy' && task === 'classification') warnings.push('accuracy peut être trompeuse si les classes sont déséquilibrées.')
  const constraints: string[] = []; const mm = lower.match(/(\d+)\s*min/); if (mm) constraints.push(`durée de tuning ≤ ${mm[1]} min`)
  if (task === 'classification') { const prof = db.profiles[v.id]; const t = prof?.columns.find((c) => c.name === col!.name); const yes = t?.top?.[1]; if (yes && yes.count / v.rows < 0.35) warnings.push(`Classes déséquilibrées (minoritaire ≈ ${Math.round((yes.count / v.rows) * 100)} %) : ${metric} retenue.`) }
  if (!db.profiles[v.id]) questions.push('Aucun profil n\'est disponible : lancer le profilage améliorerait le plan.')
  const goal: C.GoalSpec = { id: uid('goal'), task, target: col?.name, objective: { primary_metric: metric, direction: MINIMIZE.has(metric) ? 'minimize' : 'maximize' }, constraints, ambiguities }
  db.goals.push(goal); return { goal, questions, warnings }
}

function nodeRationale(spec: C.WorkflowSpec, goal: C.GoalSpec, dsv: C.DatasetVersion): Record<string, string> {
  const r: Record<string, string> = {}
  for (const n of spec.nodes) {
    if (n.type === 'data.split') r[n.id] = `Split ${n.params.strategy} avec ${n.params.cv_folds} plis ; le jeu de test (${Math.round(n.params.test_ratio * 100)} %) est réservé à l'évaluation finale.`
    if (n.type === 'data.preprocess') r[n.id] = `Étapes déduites de règles déterministes sur le profil : ${(n.params.steps ?? []).map((s: any) => `${s.type}(${(s.columns ?? []).join(', ')})`).join(' ; ') || 'aucune'}.`
    if (n.type === 'train.model') r[n.id] = n.params.model_id === 'logistic_regression' || n.params.model_id === 'ridge' ? 'Référence linéaire simple : mesure le gain réel des modèles non linéaires.' : 'Modèle d\'arbres robuste aux variables mixtes, peu de réglages.'
    if (n.type === 'train.tune') r[n.id] = `Optimisation bornée (${n.params.budget.trials} essais, ${n.params.budget.max_minutes} min) respectant les plafonds.`
    if (n.type === 'eval.compare') r[n.id] = `Sélection sur la validation croisée (${goal.objective.primary_metric}), jamais sur le test.`
    if (n.type === 'eval.final_test') r[n.id] = 'Test final unique sur le meilleur modèle : approbation individuelle de l\'utilisateur requise.'
    if (n.type === 'model.register') r[n.id] = 'Enregistrement du modèle retenu avec son préprocesseur ajusté.'
  }
  void dsv; return r
}

export function registerAssistant() {
  route('POST', '/assistant/messages', async ({ body }) => {
    const b = body; if (!b?.message?.trim()) throw bad('VALIDATION', 'message requis.')
    await jitter(500, 900)
    const text: string = b.message, lower = text.toLowerCase(); const pid = b.project_id
    const dsvId: string | undefined = b.context_refs?.find((r: string) => r.startsWith('dsv_')) ?? db.versions.find((v) => v.project_id === pid)?.id
    const um: C.ChatMessage = { id: uid('m'), role: 'user', text, ts: nowIso() }
    let reply: C.ChatMessage
    if (/test final|promouv|lance|exécute|entraîne maintenant|supprime/.test(lower)) {
      reply = { id: uid('m'), role: 'assistant', ts: nowIso(), simulated: true, text: 'Je ne peux pas lancer cette action moi-même : l\'entraînement, le test final et la promotion passent par une exécution que vous approuvez dans le Studio (le test final et la promotion exigent une approbation individuelle). Je peux en revanche préparer un plan que vous relirez.', proposed_actions: [{ kind: 'create_proposal', label: 'Préparer un plan', ref: parseGoal(text, dsvId ?? 'dsv_telecom_1').goal.id }] }
      logAudit(pid, AI, 'tool_refused', 'chat', { outcome: 'refused', reason: 'Action L2/L3 demandée par chat : approbation humaine dans le Studio requise.' })
    } else if (/profil|manquant|qualité|colonne|déséquilibr/.test(lower) && dsvId && db.profiles[dsvId]) {
      const p = db.profiles[dsvId]; const miss = p.columns.filter((c) => c.missing_pct > 0)
      reply = { id: uid('m'), role: 'assistant', ts: nowIso(), simulated: true, text: `Le dataset compte ${p.rows.toLocaleString('fr-FR')} lignes et ${p.columns.length} colonnes. ${miss.length ? `Valeurs manquantes : ${miss.map((c) => `${c.name} (${c.missing_pct} %)`).join(', ')}.` : 'Aucune valeur manquante.'} ${p.alerts.filter((a) => a.severity === 'warning').map((a) => a.message).join(' ')}`, evidence_refs: [{ source_type: 'profile', source_id: dsvId, summary: `${p.columns.length} colonnes, ${p.alerts.length} alertes` }, ...miss.map((c) => evProfile(dsvId, c.name, `${c.name} : ${c.missing_pct} % manquants`))] }
    } else if (/plan|workflow|pipeline|prédi|predi|modèle|classif|régress|objectif/.test(lower)) {
      const g = parseGoal(text, dsvId ?? 'dsv_telecom_1')
      reply = { id: uid('m'), role: 'assistant', ts: nowIso(), simulated: true, text: `J'ai structuré votre objectif : prédire « ${g.goal.target} » (${g.goal.task}), métrique ${g.goal.objective.primary_metric}. ${g.goal.ambiguities.join(' ')} Voulez-vous que je prépare un plan de workflow ? Il sera créé comme une version à relire — rien ne sera exécuté sans votre approbation.`, evidence_refs: g.warnings.map((w) => ({ source_type: 'rule' as const, source_id: 'goal', summary: w })), proposed_actions: [{ kind: 'create_proposal', label: 'Préparer le plan', ref: g.goal.id }] }
    } else {
      reply = { id: uid('m'), role: 'assistant', ts: nowIso(), simulated: true, text: 'Je peux décrire la qualité de vos données, structurer un objectif de prédiction, préparer un plan de workflow à relire ou expliquer un résultat vérifié. Que souhaitez-vous faire ?' }
    }
    ;(db.chats[pid] ||= []).push(um, reply); return { user_message: um, reply }
  })
  route('GET', '/assistant/messages', ({ query }) => clone(db.chats[query.project_id] ?? []))
  route('POST', '/assistant/goals/parse', async ({ body }) => { await jitter(400, 800); if (!body?.text?.trim()) throw bad('VALIDATION', 'texte requis.'); return { ...parseGoal(body.text, body.dataset_version_id), simulated: true } })
  route('POST', '/assistant/proposals', async ({ body }) => {
    const goal = db.goals.find((g) => g.id === body?.goal_id); if (!goal) throw notFound('GoalSpec', body?.goal_id)
    await jitter(900, 1500)
    const dsvId: string = body.dataset_version_id ?? body.profile_ref ?? db.versions.find((v) => v.schema.some((c) => c.name === goal.target))?.id
    const dsv = db.versions.find((v) => v.id === dsvId); if (!dsv) throw notFound('DatasetVersion', dsvId)
    const tabular = goal.task === 'classification' || goal.task === 'regression'
    const spec = tabular ? fullPlanSpec(dsv.id, goal.target!, goal.objective.primary_metric, goal.id, 'ai', goal.task as 'classification' | 'regression')
      : buildTemplateSpec(goal.task, dsv.id, dsv.schema, { target: goal.target, metric: goal.objective.primary_metric, origin: 'ai', goal_id: goal.id, gateDL: db.catalogGateDL })
    const rec = recommend(dsv.id, goal.target, goal.task); spec.nodes.find((n) => n.type === 'data.preprocess')!.params.steps = rec.spec.steps
    if (goal.task === 'regression') { const t = spec.nodes.find((n) => n.id === 'n4'); if (t) t.params.model_id = 'ridge' }
    const budgetMin = goal.constraints.map((c) => c.match(/(\d+)\s*min/)?.[1]).find(Boolean); const tune = spec.nodes.find((n) => n.type === 'train.tune'); if (budgetMin && tune) tune.params.budget.max_minutes = Math.min(60, Number(budgetMin))
    const { workflow, version } = createWorkflow(dsv.project_id, `Plan IA — ${goal.target ?? pipelineType(goal.task).label}`, spec, 'ai', AI)
    const rep = fullValidate(version); db.reports[version.id] = rep
    const mode = modeOf(dsv.project_id)
    const prof = db.profiles[dsv.id]
    const prop: C.PlanProposal = { id: uid('prop'), goal_id: goal.id, workflow_id: workflow.id, workflow_version_id: version.id, simulated: true, rationale: nodeRationale(spec, goal, dsv),
      assumptions: [`La cible est « ${goal.target} » (${goal.task}).`, `Métrique ${goal.objective.primary_metric} (${goal.objective.direction === 'maximize' ? 'à maximiser' : 'à minimiser'}).`, ...goal.ambiguities],
      warnings: [...(prof?.alerts.filter((a) => a.severity === 'warning' && a.column !== 'customer_id').map((a) => a.message) ?? []), ...(prof ? [] : ['Aucun profil disponible : le plan repose sur le seul schéma.'])],
      evidence_refs: [...rec.evidence_refs, ...(prof?.alerts.filter((a) => a.column && a.severity !== 'info').slice(0, 3).map((a) => evProfile(dsv.id, a.column!, a.message)) ?? [])],
      required_approvals: requirements(spec, mode).map((r) => ({ operation_class: r.operation_class, node_ids: r.node_ids, individual: r.individual })), validation_report_ref: version.id }
    db.proposals.push(prop); logAudit(dsv.project_id, AI, 'proposal_created', prop.id, { reason: `Objectif : ${goal.target} (${goal.objective.primary_metric})` })
    return prop
  }, { status: 201 })
  route('GET', '/assistant/proposals/{proposal_id}', ({ params }) => clone(db.proposals.find((p) => p.id === params.proposal_id) ?? (() => { throw notFound('Proposition', params.proposal_id) })()))
  route('POST', '/assistant/explanations', async ({ body }) => {
    const ref: string = body?.subject_ref ?? ''; const [kind, id] = ref.split(':'); await jitter(400, 800)
    const ev: C.EvidenceRef[] = []; let text = ''
    if (kind === 'run') {
      const r = db.runs.find((x) => x.id === id); if (!r) throw notFound('Run', id)
      const m = r.metrics[r.primary_metric], sd = r.metrics_std?.[r.primary_metric]
      text = `Le modèle « ${r.name} » obtient ${r.primary_metric} = ${m} (± ${sd}) en validation croisée.${r.test_evaluated && r.test_metrics ? ` Sur le jeu de test, ${r.primary_metric} = ${r.test_metrics[r.primary_metric]} : l'écart avec la validation (${Math.abs(Math.round((r.test_metrics[r.primary_metric] - m) * 1000) / 1000)}) reste faible, ce qui suggère peu de sur-apprentissage.` : ' Le jeu de test n\'a pas encore été utilisé : ce résultat reste une estimation de validation.'}`
      ev.push({ source_type: 'run', source_id: r.id, summary: `${r.primary_metric} validation = ${m}` }); if (r.test_metrics) ev.push({ source_type: 'run', source_id: r.id + '#test', summary: `${r.primary_metric} test = ${r.test_metrics[r.primary_metric]}` })
    } else if (kind === 'execution') {
      const e = db.executions.find((x) => x.id === id); if (!e) throw notFound('Exécution', id)
      const failed = e.node_runs.find((n) => n.status === 'failed'); const ok = e.node_runs.filter((n) => n.status === 'succeeded').length
      text = failed ? `L'exécution a échoué au nœud ${failed.node_id} : ${failed.error?.message} ${ok} nœud(s) avaient réussi avant. Vous pouvez corriger la cause puis relancer en réutilisant les nœuds identiques.` : `L'exécution est ${e.status} : ${ok}/${e.node_runs.length} nœuds réussis.`
      ev.push({ source_type: 'execution', source_id: e.id, summary: `statut ${e.status}, ${ok}/${e.node_runs.length} nœuds réussis` })
    } else if (kind === 'profile') {
      const p = db.profiles[id]; if (!p) throw notFound('Profil', id)
      text = `${p.rows.toLocaleString('fr-FR')} lignes, ${p.columns.length} colonnes, ${p.alerts.length} alerte(s). ${p.alerts.filter((a) => a.severity !== 'info').map((a) => a.message).join(' ')}`
      ev.push({ source_type: 'profile', source_id: id, summary: `${p.alerts.length} alertes` })
    } else throw bad('SUBJECT_UNSUPPORTED', 'subject_ref attendu : run:<id>, execution:<id> ou profile:<dataset_version_id>.')
    return { subject_ref: ref, text, evidence_refs: ev, simulated: true } as C.Explanation
  })
  route('GET', '/assistant/mode', ({ query }) => ({ project_id: query.project_id, mode: db.modes[query.project_id] ?? 'guided' }))
  route('PUT', '/assistant/mode', ({ body }) => {
    if (!db.projects.some((p) => p.id === body?.project_id)) throw notFound('Projet', body?.project_id)
    if (!['auto', 'guided', 'expert'].includes(body?.mode)) throw bad('VALIDATION', 'mode : auto, guided ou expert.')
    const prev = db.modes[body.project_id]; db.modes[body.project_id] = body.mode
    logAudit(body.project_id, { type: 'user', id: USER.id }, 'mode_changed', body.project_id, { reason: `${prev} → ${body.mode}` }); return { project_id: body.project_id, mode: body.mode }
  })
  route('GET', '/assistant/audit', ({ query }) => clone(db.audit.filter((a) => (!query.project_id || a.project_id === query.project_id) && (!query.action || a.action === query.action) && (!query.actor_type || a.actor.type === query.actor_type))))
  route('GET', '/policy/matrix', () => POLICY)
}
