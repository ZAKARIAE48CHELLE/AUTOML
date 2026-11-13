import { useSyncExternalStore, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun } from 'lucide-react'
import { clsx } from './format'

/* Thème clair/sombre. La classe `dark` sur <html> active les variantes `dark:` et la couche de surcharge de styles.css.
 * Le choix est mémorisé ; à défaut, on suit la préférence système. index.html l'applique avant le premier rendu (pas de flash). */

export type Theme = 'light' | 'dark'
const KEY = 'ai-studio.theme'
const ls = new Set<() => void>()
const read = (): Theme => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light')

function apply(t: Theme) {
  const el = document.documentElement
  el.classList.toggle('dark', t === 'dark'); el.style.colorScheme = t
  try { localStorage.setItem(KEY, t) } catch { /* stockage indisponible */ }
  ls.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l) } }, read, () => 'light')
}

/**
 * Bascule le thème avec un « splash » circulaire qui part du point cliqué et recouvre toute la page
 * (View Transitions API). Repli instantané si l'API est absente ou si l'utilisateur réduit les animations.
 */
export function toggleTheme(origin?: { x: number; y: number }) {
  const next: Theme = read() === 'dark' ? 'light' : 'dark'
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce) { apply(next); return }
  const x = origin?.x ?? window.innerWidth - 40, y = origin?.y ?? 40
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  // flushSync : les composants abonnés (ex. canevas React Flow) doivent être à jour avant la capture du nouvel état.
  const vt = doc.startViewTransition(() => { flushSync(() => apply(next)) })
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' })
  }).catch(() => { /* transition annulée */ })
}

/** Bouton soleil/lune : l'icône pivote et change, puis le splash part du centre du bouton. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTheme(); const dark = t === 'dark'
  const onClick = (e: MouseEvent<HTMLButtonElement>) => { const r = e.currentTarget.getBoundingClientRect(); toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) }
  const label = dark ? 'Passer en mode clair' : 'Passer en mode sombre'
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={dark}
      className={clsx('relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-brand-500 hover:text-brand-700', className)}>
      <Sun className={clsx('absolute h-4 w-4 transition-all duration-500 [transition-timing-function:var(--ease-spring)]', dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={clsx('absolute h-4 w-4 transition-all duration-500 [transition-timing-function:var(--ease-spring)]', dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
    </button>)
}
