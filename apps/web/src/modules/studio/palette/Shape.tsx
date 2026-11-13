/* Pictogrammes SVG de la palette : une forme par type de pipeline et par rôle de bloc. */

export type ShapeKind =
  | 'diamond' | 'wave' | 'clusters' | 'spike' | 'trend' | 'speech' | 'frame' | 'network'
  | 'cylinder' | 'fork' | 'hexagon' | 'chip' | 'gear' | 'target' | 'shield' | 'ribbon'

/** Forme par type de nœud. */
export const NODE_SHAPE: Record<string, ShapeKind> = {
  'data.dataset': 'cylinder', 'data.split': 'fork', 'data.preprocess': 'hexagon', 'train.model': 'chip',
  'train.tune': 'gear', 'eval.compare': 'target', 'eval.final_test': 'shield', 'model.register': 'ribbon',
}

export function Shape({ kind, color, size = 32, className }: { kind: ShapeKind | string; color: string; size?: number; className?: string }) {
  const fill = `${color}22`, s = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }, o = { ...s, fill: 'none' }
  const body = (() => {
    switch (kind) {
      case 'diamond': return <><path d="M20 4 36 20 20 36 4 20Z" fill={fill} {...s} /><path d="M12 20h16" {...o} /><circle cx="20" cy="13" r="2" fill={color} /><circle cx="20" cy="27" r="2" fill={color} /></>
      case 'wave': return <><rect x="4" y="6" width="32" height="28" rx="7" fill={fill} {...s} /><path d="M9 26c4-10 7-10 11-4s7 6 11-6" {...o} /><circle cx="13" cy="24" r="1.6" fill={color} /><circle cx="27" cy="18" r="1.6" fill={color} /></>
      case 'clusters': return <><circle cx="13" cy="14" r="7" fill={fill} {...s} /><circle cx="28" cy="15" r="6" fill={fill} {...s} /><circle cx="19" cy="28" r="7" fill={fill} {...s} /><circle cx="12" cy="13" r="1.5" fill={color} /><circle cx="15" cy="16" r="1.5" fill={color} /><circle cx="28" cy="14" r="1.5" fill={color} /><circle cx="18" cy="28" r="1.5" fill={color} /><circle cx="21" cy="30" r="1.5" fill={color} /></>
      case 'spike': return <><rect x="4" y="6" width="32" height="28" rx="7" fill={fill} {...s} /><path d="M8 26h6l3-3 3 3 3-15 3 15h6" {...o} /><circle cx="23" cy="11" r="2.6" fill="#ef4444" /></>
      case 'trend': return <><rect x="4" y="6" width="32" height="28" rx="7" fill={fill} {...s} /><path d="M8 27l6-6 5 3 5-7" {...o} /><path d="M24 17l7-6" {...o} strokeDasharray="2 3" /><path d="M8 31h24" {...o} strokeWidth={1.2} /></>
      case 'speech': return <><path d="M6 9h28a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H17l-7 6v-6H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3Z" fill={fill} {...s} /><path d="M10 16h20M10 22h13" {...o} /></>
      case 'frame': return <><rect x="4" y="7" width="32" height="26" rx="4" fill={fill} {...s} /><path d="M8 29l8-9 6 6 4-4 6 7" {...o} /><circle cx="27" cy="14" r="3" fill={color} /></>
      case 'network': return <><path d="M11 12 20 20M29 11 20 20M20 20l-8 9M20 20l9 9" {...o} /><circle cx="20" cy="20" r="4.5" fill={fill} {...s} /><circle cx="10" cy="11" r="3.5" fill={fill} {...s} /><circle cx="30" cy="10" r="3.5" fill={fill} {...s} /><circle cx="11" cy="30" r="3.5" fill={fill} {...s} /><circle cx="30" cy="30" r="3.5" fill={fill} {...s} /></>
      case 'cylinder': return <><path d="M7 10v20c0 3 6 5 13 5s13-2 13-5V10" fill={fill} {...s} /><ellipse cx="20" cy="10" rx="13" ry="5" fill={fill} {...s} /><path d="M7 20c0 3 6 5 13 5s13-2 13-5" {...o} /></>
      case 'fork': return <><path d="M20 5v11M20 16 9 28M20 16l11 12" {...o} /><circle cx="20" cy="6" r="3" fill={color} /><rect x="4" y="27" width="10" height="8" rx="2" fill={fill} {...s} /><rect x="26" y="27" width="10" height="8" rx="2" fill={fill} {...s} /></>
      case 'hexagon': return <><path d="M20 4 34 12v16l-14 8-14-8V12Z" fill={fill} {...s} /><path d="M14 20h12M17 15h6M17 25h6" {...o} /></>
      case 'chip': return <><rect x="9" y="9" width="22" height="22" rx="5" fill={fill} {...s} /><path d="M15 4v5M25 4v5M15 31v5M25 31v5M4 15h5M4 25h5M31 15h5M31 25h5" {...o} /><circle cx="20" cy="20" r="4" fill={color} /></>
      case 'gear': return <><path d="M20 6l3 4 5-1 1 5 4 3-3 4 1 5-5 1-3 4-3-4-5 1-1-5-4-3 3-4-1-5 5-1Z" fill={fill} {...s} /><circle cx="20" cy="20" r="4.5" {...o} /></>
      case 'target': return <><circle cx="20" cy="20" r="15" fill={fill} {...s} /><circle cx="20" cy="20" r="9" {...o} /><circle cx="20" cy="20" r="3" fill={color} /></>
      case 'shield': return <><path d="M20 4l13 5v9c0 9-6 15-13 18C13 33 7 27 7 18V9Z" fill={fill} {...s} /><path d="M14 19l4 4 8-8" {...o} /></>
      case 'ribbon': return <><circle cx="20" cy="15" r="10" fill={fill} {...s} /><path d="M14 23l-3 13 9-5 9 5-3-13" {...o} /><path d="M16 15l3 3 5-6" {...o} /></>
      default: return <rect x="6" y="6" width="28" height="28" rx="6" fill={fill} {...s} />
    }
  })()
  return <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden="true">{body}</svg>
}
