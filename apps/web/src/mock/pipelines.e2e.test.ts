import { describe, it, expect, beforeEach } from 'vitest'
import { registerAll, dispatch, resetDb, speed, db } from './index'
import { PIPELINE_TYPES, buildTemplateSpec, detectTaskFromText, guessRoles, inferTask, validateStructure, type Task } from '@contracts/src'

const call = async (m: string, p: string, body?: unknown, q: Record<string, string> = {}) => (await dispatch(m, p, q, body)).data as any
const waitExec = async (id: string) => { for (let i = 0; i < 600; i++) { const e = await call('GET', `/executions/${id}`); if (['succeeded', 'failed', 'cancelled'].includes(e.status)) return e; await new Promise((r) => setTimeout(r, 10)) } throw new Error('timeout') }

beforeEach(() => { registerAll(); resetDb(); speed.factor = 0.01 })

const DEMO: Record<string, Task> = { segmentation: 'clustering', transactions: 'anomaly_detection', sales: 'forecasting', reviews: 'text_classification', images: 'image_classification', ratings: 'recommendation' }

describe('types de pipeline', () => {
  it('le catalogue couvre les 8 types', () => {
    expect(PIPELINE_TYPES.map((p) => p.id).sort()).toEqual(['anomaly_detection', 'classification', 'clustering', 'forecasting', 'image_classification', 'recommendation', 'regression', 'text_classification'])
  })

  for (const [id, task] of Object.entries(DEMO)) {
    it(`${task} : gabarit valide → approbations → exécution → métriques du type → registre`, async () => {
      const wfv = `wfv_${id}_1`
      const v = db.versionsMeta.find((x) => x.id === wfv)!
      expect(v.spec.metadata.task).toBe(task)
      const rep = await call('POST', `/workflows/wf_${id}/versions/${wfv}/validate`)
      const errors = rep.layers.filter((l: any) => l.layer !== 'policy').flatMap((l: any) => l.issues).filter((i: any) => i.severity === 'error')
      expect(errors).toEqual([])
      // Mode du projet de démo : expert → le clic vaut approbation L2 ; le test final (L3) reste individuel.
      const l3 = v.spec.nodes.filter((n) => n.type === 'eval.final_test').map((n) => n.id)
      const ids = [(await call('POST', '/approvals', { workflow_version_id: wfv, operation_classes: ['L3'], node_ids: l3, method: 'explicit_click' })).approval_id]
      const { execution_id } = await call('POST', '/executions', { workflow_version_id: wfv, approval_ids: ids })
      const e = await waitExec(execution_id)
      expect(e.status, JSON.stringify(e.node_runs.filter((n: any) => n.error))).toBe('succeeded')
      const run = db.runs.find((r) => e.node_runs.some((n: any) => n.result_refs?.some((x: any) => x.id === r.id)))!
      const pt = PIPELINE_TYPES.find((p) => p.id === task)!
      expect(Object.keys(run.metrics).sort()).toEqual([...pt.metrics].sort())
      expect(db.registry.some((m) => m.name === `${id}-model` && m.test_evaluated)).toBe(true)
    })
  }

  it('V11 : rôle obligatoire manquant, stratégie et étape inadaptées', () => {
    const sales = db.versions.find((v) => v.id === 'dsv_sales_1')!
    const spec = buildTemplateSpec('forecasting', sales.id, sales.schema)
    expect(validateStructure(spec)).toEqual([])
    const split = spec.nodes.find((n) => n.type === 'data.split')!
    delete split.params.time_column; split.params.strategy = 'random'
    spec.nodes.find((n) => n.type === 'data.preprocess')!.params.steps.push({ type: 'tfidf', columns: ['sales'] })
    const paths = validateStructure(spec).filter((i) => i.code === 'V11').map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['strategy', 'time_column']))
    expect(paths.some((p) => /^steps\.\d+\.type$/.test(p ?? ''))).toBe(true)
  })

  it('rôles et type déduits des datasets et du texte', () => {
    const schema = (id: string) => db.versions.find((v) => v.id === id)!.schema
    expect(guessRoles(schema('dsv_ratings_1'), 'recommendation')).toMatchObject({ user_column: 'user_id', item_column: 'item_id', target: 'rating' })
    expect(guessRoles(schema('dsv_reviews_1'), 'text_classification')).toMatchObject({ text_column: 'review_text', target: 'sentiment' })
    expect(inferTask(schema('dsv_images_1'), 'label')).toBe('image_classification')
    expect(inferTask(schema('dsv_sales_1'), 'sales')).toBe('forecasting')
    expect(detectTaskFromText('Segmenter nos clients en groupes')).toBe('clustering')
    expect(detectTaskFromText('Détecter les fraudes sur les transactions')).toBe('anomaly_detection')
    expect(detectTaskFromText('Prévoir les ventes des 14 prochains jours')).toBe('forecasting')
  })

  it('assistant : un objectif de prévision produit un plan de prévision valide', async () => {
    const { goal } = await call('POST', '/assistant/goals/parse', { text: 'Prévoir les ventes futures', dataset_version_id: 'dsv_sales_1' })
    expect(goal.task).toBe('forecasting'); expect(goal.target).toBe('sales'); expect(goal.objective.primary_metric).toBe('mae')
    const prop = await call('POST', '/assistant/proposals', { goal_id: goal.id, dataset_version_id: 'dsv_sales_1' })
    const v = db.versionsMeta.find((x) => x.id === prop.workflow_version_id)!
    expect(v.spec.metadata.task).toBe('forecasting')
    expect(validateStructure(v.spec)).toEqual([])
  })
})
