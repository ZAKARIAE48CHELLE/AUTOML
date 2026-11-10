import type * as C from '@contracts/src'
import { cyrb53 } from '@contracts/src'
import { db, logAudit } from './db'
import { dispatch, SERVICE_HEADERS } from './router'
import { emit } from './bus'
import { jobWaiters } from './handlers/training'
import { ApiErr, nowIso, sleep } from './util'

type Out = Record<string, string>
const execState: Record<string, { outputs: Record<string, Out>; sigs: Record<string, string> }> = {}
export const stateOf = (id: string) => execState[id]

class NodeFail extends Error { constructor(public code: string, message: string) { super(message) } }

async function call(method: string, path: string, body?: unknown, internal = false, query: Record<string, string> = {}) {
  try { return (await dispatch(method, path, query, body, internal ? SERVICE_HEADERS : {})).data as any }
  catch (e) { if (e instanceof ApiErr) throw new NodeFail(e.code, e.message); throw e }
}

export function startExecution(ex: C.Execution, version: C.WorkflowVersion) {
  execState[ex.id] = { outputs: {}, sigs: {} }
  run(ex, version).catch((e) => { console.error('executor', e); ex.status = 'failed'; emit(ex.id, 'execution_status', 'failed') })
}

async function run(ex: C.Execution, version: C.WorkflowVersion) {
  const spec = version.spec, st = execState[ex.id], src = ex.reuse_from ? execState[ex.reuse_from] : undefined, srcEx = ex.reuse_from ? db.executions.find((e) => e.id === ex.reuse_from) : undefined
  const nr = (id: string) => ex.node_runs.find((n) => n.node_id === id)!
  const parents = (id: string) => spec.edges.filter((e) => e.to.node === id).map((e) => e.from.node)
  const node = (id: string) => spec.nodes.find((n) => n.id === id)!
  const setNode = (id: string, status: C.NodeStatus, extra: Partial<C.NodeRun> = {}) => { Object.assign(nr(id), { status }, extra); emit(ex.id, 'node_status', status, id) }
  const cancelled = () => !!(ex as any)._cancel
  const terminal = (s: C.NodeStatus) => ['succeeded', 'failed', 'cancelled', 'skipped'].includes(s)

  await sleep(300); ex.status = 'running'; emit(ex.id, 'execution_status', 'running')
  setNode(spec.nodes[0].id, nr(spec.nodes[0].id).status) // no-op event to anchor the stream

  const exec = async (id: string) => {
    const n = node(id), ps = parents(id)
    const sig = cyrb53(n.type + JSON.stringify(n.params) + ps.map((p) => st.sigs[p]).join('|'))
    st.sigs[id] = sig
    // Reprise : nœud de contenu et d'entrées identiques, réussi dans l'exécution source.
    const prev = srcEx?.node_runs.find((r) => r.node_id === id)
    if (src && prev?.status === 'succeeded' && src.sigs[id] === sig && src.outputs[id] && n.type !== 'eval.final_test') {
      st.outputs[id] = src.outputs[id]; setNode(id, 'running', { started_at: nowIso() }); await sleep(250)
      return setNode(id, 'succeeded', { cached: true, finished_at: nowIso(), progress: 1, result_refs: prev.result_refs, job_ref: prev.job_ref })
    }
    setNode(id, 'running', { started_at: nowIso(), progress: 0 })
    const ref = { execution_id: ex.id, node_id: id, attempt: nr(id).attempt }
    const inp = (port: string) => spec.edges.filter((e) => e.to.node === id && e.to.port === port).map((e) => st.outputs[e.from.node]?.[e.from.port === 'dataset' ? 'dataset' : e.from.port]).filter(Boolean)
    const watch = async (jobId: string) => {
      nr(id).job_ref = jobId
      const tick = setInterval(() => { const j = db.trainingJobs.find((x) => x.id === jobId); if (j) { nr(id).progress = j.progress; emit(ex.id, 'node_status', 'running', id) } }, 450)
      const j = await jobWaiters[jobId]; clearInterval(tick)
      if (j.status === 'cancelled') throw new NodeFail('CANCELLED', 'Job annulé.')
      if (j.status === 'failed') throw new NodeFail(j.error_code ?? 'JOB_FAILED', j.message ?? 'Le job a échoué.')
      return j
    }
    let refs: { kind: string; id: string }[] = []
    switch (n.type) {
      case 'data.dataset': { await sleep(400); if (!db.versions.some((v) => v.id === n.params.dataset_version_id)) throw new NodeFail('D_DATASET', 'Version de dataset introuvable.'); st.outputs[id] = { dataset: n.params.dataset_version_id }; refs = [{ kind: 'dataset_version', id: n.params.dataset_version_id }]; break }
      case 'data.split': { await sleep(500); const r = await call('POST', '/splits', { dataset_version_id: inp('dataset')[0], split_spec: n.params }); st.outputs[id] = { split: r.split_id }; refs = [{ kind: 'split', id: r.split_id }]; break }
      case 'data.preprocess': { await sleep(500); const dsv = db.splits.find((s) => s.id === inp('split')[0])!.dataset_version_id; const r = await call('POST', '/preprocessing/specs', { dataset_version_id: dsv, spec: { steps: n.params.steps } }); st.outputs[id] = { spec: r.spec_id }; refs = [{ kind: 'preprocess_spec', id: r.spec_id }]; break }
      case 'train.model': {
        const r = await call('POST', '/training/jobs', { execution_ref: ref, split_id: inp('split')[0], preprocess_spec_id: inp('spec')[0], model_id: n.params.model_id, params: n.params.params ?? {}, primary_metric: n.params.primary_metric, seed: n.params.seed }, true)
        const j = await watch(r.job_id); st.outputs[id] = { run: j.run_id! }; refs = [{ kind: 'run', id: j.run_id! }]; break }
      case 'train.tune': {
        const r = await call('POST', '/tuning/studies', { execution_ref: ref, base_config: { split_id: inp('split')[0], preprocess_spec_id: inp('spec')[0], model_id: n.params.model_id, params: {}, seed: n.params.seed, primary_metric: n.params.primary_metric }, search_space: n.params.search_space ?? {}, budget: n.params.budget, primary_metric: n.params.primary_metric }, true)
        const study = db.studies.find((s) => s.id === r.study_id)!; const j = await watch(study.job_id); st.outputs[id] = { run: j.run_id! }; refs = [{ kind: 'study', id: r.study_id }, { kind: 'run', id: j.run_id! }]; break }
      case 'eval.compare': {
        await sleep(400); const runs = inp('runs'); const min = n.params.min_succeeded ?? 1
        if (runs.length < min) throw new NodeFail('COMPARE_MIN_SUCCEEDED', `Seulement ${runs.length} run(s) réussi(s) pour ${min} requis.`)
        const lb = await call('POST', '/experiments/compare', { run_ids: runs }); st.outputs[id] = { best: lb.entries[0].run_id, board: runs.join(',') }; refs = [{ kind: 'leaderboard', id: lb.entries[0].run_id }]; break }
      case 'eval.final_test': {
        const runId = inp('run')[0]; const r = await call('POST', `/experiments/${runId}/final-evaluation`, { execution_ref: ref }, true); await watch(r.job_id); st.outputs[id] = { run: runId }; refs = [{ kind: 'run', id: runId }]; break }
      case 'model.register': {
        await sleep(500); const r = await call('POST', '/models/registry', { execution_ref: ref, run_id: inp('run')[0], name: n.params.name }, true); st.outputs[id] = { version: r.model_version_id }; refs = [{ kind: 'model_version', id: r.model_version_id }]; break }
    }
    setNode(id, 'succeeded', { finished_at: nowIso(), progress: 1, result_refs: refs })
  }

  const done = new Set<string>(), running = new Set<string>()
  const launch = (id: string) => {
    running.add(id)
    exec(id).catch((e: NodeFail) => { if (e.code === 'CANCELLED') setNode(id, 'cancelled', { finished_at: nowIso() }); else setNode(id, 'failed', { finished_at: nowIso(), error: { code: e.code ?? 'ERROR', message: e.message } }) }).finally(() => { running.delete(id); done.add(id) })
  }
  while (done.size < spec.nodes.length) {
    for (const n of spec.nodes) {
      if (done.has(n.id) || running.has(n.id)) continue
      const ps = parents(n.id); if (!ps.every((p) => done.has(p))) continue
      if (cancelled()) { setNode(n.id, 'cancelled'); done.add(n.id); continue }
      const ok = ps.filter((p) => nr(p).status === 'succeeded').length
      const need = n.type === 'eval.compare' ? Math.max(1, n.params.min_succeeded ?? 1) : ps.length
      if (ok < need || (n.type !== 'eval.compare' && ok < ps.length)) { setNode(n.id, 'skipped'); done.add(n.id); continue }
      launch(n.id)
    }
    await sleep(120)
  }
  const nodes = ex.node_runs
  const status: C.ExecutionStatus = nodes.some((n) => n.status === 'cancelled') || cancelled() ? 'cancelled' : nodes.some((n) => n.status === 'failed') ? 'failed' : 'succeeded'
  ex.status = status; ex.finished_at = nowIso(); emit(ex.id, 'execution_status', status)
  logAudit(db.workflows.find((w) => w.id === ex.workflow_id)!.project_id, { type: 'system', id: 'executor' }, 'execution_finished', ex.id, { outcome: status === 'succeeded' ? 'ok' : 'error', reason: status })
}
