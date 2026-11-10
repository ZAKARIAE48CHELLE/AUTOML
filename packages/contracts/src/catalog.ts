import catalogJson from '../catalog.json'
import policyJson from '../policy.json'
import validationJson from '../validation.json'
import endpointsJson from '../endpoints.json'
import type { NodeType, OpClass } from './types'

export const CATALOG_VERSION: string = catalogJson.catalog_version
export const NODE_TYPES = catalogJson.node_types as unknown as NodeType[]
export const NODE_TYPE_BY_ID: Record<string, NodeType> = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]))
export const POLICY = policyJson as { classes: { id: OpClass; label: string; examples: string }[]; modes: string[]; matrix: { cls: OpClass; auto: string; guided: string; expert: string }[] }
export const VALIDATION = validationJson as { rules: { id: string; text: string }[]; layers: { layer: string; owner: string; text: string }[] }
export type EndpointDef = { index: number; owner: 'E1' | 'E2' | 'E3' | 'E4'; method: string; path: string; purpose: string; inp: string; out: string; access: 'public' | 'internal'; consumers: string[] }
export const ENDPOINTS = endpointsJson as EndpointDef[]
// Limites MVP (V10)
export const MAX_NODES = 40
