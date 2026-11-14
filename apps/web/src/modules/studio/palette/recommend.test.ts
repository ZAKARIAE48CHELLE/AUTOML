import { describe, expect, it } from 'vitest'
import type { DatasetColumn, WorkflowSpec } from '@contracts/src'
import { buildTemplateSpec } from '@contracts/src'
import { addBlock } from './blocks'
import { recommend } from './recommend'

const COLS: DatasetColumn[] = [
  { name: 'customer_id', dtype: 'string', nullable: false },
  { name: 'age', dtype: 'int', nullable: true },
  { name: 'plan', dtype: 'category', nullable: false },
  { name: 'monthly_charge', dtype: 'float', nullable: false },
  { name: 'churn', dtype: 'category', nullable: false },
]
const empty = (): WorkflowSpec => ({ schema_version: '1.0', metadata: { task: 'classification', target: 'churn' }, nodes: [], edges: [] } as unknown as WorkflowSpec)
const add = (s: WorkflowSpec, type: string) => addBlock(s, { kind: 'node', type }, { columns: COLS, wire: true }).spec
const keys = (s: WorkflowSpec, nodeId?: string) => recommend(s, { columns: COLS, nodeId }).map((r) => r.key)

describe('recommandations du clic droit', () => {
  it('pipeline vide : le dataset est la prochaine étape, en tête', () => {
    const r = recommend(empty(), { columns: COLS })
    expect(r[0]).toMatchObject({ key: 'data.dataset', next: true })
    expect(r.filter((x) => x.next)).toHaveLength(1)
  })

  it('après dataset + split : étapes de prétraitement adaptées aux colonnes, sans doublon', () => {
    let s = add(add(empty(), 'data.dataset'), 'data.split')
    const r = recommend(s, { columns: COLS })
    expect(r[0].block.kind).toBe('step'); expect(r[0].next).toBe(true)
    const first = r[0].block.kind === 'step' ? r[0].block.type : ''
    s = addBlock(s, r[0].block, { columns: COLS, wire: true }).spec
    expect(keys(s)).not.toContain(`step:${first}`)
  })

  it('un modèle présent : propose une autre famille, le tuning et la comparaison', () => {
    let s = add(add(empty(), 'data.dataset'), 'data.split')
    const m = recommend(s, { columns: COLS }).find((x) => x.block.kind === 'model')!
    s = addBlock(s, m.block, { columns: COLS, wire: true }).spec
    const k = keys(s)
    expect(k).not.toContain(m.key)
    expect(k).toContain('train.tune'); expect(k).toContain('eval.compare')
    expect(k.some((x) => x.startsWith('model:'))).toBe(true)
  })

  it('clic droit sur un bloc : seulement ce qui vient après lui', () => {
    const s = add(add(empty(), 'data.dataset'), 'data.split')
    const split = s.nodes.find((n) => n.type === 'data.split')!
    const k = keys(s, split.id)
    expect(k).not.toContain('data.dataset'); expect(k).not.toContain('data.split')
    expect(k.length).toBeGreaterThan(0)
  })

  it('pipeline type complet : plus rien à recommander', () => {
    const s = buildTemplateSpec('classification', 'dsv_1', COLS, { target: 'churn' })
    const nodeKeys = keys(s).filter((x) => !x.startsWith('model:') && !x.startsWith('step:') && x !== 'train.tune')
    expect(nodeKeys).toEqual([])
    expect(recommend(s, { columns: COLS }).some((x) => x.next)).toBe(false)
  })
})
