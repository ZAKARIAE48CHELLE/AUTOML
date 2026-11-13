import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Controls, Handle, Position, ReactFlowProvider, useReactFlow, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps } from '@xyflow/react'
import type { WorkflowSpec, NodeStatus, PortType } from '@contracts/src'
import { NODE_TYPE_BY_ID } from '@contracts/src'
import { clsx } from '@/lib/format'
import { useTheme } from '@/lib/theme'
import { GridFx, createFxBus } from './GridFx'
import { BLOCK_MIME } from './palette/blocks'

const PORT_COLOR: Record<PortType, string> = { Dataset: '#0e7490', Split: '#7c3aed', PreprocessSpecRef: '#c2410c', ModelRun: '#2563eb', Leaderboard: '#65a30d', ModelVersion: '#be185d' }
const CLS: Record<string, string> = { L0: 'bg-slate-100 text-slate-600', L1: 'bg-blue-100 text-blue-700', L2: 'bg-amber-100 text-amber-800', L3: 'bg-red-100 text-red-700' }
const STATUS_RING: Record<string, string> = { running: 'ring-2 ring-blue-400 node-running', succeeded: 'ring-2 ring-green-500 node-done', failed: 'ring-2 ring-red-500 node-failed', cancelled: 'ring-2 ring-orange-400', skipped: 'opacity-50', pending: '', queued: '' }
export type Sev = 'error' | 'warning'
interface NData extends Record<string, unknown> { type: string; id: string; severity?: Sev; status?: NodeStatus; cached?: boolean; summary: string }

function StudioNode({ data, selected }: NodeProps<Node<NData>>) {
  const t = NODE_TYPE_BY_ID[data.type]; const rows = Math.max(t?.input_ports.length ?? 0, t?.output_ports.length ?? 0, 1)
  return (
    <div className={clsx('studio-node node-pop min-w-[180px] rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md', selected ? 'border-brand-600 ring-2 ring-brand-500/30' : 'border-slate-300', data.severity === 'error' && '!border-red-500 ring-2 ring-red-300', data.severity === 'warning' && !selected && '!border-amber-400', data.status && STATUS_RING[data.status])} style={{ minHeight: 48 + rows * 22 }}>
      <div className="flex items-center justify-between gap-2 rounded-t-lg border-b bg-slate-50 px-2.5 py-1.5"><span className="text-xs font-semibold text-slate-800">{t?.label ?? data.type}</span><span className={clsx('rounded px-1 text-[10px] font-medium', CLS[t?.operation_class ?? 'L0'])}>{t?.operation_class}</span></div>
      <div className="px-2.5 py-1.5 text-[11px] text-slate-500"><span className="font-mono text-slate-400">{data.id}</span> · {data.summary}{data.status && <div className="mt-0.5 font-medium text-slate-700">{data.status}{data.cached ? ' (cache)' : ''}</div>}</div>
      {t?.input_ports.map((p, i) => <Handle key={p.name} id={p.name} type="target" position={Position.Left} style={{ top: 58 + i * 22, background: PORT_COLOR[p.type], width: 10, height: 10 }} title={`${p.name} : ${p.type}${p.multiple ? ' (1..n)' : ''}`} />)}
      {t?.output_ports.map((p, i) => <Handle key={p.name} id={p.name} type="source" position={Position.Right} style={{ top: 58 + i * 22, background: PORT_COLOR[p.type], width: 10, height: 10 }} title={`${p.name} : ${p.type}`} />)}
      <div className="flex justify-between px-2.5 pb-1.5 text-[10px] text-slate-400"><div>{t?.input_ports.map((p) => <div key={p.name} style={{ color: PORT_COLOR[p.type] }}>● {p.name}</div>)}</div><div className="text-right">{t?.output_ports.map((p) => <div key={p.name} style={{ color: PORT_COLOR[p.type] }}>{p.name} ●</div>)}</div></div>
    </div>)
}
const nodeTypes = { studio: StudioNode }

const summarize = (type: string, p: Record<string, any>): string => {
  if (type === 'train.model' || type === 'train.tune') return p.model_id ?? 'modèle ?'
  if (type === 'data.split') return `${p.strategy ?? '?'} · ${p.cv_folds ?? '?'} plis`
  if (type === 'data.preprocess') return `${p.steps?.length ?? 0} étape(s)`
  if (type === 'data.dataset') return p.dataset_version_id ?? 'dataset ?'
  if (type === 'model.register') return p.name ?? 'nom ?'
  return ''
}
interface Props { spec: WorkflowSpec; readOnly?: boolean; onChange?: (s: WorkflowSpec) => void; selected?: string | null; onSelect?: (id: string | null) => void; severity?: Record<string, Sev>; status?: Record<string, { status: NodeStatus; cached?: boolean }>; height?: number | string
  /** Plein écran : sans bordure ni coins arrondis, contrôles de zoom centrés en bas (hors des panneaux latéraux). */
  bare?: boolean
  /** Dépôt d'un bloc de la palette (glisser-déposer) : données brutes + position dans le flux. */
  onDropBlock?: (raw: string, pos: { x: number; y: number }) => void }

type SyncArgs = Pick<Props, 'spec' | 'readOnly' | 'selected' | 'onSelect' | 'severity' | 'status'>

/**
 * Fusionne la spec dans les nœuds React Flow existants au lieu de les recréer.
 * Les champs internes (`measured`, `dragging`…) doivent être conservés : sans `measured`, React Flow
 * réinitialise les positions des poignées (handleBounds) — les liens disparaissent et les connexions échouent.
 */
function syncNodes(prev: Node<NData>[], { spec, readOnly, selected, onSelect, severity, status }: SyncArgs): Node<NData>[] {
  const old = new Map(prev.map((n) => [n.id, n]))
  return spec.nodes.map((n, i) => {
    const o = old.get(n.id)
    // Lecture seule : déplacement purement visuel (spec intacte). Édition : la spec fait foi, sauf pendant le glissement.
    const position = o && (readOnly || o.dragging) ? o.position : n.ui ?? o?.position ?? { x: i * 220, y: 0 }
    return {
      ...o, id: n.id, type: 'studio', position, draggable: true, deletable: !readOnly,
      selected: onSelect ? n.id === selected : o?.selected ?? false,
      data: { type: n.type, id: n.id, severity: severity?.[n.id], status: status?.[n.id]?.status, cached: status?.[n.id]?.cached, summary: summarize(n.type, n.params) },
    }
  })
}

function syncEdges(prev: Edge[], { spec, readOnly, status }: SyncArgs): Edge[] {
  const old = new Map(prev.map((e) => [e.id, e]))
  return spec.edges.map((e) => {
    const t = NODE_TYPE_BY_ID[spec.nodes.find((n) => n.id === e.from.node)?.type ?? '']?.output_ports.find((q) => q.name === e.from.port)?.type
    const running = status?.[e.from.node]?.status === 'running'
    return { ...old.get(e.id), id: e.id, source: e.from.node, sourceHandle: e.from.port, target: e.to.node, targetHandle: e.to.port, deletable: !readOnly, style: { stroke: t ? PORT_COLOR[t] : '#94a3b8', strokeWidth: 2 }, animated: running, className: running ? 'running' : undefined }
  })
}

export function WorkflowCanvas(p: Props) { return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider> }
function Inner({ spec, readOnly, onChange, selected, onSelect, severity, status, height = 520, bare, onDropBlock }: Props) {
  const args: SyncArgs = { spec, readOnly, selected, onSelect, severity, status }
  // Flux contrôlé : les nœuds/liens vivent dans un état local auquel on applique TOUS les changements React Flow
  // (dimensions, sélection, glissement), puis la spec y est fusionnée quand elle change.
  const [nodes, setNodes] = useState<Node<NData>[]>(() => syncNodes([], args))
  const [edges, setEdges] = useState<Edge[]>(() => syncEdges([], args))
  const theme = useTheme()
  // Micro-interactions : lien fraîchement tracé, nœud cible « aimanté », nœuds en cours de suppression.
  const [fresh, setFresh] = useState<{ edge?: string; node?: string }>({})
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set())
  const latest = useRef({ spec, onChange, onSelect, selected }); latest.current = { spec, onChange, onSelect, selected }
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)) }

  // Grille interactive : chaque ajout, suppression, connexion, erreur ou exécution fait réagir le fond.
  const fx = useMemo(createFxBus, []); const rf = useReactFlow(); const wrap = useRef<HTMLDivElement>(null)
  const center = (n?: { ui?: { x: number; y: number } }) => ({ x: (n?.ui?.x ?? 0) + 95, y: (n?.ui?.y ?? 0) + 45 })
  const prevNodes = useRef<Map<string, { ui?: { x: number; y: number }; params?: Record<string, any> }> | null>(null)
  useEffect(() => {
    const cur = new Map(spec.nodes.map((n) => [n.id, n]))
    const prev = prevNodes.current; prevNodes.current = cur
    if (!prev) return
    for (const [id, n] of cur) {
      const before = prev.get(id) as { params?: { steps?: unknown[] } } | undefined
      const grew = (n as { params?: { steps?: unknown[] } }).params?.steps?.length ?? 0
      if (!before || grew > (before.params?.steps?.length ?? 0)) fx.emit('add', center(n).x, center(n).y) // nouveau bloc ou étape ajoutée
    }
    for (const [id, n] of prev) if (!cur.has(id)) fx.emit('remove', center(n).x, center(n).y)
  }, [spec.nodes, fx])
  const prevSev = useRef<Record<string, Sev> | undefined>(severity)
  useEffect(() => {
    const before = prevSev.current ?? {}; prevSev.current = severity
    for (const [id, sv] of Object.entries(severity ?? {})) if (sv === 'error' && before[id] !== 'error') { const n = spec.nodes.find((x) => x.id === id); if (n) fx.emit('error', center(n).x, center(n).y) }
  }, [severity]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const running = Object.entries(status ?? {}).filter(([, s]) => s.status === 'running').map(([id]) => id)
    if (!running.length) return
    const pulse = () => running.forEach((id) => { const n = spec.nodes.find((x) => x.id === id); if (n) fx.emit('run', center(n).x, center(n).y) })
    pulse(); const t = setInterval(pulse, 1600); return () => clearInterval(t)
  }, [status, spec.nodes, fx])
  useEffect(() => { setNodes((prev) => syncNodes(prev, args)) }, [spec.nodes, selected, severity, status, readOnly, onSelect]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEdges((prev) => syncEdges(prev, args)) }, [spec, readOnly, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const onNodesChange = useCallback((chs: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(readOnly || !onChange ? chs : chs.filter((c) => c.type !== 'remove'), ns) as Node<NData>[])
    if (readOnly || !onChange) { chs.forEach((c) => { if (c.type === 'select' && c.selected) onSelect?.(c.id) }); return }
    let next = spec; let changed = false; const removing: string[] = []
    for (const c of chs) {
      if (c.type === 'position' && c.position) { next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, ui: { x: Math.round(c.position!.x), y: Math.round(c.position!.y) } } : n)) }; changed = true }
      else if (c.type === 'remove') removing.push(c.id)
      else if (c.type === 'select' && c.selected) onSelect?.(c.id)
    }
    if (changed) onChange(next)
    if (removing.length) {
      // Le nœud rétrécit et s'estompe (~220 ms) avant d'être retiré de la spec.
      setLeaving((s) => new Set([...s, ...removing]))
      later(() => {
        const { spec: cur, onChange: oc, onSelect: os, selected: sel } = latest.current
        oc?.({ ...cur, nodes: cur.nodes.filter((n) => !removing.includes(n.id)), edges: cur.edges.filter((e) => !removing.includes(e.from.node) && !removing.includes(e.to.node)) })
        if (sel && removing.includes(sel)) os?.(null)
        setLeaving((s) => { const n = new Set(s); removing.forEach((id) => n.delete(id)); return n })
      }, 220)
    }
  }, [spec, readOnly, onChange, onSelect, selected])
  const onEdgesChange = useCallback((chs: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(chs, es)) // sélection des liens (nécessaire pour les supprimer au clavier)
    if (readOnly || !onChange) return
    const rm = chs.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id); if (rm.length) onChange({ ...spec, edges: spec.edges.filter((e) => !rm.includes(e.id)) })
  }, [spec, readOnly, onChange])
  const isValid = useCallback((c: Connection | Edge) => {
    const a = spec.nodes.find((n) => n.id === c.source), b = spec.nodes.find((n) => n.id === c.target); if (!a || !b || a.id === b.id) return false
    const fp = NODE_TYPE_BY_ID[a.type]?.output_ports.find((q) => q.name === c.sourceHandle), tp = NODE_TYPE_BY_ID[b.type]?.input_ports.find((q) => q.name === c.targetHandle)
    if (!fp || !tp || fp.type !== tp.type) return false
    if (!tp.multiple && spec.edges.some((e) => e.to.node === b.id && e.to.port === tp.name)) return false
    return !spec.edges.some((e) => e.from.node === a.id && e.from.port === fp.name && e.to.node === b.id && e.to.port === tp.name)
  }, [spec])
  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !onChange || !isValid(c)) return
    const n = Math.max(0, ...spec.edges.map((e) => Number(e.id.replace(/\D/g, '')) || 0)) + 1
    onChange({ ...spec, edges: [...spec.edges, { id: `e${n}`, from: { node: c.source!, port: c.sourceHandle! }, to: { node: c.target!, port: c.targetHandle! } }] })
    setFresh({ edge: `e${n}`, node: c.target! }); later(() => setFresh({}), 900)
    const tn = spec.nodes.find((x) => x.id === c.target); if (tn) fx.emit('connect', center(tn).x, center(tn).y)
  }, [spec, readOnly, onChange, isValid, fx])
  const shownNodes = useMemo(() => nodes.map((n) => (leaving.has(n.id) || fresh.node === n.id ? { ...n, className: clsx(leaving.has(n.id) && 'node-leaving', fresh.node === n.id && 'node-connected') } : n.className ? { ...n, className: undefined } : n)), [nodes, leaving, fresh.node])
  const shownEdges = useMemo(() => edges.map((e) => (fresh.edge === e.id ? { ...e, className: clsx(e.className, 'edge-new') } : e)), [edges, fresh.edge])
  return (
    <div ref={wrap} style={{ height }} className={clsx('relative overflow-hidden bg-slate-50', !bare && 'rounded-lg border border-slate-200')} data-testid="canvas"
      onDragOver={(e) => { if (onDropBlock && e.dataTransfer.types.includes(BLOCK_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => { const raw = e.dataTransfer.getData(BLOCK_MIME); if (!raw || !onDropBlock) return; e.preventDefault(); const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); onDropBlock(raw, { x: p.x - 95, y: p.y - 30 }) }}>
      <GridFx bus={fx} />
      <ReactFlow style={{ background: 'transparent' }} nodes={shownNodes} edges={shownEdges} nodeTypes={nodeTypes} colorMode={theme} connectionLineStyle={{ stroke: '#4f81bd', strokeWidth: 2, strokeDasharray: '6 4' }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValid} onPaneClick={(e) => { onSelect?.(null); const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); fx.emit('ripple', p.x, p.y) }}
        onNodeDrag={(e) => { const r = wrap.current?.getBoundingClientRect(); if (r) fx.spot({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
        onNodeDragStop={(_, n) => { fx.spot(null); fx.emit('ripple', n.position.x + 95, n.position.y + 45) }} nodesConnectable={!readOnly} elementsSelectable fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
        <Controls showInteractive={false} {...(bare ? { position: 'bottom-center' as const, orientation: 'horizontal' as const } : {})} />
      </ReactFlow>
    </div>)
}
