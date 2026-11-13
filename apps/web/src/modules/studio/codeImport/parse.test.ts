import { describe, it, expect } from 'vitest'
import type { Task } from '@contracts/src'
import { validateStructure } from '@contracts/src'
import { db } from '@/mock/db'
import { buildFromCode, parseCode, sourceOf } from './parse'
import { CODE_SAMPLES } from './samples'

const DSV: Record<Task, string> = {
  classification: 'dsv_telecom_1', regression: 'dsv_housing_1', clustering: 'dsv_segmentation_1', anomaly_detection: 'dsv_transactions_1',
  forecasting: 'dsv_sales_1', text_classification: 'dsv_reviews_1', image_classification: 'dsv_images_1', recommendation: 'dsv_ratings_1',
}

describe('code → pipeline', () => {
  for (const [task, code] of Object.entries(CODE_SAMPLES) as [Task, string][]) {
    it(`${task} : type détecté, pipeline valide`, () => {
      const r = parseCode(code)
      expect(r.task).toBe(task)
      const v = db.versions.find((x) => x.id === DSV[task])!
      const { spec, findings } = buildFromCode(r, { dsvId: v.id, columns: v.schema })
      expect(spec.metadata.task).toBe(task)
      expect(validateStructure(spec).filter((i) => i.severity === 'error')).toEqual([])
      expect(findings.some((f) => f.kind === 'model' && f.node)).toBe(true) // chaque modèle reconnu est relié à son nœud
    })
  }

  it('classification : split, étapes avec colonnes, modèle et hyperparamètres, enregistrement', () => {
    const r = parseCode(CODE_SAMPLES.classification)
    const v = db.versions.find((x) => x.id === 'dsv_telecom_1')!
    const { spec } = buildFromCode(r, { dsvId: v.id, columns: v.schema })
    const split = spec.nodes.find((n) => n.type === 'data.split')!.params
    expect(split).toMatchObject({ strategy: 'stratified', test_ratio: 0.2, cv_folds: 5, seed: 42, target: 'churn' })
    const steps = spec.nodes.find((n) => n.type === 'data.preprocess')!.params.steps
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'impute_median', columns: ['age', 'data_gb'] }), expect.objectContaining({ type: 'onehot', columns: ['plan', 'contract', 'payment_method'] })]))
    expect(spec.nodes.find((n) => n.type === 'train.model')!.params).toMatchObject({ model_id: 'random_forest', params: { n_estimators: 300, max_depth: 12 }, primary_metric: 'f1' })
    expect(spec.nodes.find((n) => n.type === 'model.register')!.params.name).toBe('churn-model')
  })

  it('XGBoost : approximé par gradient boosting ; classe inconnue signalée', () => {
    const r = parseCode('from xgboost import XGBClassifier\nm = XGBClassifier(n_estimators=200)\nnet = MyCustomNet()')
    expect(r.findings.find((f) => f.kind === 'model')).toMatchObject({ status: 'approx', data: { model_id: 'gradient_boosting' } })
    expect(r.findings.some((f) => f.kind === 'unsupported')).toBe(true)
  })

  it('notebook .ipynb : seules les cellules de code sont lues', () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# titre'] }, { cell_type: 'code', source: ['from sklearn.cluster import KMeans\n', 'km = KMeans(n_clusters=3)'] }] })
    expect(sourceOf(nb)).toContain('KMeans(n_clusters=3)')
    expect(parseCode(nb).task).toBe('clustering')
  })
})
