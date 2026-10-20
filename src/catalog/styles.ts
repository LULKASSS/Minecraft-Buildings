// Stile = Palette + Regeln. Ein Stil legt Formensprache und Proportionen fest; die Palette das Material.

export type Size = 'S' | 'M' | 'L'
export type RoofKind = 'gable' | 'hip' | 'pagoda' | 'flat' | 'parapet'

export interface Style {
  id: string
  label: string
  /** Höhe eines Stockwerks inkl. Balkenlage */
  storey: number
  /** Reihen Sockel über dem Gelände (2 = erhöhter Boden) */
  sockel: number
  frame: 'timber' | 'posts' | 'band' | 'none'
  /** Abstand der Pfosten in Fachwerk/Pfosten-Stilen */
  spacing: number
  roof: RoofKind
  overhang: number
  /** Fensterhöhe und -art */
  window: { h: number; wide: boolean; shutters: boolean; boxes: boolean; awning: boolean; glassBlock: boolean }
  /** Grundfläche [Breite, Tiefe] je Größe, Auswahl per Variante */
  sizes: Record<Size, [number, number][]>
  storeys: Record<Size, number[]>
  chimneys: number
  skirt: boolean
  veranda: boolean
  vigas: boolean
  doubleDoor: boolean
  palettes: string[]
  /** Natur, die gut dazu passt (für den Pinsel) */
  nature: string
}

export const STYLES: Style[] = [
  {
    id: 'mittelalter', label: 'Mittelalterlich', storey: 4, sockel: 1, frame: 'timber', spacing: 4, roof: 'gable', overhang: 1,
    window: { h: 1, wide: false, shutters: true, boxes: true, awning: false, glassBlock: false },
    sizes: { S: [[7, 9], [7, 7]], M: [[9, 11], [9, 13]], L: [[11, 15], [13, 15]] },
    storeys: { S: [1], M: [1, 2], L: [2] }, chimneys: 1, skirt: true, veranda: false, vigas: false, doubleDoor: false,
    palettes: ['mittel-eiche', 'mittel-fichte', 'mittel-dunkel'], nature: 'wald',
  },
  {
    id: 'japan', label: 'Japanisch', storey: 4, sockel: 2, frame: 'posts', spacing: 3, roof: 'pagoda', overhang: 2,
    window: { h: 2, wide: true, shutters: false, boxes: false, awning: false, glassBlock: false },
    sizes: { S: [[7, 7], [9, 7]], M: [[9, 9], [11, 9]], L: [[13, 11], [11, 11]] },
    storeys: { S: [1], M: [1, 2], L: [2] }, chimneys: 0, skirt: true, veranda: true, vigas: false, doubleDoor: true,
    palettes: ['japan-kirsche', 'japan-dunkel'], nature: 'kirschhain',
  },
  {
    id: 'modern', label: 'Modern', storey: 4, sockel: 1, frame: 'band', spacing: 4, roof: 'flat', overhang: 1,
    window: { h: 3, wide: true, shutters: false, boxes: false, awning: false, glassBlock: true },
    sizes: { S: [[9, 7], [7, 9]], M: [[11, 9], [13, 9]], L: [[15, 11], [13, 13]] },
    storeys: { S: [1], M: [2], L: [2, 3] }, chimneys: 0, skirt: false, veranda: false, vigas: false, doubleDoor: false,
    palettes: ['modern-weiss', 'modern-tuff'], nature: 'wiese',
  },
  {
    id: 'wueste', label: 'Wüste', storey: 4, sockel: 1, frame: 'none', spacing: 3, roof: 'parapet', overhang: 0,
    window: { h: 1, wide: false, shutters: false, boxes: false, awning: true, glassBlock: false },
    sizes: { S: [[7, 7], [7, 9]], M: [[9, 9], [11, 9]], L: [[13, 11], [11, 13]] },
    storeys: { S: [1], M: [1, 2], L: [2] }, chimneys: 0, skirt: false, veranda: false, vigas: true, doubleDoor: false,
    palettes: ['wueste-sand', 'wueste-rot', 'wueste-lehm'], nature: 'savanne',
  },
  {
    id: 'steampunk', label: 'Steampunk', storey: 5, sockel: 2, frame: 'timber', spacing: 4, roof: 'gable', overhang: 1,
    window: { h: 2, wide: false, shutters: false, boxes: false, awning: false, glassBlock: false },
    sizes: { S: [[7, 9], [9, 9]], M: [[9, 11], [11, 11]], L: [[11, 15], [13, 13]] },
    storeys: { S: [1], M: [2], L: [2, 3] }, chimneys: 2, skirt: true, veranda: false, vigas: false, doubleDoor: false,
    palettes: ['steam-kupfer', 'steam-schwarz'], nature: 'felsen',
  },
]

export function styleById(id: string): Style {
  const s = STYLES.find(s => s.id === id)
  if (!s) throw new Error(`Unbekannter Stil: ${id}`)
  return s
}
