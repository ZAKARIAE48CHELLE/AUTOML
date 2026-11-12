import { useCallback, useEffect, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, ReactFlowProvider, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps } from '@xyflow/react'
import type { WorkflowSpec, NodeStatus, PortType } from '@contracts/src'
import { NODE_TYPE_BY_ID } from '@contracts/src'
import { clsx } from '@/lib/format'

const PORT_COLOR: Record<PortType, string> = { Dataset: '#0e7490', Split: '#7c3aed', PreprocessSpecRef: '#c2410c', ModelRun: '#2563eb', Leaderboard: '#65a30d', ModelVersion: '#be185d' }
const CLS: Record<string, string> = { L0: 'bg-slate-100 text-slate-600', L1: 'bg-blue-100 text-blue-700', L2: 'bg-amber-100 text-amber-800', L3: 'bg-red-100 text-red-700' }
const STATUS_RING: Record<string, string> = { running: 'ring-2 ring-blue-400 node-running', succeeded: 'ring-2 ring-green-500 node-done', failed: 'ring-2 ring-red-500 node-failed', cancelled: 'ring-2 ring-orange-400', skipped: 'opacity-50', pending: '', queued: '' }
export type Sev = 'error' | 'warning'
interface NData extends Record<string, unknown> { type: string; id: string; severity?: Sev; status?: NodeStatus; cached?: boolean; summary: string }

function StudioNode({ data, selected }: NodeProps<Node<NData>>) {
  const t = NODE_TYPE_BY_ID[data.type]; const rows = Math.max(t?.input_ports.length ?? 0, t?.output_ports.length ?? 0, 1)
  return (
    <div className={clsx('node-pop min-w-[180px] rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md', selected ? 'border-brand-600 ring-2 ring-brand-500/30' : 'border-slate-300', data.severity === 'error' && '!border-red-500 ring-2 ring-red-300', data.severity === 'warning' && !selected && '!border-amber-400', data.status && STATUS_RING[data.status])} style={{ minHeight: 48 + rows * 22 }}>
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
interface Props { spec: WorkflowSpec; readOnly?: boolean; onChange?: (s: WorkflowSpec) => void; selected?: string | null; onSelect?: (id: string | null) => void; severity?: Record<string, Sev>; status?: Record<string, { status: NodeStatus; cached?: boolean }>; height?: number }

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
function Inner({ spec, readOnly, onChange, selected, onSelect, severity, status, height = 520 }: Props) {
  const args: SyncArgs = { spec, readOnly, selected, onSelect, severity, status }
  // Flux contrôlé : les nœuds/liens vivent dans un état local auquel on applique TOUS les changements React Flow
  // (dimensions, sélection, glissement), puis la spec y est fusionnée quand elle change.
  const [nodes, setNodes] = useState<Node<NData>[]>(() => syncNodes([], args))
  const [edges, setEdges] = useState<Edge[]>(() => syncEdges([], args))
  useEffect(() => { setNodes((prev) => syncNodes(prev, args)) }, [spec.nodes, selected, severity, status, readOnly, onSelect]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEdges((prev) => syncEdges(prev, args)) }, [spec, readOnly, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const onNodesChange = useCallback((chs: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(chs, ns) as Node<NData>[])
    if (readOnly || !onChange) { chs.forEach((c) => { if (c.type === 'select' && c.selected) onSelect?.(c.id) }); return }
    let next = spec; let changed = false
    for (const c of chs) {
      if (c.type === 'position' && c.position) { next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, ui: { x: Math.round(c.position!.x), y: Math.round(c.position!.y) } } : n)) }; changed = true }
      else if (c.type === 'remove') { next = { ...next, nodes: next.nodes.filter((n) => n.id !== c.id), edges: next.edges.filter((e) => e.from.node !== c.id && e.to.node !== c.id) }; changed = true; if (selected === c.id) onSelect?.(null) }
      else if (c.type === 'select' && c.selected) onSelect?.(c.id)
    }
    if (changed) onChange(next)
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
  }, [spec, readOnly, onChange, isValid])
  return (
    <div style={{ height }} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50" data-testid="canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValid} onPaneClick={() => onSelect?.(null)} nodesConnectable={!readOnly} elementsSelectable fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
        <Background gap={18} color="#e2e8f0" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>)
}
