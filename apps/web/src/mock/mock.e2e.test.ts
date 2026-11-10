import { describe, it, expect, beforeEach } from 'vitest'
import { registerAll, dispatch, resetDb, speed, db } from './index'

const call = async (m: string, p: string, body?: unknown, q: Record<string, string> = {}) => (await dispatch(m, p, q, body)).data as any
const waitExec = async (id: string) => { for (let i = 0; i < 400; i++) { const e = await call('GET', `/executions/${id}`); if (['succeeded', 'failed', 'cancelled'].includes(e.status)) return e; await new Promise((r) => setTimeout(r, 10)) } throw new Error('timeout') }

beforeEach(() => { registerAll(); resetDb(); speed.factor = 0.01 })

describe('mock E2E', () => {
  it('plan IA : validation → approbations par étape + L3 → exécution → registre', async () => {
    const rep = await call('POST', '/workflows/wf_ai/versions/wfv_ai_1/validate')
    expect(rep.layers.map((l: any) => l.layer)).toEqual(['structure', 'data', 'training', 'policy'])
    expect(rep.layers.find((l: any) => l.layer === 'structure').status).toBe('ok')
    // sans approbation : refus
    await expect(call('POST', '/executions', { workflow_version_id: 'wfv_ai_1', approval_ids: [] })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    const ids: string[] = []
    for (const n of ['n4', 'n5', 'n6', 'n9']) ids.push((await call('POST', '/approvals', { workflow_version_id: 'wfv_ai_1', operation_classes: ['L2'], node_ids: [n], method: 'explicit_click' })).approval_id)
    ids.push((await call('POST', '/approvals', { workflow_version_id: 'wfv_ai_1', operation_classes: ['L3'], node_ids: ['n8'], method: 'explicit_click' })).approval_id)
    const { execution_id } = await call('POST', '/executions', { workflow_version_id: 'wfv_ai_1', approval_ids: ids })
    const e = await waitExec(execution_id)
    expect(e.status).toBe('succeeded')
    expect(db.registry.some((m) => m.name === 'churn-model' && m.test_evaluated)).toBe(true)
  })
  it('échec simulé (seed 13) → nœud failed, compare skipped si min non atteint', async () => {
    const ap = (await call('POST', '/approvals', { workflow_version_id: 'wfv_base_2', operation_classes: ['L2'], node_ids: ['n4', 'n6'], method: 'explicit_click' })).approval_id
    const { execution_id } = await call('POST', '/executions', { workflow_version_id: 'wfv_base_2', approval_ids: [ap] })
    const e = await waitExec(execution_id)
    expect(e.status).toBe('failed'); expect(e.node_runs.find((n: any) => n.node_id === 'n6').status).toBe('failed')
    expect(e.node_runs.find((n: any) => n.node_id === 'n5').status).toBe('succeeded') // min_succeeded = 1
  })
  it('endpoints internes refusés sans jeton de service', async () => {
    await expect(call('POST', '/training/jobs', {})).rejects.toMatchObject({ code: 'FORBIDDEN_INTERNAL' })
  })
})
