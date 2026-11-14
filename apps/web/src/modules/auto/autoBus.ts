/* Bus d'événements de la mascotte. Aujourd'hui alimenté par de faux événements ; plus tard par l'agent réel (E3),
 * qui tourne en arrière-plan : l'agent décide, Auto montre. */

export type AutoLevel = 'error' | 'warning' | 'tip'
export interface AutoNotice { id: string; level: AutoLevel; title: string; detail?: string; to?: string }
/** Demande de guidage : Auto vole vers les éléments (ids du registre targets.ts) et les montre. */
export interface PointEvent {
  type: 'point'
  targets: string[]
  /** Mots de la demande : recherche libre dans toute l'interface quand le registre ne suffit pas. */
  words?: string[]
  strength?: number
  message?: string
  /** Réponse pour le chat : la phrase d'Auto, ou null si rien n'a été trouvé. */
  reply?: (line: string | null) => void
}
export type AutoEvent = { type: 'notice'; notice: AutoNotice } | { type: 'resolve'; id: string } | PointEvent

const subs = new Set<(e: AutoEvent) => void>()
let seq = 0

export const autoBus = {
  /** Erreur : Auto apparaît immédiatement (même masqué). Avertissement / astuce : une ampoule, quand l'utilisateur est inactif. */
  notify(n: Omit<AutoNotice, 'id'> & { id?: string }): string {
    const notice: AutoNotice = { ...n, id: n.id ?? `auto-${++seq}` }
    subs.forEach((cb) => cb({ type: 'notice', notice }))
    return notice.id
  },
  /** Le problème est réglé : l'erreur disparaît (et Auto repart s'il était masqué). */
  resolve(id: string) { subs.forEach((cb) => cb({ type: 'resolve', id })) },
  /** Point d'entrée générique (ex. { type: 'point', targets: ['studio.block.data.split'] }), utilisé aussi par le futur agent. */
  emit(e: AutoEvent) { subs.forEach((cb) => cb(e)) },
  /** Y a-t-il quelqu'un pour écouter (Auto monté) ? */
  listening: () => subs.size > 0,
  subscribe(cb: (e: AutoEvent) => void): () => void { subs.add(cb); return () => { subs.delete(cb) } },
}

/* ---------- Faux événements, en attendant l'agent réel ---------- */

const FAKE: Record<AutoLevel, Omit<AutoNotice, 'id' | 'level'>[]> = {
  tip: [
    { title: 'Essayez la validation croisée', detail: 'Avec moins de 2 000 lignes, une validation croisée à 5 plis donne une métrique plus fiable qu’un simple découpage.', to: '/studio' },
    { title: 'Comparez vos expériences', detail: 'Deux entraînements récents ont des scores proches : la vue comparative aide à choisir.', to: '/training/experiments' },
  ],
  warning: [
    { title: 'Classes déséquilibrées', detail: 'La cible contient seulement 8 % de positifs : pensez au rééquilibrage ou à la métrique F1.', to: '/data' },
    { title: 'Valeurs manquantes', detail: 'La colonne « revenu » est vide à 31 % : une imputation est recommandée avant l’entraînement.', to: '/data' },
  ],
  error: [
    { title: 'Échec de l’exécution', detail: 'Le nœud « entraînement » a échoué : colonne « age » introuvable.', to: '/studio/executions' },
  ],
}
const openErrors: string[] = []

export function simulate(level: AutoLevel): string {
  const list = FAKE[level], n = list[(Math.random() * list.length) | 0]
  const id = autoBus.notify({ level, ...n })
  if (level === 'error') openErrors.push(id)
  return id
}
/** Résout la plus ancienne erreur simulée encore ouverte. */
export function simulateResolve(): boolean {
  const id = openErrors.shift()
  if (id) autoBus.resolve(id)
  return !!id
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__auto = {
    simulate, resolve: simulateResolve, bus: autoBus,
    pointTo: (...targets: string[]) => autoBus.emit({ type: 'point', targets }),
    /** Comme une question au chat : __auto.find('where can i upload a csv'). */
    find: async (text: string) => {
      const { locateRequest } = await import('./resolver')
      const r = locateRequest(text)
      if (r) autoBus.emit({ type: 'point', ...r, reply: (l) => console.info('[Auto]', l ?? 'introuvable') })
      return r
    },
  }
}
