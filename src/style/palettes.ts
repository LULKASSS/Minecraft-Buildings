// Paletten nach Rollen: nicht "welche Blöcke", sondern "welcher Block wofür".
// Jede Rolle mischt 1–3 Blöcke mit Gewicht. Formen (Treppe, Stufe, Zaun …) holt der Generator aus der Familie.

import { hasForms, type Form } from './blocks'

export type Role =
  | 'sockel' // Fundament, Sockel, Schornstein
  | 'wall' // Wandfläche
  | 'frame' // Pfosten und Balken
  | 'roof' // Dachfläche
  | 'trim' // Dachkante, Gesimse
  | 'floor' // Boden innen
  | 'window' // Glas
  | 'door'
  | 'detail' // Holz für Fensterläden, Zäune, Geländer
  | 'light'
  | 'accent' // Stoff, Markisen, Blumen
  | 'path'

export interface Weighted {
  id: string
  w: number
  /** nur in den unteren Reihen (Verwitterung, Moos) */
  low?: boolean
}

export interface Palette {
  id: string
  name: string
  style: string
  mood: 'warm' | 'kühl' | 'hell' | 'dunkel'
  roles: Record<Role, Weighted[]>
  custom?: boolean
}

const one = (id: string): Weighted[] => [{ id, w: 1 }]

/** Welche Formen eine Rolle in ihrem Hauptblock braucht. */
export const NEEDS: Partial<Record<Role, Form[]>> = {
  sockel: ['stairs', 'slab'],
  roof: ['stairs', 'slab'],
  trim: ['slab'],
  detail: ['fence', 'trapdoor', 'slab'],
}

const mix = (...e: [string, number, boolean?][]): Weighted[] => e.map(([id, w, low]) => (low ? { id, w, low } : { id, w }))
const lantern = one('lantern')
const glass = one('glass_pane')

// Paletten: je Rolle zwei bis vier Blöcke mit Gewicht, damit Flächen lebendig wirken; "low" = nur unten (Moos, Risse).
export const PALETTES: Palette[] = [
  // ---------- Mittelalterlich ----------
  {
    id: 'mittel-putz', name: 'Kalkputz & Dunkeleiche', style: 'mittelalter', mood: 'hell',
    roles: {
      sockel: mix(['cobblestone', 5], ['stone_bricks', 3], ['andesite', 2], ['mossy_cobblestone', 3, true]),
      wall: mix(['calcite', 7], ['polished_diorite', 2]),
      frame: one('stripped_dark_oak_log'),
      roof: one('dark_oak_planks'),
      trim: one('cobblestone'),
      floor: one('spruce_planks'),
      window: glass, door: one('dark_oak_door'), detail: one('spruce_planks'), light: lantern,
      accent: mix(['red_wool', 1], ['white_wool', 1]),
      path: mix(['dirt_path', 5], ['coarse_dirt', 3], ['gravel', 2], ['cobblestone', 1]),
    },
  },
  {
    id: 'mittel-eiche', name: 'Eiche & Bruchstein', style: 'mittelalter', mood: 'warm',
    roles: {
      sockel: mix(['cobblestone', 6], ['andesite', 2], ['mossy_cobblestone', 3, true]),
      wall: mix(['birch_planks', 6], ['stripped_birch_wood', 3], ['calcite', 1]),
      frame: one('stripped_dark_oak_log'),
      roof: one('spruce_planks'),
      trim: one('cobblestone'),
      floor: one('spruce_planks'),
      window: glass, door: one('spruce_door'), detail: one('spruce_planks'), light: lantern,
      accent: mix(['red_wool', 1]),
      path: mix(['dirt_path', 5], ['coarse_dirt', 3], ['gravel', 2]),
    },
  },
  {
    id: 'mittel-ziegel', name: 'Backstein & Fichte', style: 'mittelalter', mood: 'warm',
    roles: {
      sockel: mix(['stone_bricks', 5], ['cracked_stone_bricks', 2], ['mossy_stone_bricks', 3, true]),
      wall: mix(['bricks', 7], ['granite', 1], ['mud_bricks', 2]),
      frame: one('spruce_log'),
      roof: mix(['deepslate_tiles', 8], ['deepslate_bricks', 1]),
      trim: one('stone_bricks'),
      floor: one('oak_planks'),
      window: glass, door: one('spruce_door'), detail: one('spruce_planks'), light: lantern,
      accent: mix(['brown_wool', 1], ['white_wool', 1]),
      path: mix(['cobblestone', 4], ['gravel', 3], ['andesite', 2], ['mossy_cobblestone', 1]),
    },
  },
  {
    id: 'mittel-fichte', name: 'Fichte & Steinziegel', style: 'mittelalter', mood: 'kühl',
    roles: {
      sockel: mix(['stone_bricks', 6], ['cracked_stone_bricks', 2], ['mossy_stone_bricks', 3, true]),
      wall: mix(['spruce_planks', 6], ['stripped_spruce_wood', 3], ['spruce_planks', 1]),
      frame: one('spruce_log'),
      roof: mix(['deepslate_tiles', 8], ['deepslate_bricks', 1]),
      trim: one('cobbled_deepslate'),
      floor: one('oak_planks'),
      window: glass, door: one('spruce_door'), detail: one('dark_oak_planks'), light: lantern,
      accent: mix(['blue_wool', 1]),
      path: mix(['gravel', 4], ['cobblestone', 3], ['coarse_dirt', 3]),
    },
  },
  {
    id: 'mittel-dunkel', name: 'Dunkeleiche & Lehm', style: 'mittelalter', mood: 'dunkel',
    roles: {
      sockel: mix(['cobbled_deepslate', 6], ['deepslate_bricks', 3], ['mossy_cobblestone', 2, true]),
      wall: mix(['mud_bricks', 5], ['packed_mud', 3], ['bricks', 1]),
      frame: one('dark_oak_log'),
      roof: one('dark_oak_planks'),
      trim: one('spruce_planks'),
      floor: one('dark_oak_planks'),
      window: glass, door: one('dark_oak_door'), detail: one('spruce_planks'), light: lantern,
      accent: mix(['green_wool', 1]),
      path: mix(['coarse_dirt', 4], ['dirt_path', 4], ['rooted_dirt', 2]),
    },
  },
  // ---------- Japanisch ----------
  {
    id: 'japan-kirsche', name: 'Kirsche & Kalkputz', style: 'japan', mood: 'hell',
    roles: {
      sockel: mix(['polished_andesite', 6], ['andesite', 3], ['mossy_cobblestone', 1, true]),
      wall: mix(['calcite', 7], ['polished_diorite', 2]),
      frame: one('stripped_spruce_log'),
      roof: one('deepslate_tiles'),
      trim: one('dark_oak_planks'),
      floor: one('spruce_planks'),
      window: one('white_stained_glass_pane'), door: one('spruce_door'), detail: one('cherry_planks'), light: lantern,
      accent: mix(['red_wool', 1]),
      path: mix(['gravel', 6], ['andesite', 2], ['coarse_dirt', 2]),
    },
  },
  {
    id: 'japan-bambus', name: 'Bambus & Fichte', style: 'japan', mood: 'warm',
    roles: {
      sockel: mix(['stone_bricks', 5], ['mossy_stone_bricks', 3, true], ['andesite', 2]),
      wall: mix(['bamboo_planks', 5], ['calcite', 3]),
      frame: one('stripped_spruce_log'),
      roof: one('spruce_planks'),
      trim: one('spruce_planks'),
      floor: one('bamboo_planks'),
      window: one('white_stained_glass_pane'), door: one('bamboo_door'), detail: one('bamboo_planks'), light: lantern,
      accent: mix(['green_wool', 1]),
      path: mix(['gravel', 5], ['moss_block', 2], ['coarse_dirt', 3]),
    },
  },
  {
    id: 'japan-dunkel', name: 'Dunkeleiche & Schwarzstein', style: 'japan', mood: 'dunkel',
    roles: {
      sockel: mix(['cobbled_deepslate', 6], ['polished_deepslate', 4]),
      wall: mix(['calcite', 7], ['polished_diorite', 2]),
      frame: one('dark_oak_log'),
      roof: one('polished_blackstone_bricks'),
      trim: one('dark_oak_planks'),
      floor: one('dark_oak_planks'),
      window: one('white_stained_glass_pane'), door: one('dark_oak_door'), detail: one('dark_oak_planks'), light: lantern,
      accent: mix(['red_wool', 1]),
      path: mix(['gravel', 5], ['cobbled_deepslate', 3], ['tuff', 2]),
    },
  },
  // ---------- Modern ----------
  {
    id: 'modern-weiss', name: 'Weiß & Glas', style: 'modern', mood: 'hell',
    roles: {
      sockel: one('polished_andesite'),
      wall: mix(['white_concrete', 8], ['smooth_quartz', 2]),
      frame: one('polished_deepslate'),
      roof: one('polished_deepslate'),
      trim: one('smooth_stone'),
      floor: one('pale_oak_planks'),
      window: one('glass'), door: one('pale_oak_door'), detail: one('pale_oak_planks'), light: lantern,
      accent: mix(['light_gray_wool', 1]),
      path: mix(['smooth_stone', 6], ['polished_andesite', 4]),
    },
  },
  {
    id: 'modern-tuff', name: 'Tuff & Eiche', style: 'modern', mood: 'warm',
    roles: {
      sockel: one('tuff_bricks'),
      wall: mix(['polished_tuff', 7], ['tuff', 2], ['tuff_bricks', 1]),
      frame: one('stripped_oak_log'),
      roof: one('tuff_bricks'),
      trim: one('oak_planks'),
      floor: one('oak_planks'),
      window: one('glass'), door: one('oak_door'), detail: one('oak_planks'), light: lantern,
      accent: mix(['white_wool', 1]),
      path: mix(['tuff_bricks', 5], ['polished_tuff', 5]),
    },
  },
  {
    id: 'modern-beton', name: 'Beton & Dunkelholz', style: 'modern', mood: 'kühl',
    roles: {
      sockel: one('polished_deepslate'),
      wall: mix(['light_gray_concrete', 7], ['smooth_stone', 2]),
      frame: one('stripped_dark_oak_log'),
      roof: one('polished_deepslate'),
      trim: one('dark_oak_planks'),
      floor: one('dark_oak_planks'),
      window: one('glass'), door: one('dark_oak_door'), detail: one('dark_oak_planks'), light: lantern,
      accent: mix(['gray_wool', 1]),
      path: mix(['smooth_stone', 5], ['polished_deepslate', 3], ['gravel', 2]),
    },
  },
  {
    id: 'modern-quarz', name: 'Quarz & Birke', style: 'modern', mood: 'hell',
    roles: {
      sockel: one('smooth_quartz'),
      wall: mix(['quartz_block', 6], ['smooth_quartz', 3]),
      frame: one('stripped_birch_log'),
      roof: one('smooth_quartz'),
      trim: one('birch_planks'),
      floor: one('birch_planks'),
      window: one('glass'), door: one('birch_door'), detail: one('birch_planks'), light: lantern,
      accent: mix(['light_gray_wool', 1]),
      path: mix(['smooth_quartz', 5], ['smooth_stone', 5]),
    },
  },
  // ---------- Wüste ----------
  {
    id: 'wueste-sand', name: 'Sandstein & Akazie', style: 'wueste', mood: 'warm',
    roles: {
      sockel: mix(['smooth_sandstone', 6], ['sandstone', 3]),
      wall: mix(['smooth_sandstone', 5], ['sandstone', 3], ['cut_sandstone', 2]),
      frame: one('stripped_acacia_log'),
      roof: one('smooth_sandstone'),
      trim: mix(['sandstone', 1]),
      floor: one('acacia_planks'),
      window: glass, door: one('acacia_door'), detail: one('acacia_planks'), light: lantern,
      accent: mix(['orange_wool', 1], ['white_wool', 1]),
      path: mix(['smooth_sandstone', 5], ['sandstone', 3], ['sand', 2]),
    },
  },
  {
    id: 'wueste-lehm', name: 'Lehm & Terrakotta', style: 'wueste', mood: 'warm',
    roles: {
      sockel: mix(['mud_bricks', 7], ['packed_mud', 3]),
      wall: mix(['packed_mud', 6], ['mud_bricks', 3], ['terracotta', 1]),
      frame: one('stripped_jungle_log'),
      roof: one('mud_bricks'),
      trim: one('mud_bricks'),
      floor: one('jungle_planks'),
      window: glass, door: one('jungle_door'), detail: one('jungle_planks'), light: lantern,
      accent: mix(['orange_wool', 1], ['brown_wool', 1]),
      path: mix(['coarse_dirt', 5], ['packed_mud', 3], ['dirt_path', 2]),
    },
  },
  {
    id: 'wueste-weiss', name: 'Weißer Kalk & Akazie', style: 'wueste', mood: 'hell',
    roles: {
      sockel: mix(['smooth_sandstone', 6], ['sandstone', 4]),
      wall: mix(['calcite', 7], ['polished_diorite', 2]),
      frame: one('stripped_acacia_log'),
      roof: one('smooth_sandstone'),
      trim: one('smooth_sandstone'),
      floor: one('acacia_planks'),
      window: glass, door: one('acacia_door'), detail: one('acacia_planks'), light: lantern,
      accent: mix(['orange_wool', 1], ['white_wool', 1], ['yellow_wool', 1]),
      path: mix(['smooth_sandstone', 5], ['sand', 3], ['sandstone', 2]),
    },
  },
  {
    id: 'wueste-rot', name: 'Roter Sandstein', style: 'wueste', mood: 'warm',
    roles: {
      sockel: mix(['smooth_red_sandstone', 6], ['red_sandstone', 4]),
      wall: mix(['smooth_red_sandstone', 5], ['red_sandstone', 3], ['cut_red_sandstone', 1], ['terracotta', 1]),
      frame: one('stripped_acacia_log'),
      roof: one('smooth_red_sandstone'),
      trim: one('red_sandstone'),
      floor: one('acacia_planks'),
      window: glass, door: one('acacia_door'), detail: one('acacia_planks'), light: lantern,
      accent: mix(['white_wool', 1], ['yellow_wool', 1]),
      path: mix(['smooth_red_sandstone', 5], ['red_sand', 3], ['coarse_dirt', 2]),
    },
  },
  // ---------- Steampunk ----------
  {
    id: 'steam-kupfer', name: 'Kupfer & Ziegel', style: 'steampunk', mood: 'warm',
    roles: {
      sockel: mix(['deepslate_bricks', 6], ['cracked_deepslate_bricks', 3], ['cobbled_deepslate', 1]),
      wall: mix(['bricks', 7], ['mud_bricks', 2], ['granite', 1]),
      frame: one('dark_oak_log'),
      roof: mix(['waxed_cut_copper', 8], ['waxed_exposed_cut_copper', 2]),
      trim: one('dark_oak_planks'),
      floor: one('spruce_planks'),
      window: glass, door: one('copper_door'), detail: one('dark_oak_planks'), light: lantern,
      accent: mix(['brown_wool', 1]),
      path: mix(['cobbled_deepslate', 5], ['gravel', 3], ['tuff', 2]),
    },
  },
  {
    id: 'steam-gruen', name: 'Grünspan & Schiefer', style: 'steampunk', mood: 'kühl',
    roles: {
      sockel: mix(['cobbled_deepslate', 6], ['deepslate_bricks', 4]),
      wall: mix(['deepslate_bricks', 5], ['polished_deepslate', 3], ['cracked_deepslate_bricks', 2]),
      frame: one('stripped_spruce_log'),
      roof: mix(['waxed_weathered_cut_copper', 8], ['waxed_oxidized_cut_copper', 2]),
      trim: one('spruce_planks'),
      floor: one('spruce_planks'),
      window: glass, door: one('weathered_copper_door'), detail: one('spruce_planks'), light: lantern,
      accent: mix(['cyan_wool', 1]),
      path: mix(['cobbled_deepslate', 5], ['gravel', 3], ['tuff', 2]),
    },
  },
  {
    id: 'steam-schwarz', name: 'Schwarzstein & Messing', style: 'steampunk', mood: 'dunkel',
    roles: {
      sockel: one('polished_blackstone_bricks'),
      wall: mix(['polished_blackstone', 5], ['blackstone', 3], ['gilded_blackstone', 1]),
      frame: one('stripped_dark_oak_log'),
      roof: mix(['waxed_exposed_cut_copper', 8], ['waxed_weathered_cut_copper', 2]),
      trim: one('dark_oak_planks'),
      floor: one('dark_oak_planks'),
      window: glass, door: one('exposed_copper_door'), detail: one('dark_oak_planks'), light: one('soul_lantern'),
      accent: mix(['gray_wool', 1]),
      path: mix(['polished_blackstone', 5], ['blackstone', 3], ['gravel', 2]),
    },
  },
]

export function paletteById(id: string, extra: Palette[] = []): Palette | undefined {
  return [...PALETTES, ...extra].find(p => p.id === id)
}

export function palettesFor(style: string, extra: Palette[] = []): Palette[] {
  return [...PALETTES, ...extra].filter(p => p.style === style || p.custom)
}

/** Prüft, ob jede Rolle ihre nötigen Formen hat. Liefert Fehlermeldungen. */
export function validatePalette(p: Palette): string[] {
  const errors: string[] = []
  for (const [role, forms] of Object.entries(NEEDS) as [Role, Form[]][]) {
    const main = p.roles[role]?.[0]?.id
    if (!main) errors.push(`${p.id}: Rolle ${role} leer`)
    else if (!hasForms(main, forms)) errors.push(`${p.id}: ${main} hat nicht alle Formen ${forms.join(', ')} für ${role}`)
  }
  return errors
}

// ---------- Auswahl an einer Position ----------

/** Fester Zufall je Position, damit Mischungen gleich bleiben, wenn man neu lädt. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(seed, 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Block einer Rolle an einer Stelle; "low" nur in den unteren Reihen (y < lowUntil). */
export function pick(list: Weighted[], x: number, y: number, z: number, seed: number, lowUntil = 2): string {
  const usable = list.filter(e => !e.low || y < lowUntil)
  const total = usable.reduce((n, e) => n + e.w, 0)
  let r = hash3(x, y, z, seed) * total
  for (const e of usable) {
    r -= e.w
    if (r < 0) return e.id
  }
  return usable[0].id
}

// ---------- Eigene (gelernte) Paletten ----------

let custom: Palette[] = []

export function setCustomPalettes(list: Palette[]): void {
  custom = list
}

export function customPalettes(): Palette[] {
  return custom
}

export function getPalette(id: string): Palette | undefined {
  return paletteById(id, custom)
}
