import type { AutoEngine } from './engine'
import { createRings } from './rings'
import { EDITOR_BACK, TARGET_BY_ID, type Target } from './targets'
import { describeWhere, discover, usable } from './discover'
import { bestPage, type PageDef } from './pages'

/* Séquence de guidage. Ordre de recherche :
 *   1. registre (targets.ts) affiché à l'écran ;
 *   2. recherche libre dans l'écran (n'importe quel bouton, lien, titre, champ…) ;
 *   3. autre page : route du registre, sinon page la plus probable (pages.ts) — on y va, on parcourt, on montre ;
 *   4. dans l'éditeur plein écran (jamais quitté d'office : travail non enregistré) : le bouton « Studio » pour en sortir ;
 *   5. parent du registre (ex. l'onglet Studio pour un bloc) ; sinon « je ne le vois pas ».
 * Puis : défilement au centre, attente de stabilité, vol, bras tendu, anneaux ; fin au bout de ~5 s, clic, Échap
 * ou changement de page. Une nouvelle demande annule la précédente. */

export interface PointRequest {
  targets: string[]
  /** Mots de la demande pour la recherche libre (resolver.parseQuery). */
  words?: string[]
  /** Force de la correspondance du registre (resolver) ; absente : ids explicites, le registre fait foi. */
  strength?: number
  /** Phrase imposée pour la bulle (sinon générée). */
  message?: string
  /** Appelé une fois la décision prise : la phrase pour le chat, ou null si rien n'a été trouvé (le chat répond normalement). */
  reply?: (line: string | null) => void
}
export interface GuideHost { engine: AutoEngine; navigate: (to: string) => void; pathname: () => string; reduced: () => boolean }

const NOT_HERE = 'Je ne le vois pas ici…'
const SHOW_FOR = 5000
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const q = (s: string) => `« ${s} »`
const editorOpen = () => !!document.querySelector('[data-testid="workflow-editor"]')

function find(targets: Target[]): { els: Element[]; hits: Target[] } {
  const els: Element[] = [], hits: Target[] = []
  for (const t of targets) {
    const found = [...document.querySelectorAll(t.selector)].filter(usable)
    if (found.length) { els.push(...found); hits.push(t) }
  }
  return { els, hits }
}
function union(els: Element[]): DOMRect | null {
  const rs = els.filter((e) => e.isConnected).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
  if (!rs.length) return null
  const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top))
  return new DOMRect(l, t, Math.max(...rs.map((r) => r.right)) - l, Math.max(...rs.map((r) => r.bottom)) - t)
}
function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  if (cond()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => { if (cond()) done(true) })
    const timer = window.setTimeout(() => done(cond()), ms)
    function done(v: boolean) { mo.disconnect(); clearTimeout(timer); resolve(v) }
    mo.observe(document.body, { childList: true, subtree: true })
  })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Attend que la position ne bouge plus pendant `quiet` ms (fin du défilement doux), au plus `max` ms. */
function waitStable(els: Element[], quiet = 100, max = 1500): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now(); let last = '', since = start
    const step = (now: number) => {
      const r = union(els), key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}` : ''
      if (key !== last) { last = key; since = now }
      if (now - since >= quiet || now - start >= max) resolve(); else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

type Plan =
  | { kind: 'registry'; els: Element[]; hits: Target[]; page?: PageDef }
  | { kind: 'dom'; els: Element[]; labels: string[]; page?: PageDef }
  | { kind: 'page'; els: Element[]; page: PageDef }
  | { kind: 'say'; els: Element[]; text: string }

export function createGuide(host: GuideHost) {
  const rings = createRings()
  let token = 0, active = false, endTimer = 0, expectPath: string | null = null
  let unlisten: (() => void) | null = null

  function stop(flyHome: boolean) {
    clearTimeout(endTimer); unlisten?.(); unlisten = null; rings.stop()
    if (active && flyHome) host.engine.endGuide()
    active = false
  }
  function end() { token++; stop(true) }

  /** Registre et recherche libre sur l'écran actuel : le registre gagne, sauf si l'écran correspond nettement mieux
   * (ex. « telco churn » : le nom exact d'un jeu de données bat une vague ressemblance avec « charger »). */
  function onScreen(targets: Target[], words: string[], strength: number, page?: PageDef): Plan | null {
    const reg = find(targets), dom = discover(words)
    const domBetter = dom.length > 0 && dom[0].score > strength + 0.05
    if (reg.els.length && !domBetter) return { kind: 'registry', ...reg, page }
    if (dom.length) return { kind: 'dom', els: dom.map((d) => d.el), labels: dom.map((d) => d.label), page }
    return null
  }

  async function decide(targets: Target[], words: string[], strength: number, my: number): Promise<Plan | null> {
    const here = onScreen(targets, words, strength)
    if (here) return here

    // Autre page (pas depuis l'éditeur : on n'y perd jamais un travail non enregistré).
    const routed = targets.find((t) => t.route && t.route !== host.pathname())
    const page = routed ? null : bestPage(words)
    const to = routed?.route ?? (page && page.path !== host.pathname() ? page.path : null)
    if (to && !editorOpen()) {
      expectPath = to; host.navigate(to)
      await waitFor(() => !!document.querySelector('main h1') && location.pathname === to, 3000)
      await sleep(350) // données de la page
      if (my !== token) return null
      const there = onScreen(targets, words, strength, page ?? undefined)
      if (there) return there
      const h1 = document.querySelector('main h1')
      if (page && h1) return { kind: 'page', els: [h1], page }
    }

    // Dans l'éditeur : l'élément (ou sa page) est derrière ; on montre le bouton de sortie.
    if (editorOpen()) {
      const back = find([TARGET_BY_ID[EDITOR_BACK]])
      const hidden = targets.find((t) => [...document.querySelectorAll(t.selector)].some((e) => e.getBoundingClientRect().width > 0))
      const pageHere = page ?? (routed ? null : bestPage(words))
      if (back.els.length && (hidden || pageHere || routed)) {
        const what = hidden ? `${cap(hidden.name)} ${hidden.pro === 'les' ? 'sont' : 'est'} ${hidden.where}` : pageHere ? `C’est sur la page ${pageHere.title}` : `${cap(routed!.name)} ${routed!.pro === 'les' ? 'sont' : 'est'} ${routed!.where}`
        return { kind: 'say', els: back.els, text: `${what}, derrière l’éditeur : sors avec ce bouton « Studio ».` }
      }
    }

    // Parent du registre (ex. palette non montée → onglet Studio).
    const parents = [...new Set(targets.map((t) => t.parent).filter((p): p is string => !!p))].map((id) => TARGET_BY_ID[id]).filter(Boolean)
    const pf = find(parents)
    if (pf.els.length) {
      const t = targets.find((x) => x.missing) ?? targets[0]
      return { kind: 'say', els: pf.els, text: t.missing ?? `Passe d’abord par ${pf.hits[0].name}.` }
    }
    return null
  }

  function texts(plan: Plan): { bubble: string; line: string } {
    const on = 'page' in plan && plan.page ? `Sur la page ${plan.page.title} : ` : ''
    switch (plan.kind) {
      case 'say': return { bubble: plan.text, line: plan.text }
      case 'page': return { bubble: `Voici la page ${plan.page.title}.`, line: `Je t’emmène sur la page ${plan.page.title}.` }
      case 'registry': {
        const n = plan.els.length, t0 = plan.hits[0], pro = t0.pro ?? 'le'
        if (n === 1) return { bubble: `${cap(t0.name)} ${pro === 'les' ? 'sont' : 'est'} ici, ${t0.where}.`, line: `${on}voilà ${t0.name}, je te ${pro} montre.` }
        return { bubble: `Il y en a ${n}, les voilà !`, line: `${on}j’en ai trouvé ${n} : ${plan.hits.map((h) => h.label).join(', ')}. Je te les montre.` }
      }
      case 'dom': {
        if (plan.els.length === 1) { const w = describeWhere(plan.els[0]); return { bubble: `${q(plan.labels[0])} est ici, ${w}.`, line: `${on}voilà ${q(plan.labels[0])}, ${w}.` } }
        return { bubble: `J’en vois ${plan.els.length}, les voilà !`, line: `${on}j’en vois ${plan.els.length} : ${plan.labels.map(q).join(', ')}.` }
      }
    }
  }

  async function point(req: PointRequest) {
    const my = ++token
    stop(true)
    let replied = false
    const reply = (line: string | null) => { if (!replied) { replied = true; req.reply?.(line) } }
    const targets = req.targets.map((id) => TARGET_BY_ID[id]).filter(Boolean)
    const words = req.words ?? []

    // Ids explicites (agent, __auto.pointTo) : le registre fait foi.
    const plan = await decide(targets, words, req.strength ?? 1, my)
    if (my !== token) return
    if (!plan) { host.engine.say(NOT_HERE, 2600); reply(null); return }

    const els = plan.els
    els[0].scrollIntoView({ behavior: host.reduced() ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
    await waitStable(els)
    if (my !== token) return
    const { bubble, line } = texts(plan) // après le défilement : « en haut / en bas » est exact
    reply(line.charAt(0).toUpperCase() + line.slice(1))

    active = true
    rings.start(els)
    host.engine.guide({
      rect: () => union(els), text: req.message ?? bubble,
      onArrive: () => { if (my === token) endTimer = window.setTimeout(end, SHOW_FOR) },
    })
    // Tout clic ou Échap met fin au guidage (écouteurs posés après l'événement qui l'a déclenché).
    window.setTimeout(() => {
      if (my !== token) return
      const onDown = () => end()
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') end() }
      window.addEventListener('pointerdown', onDown, true); window.addEventListener('keydown', onKey, true)
      unlisten = () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
    }, 0)
  }

  return {
    point,
    cancel: end,
    /** Changement de page : fin du guidage, sauf pour la navigation qu'il a lui-même lancée. */
    onRoute(path: string) {
      if (expectPath === path) { expectPath = null; return }
      expectPath = null
      end() // annule aussi une demande en attente (navigation, défilement)
    },
    destroy() { token++; stop(false) },
  }
}
export type Guide = ReturnType<typeof createGuide>
