// Deutsche Zahlen und lesbare Blocknamen.

import { shortName } from '../blueprint/blockstate'

const nf = new Intl.NumberFormat('de-DE')

export const num = (n: number): string => nf.format(n)

/** Koordinaten mit echtem Minuszeichen. */
export const coord = (n: number): string => (n < 0 ? `−${nf.format(-n)}` : nf.format(n))

export function itemLabel(item: string): string {
  const s = shortName(item).replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
