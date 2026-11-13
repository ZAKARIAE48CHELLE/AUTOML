import type { DatasetColumn, ModelSpec, Task, WorkflowSpec } from '@contracts/src'
import { CATALOG_VERSION, MODEL_CATALOG, PREPROCESS_STEP_BY_TYPE, guessRoles, metricDirection, pipelineType, validateStructure } from '@contracts/src'
import { autoWire, defaultModel, STAGE, stepColumns } from '../palette/blocks'

/* Code → pipeline : analyse statique (le code n'est JAMAIS exécuté) de scripts Python scikit-learn / pandas
 * et des bibliothèques usuelles par type (statsmodels, implicit, torchvision, transformers). */

export type FindingKind = 'dataset' | 'target' | 'split' | 'step' | 'model' | 'tune' | 'metric' | 'compare' | 'final_test' | 'register' | 'unsupported'
export interface Finding { line: number; end: number; kind: FindingKind; label: string; status: 'ok' | 'approx' | 'unsupported'; data: Record<string, any>; node?: string }
export interface ParseResult { code: string; findings: Finding[]; task: Task; taskReason: string }

/** Extrait le code d'un notebook Jupyter (.ipynb) ; renvoie le texte tel quel sinon. */
export function sourceOf(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{')) return text
  try {
    const nb = JSON.parse(t) as { cells?: { cell_type: string; source: string | string[] }[] }
    return (nb.cells ?? []).filter((c) => c.cell_type === 'code').map((c) => (Array.isArray(c.source) ? c.source.join('') : c.source)).join('\n\n')
  } catch { return text }
}

/** Instructions logiques : lignes jointes tant que des parenthèses/crochets restent ouverts ; commentaires retirés. */
function statements(code: string): { text: string; line: number; end: number }[] {
  const out: { text: string; line: number; end: number }[] = []
  const lines = code.split(/\r?\n/)
  let buf = '', start = 0, depth = 0
  lines.forEach((raw, i) => {
    let line = '', q: string | null = null
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k]
      if (q) { line += ch; if (ch === q && raw[k - 1] !== '\\') q = null; continue }
      if (ch === '#') break
      if (ch === '"' || ch === "'") q = ch
      if ('([{'.includes(ch)) depth++
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
      line += ch
    }
    if (!buf) start = i + 1
    buf += (buf ? ' ' : '') + line.trim()
    if (depth === 0) { if (buf.trim()) out.push({ text: buf, line: start, end: i + 1 }); buf = '' }
  })
  if (buf.trim()) out.push({ text: buf, line: start, end: lines.length })
  return out
}

const num = (s?: string) => { if (s === undefined) return undefined; const n = Number(s); return Number.isNaN(n) ? undefined : n }
const kw = (text: string, name: string) => text.match(new RegExp(`\\b${name}\\s*=\\s*(\\([^)]*\\)|[^,()]+)`))?.[1]?.trim()
const strLit = (v?: string) => v?.match(/^['"](.*)['"]$/)?.[1]
const strList = (s: string) => [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
const literal = (v?: string): unknown => { if (v === undefined) return undefined; if (/^['"]/.test(v)) return strLit(v); if (v === 'True' || v === 'False') return v === 'True'; return num(v) }

/** Classe → modèle du catalogue. `approx` : équivalent le plus proche (bibliothèque non disponible). */
const MODEL_MAP: [RegExp, string, ('ok' | 'approx')?, string?][] = [
  [/\bLogisticRegression\(/, 'logistic_regression'], [/\bRandomForest(Classifier|Regressor)\(/, 'random_forest'],
  [/\b(Hist)?GradientBoosting(Classifier|Regressor)\(/, 'gradient_boosting'], [/\bXGB(Classifier|Regressor)\(/, 'gradient_boosting', 'approx', 'XGBoost → gradient boosting'],
  [/\bLGBM(Classifier|Regressor)\(/, 'gradient_boosting', 'approx', 'LightGBM → gradient boosting'], [/\bCatBoost(Classifier|Regressor)\(/, 'gradient_boosting', 'approx', 'CatBoost → gradient boosting'],
  [/\bKNeighbors(Classifier|Regressor)\(/, 'knn'], [/\bLinearRegression\(/, 'linear_regression'], [/\bRidge\(/, 'ridge'], [/\bMLP(Classifier|Regressor)\(/, 'mlp'],
  [/\bKMeans\(/, 'kmeans'], [/\bGaussianMixture\(/, 'gaussian_mixture'], [/\bDBSCAN\(/, 'dbscan'], [/\bAgglomerativeClustering\(/, 'agglomerative'],
  [/\bIsolationForest\(/, 'isolation_forest'], [/\bLocalOutlierFactor\(/, 'local_outlier_factor'], [/\bOneClassSVM\(/, 'one_class_svm'],
  [/\bExponentialSmoothing\(/, 'exponential_smoothing'], [/\b(S?ARIMA|SARIMAX)\(/, 'arima'], [/\bProphet\(/, 'exponential_smoothing', 'approx', 'Prophet → lissage exponentiel'],
  [/\b(LinearSVC\(|SVC\([^)]*kernel\s*=\s*['"]linear)/, 'linear_svm'], [/\bMultinomialNB\(/, 'naive_bayes'],
  [/\b(AutoModelForSequenceClassification|Trainer)\b/, 'transformer_finetune'], [/\bresnet\d+\(/i, 'resnet_transfer'], [/\befficientnet_?b\d\(/i, 'efficientnet_transfer'],
  [/\bhog\(/, 'hog_svm'], [/\bAlternatingLeastSquares\(/, 'als'], [/\bSVD\(/, 'svd_mf'], [/\b(ItemItemRecommender|CosineRecommender)\(/, 'item_knn'],
]
type StepRule = [RegExp, string, (t: string) => Record<string, unknown> | undefined]
const STEP_MAP: StepRule[] = [
  [/\bSimpleImputer\([^)]*strategy\s*=\s*['"]median/, 'impute_median', () => undefined], [/\bSimpleImputer\([^)]*strategy\s*=\s*['"]most_frequent/, 'impute_most_frequent', () => undefined],
  [/\bSimpleImputer\(/, 'impute_mean', () => undefined], [/\.fillna\([^)]*median\(\)/, 'impute_median', () => undefined], [/\.fillna\([^)]*mean\(\)/, 'impute_mean', () => undefined],
  [/\bOneHotEncoder\(|pd\.get_dummies\(/, 'onehot', () => undefined], [/\b(OrdinalEncoder|LabelEncoder)\(/, 'ordinal', () => undefined],
  [/\bStandardScaler\(/, 'standard_scale', () => undefined], [/\bMinMaxScaler\(/, 'minmax_scale', () => undefined],
  [/\bPCA\(/, 'pca', (t) => ({ n_components: num(kw(t, 'n_components')) ?? 10 })],
  [/\b(TfidfVectorizer|CountVectorizer)\(/, 'tfidf', (t) => ({ max_features: num(kw(t, 'max_features')) ?? 20000, ngram_max: Number(kw(t, 'ngram_range')?.match(/,\s*(\d)/)?.[1] ?? 1) })],
  [/\.str\.lower\(\)|re\.sub\(/, 'text_clean', () => ({ lowercase: true, strip_punctuation: true, stopwords: 'fr' })],
  [/\.shift\(\s*\d+/, 'lag_features', (t) => ({ lags: [...t.matchAll(/\.shift\(\s*(\d+)/g)].map((m) => Number(m[1])) })],
  [/\.rolling\(/, 'rolling_features', (t) => ({ window: num(t.match(/\.rolling\(\s*(?:window\s*=\s*)?(\d+)/)?.[1]) ?? 7, stats: ['mean'] })],
  [/\.dt\.(month|dayofweek|weekday|year|day|hour)/, 'date_features', (t) => ({ parts: [...new Set([...t.matchAll(/\.dt\.(month|dayofweek|weekday|year|day|hour)/g)].map((m) => (m[1] === 'dayofweek' ? 'weekday' : m[1])))] })],
  [/groupby\(\s*['"](user|item|client|product)\w*['"]\s*\)\.size\(\)/, 'min_interactions', () => ({ min_user: 5, min_item: 5 })],
  [/\btransforms\.Resize\(/, 'image_resize', (t) => ({ size: Number(t.match(/Resize\(\s*\(?(\d+)/)?.[1] ?? 224) })],
  [/\btransforms\.Normalize\(/, 'image_normalize', () => ({ preset: 'imagenet' })],
  [/\btransforms\.(RandomHorizontalFlip|RandomRotation)\(/, 'image_augment', (t) => ({ flip: /RandomHorizontalFlip/.test(t), rotate_deg: Number(t.match(/RandomRotation\(\s*(\d+)/)?.[1] ?? 15) })],
]
const METRIC_MAP: [RegExp, string][] = [
  [/f1(_score|_macro|_weighted)?\b/, 'f1'], [/roc_auc/, 'roc_auc'], [/accuracy/, 'accuracy'], [/precision_score|^precision$/, 'precision'], [/recall_score|^recall$/, 'recall'],
  [/mean_absolute_percentage_error|\bmape\b/, 'mape'], [/mean_absolute_error|neg_mean_absolute_error|\bmae\b/, 'mae'], [/mean_squared_error|rmse/, 'rmse'], [/r2_score|^r2$/, 'r2'],
  [/silhouette_score/, 'silhouette'], [/davies_bouldin/, 'davies_bouldin'], [/calinski/, 'calinski_harabasz'], [/average_precision/, 'average_precision'], [/ndcg/, 'ndcg_at_k'], [/precision_at_k/, 'precision_at_k'],
]

/** Analyse le code : constats ligne par ligne + type de pipeline déduit. */
export function parseCode(text: string): ParseResult {
  const code = sourceOf(text)
  const vars = new Map<string, string[]>()  // num_cols = ['a', 'b']
  const findings: Finding[] = []
  const push = (st: { line: number; end: number }, kind: FindingKind, label: string, data: Record<string, any> = {}, status: Finding['status'] = 'ok') => findings.push({ line: st.line, end: st.end, kind, label, status, data })
  const colsIn = (t: string) => {
    const lists = [...t.matchAll(/\[([^[\]]*['"][^[\]]*)\]/g)].flatMap((m) => strList(m[1]))
    const named = [...t.matchAll(/\b([a-z_]\w*)\b/gi)].flatMap((m) => vars.get(m[1]) ?? [])
    return [...new Set([...lists, ...named])]
  }

  for (const st of statements(code)) {
    const t = st.text
    const asg = t.match(/^([a-z_]\w*)\s*=\s*\[([^\]]*)\]\s*$/i); if (asg && /['"]/.test(asg[2])) vars.set(asg[1], strList(asg[2]))
    const tgtConst = t.match(/^(TARGET|target|LABEL|label|target_col)\s*=\s*['"]([^'"]+)['"]/)
    if (tgtConst) push(st, 'target', `Cible : ${tgtConst[2]}`, { column: tgtConst[2] })
    const file = t.match(/read_(?:csv|parquet|excel|json)\(\s*['"]([^'"]+)['"]/) ?? t.match(/ImageFolder\(\s*(?:root\s*=\s*)?['"]([^'"]+)['"]/)
    if (file) push(st, 'dataset', `Données : ${file[1]}`, { file: file[1].split(/[\\/]/).pop() })
    const y = t.match(/^y(?:_train)?\s*=\s*\w+\[\s*['"]([^'"]+)['"]\s*\]/) ?? t.match(/\.drop\(\s*(?:columns\s*=\s*)?\[?\s*['"]([^'"]+)['"]\s*\]?\s*,\s*axis\s*=\s*1/)
    if (y && !tgtConst) push(st, 'target', `Cible : ${y[1]}`, { column: y[1] })
    if (/train_test_split\(/.test(t)) {
      const strat = /stratify\s*=/.test(t), time = /shuffle\s*=\s*False/.test(t)
      push(st, 'split', `Découpage ${time ? 'temporel' : strat ? 'stratifié' : 'aléatoire'}`, { strategy: time ? 'time' : strat ? 'stratified' : 'random', test_ratio: num(kw(t, 'test_size')) ?? 0.2, seed: num(kw(t, 'random_state')) ?? 42 })
    }
    const cv = t.match(/\b(Stratified|Group)?KFold\(|TimeSeriesSplit\(/)
    if (cv) push(st, 'split', `Validation croisée${/TimeSeries/.test(t) ? ' temporelle' : ''}`, { cv_folds: num(kw(t, 'n_splits')) ?? 5, ...(cv[1] === 'Stratified' ? { strategy: 'stratified' } : cv[1] === 'Group' ? { strategy: 'group' } : /TimeSeries/.test(t) ? { strategy: 'time' } : {}) })
    let imputed = false
    for (const [re, type, params] of STEP_MAP) {
      const m = re.exec(t)
      if (!m || (imputed && type.startsWith('impute'))) continue
      if (type.startsWith('impute')) imputed = true
      // Portée de la transformation : jusqu'à la fin du tuple qui la contient (ColumnTransformer : (nom, transfo, colonnes)).
      let depth = 0, end = t.length
      for (let k = m.index; k < t.length; k++) { const ch = t[k]; if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) { depth--; if (depth < 0) { end = k; break } } }
      const scope = t.slice(m.index, end)
      push(st, 'step', PREPROCESS_STEP_BY_TYPE[type]?.label ?? type, { type, columns: colsIn(scope), params: params(t) }, /CountVectorizer/.test(t) && type === 'tfidf' ? 'approx' : 'ok')
    }
    const drop = t.match(/\.drop\(\s*columns\s*=\s*\[([^\]]+)\]/)
    if (drop && !y) push(st, 'step', PREPROCESS_STEP_BY_TYPE.drop_columns.label, { type: 'drop_columns', columns: strList(drop[1]) })
    const isTune = /\b(GridSearchCV|RandomizedSearchCV|BayesSearchCV)\(|optuna\.create_study/.test(t)
    const hit = MODEL_MAP.find(([re]) => re.test(t))
    if (hit) {
      const [, id, status, note] = hit
      const m = MODEL_CATALOG.find((x) => x.id === id)!
      const params = Object.fromEntries(Object.keys(m.params_schema.properties ?? {}).map((k) => [k, literal(kw(t, k))]).filter(([, v]) => v !== undefined))
      if (isTune) {
        const grid = t.match(/\{([^{}]*)\}/)?.[1] ?? ''
        const space = Object.fromEntries([...grid.matchAll(/['"](?:\w+__)?(\w+)['"]\s*:\s*\[([^\]]*)\]/g)].map((g) => { const vals = g[2].split(',').map(Number).filter((v) => !Number.isNaN(v)); return [g[1], vals.length ? [Math.min(...vals), Math.max(...vals)] : null] }).filter(([, v]) => v))
        push(st, 'tune', `Optimisation de ${m.label}`, { model_id: id, search_space: space, trials: num(kw(t, 'n_iter')) ?? 20 }, status ?? 'ok')
      } else push(st, 'model', note ? `${m.label} (${note})` : m.label, { model_id: id, params }, status ?? 'ok')
    } else if (isTune) push(st, 'tune', 'Optimisation (modèle défini plus haut)', { trials: num(kw(t, 'n_iter')) ?? 20 })
    else {
      const unk = t.match(/\b(\w+(?:Classifier|Regressor|Sequential|Net|Model))\(/)
      if (unk && !/^(Auto|Base)/.test(unk[1])) push(st, 'unsupported', `${unk[1]} : non pris en charge`, {}, 'unsupported')
    }
    const scoring = strLit(kw(t, 'scoring'))
    const metricText = scoring ?? (/(_score|metrics\.|mean_\w+_error)\(/.test(t) ? t : '')
    const metric = metricText && METRIC_MAP.find(([re]) => re.test(metricText))
    if (metric) push(st, 'metric', `Métrique : ${metric[1]}`, { metric: metric[1] })
    if (/cross_val_score\(|cross_validate\(/.test(t)) push(st, 'compare', 'Comparaison par validation croisée')
    if (/\.(score|predict(?:_proba)?)\(\s*X_test/.test(t) || (/y_test/.test(t) && /(_score|_error)\(/.test(t))) push(st, 'final_test', 'Évaluation sur le jeu de test')
    const reg = t.match(/registered_model_name\s*=\s*['"]([^'"]+)['"]/) ?? t.match(/(?:joblib|pickle)\.dump\([^,]+,\s*(?:open\()?\s*['"]([^'"]+?)(?:\.(?:pkl|joblib))?['"]/)
    if (reg) push(st, 'register', `Enregistrement : ${reg[1]}`, { name: reg[1].replace(/[^\w-]+/g, '-') })
  }
  const { task, reason } = detectTask(findings, code)
  const seen = new Set<string>()
  return { code, task, taskReason: reason, findings: findings.filter((x) => { const k = `${x.line}|${x.kind}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true }) }
}

function detectTask(f: Finding[], code: string): { task: Task; reason: string } {
  const models = f.filter((x) => x.kind === 'model' || x.kind === 'tune').map((x) => MODEL_CATALOG.find((m) => m.id === x.data.model_id)).filter(Boolean) as ModelSpec[]
  const steps = new Set(f.filter((x) => x.kind === 'step').map((x) => x.data.type as string))
  if (models.some((m) => m.task.includes('recommendation')) || /\bimport implicit\b|from implicit|from surprise/.test(code)) return { task: 'recommendation', reason: 'bibliothèque ou modèle de recommandation' }
  if (models.some((m) => m.task.includes('image_classification')) || [...steps].some((s) => s.startsWith('image_'))) return { task: 'image_classification', reason: 'transformations ou modèle d\'images' }
  if (steps.has('tfidf') || steps.has('text_clean') || models.some((m) => m.id === 'transformer_finetune' || m.id === 'naive_bayes')) return { task: 'text_classification', reason: 'vectorisation de texte' }
  if (models.some((m) => m.task.includes('clustering'))) return { task: 'clustering', reason: 'algorithme de clustering' }
  if (models.some((m) => m.task.includes('anomaly_detection'))) return { task: 'anomaly_detection', reason: 'détecteur d\'anomalies' }
  if (models.some((m) => m.task.includes('forecasting')) || ((steps.has('lag_features') || steps.has('rolling_features')) && /Regressor\(/.test(code))) return { task: 'forecasting', reason: 'retards ou modèle de série temporelle' }
  if (/\w+Regressor\(|LinearRegression\(|Ridge\(/.test(code)) return { task: 'regression', reason: 'modèle de régression' }
  return { task: 'classification', reason: models.length ? 'modèle de classification' : 'par défaut' }
}

/**
 * Construit le pipeline : dataset → split → prétraitement → modèles/tuning → comparaison → test final → enregistrement,
 * câblé automatiquement. Colonnes absentes du dataset ignorées ; à défaut, déduites du type de pipeline.
 */
export function buildFromCode(r: ParseResult, ctx: { dsvId?: string; columns: DatasetColumn[]; task?: Task; models?: (ModelSpec & { disabled?: boolean })[] }): { spec: WorkflowSpec; findings: Finding[] } {
  const task = ctx.task ?? r.task; const pt = pipelineType(task)
  const findings = r.findings.map((f) => ({ ...f, data: { ...f.data } }))
  const names = new Set(ctx.columns.map((c) => c.name))
  const target = findings.find((f) => f.kind === 'target' && (!names.size || names.has(f.data.column)))?.data.column as string | undefined
  const metric = (findings.find((f) => f.kind === 'metric' && pt.metrics.includes(f.data.metric))?.data.metric as string | undefined) ?? pt.default_metric
  let spec: WorkflowSpec = { schema_version: '1.0', catalog_version: CATALOG_VERSION, nodes: [], edges: [], metadata: { task, target, origin: 'human', objective: { primary_metric: metric, direction: metricDirection(metric) } } }
  const place = (type: string) => { const col = STAGE[type] ?? 3; return { x: col * 250, y: spec.nodes.filter((n) => (STAGE[n.type] ?? 3) === col).length * 150 } }
  const addNode = (type: string, params: Record<string, unknown>, from: Finding[] = []) => {
    const id = `n${spec.nodes.length + 1}`
    spec = autoWire({ ...spec, nodes: [...spec.nodes, { id, type, type_version: '1.0', params, ui: place(type) }] }, id)
    from.forEach((f) => { f.node = id })
    return id
  }
  addNode('data.dataset', { dataset_version_id: ctx.dsvId ?? '' }, findings.filter((f) => f.kind === 'dataset'))
  const splitF = findings.filter((f) => f.kind === 'split')
  const sp = Object.assign({}, ...splitF.map((f) => f.data)) as Record<string, any>
  const roles = guessRoles(ctx.columns, task, target)
  const strategy = pt.split_strategies.includes(sp.strategy) ? sp.strategy : pt.default_split
  addNode('data.split', { strategy, test_ratio: sp.test_ratio ?? 0.2, cv_folds: sp.cv_folds ?? 5, seed: sp.seed ?? 42, ...roles }, [...splitF, ...findings.filter((f) => f.kind === 'target')])
  findings.filter((f) => f.kind === 'step' && !pt.step_types.includes(f.data.type)).forEach((f) => { f.status = 'unsupported'; f.label = `${f.label} : non adapté à ${pt.label}` })
  const stepF = findings.filter((f) => f.kind === 'step' && pt.step_types.includes(f.data.type))
  const preId = addNode('data.preprocess', { steps: [] }, stepF)
  const merged = new Map<string, { type: string; columns: string[]; params?: Record<string, unknown> }>()
  for (const f of stepF) {
    const prev = merged.get(f.data.type); const cols = (f.data.columns as string[]).filter((c) => names.has(c))
    if (!prev) { merged.set(f.data.type, { type: f.data.type, columns: cols, params: f.data.params }); continue }
    prev.columns = [...new Set([...prev.columns, ...cols])]
    if (f.data.params) prev.params = Object.fromEntries(Object.entries({ ...prev.params, ...f.data.params }).map(([k, v]) => [k, Array.isArray(v) && Array.isArray(prev.params?.[k]) ? [...new Set([...(prev.params![k] as unknown[]), ...v])] : v]))
  }
  const steps = [...merged.values()].map((m) => ({ type: m.type, columns: m.columns.length ? m.columns : stepColumns(m.type, ctx.columns, spec), ...(m.params ? { params: m.params } : {}) }))
  spec = { ...spec, nodes: spec.nodes.map((n) => (n.id === preId ? { ...n, params: { steps } } : n)) }
  const modelF = findings.filter((f) => f.kind === 'model' || f.kind === 'tune')
  const fallback = defaultModel(task, ctx.models)
  for (const f of modelF) {
    let m = MODEL_CATALOG.find((x) => x.id === f.data.model_id)
    if (task === 'forecasting' && m && (m.id === 'gradient_boosting' || m.id === 'random_forest')) { m = MODEL_CATALOG.find((x) => x.id === 'gbm_lag_regressor'); f.label += ' → gradient boosting sur retards' }
    const use = m && m.task.includes(task) ? m : fallback
    if (m && use !== m) { f.status = 'approx'; f.label += ` → remplacé par ${fallback?.label} (non adapté à ${pt.label})` }
    if (f.kind === 'tune') addNode('train.tune', { model_id: use?.id, primary_metric: metric, seed: 42, search_space: f.data.search_space ?? {}, budget: { trials: Math.min(100, f.data.trials ?? 20), max_minutes: 10 } }, [f])
    else addNode('train.model', { model_id: use?.id, params: use === m ? f.data.params ?? {} : {}, primary_metric: metric, seed: 42 }, [f])
  }
  if (!modelF.length) addNode('train.model', { model_id: fallback?.id, params: {}, primary_metric: metric, seed: 42 })
  addNode('eval.compare', { min_succeeded: 1 }, findings.filter((f) => f.kind === 'compare' || f.kind === 'metric'))
  const regF = findings.filter((f) => f.kind === 'register')
  if (findings.some((f) => f.kind === 'final_test') || regF.length) addNode('eval.final_test', {}, findings.filter((f) => f.kind === 'final_test'))
  if (regF.length) addNode('model.register', { name: regF[0].data.name }, regF)
  return { spec, findings }
}

export const structureErrors = (spec: WorkflowSpec) => validateStructure(spec).filter((i) => i.severity === 'error')

/**
 * Fusion dans le pipeline courant : étapes de prétraitement et modèles/tuning du code ajoutés à l'existant
 * (nœud de prétraitement créé au besoin), câblage automatique.
 */
export function mergeInto(current: WorkflowSpec, built: WorkflowSpec, wire: (s: WorkflowSpec, id: string) => WorkflowSpec): WorkflowSpec {
  let spec = current
  const steps = built.nodes.find((n) => n.type === 'data.preprocess')?.params.steps ?? []
  let pre = spec.nodes.find((n) => n.type === 'data.preprocess')
  const nextId = () => `n${Math.max(0, ...spec.nodes.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1}`
  if (steps.length && !pre) { const id = nextId(); spec = wire({ ...spec, nodes: [...spec.nodes, { id, type: 'data.preprocess', type_version: '1.0', params: { steps: [] }, ui: { x: 500, y: 0 } }] }, id); pre = spec.nodes.find((n) => n.id === id) }
  if (pre && steps.length) { const pid = pre.id; spec = { ...spec, nodes: spec.nodes.map((n) => (n.id === pid ? { ...n, params: { ...n.params, steps: [...(n.params.steps ?? []), ...steps] } } : n)) } }
  for (const n of built.nodes.filter((x) => x.type === 'train.model' || x.type === 'train.tune')) {
    const id = nextId(); const y = Math.max(0, ...spec.nodes.filter((x) => x.type.startsWith('train.')).map((x) => (x.ui?.y ?? 0) + 150))
    spec = wire({ ...spec, nodes: [...spec.nodes, { ...n, id, ui: { x: 750, y } }] }, id)
  }
  return spec
}
