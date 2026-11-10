import type { WorkflowSpec, WorkflowNode, WorkflowEdge } from '@contracts/src'
import { CATALOG_VERSION } from '@contracts/src'

const N = (id: string, type: string, params: Record<string, unknown>, col: number, row = 0): WorkflowNode => ({ id, type, type_version: '1.0', params, ui: { x: col * 250, y: row * 150 } })
const E = (id: string, fn: string, fp: string, tn: string, tp: string): WorkflowEdge => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } })
const meta = (target: string, metric: string, origin: 'human' | 'ai', goal_id?: string): WorkflowSpec['metadata'] => ({ task: 'classification', target, origin, goal_id, objective: { primary_metric: metric, direction: 'maximize' } })
const base = (dsv: string, target: string) => ({
  nodes: [
    N('n1', 'data.dataset', { dataset_version_id: dsv }, 0),
    N('n2', 'data.split', { strategy: 'stratified', test_ratio: 0.2, cv_folds: 5, seed: 42, target }, 1),
    N('n3', 'data.preprocess', { steps: [{ type: 'drop_columns', columns: ['customer_id'] }, { type: 'impute_median', columns: ['age', 'data_gb'] }, { type: 'onehot', columns: ['plan', 'contract', 'payment_method'] }] }, 2),
  ],
  edges: [E('e1', 'n1', 'dataset', 'n2', 'dataset'), E('e2', 'n2', 'split', 'n3', 'split')],
})

export function baselineSpec(dsv: string, target = 'churn'): WorkflowSpec {
  const b = base(dsv, target)
  return { schema_version: '1.0', catalog_version: CATALOG_VERSION, metadata: meta(target, 'f1', 'human'),
    nodes: [...b.nodes, N('n4', 'train.model', { model_id: 'random_forest', params: { n_estimators: 300 }, primary_metric: 'f1', seed: 42 }, 3), N('n5', 'eval.compare', { min_succeeded: 1 }, 4)],
    edges: [...b.edges, E('e3', 'n2', 'split', 'n4', 'split'), E('e4', 'n3', 'spec', 'n4', 'spec'), E('e5', 'n4', 'run', 'n5', 'runs')] }
}
export function twoModelsSpec(dsv: string, target = 'churn', failSeed = false): WorkflowSpec {
  const s = baselineSpec(dsv, target)
  s.nodes.push(N('n6', 'train.model', { model_id: 'gradient_boosting', params: { n_estimators: 400, learning_rate: 0.08 }, primary_metric: 'f1', seed: failSeed ? 13 : 42 }, 3, 1))
  s.edges.push(E('e6', 'n2', 'split', 'n6', 'split'), E('e7', 'n3', 'spec', 'n6', 'spec'), E('e8', 'n6', 'run', 'n5', 'runs'))
  return s
}
export function fullPlanSpec(dsv: string, target: string, metric: string, goal_id?: string, origin: 'ai' | 'human' = 'ai', task: 'classification' | 'regression' = 'classification'): WorkflowSpec {
  const b = base(dsv, target)
  const reg = task === 'regression'
  const nodes = [...b.nodes,
    N('n4', 'train.model', { model_id: reg ? 'ridge' : 'logistic_regression', params: {}, primary_metric: metric, seed: 42 }, 3, -1),
    N('n5', 'train.model', { model_id: reg ? 'random_forest' : 'random_forest', params: { n_estimators: 300 }, primary_metric: metric, seed: 42 }, 3, 0),
    N('n6', 'train.tune', { model_id: 'gradient_boosting', primary_metric: metric, seed: 42, search_space: { n_estimators: [100, 600], learning_rate: [0.02, 0.3] }, budget: { trials: 20, max_minutes: 10 } }, 3, 1),
    N('n7', 'eval.compare', { min_succeeded: 2 }, 4), N('n8', 'eval.final_test', {}, 5), N('n9', 'model.register', { name: reg ? 'housing-price' : 'churn-model' }, 6)]
  const edges = [...b.edges,
    E('e3', 'n2', 'split', 'n4', 'split'), E('e4', 'n3', 'spec', 'n4', 'spec'),
    E('e5', 'n2', 'split', 'n5', 'split'), E('e6', 'n3', 'spec', 'n5', 'spec'),
    E('e7', 'n2', 'split', 'n6', 'split'), E('e8', 'n3', 'spec', 'n6', 'spec'),
    E('e9', 'n4', 'run', 'n7', 'runs'), E('e10', 'n5', 'run', 'n7', 'runs'), E('e11', 'n6', 'run', 'n7', 'runs'),
    E('e12', 'n7', 'best', 'n8', 'run'), E('e13', 'n8', 'run', 'n9', 'run')]
  const md = meta(target, metric, origin, goal_id); md.task = task
  return { schema_version: '1.0', catalog_version: CATALOG_VERSION, metadata: md, nodes, edges }
}
