import { TARGETS, type Target } from './targets'

/* Comprend « où est le split ? », « whos me where the split is »… et renvoie les éléments à montrer.
 * Fonction pure : pas de React, pas de DOM. Renvoie null quand le message ne demande pas un emplacement. */

const STOP = new Set(`
le la les l un une des de du d au aux et est sont se ce cet cette ces c mon ma mes ton ta tes son sa ses
moi me m te t toi tu je j il elle on nous vous ils elles y en dans sur pour par avec qui que qu quoi dont
svp stp merci bonjour salut sil plait peux peut pourrais veux voudrais voir bloc blocs block blocks bouton button
onglet tab section the a an is are am be my i you it its of to in on at please pls can could would do does did
how what which whats there here ici est ce mais donc alors juste app application appli logiciel page endroit
place spot thing truc chose see view get use utiliser need besoin want faire`.split(/\s+/).filter(Boolean))

const LOCATORS = ['montre', 'montrer', 'montrez', 'trouve', 'trouver', 'trouvez', 'cherche', 'situe', 'localise', 'affiche', 'show', 'where', 'wheres', 'find', 'locate',
  'take', 'emmene', 'amene', 'aller', 'ouvre', 'ouvrir', 'open', 'acceder', 'access', 'navigate', 'naviguer', 'go', 'goto']

export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const tokens = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))
/** Racine grossière FR/EN : « personnaliser », « personnalisation », « personalize » → « personnal » / « personal ». */
const SUFFIXES = ['isations', 'isation', 'izations', 'ization', 'ations', 'ation', 'iser', 'izer', 'ize', 'ise', 'ises', 'izes', 'ements', 'ement', 'ments', 'ment', 'ings', 'ing', 'eurs', 'eur', 'ers', 'er', 'ez', 'es', 's', 'e']
export function stem(w: string): string {
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length)
  return w
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** Qualité de correspondance de deux mots : 1 exact, puis dégressive ; fautes tolérées (≤ 2) à partir de 4 lettres. */
function quality(q: string, k: string): number {
  if (q === k) return 1
  if (q.length < 4 || k.length < 4) return 0
  const sq = stem(q), sk = stem(k)
  if (sq === sk) return 0.95
  const d = Math.min(levenshtein(q, k), levenshtein(sq, sk))
  return d === 1 ? 0.8 : d === 2 ? 0.6 : 0
}

/* Index des mots-clés, calculé une fois. */
interface Indexed { target: Target; phrases: { words: string[]; weight: number }[] }
const INDEX: Indexed[] = TARGETS.map((target) => ({
  target,
  phrases: [
    ...target.keywords.map((k) => ({ words: tokens(k), weight: 1 })),
    ...(target.weak ?? []).map((k) => ({ words: tokens(k), weight: 0.6 })),
  ].filter((p) => p.words.length),
}))
const ALL_KEYWORDS = [...new Set(INDEX.flatMap((i) => i.phrases.flatMap((p) => p.words)))]
const targetQuality = (w: string) => Math.max(0, ...ALL_KEYWORDS.map((k) => quality(w, k)))
/** Mot « où / montre / where… ». Un mot qui désigne mieux un élément qu'un mot de localisation reste un nom
 * (« thème » est à 2 lettres de « where », mais c'est d'abord un élément). */
function isLocator(w: string, i: number, all: string[]): boolean {
  if (w === 'ou') return i === 0 || ['sont', 'se', 'trouve', 'trouver', 'est'].includes(all[i + 1] ?? '')
  const loc = Math.max(0, ...LOCATORS.map((l) => locatorQuality(w, l)))
  return loc > 0 && loc >= targetQuality(w)
}
const sorted = (s: string) => [...s].sort().join('')
/** Plus strict que `quality` : « save » ne doit pas passer pour « take ». Deux fautes : mots longs, ou mêmes lettres
 * dans le désordre (« whos » → « show »). */
function locatorQuality(w: string, l: string): number {
  if (w === l) return 1
  if (w.length < 4 || l.length < 4) return 0
  const d = levenshtein(w, l)
  if (d === 1) return 0.8
  if (d === 2 && (sorted(w) === sorted(l) || Math.min(w.length, l.length) >= 6)) return 0.6
  return 0
}

export interface Resolution { targets: Target[]; /** Force de la correspondance (0 à 1 par mot de la demande). */ strength: number }

export function resolveTargets(text: string): Resolution | null {
  const raw = normalize(text).split(/[^a-z0-9]+/).filter(Boolean)
  const all = raw.filter((w) => w === 'ou' || !STOP.has(w))
  const locator = all.some((w, i) => isLocator(w, i, all))
  const words = all.filter((w, i) => !isLocator(w, i, all))
  if (!words.length) return null

  const scored = INDEX.map(({ target, phrases }) => {
    let score = 0
    const matched = new Set<string>()
    for (const q of words) {
      let best = 0
      for (const p of phrases) for (const k of p.words) { const v = quality(q, k) * p.weight; if (v > best) best = v; if (quality(q, k) > 0) matched.add(k) }
      score += best
    }
    // Part du libellé couverte par la demande : départage « Régression » (le type) de « Régression logistique ».
    const coverage = Math.max(0, ...phrases.filter((p) => p.weight === 1).map((p) => p.words.filter((w) => matched.has(w)).length / p.words.length))
    return { target, score, coverage }
  }).filter((s) => s.score >= 0.6)
  if (!scored.length) return null

  // Pas de mot « où / montre / where… » : seul un message très court qui n'est qu'un nom d'élément compte.
  if (!locator) {
    const every = words.every((q) => INDEX.some(({ phrases }) => phrases.some((p) => p.words.some((k) => quality(q, k) > 0))))
    if (words.length > 3 || !every) return null
  }
  const top = Math.max(...scored.map((s) => s.score))
  let best = scored.filter((s) => top - s.score < 1e-6)
  if (best.some((s) => s.coverage === 1)) best = best.filter((s) => s.coverage === 1)
  return { targets: best.map((s) => s.target), strength: top / words.length }
}

/* ---------- Recherche libre : n'importe quel texte de l'interface, pas seulement le registre ---------- */

/** Mots utiles d'une demande (sans les mots de localisation) et présence d'un mot « où / montre / where… ». */
export function parseQuery(text: string): { words: string[]; locator: boolean } {
  const all = normalize(text).split(/[^a-z0-9]+/).filter((w) => w && (w === 'ou' || !STOP.has(w)))
  return { words: all.filter((w, i) => !isLocator(w, i, all)), locator: all.some((w, i) => isLocator(w, i, all)) }
}

/** L'interface est en français : équivalents des mots anglais courants (« save » trouve « Enregistrer »). */
const SYN: Record<string, string[]> = {
  save: ['enregistrer', 'sauvegarder'], cancel: ['annuler'], undo: ['annuler'], delete: ['supprimer'], remove: ['supprimer', 'retirer'],
  validate: ['valider', 'validation'], check: ['valider', 'verifier'], run: ['executer', 'lancer', 'execution'], execute: ['executer', 'lancer'],
  launch: ['lancer'], start: ['lancer', 'demarrer'], export: ['exporter'], upload: ['importer'], download: ['telecharger', 'exporter'],
  search: ['rechercher', 'recherche'], close: ['fermer'], add: ['ajouter'], new: ['nouveau', 'nouvelle'], create: ['creer', 'nouveau'],
  back: ['retour'], edit: ['modifier', 'editer'], rename: ['renommer'], filter: ['filtrer', 'filtre'], help: ['aide'], send: ['envoyer'],
  compare: ['comparer', 'comparaison', 'differences'], review: ['revue', 'relire'], approve: ['approuver', 'approbation'], diff: ['differences'],
  version: ['version'], fullscreen: ['plein', 'ecran'], properties: ['proprietes'], nodes: ['noeuds', 'blocs'], node: ['noeud', 'bloc'],
  model: ['modele'], models: ['modeles'], train: ['entrainer', 'entrainement'], data: ['donnees'], columns: ['colonnes'], column: ['colonne'],
  target: ['cible'], metric: ['metrique'], metrics: ['metriques'], split: ['decoupage'], profile: ['profiler', 'profilage'], predict: ['prediction', 'predire'],
  promote: ['promouvoir'], code: ['code'], template: ['gabarit', 'type'], settings: ['parametres', 'personnaliser'], logout: ['deconnexion'],
  matrix: ['matrice'], confusion: ['confusion'], history: ['historique'], log: ['journal'], budget: ['budget'], report: ['rapport'],
}
const expand = (q: string) => [q, ...(SYN[q] ?? SYN[stem(q)] ?? [])]

/** Correspondance des mots d'une demande avec un texte quelconque (libellé de bouton, titre, aria-label…). */
export function matchText(words: string[], text: string): { score: number; hits: number; coverage: number } {
  const toks = tokens(text)
  if (!toks.length || !words.length) return { score: 0, hits: 0, coverage: 0 }
  let score = 0, hits = 0
  const used = new Set<string>()
  for (const q of words) {
    let best = 0, bestTok = ''
    for (const e of expand(q)) for (const k of toks) { const v = quality(e, k) * (e === q ? 1 : 0.95); if (v > best) { best = v; bestTok = k } }
    if (best > 0) { hits++; used.add(bestTok) }
    score += best
  }
  return { score, hits, coverage: used.size / toks.length }
}

/** Demande d'emplacement ? Ids du registre éventuels + mots pour la recherche libre. null : le chat répond normalement. */
export function locateRequest(text: string): { targets: string[]; words: string[]; strength: number } | null {
  const r = resolveTargets(text), q = parseQuery(text)
  if (r) return { targets: r.targets.map((t) => t.id), words: q.words, strength: r.strength }
  // Hors registre : seul un mot « où / montre / where… » explicite déclenche la recherche dans l'interface.
  if (q.locator && q.words.length) return { targets: [], words: q.words, strength: 0 }
  return null
}
