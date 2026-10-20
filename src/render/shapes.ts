// Vereinfachte Blockformen für die einfarbige Ansicht (ohne Minecraft-.jar).
// Ein Block ist eine Liste von Quadern in 0…1-Einheiten. Mit .jar übernimmt deepslate die echten Modelle.

import { parseState, shortName, type BlockState } from '../blueprint/blockstate'

export type Box = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number]

const FULL: Box[] = [[0, 0, 0, 1, 1, 1]]
const memo = new Map<BlockState, Box[]>()

export function shapeOf(state: BlockState): Box[] {
  let s = memo.get(state)
  if (!s) memo.set(state, (s = compute(state)))
  return s
}

/** Füllt den Block den ganzen Würfel und ist undurchsichtig? Dann verdeckt er Nachbarflächen. */
export function isOpaqueCube(state: BlockState): boolean {
  const id = shortName(parseState(state).name)
  if (/glass|leaves|ice$|^water$|^lava$|slime|honey|barrier|spawner/.test(id)) return false
  return shapeOf(state) === FULL
}

export function isInvisible(state: BlockState): boolean {
  const id = shortName(parseState(state).name)
  return id === 'air' || id === 'cave_air' || id === 'void_air' || id === 'barrier' || id === 'light' || id === 'structure_void'
}

function compute(state: BlockState): Box[] {
  const { name, props } = parseState(state)
  const id = shortName(name)
  const f = props.facing

  if (id.endsWith('_slab')) {
    if (props.type === 'top') return [[0, 0.5, 0, 1, 1, 1]]
    if (props.type === 'double') return FULL
    return [[0, 0, 0, 1, 0.5, 1]]
  }
  if (id.endsWith('_stairs')) {
    const top = props.half === 'top'
    const base: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]
    const [y0, y1] = top ? [0, 0.5] : [0.5, 1]
    const back: Record<string, Box> = {
      north: [0, y0, 0, 1, y1, 0.5], south: [0, y0, 0.5, 1, y1, 1],
      west: [0, y0, 0, 0.5, y1, 1], east: [0.5, y0, 0, 1, y1, 1],
    }
    return [base, back[f] ?? back.north]
  }
  if (id.endsWith('_carpet') || id === 'moss_carpet' || id.endsWith('pressure_plate')) return [[0, 0, 0, 1, 0.0625, 1]]
  if (id === 'snow') return [[0, 0, 0, 1, Math.max(1, Number(props.layers ?? 1)) / 8, 1]]
  if (id.endsWith('_bed')) return [[0, 0, 0, 1, 0.5625, 1]]
  if (id.endsWith('_door')) {
    const t = 0.1875
    const open = props.open === 'true'
    const dir = open ? turn(f, props.hinge === 'right' ? -1 : 1) : f
    return [panel(dir, t)]
  }
  if (id.endsWith('_trapdoor')) {
    if (props.open === 'true') return [panel(f, 0.1875)]
    return props.half === 'top' ? [[0, 0.8125, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.1875, 1]]
  }
  if (id.endsWith('glass_pane') || id === 'iron_bars' || id.endsWith('_fence') || id.endsWith('_wall') && !id.includes('wall_')) {
    const wall = id.endsWith('_wall')
    const r = wall ? 0.25 : id.endsWith('_fence') ? 0.125 : 0.0625
    const h = id.endsWith('_fence') ? 1 : wall ? 0.875 : 1
    const boxes: Box[] = [[0.5 - r, 0, 0.5 - r, 0.5 + r, 1, 0.5 + r]]
    const on = (k: string) => props[k] && props[k] !== 'false' && props[k] !== 'none'
    if (on('north')) boxes.push([0.5 - r, 0, 0, 0.5 + r, h, 0.5])
    if (on('south')) boxes.push([0.5 - r, 0, 0.5, 0.5 + r, h, 1])
    if (on('west')) boxes.push([0, 0, 0.5 - r, 0.5, h, 0.5 + r])
    if (on('east')) boxes.push([0.5, 0, 0.5 - r, 1, h, 0.5 + r])
    return boxes
  }
  if (id.endsWith('torch')) {
    if (id.includes('wall')) {
      const off: Record<string, [number, number]> = { north: [0.5, 0.8], south: [0.5, 0.2], east: [0.2, 0.5], west: [0.8, 0.5] }
      const [cx, cz] = off[f] ?? [0.5, 0.5]
      return [[cx - 0.0625, 0.2, cz - 0.0625, cx + 0.0625, 0.85, cz + 0.0625]]
    }
    return [[0.4375, 0, 0.4375, 0.5625, 0.625, 0.5625]]
  }
  if (id === 'lantern' || id === 'soul_lantern') return [[0.3125, 0, 0.3125, 0.6875, 0.5625, 0.6875]]
  if (id === 'chest' || id === 'trapped_chest' || id === 'ender_chest') return [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]
  if (/(^|_)(short_grass|fern|sapling|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|bush|dead_bush|seagrass|kelp|sugar_cane|wheat|carrots|potatoes|beetroots)$/.test(id)
    || id === 'tall_grass' || id === 'large_fern' || id === 'rose_bush' || id === 'peony' || id === 'lilac' || id === 'sunflower') {
    return [[0.2, 0, 0.2, 0.8, 0.8, 0.8]]
  }
  if (id.endsWith('rail')) return [[0, 0, 0, 1, 0.0625, 1]]
  if (id === 'redstone_wire') return [[0, 0, 0, 1, 0.03, 1]]
  if (id.endsWith('_button')) return [[0.3125, 0, 0.375, 0.6875, 0.125, 0.625]]
  if (id.endsWith('_sign') || id.endsWith('_banner')) return [[0.4375, 0, 0.4375, 0.5625, 1, 0.5625]]
  return FULL
}

function panel(dir: string | undefined, t: number): Box {
  switch (dir) {
    case 'south': return [0, 0, 0, 1, 1, t]
    case 'west': return [1 - t, 0, 0, 1, 1, 1]
    case 'east': return [0, 0, 0, t, 1, 1]
    default: return [0, 0, 1 - t, 1, 1, 1] // north: Tür sitzt an der Südseite des Blocks
  }
}

const H = ['north', 'east', 'south', 'west']
function turn(d: string | undefined, steps: number): string {
  const i = H.indexOf(d ?? 'north')
  return H[(i + steps + 4) % 4]
}
