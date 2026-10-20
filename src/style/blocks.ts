// Blockkatalog: was die Stil-Generatoren über Blöcke wissen müssen.
// Familien (Treppe, Stufe, Mauer … zu einem Grundblock), Material, Aufwand im Survival,
// und vollständige Blockzustände mit allen Standardwerten aus dem Datengenerator-Report.

import blocksJson from '../../data/blocks-26.1.json'
import { formatState, parseState, shortName, type BlockState, type Props } from '../blueprint/blockstate'
import { shapeOf } from '../render/shapes'

const DATA = blocksJson as unknown as { blocks: Record<string, Record<string, string[]>>; defaults: Record<string, Record<string, string>> }

export function exists(id: string): boolean {
  return shortName(id) in DATA.blocks
}

export function propsOf(id: string): Record<string, string[]> {
  return DATA.blocks[shortName(id)] ?? {}
}

/** Zustand mit allen Properties: fehlende kommen aus den Standardwerten, unbekannte fliegen raus. */
export function complete(state: BlockState): BlockState {
  const { name, props } = parseState(state)
  const id = shortName(name)
  const allowed = DATA.blocks[id]
  if (!allowed) throw new Error(`Unbekannter Block: ${name}`)
  const out: Props = { ...(DATA.defaults[id] ?? {}) }
  for (const [k, v] of Object.entries(props)) {
    if (!allowed[k]) continue
    if (!allowed[k].includes(v)) throw new Error(`${name}: ${k}=${v} gibt es nicht`)
    out[k] = v
  }
  return formatState(name, out)
}

// ---------- Familien ----------

export type Form = 'stairs' | 'slab' | 'wall' | 'fence' | 'fence_gate' | 'door' | 'trapdoor' | 'button' | 'pressure_plate'
const FORMS: Form[] = ['stairs', 'slab', 'wall', 'fence', 'fence_gate', 'door', 'trapdoor', 'button', 'pressure_plate']

/** Wortstamm, an den Minecraft die Formen hängt: oak_planks → oak, stone_bricks → stone_brick, quartz_block → quartz. */
export function stemOf(id: string): string {
  const s = shortName(id)
  if (s.endsWith('_planks')) return s.slice(0, -7)
  if (s.endsWith('_block') && exists(`${s.slice(0, -6)}_stairs`)) return s.slice(0, -6)
  if (s.endsWith('s') && (exists(`${s.slice(0, -1)}_stairs`) || exists(`${s.slice(0, -1)}_slab`))) return s.slice(0, -1)
  if (s.endsWith('_block') && (exists(`${s.slice(0, -6)}_door`))) return s.slice(0, -6)
  return s
}

export function formOf(id: string, form: Form): string | null {
  const stem = stemOf(id)
  const cand = `${stem}_${form}`
  return exists(cand) ? `minecraft:${cand}` : null
}

export function hasForms(id: string, forms: Form[]): boolean {
  return forms.every(f => formOf(id, f) !== null)
}

export function familyOf(id: string): Partial<Record<Form, string>> {
  const out: Partial<Record<Form, string>> = {}
  for (const f of FORMS) {
    const b = formOf(id, f)
    if (b) out[f] = b
  }
  return out
}

// ---------- Material und Aufwand ----------

export type Material = 'stone' | 'wood' | 'earth' | 'brick' | 'metal' | 'glass' | 'plant' | 'light' | 'fabric' | 'other'

export function materialOf(id: string): Material {
  const s = shortName(id)
  if (/glass|pane/.test(s)) return 'glass'
  if (/lantern|torch|lamp|candle|glowstone|shroomlight|froglight|campfire/.test(s)) return 'light'
  if (/leaves|sapling|flower|grass|fern|bush|vine|moss|petals|tulip|poppy|dandelion|orchid|allium|daisy|lily|rose|peony|lilac|cactus|cane|bamboo$/.test(s)) return 'plant'
  if (/_log|_wood|planks|stem|hyphae|bamboo_(block|mosaic|planks)|_fence|_door|_trapdoor|bookshelf|barrel|crafting/.test(s)) return 'wood'
  if (/wool|carpet|banner|bed/.test(s)) return 'fabric'
  if (/copper|iron|gold|chain|anvil|bars|grate/.test(s)) return 'metal'
  if (/brick|tile/.test(s)) return 'brick'
  if (/dirt|mud$|clay|gravel|sand$|grass_block|podzol|mycelium|farmland|path/.test(s)) return 'earth'
  if (/stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|blackstone|quartz|sandstone|prismarine|purpur|terracotta|concrete|obsidian|end_stone|packed_mud|mud_brick/.test(s)) return 'stone'
  return 'other'
}

/** 1 = liegt herum, 2 = einfach hergestellt, 3 = Aufwand (Schmelzen/Handel/Nether), 4 = selten */
export function survivalCost(id: string): 1 | 2 | 3 | 4 {
  const s = shortName(id)
  if (/^(dirt|coarse_dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|sand|red_sand|gravel|.*_log|.*_planks|.*_leaves|grass_block|mossy_cobblestone|mud|clay)$/.test(s)) return 1
  if (/obsidian|amethyst|_ore$|diamond|emerald|netherite|gold_block|iron_block|crying|sculk|beacon|conduit|end_stone|purpur/.test(s)) return 4
  if (/quartz|prismarine|blackstone|basalt|nether|copper|resin|calcite|glowstone|shroomlight|froglight|concrete|terracotta|wool|packed_ice|blue_ice/.test(s)) return 3
  return 2
}

export function isNatural(id: string): boolean {
  const s = shortName(id)
  return /^(stone|dirt|coarse_dirt|grass_block|podzol|mycelium|sand|red_sand|gravel|clay|mud|water|lava|bedrock|andesite|diorite|granite|tuff|calcite|deepslate|snow|snow_block|powder_snow|ice|packed_ice|sandstone|red_sandstone|terracotta|.*_terracotta|moss_block|moss_carpet|rooted_dirt|dripstone_block|pointed_dripstone|short_grass|tall_grass|fern|large_fern|seagrass|tall_seagrass|kelp|kelp_plant|vine|.*_leaves|.*_ore|bubble_column|sugar_cane|cactus|lily_pad|dead_bush|.*_mushroom|.*_mushroom_block|mushroom_stem|amethyst_block|budding_amethyst|.*_amethyst_bud|amethyst_cluster|glow_lichen|hanging_roots|spore_blossom|azalea|flowering_azalea|cave_vines|cave_vines_plant|big_dripleaf|small_dripleaf|.*_tulip|poppy|dandelion|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|leaf_litter|bush|firefly_bush|sweet_berry_bush|pumpkin|melon|bamboo|smooth_basalt|magma_block|obsidian)$/.test(s)
}

// ---------- Treppenformen wie im Spiel ----------

const CCW: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' }
const OPP: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' }
const STEP: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

interface StairInfo { facing: string; half: string }

/**
 * Setzt "shape" aller Treppen so, wie Minecraft es beim Setzen ausrechnet (StairBlock.getStairsShape).
 * get/set arbeiten auf einem Gitter; Treppen ohne Nachbarn bleiben "straight".
 */
export function fixStairShapes(
  size: [number, number, number],
  get: (x: number, y: number, z: number) => BlockState,
  set: (x: number, y: number, z: number, s: BlockState) => void,
): void {
  const [w, h, d] = size
  const info = (x: number, y: number, z: number): StairInfo | null => {
    if (x < 0 || z < 0 || x >= w || z >= d) return null
    const s = get(x, y, z)
    if (!s.includes('_stairs')) return null
    const p = parseState(s).props
    return { facing: p.facing, half: p.half }
  }
  const updates: [number, number, number, BlockState][] = []
  for (let y = 0; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const me = info(x, y, z)
        if (!me) continue
        const canTake = (face: string) => {
          const [dx, dz] = STEP[face]
          const n = info(x + dx, y, z + dz)
          return !n || n.facing !== me.facing || n.half !== me.half
        }
        let shape = 'straight'
        const [fx, fz] = STEP[me.facing]
        const front = info(x + fx, y, z + fz)
        const back = info(x - fx, y, z - fz)
        if (front && front.half === me.half && axis(front.facing) !== axis(me.facing) && canTake(OPP[front.facing])) {
          shape = front.facing === CCW[me.facing] ? 'outer_left' : 'outer_right'
        } else if (back && back.half === me.half && axis(back.facing) !== axis(me.facing) && canTake(back.facing)) {
          shape = back.facing === CCW[me.facing] ? 'inner_left' : 'inner_right'
        }
        const { name, props } = parseState(get(x, y, z))
        if (props.shape !== shape) updates.push([x, y, z, formatState(name, { ...props, shape })])
      }
  for (const [x, y, z, s] of updates) set(x, y, z, s)
}

function axis(f: string): 'x' | 'z' {
  return f === 'east' || f === 'west' ? 'x' : 'z'
}

// ---------- Verbindungen von Scheiben, Gittern, Zäunen und Mauern wie im Spiel ----------


const CONNECTOR = /(_pane|^minecraft:iron_bars|_bars|_fence|_wall)$/

function kind(name: string): 'pane' | 'fence' | 'wall' | 'gate' | null {
  if (name.endsWith('_fence_gate')) return 'gate'
  if (name.endsWith('_pane') || name.endsWith('_bars')) return 'pane'
  if (name.endsWith('_fence')) return 'fence'
  if (name.endsWith('_wall')) return 'wall'
  return null
}

function sturdy(state: BlockState): boolean {
  const n = parseState(state).name
  if (n === 'minecraft:air' || n === 'minecraft:cave_air' || n === 'minecraft:void_air') return false
  if (/leaves|glass_pane|_bars|_fence|_wall$|_slab|_stairs|lantern|torch|door|trapdoor|_sign|ladder|carpet|flower|sapling|grass|fern|chest|campfire|bed|pot/.test(n) && !/glass$/.test(n)) return false
  const s = shapeOf(state)
  return s.length === 1 && s[0].join() === '0,0,0,1,1,1'
}

/**
 * Setzt north/east/south/west (und bei Mauern up) so, wie Minecraft sie beim Setzen ausrechnet.
 * Vereinfacht: verbindet mit gleichartigen Blöcken, passenden Zauntoren und vollen festen Blöcken.
 */
export function fixConnections(
  size: [number, number, number],
  get: (x: number, y: number, z: number) => BlockState,
  set: (x: number, y: number, z: number, s: BlockState) => void,
): void {
  const [w, h, d] = size
  const air = 'minecraft:air'
  const at = (x: number, y: number, z: number) => (x < 0 || z < 0 || y < 0 || x >= w || z >= d || y >= h ? air : get(x, y, z))
  const updates: [number, number, number, BlockState][] = []
  for (let y = 0; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const s = get(x, y, z)
        const { name, props } = parseState(s)
        if (!CONNECTOR.test(name)) continue
        const me = kind(name)
        if (!me || me === 'gate') continue
        const out: Props = { ...props }
        const conn: Record<string, boolean> = {}
        for (const [dir, [dx, dz]] of Object.entries(STEP)) {
          const n = at(x + dx, y, z + dz)
          const np = parseState(n)
          const nk = kind(np.name)
          let c = false
          if (nk === 'gate') c = axis(np.props.facing) !== (dx !== 0 ? 'x' : 'z')
          else if (me === 'pane') c = nk === 'pane' || nk === 'wall' || sturdy(n)
          else if (me === 'fence') c = (nk === 'fence' && (np.name === 'minecraft:nether_brick_fence') === (name === 'minecraft:nether_brick_fence')) || sturdy(n)
          else c = nk === 'wall' || nk === 'pane' || sturdy(n)
          conn[dir] = c
        }
        for (const dir of Object.keys(STEP)) {
          if (me === 'wall') out[dir] = conn[dir] ? 'low' : 'none'
          else out[dir] = String(conn[dir])
        }
        if (me === 'wall') {
          const straight = (conn.north && conn.south && !conn.east && !conn.west) || (conn.east && conn.west && !conn.north && !conn.south)
          out.up = String(!straight)
        }
        const next = formatState(name, out)
        if (next !== s) updates.push([x, y, z, next])
      }
  for (const [x, y, z, s] of updates) set(x, y, z, s)
}
