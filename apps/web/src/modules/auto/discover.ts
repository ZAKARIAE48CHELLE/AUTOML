import { matchText } from './resolver'

/* Recherche libre dans l'interface affichée : boutons, liens, onglets, titres, champs, libellés, icônes
 * (aria-label / title)… sans attribut à ajouter. Le registre (targets.ts) reste prioritaire. */

const CANDIDATES = [
  'a[href]', 'button', 'summary', 'select', 'input:not([type=hidden])', 'textarea', 'label', 'th', 'legend',
  'h1', 'h2', 'h3', 'h4', '[role=button]', '[role=tab]', '[role=menuitem]', '[role=radio]', '[role=checkbox]', '[role=switch]',
  '[role=option]', '[aria-label]', '[title]', '[data-auto-target]',
].join(',')

/** Affiché et non recouvert : quand l'éditeur plein écran est ouvert, seul ce qu'il contient (ou un dialogue) compte. */
export function usable(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (!el.isConnected || r.width === 0 || r.height === 0) return false
  const editor = document.querySelector('[data-testid="workflow-editor"]')
  return !editor || editor.contains(el) || !!el.closest('[role="dialog"]')
}

const clip = (s: string) => s.replace(/\s+/g, ' ').trim()
/** Libellé lisible d'un élément (pour la bulle) et texte complet pour la correspondance. */
function texts(el: Element): { label: string; all: string } {
  const h = el as HTMLElement & { placeholder?: string }
  const aria = el.getAttribute('aria-label') ?? '', title = el.getAttribute('title') ?? ''
  const inner = clip(h.innerText ?? el.textContent ?? '').slice(0, 120)
  const ph = h.placeholder ?? ''
  const label = clip(inner.split('\n')[0] || aria || title || ph).slice(0, 60)
  return { label, all: [aria, inner, title, ph].join(' ') }
}

export interface Found { el: Element; label: string; /** 0 à 1 par mot de la demande, comparable à Resolution.strength. */ score: number }

/** Meilleurs éléments affichés pour ces mots (3 au plus, à égalité) ; [] si rien de convaincant. */
export function discover(words: string[]): Found[] {
  if (!words.length) return []
  const vw = innerWidth, vh = innerHeight
  const scored: { el: Element; label: string; score: number; coverage: number }[] = []
  for (const el of document.querySelectorAll(CANDIDATES)) {
    // Ni Auto lui-même, ni le fil du chat / les notifications (le message de l'utilisateur contient les mots cherchés).
    if (el.closest('[data-auto], [aria-live]') || !usable(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height > vw * vh * 0.25) continue // grands conteneurs : on veut l'élément précis
    const { label, all } = texts(el)
    if (!label) continue
    const m = matchText(words, all)
    // Au moins un mot bien reconnu, et au moins un tiers des mots de la demande.
    if (m.hits === 0 || m.score < 0.8 || m.hits < Math.ceil(words.length / 3)) continue
    scored.push({ el, label, score: m.score, coverage: m.coverage })
  }
  if (!scored.length) return []
  const top = Math.max(...scored.map((s) => s.score))
  let best = scored.filter((s) => top - s.score < 0.05)
  const cov = Math.max(...best.map((s) => s.coverage))
  best = best.filter((s) => cov - s.coverage < 0.2) // le libellé qui correspond le mieux à la demande
  // Imbriqués (un lien qui contient un titre…) : on garde le plus précis.
  best = best.filter((s) => !best.some((o) => o !== s && s.el.contains(o.el)))
  // Doublons de libellé (même bouton rendu deux fois) : un seul.
  const seen = new Set<string>()
  best = best.filter((s) => { const k = s.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  return best.slice(0, 3).map(({ el, label, score }) => ({ el, label, score: score / words.length }))
}

/** Où se trouve l'élément, en mots : repère de l'interface, sinon zone de l'écran. */
export function describeWhere(el: Element): string {
  if (el.closest('[role="dialog"]')) return 'dans la fenêtre ouverte'
  if (el.closest('header')) return 'dans la barre du haut'
  const aside = el.closest('aside')
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
  if (aside) return cx < innerWidth / 2 ? 'dans le panneau de gauche' : 'dans le panneau de droite'
  const v = cy < innerHeight / 3 ? 'en haut' : cy > (innerHeight * 2) / 3 ? 'en bas' : 'au milieu'
  const h = cx < innerWidth / 3 ? ' à gauche' : cx > (innerWidth * 2) / 3 ? ' à droite' : ''
  return v === 'au milieu' && !h ? 'au milieu de la page' : `${v}${h} de la page`
}
