/* Anneaux de mise en évidence : une couche fixe à part (pointer-events: none, au-dessus des panneaux, sous Auto),
 * un anneau pulsant par élément. Suit les éléments à chaque image (défilement, redimensionnement) ; ne touche jamais
 * aux styles des éléments eux-mêmes. Styles : .auto-rings / .auto-ring dans styles.css (clair et sombre). */

const PAD = 5

/** Ancêtres qui rognent leur contenu (la palette défile) : l'anneau ne déborde pas d'une zone masquée. */
function clipAncestors(el: Element): Element[] {
  const out: Element[] = []
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) out.push(p)
  }
  return out
}

export function createRings() {
  let host: HTMLDivElement | null = null, raf = 0
  let items: { el: Element; ring: HTMLDivElement; clips: Element[] }[] = []

  function tick() {
    for (const { el, ring, clips } of items) {
      const r = el.getBoundingClientRect()
      let l = r.left - PAD, t = r.top - PAD, rr = r.right + PAD, b = r.bottom + PAD
      for (const c of clips) { const k = c.getBoundingClientRect(); l = Math.max(l, k.left); t = Math.max(t, k.top); rr = Math.min(rr, k.right); b = Math.min(b, k.bottom) }
      const show = el.isConnected && r.width > 0 && rr - l > 4 && b - t > 4
      ring.style.visibility = show ? 'visible' : 'hidden'
      // left/top et non transform : la pulsation (propriété `scale`) s'appliquerait aussi à la translation et décalerait l'anneau.
      if (show) { ring.style.left = `${l}px`; ring.style.top = `${t}px`; ring.style.width = `${rr - l}px`; ring.style.height = `${b - t}px` }
    }
    raf = requestAnimationFrame(tick)
  }

  return {
    start(els: Element[]) {
      this.stop()
      host = document.createElement('div')
      host.className = 'auto-rings'; host.dataset.auto = ''; host.setAttribute('aria-hidden', 'true')
      document.body.appendChild(host)
      items = els.map((el) => { const ring = document.createElement('div'); ring.className = 'auto-ring'; host!.appendChild(ring); return { el, ring, clips: clipAncestors(el) } })
      tick()
    },
    stop() { cancelAnimationFrame(raf); raf = 0; host?.remove(); host = null; items = [] },
  }
}
