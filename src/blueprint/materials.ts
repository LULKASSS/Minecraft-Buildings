// Was man im Inventar braucht, um einen Block zu setzen.
// Ein Block kann null (Oberteil einer Tür), ein oder mehrere Items kosten (Topfpflanze).

import { parseState, shortName, type BlockState } from './blockstate'
import type { Blueprint } from './blueprint'

export interface ItemCount {
  item: string
  count: number
}

const NOTHING = new Set([
  'air', 'cave_air', 'void_air', 'piston_head', 'moving_piston', 'fire', 'soul_fire',
  'nether_portal', 'end_portal', 'end_gateway', 'frosted_ice', 'bubble_column', 'big_dripleaf_stem',
])

const RENAME: Record<string, string> = {
  wall_torch: 'torch',
  redstone_wire: 'redstone',
  tripwire: 'string',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  wheat: 'wheat_seeds',
  melon_stem: 'melon_seeds',
  attached_melon_stem: 'melon_seeds',
  pumpkin_stem: 'pumpkin_seeds',
  attached_pumpkin_stem: 'pumpkin_seeds',
  torchflower_crop: 'torchflower_seeds',
  pitcher_crop: 'pitcher_pod',
  cocoa: 'cocoa_beans',
  sweet_berry_bush: 'sweet_berries',
  cave_vines: 'glow_berries',
  cave_vines_plant: 'glow_berries',
  kelp_plant: 'kelp',
  twisting_vines_plant: 'twisting_vines',
  weeping_vines_plant: 'weeping_vines',
  bamboo_sapling: 'bamboo',
  tall_seagrass: 'seagrass',
  water: 'water_bucket',
  lava: 'lava_bucket',
  powder_snow: 'powder_snow_bucket',
  water_cauldron: 'cauldron',
  lava_cauldron: 'cauldron',
  powder_snow_cauldron: 'cauldron',
  farmland: 'dirt',
  dirt_path: 'dirt',
}

/** Items, die mehrere Blöcke hoch/lang sind: nur das untere bzw. Fußteil kostet. */
function isSecondHalf(props: Record<string, string>): boolean {
  return props.half === 'upper' || props.part === 'head'
}

export function itemsFor(state: BlockState): ItemCount[] {
  const { name, props } = parseState(state)
  let id = shortName(name)
  if (NOTHING.has(id)) return []
  if (isSecondHalf(props)) return []
  if ((id === 'water' || id === 'lava') && props.level && props.level !== '0') return []

  if (id.startsWith('potted_')) {
    const plant = id.slice(7)
    return [
      { item: 'flower_pot', count: 1 },
      { item: plant === 'azalea_bush' ? 'azalea' : plant === 'flowering_azalea_bush' ? 'flowering_azalea' : plant, count: 1 },
    ]
  }

  id = RENAME[id] ?? id.replace(/_wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/, '_$1')

  let count = 1
  if (props.type === 'double' && id.endsWith('_slab')) count = 2
  else if (props.candles) count = Number(props.candles)
  else if (props.pickles) count = Number(props.pickles)
  else if (props.eggs) count = Number(props.eggs)
  else if (props.flower_amount) count = Number(props.flower_amount)
  else if (props.segment_amount) count = Number(props.segment_amount)
  else if (id === 'snow' && props.layers) count = Number(props.layers)

  return [{ item: `minecraft:${id}`.replace('minecraft:minecraft:', 'minecraft:'), count }]
}

export function stackSize(item: string): number {
  const id = shortName(item)
  if (/_bucket$/.test(id) || /_bed$/.test(id) || /shulker_box$/.test(id) || id === 'cake') return 1
  if (/_sign$/.test(id) || /_banner$/.test(id) || id === 'bucket' || id === 'armor_stand'
    || id === 'snowball' || id === 'egg' || id === 'ender_pearl' || id === 'honey_bottle') return 16
  return 64
}

export const SHULKER_SLOTS = 27

export interface MaterialRow {
  item: string
  count: number
  stackSize: number
}

export function materialsOf(states: Iterable<BlockState>): MaterialRow[] {
  const sum = new Map<string, number>()
  const memo = new Map<BlockState, ItemCount[]>()
  for (const s of states) {
    let items = memo.get(s)
    if (!items) memo.set(s, (items = itemsFor(s)))
    for (const it of items) sum.set(it.item, (sum.get(it.item) ?? 0) + it.count)
  }
  return [...sum.entries()]
    .map(([item, count]) => ({ item, count, stackSize: stackSize(item) }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
}

export function blueprintMaterials(bp: Blueprint, layer?: number): MaterialRow[] {
  const states: BlockState[] = []
  for (const b of bp.each()) if (layer === undefined || b.y === layer) states.push(b.state)
  return materialsOf(states)
}

export interface Packing {
  shulkers: number
  stacks: number
  rest: number
}

/** Aufteilung in volle Shulker, volle Stacks und Rest. */
export function pack(count: number, size: number): Packing {
  const perShulker = size * SHULKER_SLOTS
  const shulkers = Math.floor(count / perShulker)
  const left = count - shulkers * perShulker
  return { shulkers, stacks: Math.floor(left / size), rest: left % size }
}

export function formatPacking(count: number, size: number): string {
  const p = pack(count, size)
  const parts: string[] = []
  if (p.shulkers) parts.push(`${p.shulkers} Shulker`)
  if (p.stacks) parts.push(`${p.stacks} × ${size}`)
  if (p.rest || parts.length === 0) parts.push(String(p.rest))
  return parts.join(' + ')
}
