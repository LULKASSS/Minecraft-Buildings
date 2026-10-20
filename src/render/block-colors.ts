// Einfarbige Blöcke, solange keine Minecraft-.jar geladen ist.
// Erst die Tabelle, dann Regeln nach Namensteilen, zuletzt ein ruhiges Grau.

import { shortName } from '../blueprint/blockstate'

export type RGB = [number, number, number]

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

const TABLE: Record<string, string> = {
  grass_block: '#7FB238', short_grass: '#6E9E3A', tall_grass: '#6E9E3A', fern: '#5E8E32',
  dirt: '#8B6544', coarse_dirt: '#77553A', rooted_dirt: '#8A6446', podzol: '#5E4024', mycelium: '#6F6265',
  mud: '#3C3836', clay: '#A0A6B3', gravel: '#837F7E', sand: '#DBD3A0', red_sand: '#BE6621',
  sandstone: '#D8CB9B', red_sandstone: '#B5621F', stone: '#7D7D7D', cobblestone: '#7A7A7A',
  mossy_cobblestone: '#6E7C5A', granite: '#9A6C59', diorite: '#BDBDBD', andesite: '#888888',
  deepslate: '#505052', tuff: '#6C6D66', calcite: '#DFE0DC', bedrock: '#555555',
  water: '#3F76E4', lava: '#D35A0A', ice: '#91B4FE', packed_ice: '#8DB2F5', blue_ice: '#74A7FD',
  snow: '#F8FEFE', snow_block: '#F8FEFE', powder_snow: '#F8FEFE',
  oak_leaves: '#59AE30', birch_leaves: '#80A755', spruce_leaves: '#619961', jungle_leaves: '#30BB0B',
  acacia_leaves: '#59AE30', dark_oak_leaves: '#59AE30', mangrove_leaves: '#8DB127',
  cherry_leaves: '#E8B2C9', azalea_leaves: '#5E7D2C', flowering_azalea_leaves: '#6F7E3E', pale_oak_leaves: '#7C877A',
  oak_log: '#6D5532', oak_planks: '#A2834F', spruce_log: '#3B2711', spruce_planks: '#735531',
  birch_log: '#D8D7D2', birch_planks: '#C0AF79', jungle_log: '#56441B', jungle_planks: '#A07351',
  acacia_log: '#676157', acacia_planks: '#A85A32', dark_oak_log: '#3C2E1A', dark_oak_planks: '#432B14',
  mangrove_log: '#544429', mangrove_planks: '#763631', cherry_log: '#381C26', cherry_planks: '#E2B2AC',
  pale_oak_log: '#4F4743', pale_oak_planks: '#E3D9D7', bamboo_block: '#7F9035', bamboo_planks: '#C3AD53',
  crimson_planks: '#653148', warped_planks: '#2C6A66',
  netherrack: '#6F3634', soul_sand: '#513E32', soul_soil: '#4B3A2E', basalt: '#4C4C52', blackstone: '#2B2328',
  end_stone: '#DBDE9E', obsidian: '#0F0A18', glass: '#C0DCE6', glass_pane: '#C0DCE6',
  torch: '#F6D25A', wall_torch: '#F6D25A', lantern: '#4C4B4E', crafting_table: '#7A5532', chest: '#A2732F',
  bricks: '#966253', stone_bricks: '#7A7979', mossy_stone_bricks: '#737A60', terracotta: '#985E43',
  hay_block: '#A68B0C', pumpkin: '#C57519', melon: '#6F9A18', cactus: '#5A8A2A', sugar_cane: '#94C065',
  lily_pad: '#208030', seagrass: '#336E2B', kelp: '#4E8A33', moss_block: '#596E2D', moss_carpet: '#596E2D',
  dirt_path: '#94793F', farmland: '#5E3F22', iron_block: '#DCDCDC', gold_block: '#F6D03D',
  copper_block: '#C06C50', red_bed: '#9E2B27', oak_door: '#8C6E40', bell: '#E0C04A',
}

const DYES: Record<string, string> = {
  white: '#E9ECEC', light_gray: '#8E8E86', gray: '#3E4447', black: '#141519', brown: '#724728',
  red: '#A12722', orange: '#F07613', yellow: '#F8C527', lime: '#70B919', green: '#546D1B',
  cyan: '#158991', light_blue: '#3AAFD9', blue: '#35399D', purple: '#792AAC', magenta: '#BD44B3', pink: '#ED8DAC',
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']

const RULES: [RegExp, string][] = [
  [/deepslate/, '#505052'], [/blackstone/, '#2B2328'], [/cobbled|cobblestone/, '#7A7A7A'],
  [/stone_brick|stone|smooth_stone/, '#7D7D7D'], [/brick/, '#966253'], [/sandstone|sand/, '#D8CB9B'],
  [/quartz/, '#ECE6DF'], [/prismarine/, '#5DA59A'], [/copper/, '#C06C50'], [/nether/, '#6F3634'],
  [/leaves/, '#59AE30'], [/grass|fern|bush|sapling|flower|tulip|poppy|dandelion|orchid|allium|daisy|cornflower|lily|rose|peony|lilac|petals/, '#6E9E3A'],
  [/log|wood|stem|hyphae/, '#6D5532'], [/plank|fence|door|trapdoor|sign|stairs|slab|button|pressure_plate/, '#A2834F'],
  [/ice/, '#91B4FE'], [/snow/, '#F8FEFE'], [/glass/, '#C0DCE6'], [/ore/, '#7D7D7D'],
  [/dirt|mud|soil/, '#8B6544'], [/coral/, '#C05A8C'], [/rail/, '#8A7F6E'], [/torch|lantern|candle/, '#F6D25A'],
]

const cache = new Map<string, RGB>()

export function fallbackColor(name: string): RGB {
  const id = shortName(name)
  let c = cache.get(id)
  if (c) return c
  c = hex(lookup(id))
  cache.set(id, c)
  return c
}

function lookup(id: string): string {
  if (TABLE[id]) return TABLE[id]
  for (const [dye, color] of Object.entries(DYES)) if (id.startsWith(dye + '_')) return color
  for (const wood of WOODS) {
    if (id.startsWith(wood + '_')) {
      const planks = TABLE[`${wood}_planks`]
      if (/_log$|_wood$/.test(id)) return TABLE[`${wood}_log`] ?? planks
      if (/_leaves$/.test(id)) return TABLE[`${wood}_leaves`] ?? '#59AE30'
      if (planks) return planks
    }
  }
  for (const [re, color] of RULES) if (re.test(id)) return color
  return '#8C8C8C'
}

/** Blöcke, die auf der Karte als Wasser zählen (Tiefe wird schattiert). */
export function isWaterLike(name: string): boolean {
  const id = shortName(name)
  return id === 'water' || id === 'bubble_column' || id === 'seagrass' || id === 'tall_seagrass' || id === 'kelp' || id === 'kelp_plant'
}
