import type * as C from '@contracts/src'
import { db, logAudit, USER } from '../db'
import { route } from '../router'
import { ApiErr, notFound, bad, uid, nowIso, sleep, clone } from '../util'
import { buildProfile, type Row } from '../seed-data'
import { cyrb53, aggregateReport, layerStatus, PREPROCESS_STEPS, CATALOG_VERSION, idColumns, inferTask, guessRoles, templateSteps, pipelineType } from '@contracts/src'

/** Catalogue des transformations : source unique, le catalogue partagé (tous types de pipeline). */
const TRANSFORMS: C.PreprocessTransform[] = PREPROCESS_STEPS

export const version = (id: string) => db.versions.find((v) => v.id === id) ?? (() => { throw notFound('DatasetVersion', id) })()

/** Couche « data » (E1) : colonnes existantes, types compatibles, fuites, cohérence avec le split. Réutilisée par l'agrégateur d'E4. */
export function dataLayerForPreprocess(dsvId: string, steps: C.PreprocessStep[], target?: string, nodeId?: string, roleCols: string[] = []): C.ValidationLayer {
  const v = db.versions.find((x) => x.id === dsvId)
  const issues: C.ValidationIssue[] = []
  if (!v) return { layer: 'data', status: 'error', issues: [{ code: 'D_DATASET', severity: 'error', node_id: nodeId, message: `Version de dataset introuvable : ${dsvId}.` }] }
  steps.forEach((s, i) => {
    const t = TRANSFORMS.find((x) => x.type === s.type)
    if (!t) { issues.push({ code: 'D_STEP', severity: 'error', node_id: nodeId, path: `steps[${i}].type`, message: `Transformation inconnue : ${s.type}.` }); return }
    if (!s.columns?.length) issues.push({ code: 'D_COLS', severity: 'error', node_id: nodeId, path: `steps[${i}].columns`, message: `${t.label} : aucune colonne sélectionnée.` })
    for (const c of s.columns ?? []) {
      const col = v.schema.find((x) => x.name === c)
      if (!col) { issues.push({ code: 'D_COLUMN', severity: 'error', node_id: nodeId, path: `steps[${i}].columns`, message: `Colonne inexistante : ${c}.` }); continue }
      if (!t.applies_to.includes(col.dtype)) issues.push({ code: 'D_TYPE', severity: 'error', node_id: nodeId, path: `steps[${i}].columns`, message: `${t.label} incompatible avec ${c} (${col.dtype}).`, hint: `Types acceptés : ${t.applies_to.join(', ')}.` })
      if (target && c === target && s.type !== 'drop_columns' && !t.target_safe) issues.push({ code: 'D_LEAK', severity: 'error', node_id: nodeId, path: `steps[${i}].columns`, message: `La cible « ${target} » ne doit pas être transformée comme une variable explicative (fuite).` })
    }
  })
  const dropped = new Set(steps.filter((s) => s.type === 'drop_columns').flatMap((s) => s.columns ?? []))
  for (const idc of idColumns(v.schema).filter((c) => !dropped.has(c) && !roleCols.includes(c))) issues.push({ code: 'D_ID', severity: 'warning', node_id: nodeId, message: `La colonne identifiant « ${idc} » n'est pas exclue : risque de sur-apprentissage.`, hint: 'Ajoutez une étape « Exclure des colonnes ».' })
  const withMissing = v.schema.filter((c) => c.nullable && c.name !== target && !roleCols.includes(c.name) && (c.dtype === 'int' || c.dtype === 'float'))
  const imputed = new Set(steps.filter((s) => s.type.startsWith('impute')).flatMap((s) => s.columns ?? []))
  withMissing.forEach((c) => { if (!imputed.has(c.name) && !dropped.has(c.name)) issues.push({ code: 'D_MISSING', severity: 'warning', node_id: nodeId, message: `${c.name} contient des valeurs manquantes non traitées.` }) })
  return { layer: 'data', status: layerStatus(issues), issues }
}

export function dataLayerForSplit(dsvId: string, p: Record<string, any>, nodeId?: string, task?: C.Task): C.ValidationLayer {
  const v = db.versions.find((x) => x.id === dsvId); const issues: C.ValidationIssue[] = []
  if (!v) return { layer: 'data', status: 'error', issues: [{ code: 'D_DATASET', severity: 'error', node_id: nodeId, message: `Version de dataset introuvable : ${dsvId}.` }] }
  const col = (n?: string) => v.schema.find((c) => c.name === n)
  const pt = pipelineType(task ?? inferTask(v.schema, p.target))
  // Rôles renseignés : la colonne doit exister et avoir un type compatible (les rôles obligatoires sont vérifiés par V11).
  for (const r of pt.roles) {
    if (!p[r.role]) continue
    const c = col(p[r.role])
    if (!c) issues.push({ code: 'D_ROLE', severity: 'error', node_id: nodeId, path: r.role, message: `${r.label} : colonne inexistante (${p[r.role]}).` })
    else if (!r.dtypes.includes(c.dtype)) issues.push({ code: 'D_ROLE_TYPE', severity: 'warning', node_id: nodeId, path: r.role, message: `${r.label} : type ${c.dtype} inhabituel.`, hint: `Types attendus : ${r.dtypes.join(', ')}.` })
  }
  if (!task && !p.target && pt.supervised && pt.roles.some((r) => r.role === 'target' && r.required)) issues.push({ code: 'D_TARGET', severity: 'error', node_id: nodeId, path: 'target', message: 'Colonne cible requise.' })
  if (p.strategy === 'stratified' && !col(p.target)) issues.push({ code: 'D_STRAT', severity: 'error', node_id: nodeId, path: 'strategy', message: 'Un split stratifié exige une colonne cible.' })
  else if (p.strategy === 'stratified' && !['category', 'bool', 'string', 'int'].includes(col(p.target)!.dtype)) issues.push({ code: 'D_STRAT', severity: 'error', node_id: nodeId, path: 'strategy', message: 'Un split stratifié exige une cible catégorielle.' })
  if (p.strategy === 'group' && !col(p.group_column)) issues.push({ code: 'D_GROUP', severity: 'error', node_id: nodeId, path: 'group_column', message: 'Colonne de groupe requise et existante.' })
  if (p.strategy === 'time' && !col(p.time_column)) issues.push({ code: 'D_TIME', severity: 'error', node_id: nodeId, path: 'time_column', message: 'Colonne temporelle requise et existante.' })
  if (p.cv_folds === 1 && !p.val_ratio) issues.push({ code: 'D_VAL', severity: 'error', node_id: nodeId, path: 'val_ratio', message: 'val_ratio est requis lorsque cv_folds = 1.' })
  return { layer: 'data', status: layerStatus(issues), issues }
}


export function recommend(dsvId: string, target?: string, task?: C.Task) {
  const v = version(dsvId)
  if (task && task !== 'classification' && task !== 'regression') {
    // Autres types : gabarit du catalogue, résolu sur les colonnes et rôles du dataset.
    const roles = guessRoles(v.schema, task, target); const steps = templateSteps(v.schema, task, roles)
    return { spec: { dataset_version_id: v.id, steps }, rule_ids: [`R-TPL-${task}`], evidence_refs: [{ source_type: 'rule' as const, source_id: `R-TPL-${task}`, summary: `Gabarit ${pipelineType(task).label} : ${steps.map((x) => x.type).join(', ') || 'aucune étape'}` }] }
  }
  ; const steps: C.PreprocessStep[] = []; const rule_ids: string[] = []; const ev: C.EvidenceRef[] = []
  const prof = db.profiles[v.id]; const ids = v.schema.filter((c) => c.name.endsWith('_id') && c.dtype === 'string').map((c) => c.name)
  if (ids.length) { steps.push({ type: 'drop_columns', columns: ids }); rule_ids.push('R-ID-01'); ev.push({ source_type: 'rule', source_id: 'R-ID-01', summary: `Identifiant : ${ids.join(', ')}` }) }
  const miss = v.schema.filter((c) => c.nullable && (c.dtype === 'int' || c.dtype === 'float') && c.name !== target).map((c) => c.name)
  if (miss.length) { steps.push({ type: 'impute_median', columns: miss }); rule_ids.push('R-IMP-01'); ev.push({ source_type: 'profile', source_id: `${v.id}#missing`, summary: `Manquants : ${miss.map((m) => `${m} ${prof?.columns.find((c) => c.name === m)?.missing_pct ?? '?'} %`).join(', ')}` }) }
  const cats = v.schema.filter((c) => c.dtype === 'category' && c.name !== target).map((c) => c.name)
  if (cats.length) { steps.push({ type: 'onehot', columns: cats }); rule_ids.push('R-ENC-01'); ev.push({ source_type: 'rule', source_id: 'R-ENC-01', summary: `Catégories de faible cardinalité : ${cats.join(', ')}` }) }
  return { spec: { dataset_version_id: v.id, steps }, rule_ids, evidence_refs: ev }
}

function inferSchema(header: string[], rows: string[][]): C.DatasetColumn[] {
  return header.map((name, i) => {
    const vals = rows.map((r) => r[i]).filter((x) => x !== undefined && x !== '')
    const nums = vals.every((x) => !Number.isNaN(Number(x)))
    const sample = vals.slice(0, 200)
    if (sample.length && sample.every((x) => /\.(jpe?g|png|bmp|gif|webp|tiff?)$/i.test(x))) return { name, dtype: 'image_path' as const, nullable: vals.length < rows.length }
    if (sample.length && !nums && sample.every((x) => /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(x))) return { name, dtype: 'datetime' as const, nullable: vals.length < rows.length }
    if (sample.length && !nums && sample.reduce((acc, x) => acc + x.length, 0) / sample.length > 40 && sample.filter((x) => x.includes(' ')).length > sample.length * 0.8) return { name, dtype: 'text' as const, nullable: vals.length < rows.length }
    const dtype: C.DatasetColumn['dtype'] = vals.length && nums ? (vals.every((x) => Number.isInteger(Number(x))) ? 'int' : 'float') : new Set(vals).size <= Math.max(10, rows.length * 0.05) ? 'category' : 'string'
    return { name, dtype, nullable: vals.length < rows.length }
  })
}

/** Répartition de la cible (catégorielle) estimée sur l'échantillon ; vide pour une cible numérique ou absente. */
function targetDistribution(dsvId: string, target?: string): C.SplitVersion['target_distribution'] {
  const v = db.versions.find((x) => x.id === dsvId); const col = v?.schema.find((c) => c.name === target)
  if (!v || !col || !['category', 'bool', 'string'].includes(col.dtype)) return []
  const rows = db.rows[v.id] ?? []; const m = new Map<string, number>(); rows.forEach((r) => { const k = String(r[col.name]); m.set(k, (m.get(k) ?? 0) + 1) })
  if (m.size > 20 || !rows.length) return []
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, train: Math.round((n / rows.length) * 1000) / 1000, test: Math.round((n / rows.length) * 1000) / 1000 }))
}

export function registerData() {
  route('POST', '/auth/login', ({ body }) => {
    if (!body?.email || !body?.password) throw bad('AUTH_INVALID', 'Email et mot de passe requis.')
    return { access_token: 'mock.access.' + uid('t'), refresh_token: 'mock.refresh.' + uid('t'), user: { id: USER.id, name: USER.name, email: body.email } }
  })
  route('POST', '/auth/refresh', () => ({ access_token: 'mock.access.' + uid('t') }))
  route('GET', '/projects', () => clone(db.projects))
  route('POST', '/projects', ({ body }) => {
    if (!body?.name?.trim()) throw bad('VALIDATION', 'Le nom du projet est requis.')
    const p: C.Project = { id: uid('p'), name: body.name.trim(), role: 'owner', created_at: nowIso() }
    db.projects.push(p); db.modes[p.id] = 'guided'; return { project_id: p.id, ...p }
  }, { status: 201 })
  route('GET', '/projects/{project_id}', ({ params }) => {
    const p = db.projects.find((x) => x.id === params.project_id); if (!p) throw notFound('Projet', params.project_id)
    return { ...p, members: [{ user_id: USER.id, name: USER.name, role: p.role }] }
  })

  route('GET', '/datasets', ({ query }) => {
    const out = db.datasets.filter((d) => !query.project_id || d.project_id === query.project_id).map((d) => {
      const vs = db.versions.filter((v) => v.dataset_id === d.id); const last = vs[vs.length - 1]
      return { ...d, latest_version_id: last?.id, rows: last?.rows, columns: last?.schema.length, status: last?.status, created_at: vs[0]?.created_at }
    }); return out
  })
  route('POST', '/datasets', async ({ body }) => {
    const file: File | undefined = body?.get?.('file'); const project_id = body?.get?.('project_id')
    if (!file || !project_id) throw bad('VALIDATION', 'Fichier et project_id requis.')
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw bad('UNSUPPORTED_FILE', 'Formats acceptés : CSV, XLSX.')
    if (/\.xlsx$/i.test(file.name)) throw bad('UNSUPPORTED_FILE', 'Le mock n\'analyse que les CSV ; le XLSX est géré par le backend E1.')
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw bad('EMPTY_FILE', 'Fichier vide ou sans ligne de données.')
    const sep = lines[0].includes(';') ? ';' : ','; const header = lines[0].split(sep).map((x) => x.trim())
    const body_ = lines.slice(1).map((l) => l.split(sep).map((x) => x.trim()))
    const schema = inferSchema(header, body_)
    const rows: Row[] = body_.slice(0, 500).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === '' || r[i] === undefined ? null : schema[i].dtype === 'int' || schema[i].dtype === 'float' ? Number(r[i]) : r[i]])))
    const dataset_id = uid('ds'), version_id = uid('dsv'), job_id = uid('job')
    db.datasets.push({ id: dataset_id, project_id, name: file.name })
    db.versions.push({ id: version_id, dataset_id, project_id, name: file.name, version: 1, checksum: 'sha256:' + cyrb53(text).slice(0, 12) + '…', schema, rows: body_.length, uri: `s3://datasets/${project_id}/${file.name}`, created_at: nowIso(), status: 'importing', job_id })
    db.rows[version_id] = rows; db.jobs[job_id] = { id: job_id, kind: 'import', status: 'running', progress: 0.1 }
    logAudit(project_id, { type: 'user', id: USER.id }, 'dataset_imported', dataset_id)
    sleep(1400).then(() => { db.jobs[job_id].status = 'succeeded'; db.jobs[job_id].progress = 1; const v = db.versions.find((x) => x.id === version_id); if (v) v.status = 'ready' })
    return { dataset_id, version_id, job_id }
  }, { status: 202 })
  route('GET', '/datasets/{dataset_id}', ({ params }) => {
    const d = db.datasets.find((x) => x.id === params.dataset_id); if (!d) throw notFound('Dataset', params.dataset_id)
    return { ...d, versions: clone(db.versions.filter((v) => v.dataset_id === d.id)) }
  })
  route('GET', '/datasets/{dataset_id}/preview', ({ params, query }) => {
    const vs = db.versions.filter((v) => v.dataset_id === params.dataset_id); if (!vs.length) throw notFound('Dataset', params.dataset_id)
    const v = vs.find((x) => x.id === query.dataset_version_id) ?? vs[vs.length - 1]
    const limit = Math.min(Number(query.limit ?? 25), 100), offset = Number(query.offset ?? 0)
    const rows = (db.rows[v.id] ?? []).slice(offset, offset + limit)
    return { dataset_version_id: v.id, columns: v.schema, rows, total: v.rows, limit, offset }
  })
  route('POST', '/datasets/{dataset_id}/profile', ({ params, body }) => {
    const v = version(body?.dataset_version_id); if (v.dataset_id !== params.dataset_id) throw bad('MISMATCH', 'Version et dataset incohérents.')
    if (v.status === 'importing') throw new ApiErr(409, 'DATASET_NOT_READY', 'Import en cours : attendez la fin.')
    const job_id = uid('job'); db.jobs[job_id] = { id: job_id, kind: 'profile', status: 'running', progress: 0.2 }
    sleep(900).then(() => { db.jobs[job_id].progress = 0.7 }); sleep(1800).then(() => { db.profiles[v.id] = buildProfile(v.id, v.schema, db.rows[v.id] ?? [], v.rows); db.jobs[job_id].status = 'succeeded'; db.jobs[job_id].progress = 1 })
    ;(db.jobs[job_id] as any).version_id = v.id
    db.jobs['latest_profile_' + v.id] = db.jobs[job_id]
    return { job_id }
  }, { status: 202 })
  route('GET', '/datasets/{dataset_id}/profile', ({ query }) => {
    const id = query.dataset_version_id; if (db.profiles[id]) return clone(db.profiles[id])
    const j = db.jobs['latest_profile_' + id]; if (j) return clone(j)
    throw notFound('Profil', id)
  })

  route('GET', '/preprocessing/catalog', () => TRANSFORMS)
  route('POST', '/preprocessing/recommendations', ({ body }) => recommend(body?.dataset_version_id, body?.target, body?.task))
  route('POST', '/preprocessing/validate', ({ body }) => {
    const layer = dataLayerForPreprocess(body?.dataset_version_id, body?.spec?.steps ?? [], body?.target)
    const split = db.splits.find((s) => s.id === body?.split_id)
    if (body?.split_id && !split) layer.issues.push({ code: 'D_SPLIT', severity: 'error', message: `Split introuvable : ${body.split_id}.` })
    layer.status = layerStatus(layer.issues)
    const r = aggregateReport({ id: body?.dataset_version_id }, { schema_version: '1.0', catalog_version: CATALOG_VERSION, nodes: [], edges: [], metadata: { task: body?.task ?? 'classification', origin: 'human' } }, [layer])
    r.subject = { kind: 'preprocess_spec', id: body?.spec?.id ?? 'draft' }; r.content_hash = 'ph_' + cyrb53(JSON.stringify(body?.spec?.steps ?? []))
    return r
  })
  route('POST', '/preprocessing/specs', ({ body }) => {
    const v = version(body?.dataset_version_id); const steps = body?.spec?.steps ?? body?.steps
    if (!Array.isArray(steps)) throw bad('VALIDATION', 'steps requis.')
    const hash = 'ph_' + cyrb53(JSON.stringify(steps)); const ex = db.specs.find((s) => s.content_hash === hash && s.dataset_version_id === v.id)
    if (ex) return { spec_id: ex.id, version: ex.version, content_hash: ex.content_hash }
    const n = db.specs.filter((s) => s.dataset_version_id === v.id).length + 1
    const s: C.PreprocessSpec = { id: uid('ps'), version: n, dataset_version_id: v.id, steps: clone(steps), content_hash: hash }
    db.specs.push(s); return { spec_id: s.id, version: s.version, content_hash: s.content_hash }
  }, { status: 201 })
  route('GET', '/preprocessing/specs', ({ query }) => clone(db.specs.filter((s) => !query.dataset_version_id || s.dataset_version_id === query.dataset_version_id)))
  route('GET', '/preprocessing/specs/{spec_id}', ({ params }) => clone(db.specs.find((s) => s.id === params.spec_id) ?? (() => { throw notFound('PreprocessSpec', params.spec_id) })()))
  route('POST', '/preprocessing/specs/{spec_id}/preview', ({ params, body }) => {
    const sp = db.specs.find((s) => s.id === params.spec_id); if (!sp) throw notFound('PreprocessSpec', params.spec_id)
    const split = db.splits.find((s) => s.id === body?.split_id); if (!split) throw notFound('Split', body?.split_id)
    const v = version(sp.dataset_version_id); const prof = db.profiles[v.id]
    const dropped = sp.steps.filter((s) => s.type === 'drop_columns').flatMap((s) => s.columns ?? [])
    const oh = sp.steps.filter((s) => s.type === 'onehot').flatMap((s) => s.columns ?? [])
    const before = v.schema.length - 1; const after = before - dropped.length - oh.length + oh.reduce((a, c) => a + (prof?.columns.find((x) => x.name === c)?.unique ?? 3), 0)
    const imputed = sp.steps.filter((s) => s.type.startsWith('impute')).flatMap((s) => s.columns ?? [])
    return { split_id: split.id, sample: 'apprentissage uniquement', columns_before: before, columns_after: after, missing_before: prof?.columns.filter((c) => c.missing_pct > 0).map((c) => ({ column: c.name, pct: c.missing_pct })) ?? [], missing_after: prof?.columns.filter((c) => c.missing_pct > 0 && !imputed.includes(c.name) && !dropped.includes(c.name)).map((c) => ({ column: c.name, pct: c.missing_pct })) ?? [] }
  }, { status: 200 })

  route('POST', '/splits', ({ body }) => {
    const v = version(body?.dataset_version_id); const sp: C.SplitSpec = body?.split_spec
    if (!sp) throw bad('VALIDATION', 'split_spec requis.')
    const l = dataLayerForSplit(v.id, sp, undefined, body?.task); const e = l.issues.find((i) => i.severity === 'error'); if (e) throw bad('SPLIT_INVALID', e.message, l.issues)
    const test = Math.round(v.rows * sp.test_ratio), rest = v.rows - test, val = sp.cv_folds > 1 ? Math.round(rest / sp.cv_folds) : Math.round(rest * (sp.val_ratio ?? 0.2))
    const s: C.SplitVersion = { id: uid('sp'), dataset_version_id: v.id, split_spec: sp, checksum: 'sha256:' + cyrb53(JSON.stringify(sp) + v.checksum).slice(0, 10) + '…', counts: { train: rest - val, validation: val, test }, target_distribution: targetDistribution(v.id, sp.target) }
    db.splits.push(s); return { split_id: s.id, checksum: s.checksum }
  }, { status: 201 })
  route('GET', '/splits', ({ query }) => clone(db.splits.filter((s) => !query.dataset_version_id || s.dataset_version_id === query.dataset_version_id)))
  route('GET', '/splits/{split_id}', ({ params }) => clone(db.splits.find((s) => s.id === params.split_id) ?? (() => { throw notFound('Split', params.split_id) })()))
}
