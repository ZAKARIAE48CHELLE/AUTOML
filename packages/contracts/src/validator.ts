import type { ValidationIssue, ValidationLayer, ValidationReport, WorkflowSpec, NodeType, LayerName } from './types'
import { NODE_TYPE_BY_ID, CATALOG_VERSION, MAX_NODES } from './catalog'
import { validateSchema } from './jsonschema'
import { contentHash } from './hash'

export interface StructureContext { caps?: { trials: number; max_minutes: number } }
const err = (code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue => ({ code, severity: 'error', message, ...extra })

export function layerStatus(issues: ValidationIssue[]): 'ok' | 'warning' | 'error' {
  return issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : 'ok'
}

/** Couche « structure » (E4) : règles V1 à V10, calcul local et déterministe. */
export function validateStructure(spec: WorkflowSpec, ctx: StructureContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodes = new Map(spec.nodes.map((n) => [n.id, n]))
  // V9 — types connus
  for (const n of spec.nodes) {
    if (!NODE_TYPE_BY_ID[n.type]) issues.push(err('V9', `Type de nœud inconnu « ${n.type} » dans le catalogue ${spec.catalog_version}.`, { node_id: n.id }))
  }
  if (spec.catalog_version !== CATALOG_VERSION) issues.push(err('V9', `Version de catalogue ${spec.catalog_version} introuvable (courante : ${CATALOG_VERSION}).`))
  if (issues.length) return issues
  const T = (id: string): NodeType => NODE_TYPE_BY_ID[nodes.get(id)!.type]
  // V10 — limites
  if (spec.nodes.filter((n) => n.type === 'data.dataset').length > 1) issues.push(err('V10', 'Un seul nœud data.dataset est autorisé par workflow (MVP).'))
  if (spec.nodes.length > MAX_NODES) issues.push(err('V10', `Maximum ${MAX_NODES} nœuds (actuellement ${spec.nodes.length}).`))
  if (ctx.caps) {
    for (const n of spec.nodes.filter((x) => x.type === 'train.tune')) {
      const b = n.params?.budget
      if (b?.trials > ctx.caps.trials) issues.push(err('V10', `Budget de tuning : ${b.trials} essais > plafond ${ctx.caps.trials}.`, { node_id: n.id, path: 'budget.trials' }))
      if (b?.max_minutes > ctx.caps.max_minutes) issues.push(err('V10', `Budget de tuning : ${b.max_minutes} min > plafond ${ctx.caps.max_minutes}.`, { node_id: n.id, path: 'budget.max_minutes' }))
    }
  }
  // V2 — ports et types, cardinalité
  const incoming: Record<string, Record<string, string[]>> = {}
  const adj: Record<string, string[]> = {}
  spec.nodes.forEach((n) => { incoming[n.id] = {}; adj[n.id] = [] })
  for (const e of spec.edges) {
    if (!nodes.has(e.from.node) || !nodes.has(e.to.node)) { issues.push(err('V2', `Arête ${e.id} : nœud inexistant.`)); continue }
    const fp = T(e.from.node).output_ports.find((p) => p.name === e.from.port)
    const tp = T(e.to.node).input_ports.find((p) => p.name === e.to.port)
    if (!fp || !tp) { issues.push(err('V2', `Arête ${e.id} : port inexistant.`, { node_id: e.to.node })); continue }
    if (fp.type !== tp.type) { issues.push(err('V2', `Arête ${e.id} : types incompatibles (${fp.type} → ${tp.type}).`, { node_id: e.to.node, hint: 'Reliez des ports de même type.' })); continue }
    ;(incoming[e.to.node][e.to.port] ||= []).push(e.from.node)
    adj[e.from.node].push(e.to.node)
  }
  for (const [nid, ports] of Object.entries(incoming)) {
    for (const [pname, srcs] of Object.entries(ports)) {
      const def = T(nid).input_ports.find((p) => p.name === pname)!
      if (srcs.length > 1 && !def.multiple) issues.push(err('V2', `Le port ${pname} de ${nid} n'accepte qu'une seule arête entrante.`, { node_id: nid }))
    }
  }
  // V1 — cycle
  const color: Record<string, number> = {}
  const dfs = (u: string): boolean => {
    color[u] = 1
    for (const v of adj[u]) { if (color[v] === 1) return true; if (!color[v] && dfs(v)) return true }
    color[u] = 2
    return false
  }
  if (spec.nodes.some((n) => !color[n.id] && dfs(n.id))) { issues.push(err('V1', 'Le graphe contient un cycle.', { hint: 'Un workflow doit être acyclique (DAG).' })); return issues }
  // V3 — entrées obligatoires
  for (const n of spec.nodes) {
    for (const p of T(n.id).input_ports) {
      if (!incoming[n.id][p.name]?.length) issues.push(err('V3', `Entrée « ${p.name} » non connectée.`, { node_id: n.id, hint: `Connectez une sortie ${p.type}.` }))
    }
  }
  // V4 — paramètres vs JSON Schema
  for (const n of spec.nodes) {
    for (const i of validateSchema(n.params ?? {}, T(n.id).params_schema)) issues.push(err('V4', `${i.path || 'params'} : ${i.message}`, { node_id: n.id, path: i.path }))
  }
  if (issues.some((i) => i.code === 'V3')) return issues
  // ancêtres / lignée
  const parents: Record<string, Set<string>> = {}
  spec.nodes.forEach((n) => (parents[n.id] = new Set()))
  for (const u of Object.keys(adj)) for (const v of adj[u]) parents[v].add(u)
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => { for (const p of parents[id]) if (!seen.has(p)) { seen.add(p); ancestors(p, seen) } return seen }
  const splitOf = (id: string): string | null => {
    const n = nodes.get(id)!
    if (n.type === 'data.split') return id
    const port = T(id).input_ports.find((p) => p.name === 'split')
    return port ? splitOf(incoming[id]['split'][0]) : null
  }
  // V5 — lignée de split commune
  const trainLineages = new Set<string>()
  for (const n of spec.nodes.filter((x) => x.type === 'train.model' || x.type === 'train.tune')) {
    const s1 = splitOf(incoming[n.id].split[0]); const s2 = splitOf(incoming[n.id].spec[0])
    if (s1 !== s2) issues.push(err('V5', 'Le split et le prétraitement viennent de lignées différentes.', { node_id: n.id, hint: 'Reliez un prétraitement construit sur le même split.' }))
    if (s1) trainLineages.add(s1)
  }
  if (trainLineages.size > 1) issues.push(err('V5', 'Les nœuds train.* utilisent plusieurs splits : un graphe cohérent n\'en partage qu\'un.'))
  // V6 — protocole commun des entrées d'un eval.compare
  const protocol = (id: string) => {
    const n = nodes.get(id)!
    if (n.type === 'train.model' || n.type === 'train.tune') return `${splitOf(incoming[id].split[0])}|${n.params?.primary_metric}`
    if (n.type === 'eval.final_test') return protocol(incoming[id].run[0])
    return 'x'
  }
  for (const n of spec.nodes.filter((x) => x.type === 'eval.compare')) {
    const protos = new Set((incoming[n.id].runs ?? []).map(protocol))
    if (protos.size > 1) issues.push(err('V6', 'Les runs comparés ne partagent pas split / métrique principale / protocole.', { node_id: n.id, hint: 'Alignez primary_metric et le split des nœuds train.*.' }))
  }
  // V7 — final_test en aval d'un compare ; V8 — register en aval d'un final_test
  for (const n of spec.nodes) {
    if (n.type === 'eval.final_test' && ![...ancestors(n.id)].some((a) => nodes.get(a)!.type === 'eval.compare')) issues.push(err('V7', 'eval.final_test doit être en aval d\'un eval.compare.', { node_id: n.id, hint: 'Sélectionnez d\'abord sur la validation, testez ensuite.' }))
    if (n.type === 'model.register' && ![...ancestors(n.id)].some((a) => nodes.get(a)!.type === 'eval.final_test')) issues.push(err('V8', 'model.register doit être en aval d\'un eval.final_test.', { node_id: n.id }))
  }
  return issues
}

export function structureLayer(spec: WorkflowSpec, ctx?: StructureContext): ValidationLayer {
  const issues = validateStructure(spec, ctx)
  return { layer: 'structure', status: layerStatus(issues), issues }
}

/** Agrège les couches en un ValidationReport unique. Les couches absentes sont simplement omises. */
export function aggregateReport(version: { id: string; workflow_id?: string }, spec: WorkflowSpec, layers: ValidationLayer[]): ValidationReport {
  const order: LayerName[] = ['structure', 'data', 'training', 'policy']
  const sorted = [...layers].sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer))
  const status = sorted.some((l) => l.status === 'error') ? 'error' : sorted.some((l) => l.status === 'warning') ? 'warning' : 'ok'
  return { subject: { kind: 'workflow_version', id: version.id }, content_hash: contentHash(spec), status, layers: sorted, catalog_version: spec.catalog_version }
}
