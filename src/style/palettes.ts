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

export const PALETTES: Palette[] = [
  // ---------- Mittelalterlich ----------
  {
    id: 'mittel-eiche', name: 'Eiche & Bruchstein', style: 'mittelalter', mood: 'warm',
    roles: {
      sockel: [{ id: 'cobblestone', w: 6 }, { id: 'andesite', w: 2 }, { id: 'mossy_cobblestone', w: 3, low: true }],
      wall: [{ id: 'birch_planks', w: 6 }, { id: 'stripped_birch_wood', w: 3 }],
      frame: one('stripped_dark_oak_log'),
      roof: [{ id: 'spruce_planks', w: 1 }],
      trim: one('dark_oak_planks'),
      floor: one('spruce_planks'),
      window: one('glass_pane'), door: one('spruce_door'), detail: one('spruce_planks'), light: one('lantern'),
      accent: [{ id: 'red_wool', w: 1 }],
      path: [{ id: 'dirt_path', w: 5 }, { id: 'coarse_dirt', w: 3 }, { id: 'gravel', w: 2 }],
    },
  },
  {
    id: 'mittel-fichte', name: 'Fichte & Steinziegel', style: 'mittelalter', mood: 'kühl',
    roles: {
      sockel: [{ id: 'stone_bricks', w: 6 }, { id: 'cracked_stone_bricks', w: 2 }, { id: 'mossy_stone_bricks', w: 3, low: true }],
      wall: [{ id: 'spruce_planks', w: 7 }, { id: 'stripped_spruce_wood', w: 3 }],
      frame: one('spruce_log'),
      roof: [{ id: 'deepslate_tiles', w: 8 }, { id: 'cobbled_deepslate', w: 2 }],
      trim: one('dark_oak_planks'),
      floor: one('oak_planks'),
      window: one('glass_pane'), door: one('spruce_door'), detail: one('dark_oak_planks'), light: one('lantern'),
      accent: [{ id: 'blue_wool', w: 1 }],
      path: [{ id: 'gravel', w: 4 }, { id: 'cobblestone', w: 3 }, { id: 'coarse_dirt', w: 3 }],
    },
  },
  {
    id: 'mittel-dunkel', name: 'Dunkeleiche & Lehm', style: 'mittelalter', mood: 'dunkel',
    roles: {
      sockel: [{ id: 'cobbled_deepslate', w: 6 }, { id: 'deepslate_bricks', w: 4 }],
      wall: [{ id: 'mud_bricks', w: 6 }, { id: 'packed_mud', w: 3 }],
      frame: one('dark_oak_log'),
      roof: one('dark_oak_planks'),
      trim: one('spruce_planks'),
      floor: one('dark_oak_planks'),
      window: one('glass_pane'), door: one('dark_oak_door'), detail: one('spruce_planks'), light: one('lantern'),
      accent: [{ id: 'green_wool', w: 1 }],
      path: [{ id: 'coarse_dirt', w: 4 }, { id: 'dirt_path', w: 4 }, { id: 'rooted_dirt', w: 2 }],
    },
  },
  // ---------- Japanisch ----------
  {
    id: 'japan-kirsche', name: 'Kirsche & Fichte', style: 'japan', mood: 'hell',
    roles: {
      sockel: [{ id: 'polished_andesite', w: 7 }, { id: 'andesite', w: 3 }],
      wall: one('birch_planks'),
      frame: one('stripped_spruce_log'),
      roof: one('deepslate_tiles'),
      trim: one('dark_oak_planks'),
      floor: one('spruce_planks'),
      window: one('glass_pane'), door: one('spruce_door'), detail: one('cherry_planks'), light: one('lantern'),
      accent: [{ id: 'red_wool', w: 1 }],
      path: [{ id: 'gravel', w: 6 }, { id: 'andesite', w: 2 }, { id: 'coarse_dirt', w: 2 }],
    },
  },
  {
    id: 'japan-dunkel', name: 'Dunkeleiche & Schwarzstein', style: 'japan', mood: 'dunkel',
    roles: {
      sockel: [{ id: 'cobbled_deepslate', w: 6 }, { id: 'polished_deepslate', w: 4 }],
      wall: one('white_terracotta'),
      frame: one('dark_oak_log'),
      roof: one('polished_blackstone_bricks'),
      trim: one('dark_oak_planks'),
      floor: one('dark_oak_planks'),
      window: one('glass_pane'), door: one('dark_oak_door'), detail: one('dark_oak_planks'), light: one('lantern'),
      accent: [{ id: 'red_wool', w: 1 }],
      path: [{ id: 'gravel', w: 5 }, { id: 'cobbled_deepslate', w: 3 }, { id: 'tuff', w: 2 }],
    },
  },
  // ---------- Modern ----------
  {
    id: 'modern-weiss', name: 'Weiß & Glas', style: 'modern', mood: 'hell',
    roles: {
      sockel: one('polished_andesite'),
      wall: one('white_concrete'),
      frame: one('polished_deepslate'),
      roof: one('polished_deepslate'),
      trim: one('smooth_stone'),
      floor: one('pale_oak_planks'),
      window: one('glass'), door: one('pale_oak_door'), detail: one('pale_oak_planks'), light: one('lantern'),
      accent: [{ id: 'light_gray_wool', w: 1 }],
      path: [{ id: 'smooth_stone', w: 6 }, { id: 'polished_andesite', w: 4 }],
    },
  },
  {
    id: 'modern-tuff', name: 'Tuff & Eiche', style: 'modern', mood: 'warm',
    roles: {
      sockel: one('tuff_bricks'),
      wall: [{ id: 'polished_tuff', w: 8 }, { id: 'tuff', w: 2 }],
      frame: one('stripped_oak_log'),
      roof: one('tuff_bricks'),
      trim: one('oak_planks'),
      floor: one('oak_planks'),
      window: one('glass'), door: one('oak_door'), detail: one('oak_planks'), light: one('lantern'),
      accent: [{ id: 'white_wool', w: 1 }],
      path: [{ id: 'tuff_bricks', w: 5 }, { id: 'polished_tuff', w: 5 }],
    },
  },
  // ---------- Wüste ----------
  {
    id: 'wueste-sand', name: 'Sandstein & Akazie', style: 'wueste', mood: 'warm',
    roles: {
      sockel: one('smooth_sandstone'),
      wall: [{ id: 'sandstone', w: 6 }, { id: 'smooth_sandstone', w: 4 }],
      frame: one('stripped_acacia_log'),
      roof: one('smooth_sandstone'),
      trim: one('cut_sandstone'),
      floor: one('acacia_planks'),
      window: one('glass_pane'), door: one('acacia_door'), detail: one('acacia_planks'), light: one('lantern'),
      accent: [{ id: 'orange_wool', w: 1 }, { id: 'white_wool', w: 1 }],
      path: [{ id: 'smooth_sandstone', w: 5 }, { id: 'sandstone', w: 3 }, { id: 'sand', w: 2 }],
    },
  },
  {
    id: 'wueste-rot', name: 'Roter Sandstein', style: 'wueste', mood: 'warm',
    roles: {
      sockel: one('smooth_red_sandstone'),
      wall: [{ id: 'red_sandstone', w: 6 }, { id: 'smooth_red_sandstone', w: 4 }],
      frame: one('stripped_acacia_log'),
      roof: one('smooth_red_sandstone'),
      trim: one('cut_red_sandstone'),
      floor: one('acacia_planks'),
      window: one('glass_pane'), door: one('acacia_door'), detail: one('acacia_planks'), light: one('lantern'),
      accent: [{ id: 'white_wool', w: 1 }, { id: 'yellow_wool', w: 1 }],
      path: [{ id: 'smooth_red_sandstone', w: 5 }, { id: 'red_sand', w: 3 }, { id: 'coarse_dirt', w: 2 }],
    },
  },
  {
    id: 'wueste-lehm', name: 'Lehm & Terrakotta', style: 'wueste', mood: 'warm',
    roles: {
      sockel: one('mud_bricks'),
      wall: [{ id: 'packed_mud', w: 6 }, { id: 'mud_bricks', w: 4 }],
      frame: one('stripped_jungle_log'),
      roof: one('mud_bricks'),
      trim: one('mud_bricks'),
      floor: one('jungle_planks'),
      window: one('glass_pane'), door: one('jungle_door'), detail: one('jungle_planks'), light: one('lantern'),
      accent: [{ id: 'orange_wool', w: 1 }, { id: 'brown_wool', w: 1 }],
      path: [{ id: 'coarse_dirt', w: 5 }, { id: 'packed_mud', w: 3 }, { id: 'dirt_path', w: 2 }],
    },
  },
  // ---------- Steampunk ----------
  {
    id: 'steam-kupfer', name: 'Kupfer & Ziegel', style: 'steampunk', mood: 'warm',
    roles: {
      sockel: [{ id: 'deepslate_bricks', w: 7 }, { id: 'cracked_deepslate_bricks', w: 3 }],
      wall: [{ id: 'bricks', w: 8 }, { id: 'mud_bricks', w: 2 }],
      frame: one('dark_oak_log'),
      roof: one('cut_copper'),
      trim: one('dark_oak_planks'),
      floor: one('spruce_planks'),
      window: one('glass_pane'), door: one('copper_door'), detail: one('dark_oak_planks'), light: one('lantern'),
      accent: [{ id: 'brown_wool', w: 1 }],
      path: [{ id: 'cobbled_deepslate', w: 5 }, { id: 'gravel', w: 3 }, { id: 'tuff', w: 2 }],
    },
  },
  {
    id: 'steam-schwarz', name: 'Schwarzstein & Grünspan', style: 'steampunk', mood: 'dunkel',
    roles: {
      sockel: one('polished_blackstone_bricks'),
      wall: [{ id: 'polished_blackstone', w: 6 }, { id: 'blackstone', w: 4 }],
      frame: one('stripped_dark_oak_log'),
      roof: one('waxed_exposed_cut_copper'),
      trim: one('dark_oak_planks'),
      floor: one('dark_oak_planks'),
      window: one('glass_pane'), door: one('exposed_copper_door'), detail: one('dark_oak_planks'), light: one('soul_lantern'),
      accent: [{ id: 'gray_wool', w: 1 }],
      path: [{ id: 'polished_blackstone', w: 5 }, { id: 'blackstone', w: 3 }, { id: 'gravel', w: 2 }],
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
