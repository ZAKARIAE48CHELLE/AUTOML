import type { JsonSchema } from './types'
export interface SchemaIssue { path: string; message: string }
// Sous-ensemble JSON Schema : type, required, enum, minimum, maximum, minLength, properties, items.
export function validateSchema(value: unknown, schema: JsonSchema, path = ''): SchemaIssue[] {
  const out: SchemaIssue[] = []
  const t = schema.type
  if (value === undefined || value === null || value === '') {
    return out
  }
  if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return [{ path, message: 'Nombre attendu.' }]
    if (t === 'integer' && !Number.isInteger(value)) out.push({ path, message: 'Entier attendu.' })
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, message: `Doit être ≥ ${schema.minimum}.` })
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, message: `Doit être ≤ ${schema.maximum}.` })
  } else if (t === 'string') {
    if (typeof value !== 'string') return [{ path, message: 'Texte attendu.' }]
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push({ path, message: `Au moins ${schema.minLength} caractère(s).` })
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [{ path, message: 'Booléen attendu.' }]
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [{ path, message: 'Liste attendue.' }]
    if (schema.items) value.forEach((v, i) => out.push(...validateSchema(v, schema.items!, `${path}[${i}]`)))
  } else if (t === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return [{ path, message: 'Objet attendu.' }]
    const obj = value as Record<string, unknown>
    for (const r of schema.required ?? []) {
      if (obj[r] === undefined || obj[r] === null || obj[r] === '') out.push({ path: path ? `${path}.${r}` : r, message: 'Champ requis.' })
    }
    for (const [k, s] of Object.entries(schema.properties ?? {})) {
      if (k in obj) out.push(...validateSchema(obj[k], s, path ? `${path}.${k}` : k))
    }
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) out.push({ path, message: `Valeur hors énumération (${schema.enum.join(', ')}).` })
  return out
}
// Les champs requis absents sont signalés au niveau de l'objet : on traite ici le cas « valeur vide ».
export function validateRequired(value: unknown, schema: JsonSchema, path: string): SchemaIssue[] {
  if (value === undefined || value === null || value === '') return [{ path, message: 'Champ requis.' }]
  return []
}
