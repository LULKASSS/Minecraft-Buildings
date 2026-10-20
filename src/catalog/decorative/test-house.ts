// Fest eingebautes Testhaus für den Durchstich.
// Klein, aber mit den Blockstates, die beim Drehen und Zählen gern schiefgehen:
// Treppen, Tür, Bett, Glasscheiben, Wandfackeln, Truhe, Stufen, Stämme mit Achse.

import { Blueprint } from '../../blueprint/blueprint'

export const TEST_HOUSE_ID = 'test-house'

export function testHouse(): Blueprint {
  const W = 7, H = 8, D = 10 // z = 9 ist die Stufe vor der Tür
  const bp = new Blueprint({
    size: [W, H, D],
    name: 'Testhaus',
    anchor: [3, 0, 4], // Mitte des Bodens landet auf dem Geländeblock der Markierung
    source: { generator: TEST_HOUSE_ID, version: 1, seed: 0, params: {} },
  })

  // Boden
  bp.fill([0, 0, 0], [6, 0, 8], 'cobblestone')
  bp.fill([1, 0, 1], [5, 0, 7], 'oak_planks')
  bp.set(3, 0, 9, 'cobblestone_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]')

  // Wände: unten Bruchstein, darüber Bretter, Ecken Eichenstämme
  for (let y = 1; y <= 3; y++) {
    const wall = y === 1 ? 'cobblestone' : 'oak_planks'
    bp.fill([0, y, 0], [6, y, 0], wall)
    bp.fill([0, y, 8], [6, y, 8], wall)
    bp.fill([0, y, 0], [0, y, 8], wall)
    bp.fill([6, y, 0], [6, y, 8], wall)
    for (const [x, z] of [[0, 0], [6, 0], [0, 8], [6, 8]]) bp.set(x, y, z, 'oak_log[axis=y]')
  }
  // Querbalken über den Wänden
  bp.fill([1, 4, 0], [5, 4, 0], 'oak_log[axis=x]')
  bp.fill([1, 4, 8], [5, 4, 8], 'oak_log[axis=x]')

  // Tür in der Südwand, man geht nach Norden hinein
  bp.set(3, 1, 8, 'oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]')
  bp.set(3, 2, 8, 'oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]')

  // Fenster: Scheiben verbinden sich mit den Wandblöcken links und rechts
  for (const z of [2, 6]) {
    bp.set(0, 2, z, 'glass_pane[east=false,north=true,south=true,waterlogged=false,west=false]')
    bp.set(6, 2, z, 'glass_pane[east=false,north=true,south=true,waterlogged=false,west=false]')
  }
  for (const x of [2, 4]) bp.set(x, 2, 0, 'glass_pane[east=true,north=false,south=false,waterlogged=false,west=true]')

  // Einrichtung
  bp.set(1, 1, 1, 'crafting_table')
  bp.set(3, 1, 1, 'chest[facing=south,type=single,waterlogged=false]')
  bp.set(5, 1, 4, 'red_bed[facing=north,occupied=false,part=head]')
  bp.set(5, 1, 5, 'red_bed[facing=north,occupied=false,part=foot]')
  bp.set(1, 3, 1, 'wall_torch[facing=south]')
  bp.set(5, 3, 1, 'wall_torch[facing=south]')
  bp.set(1, 3, 7, 'wall_torch[facing=north]')

  // Satteldach, First entlang z
  const stair = (facing: string) => `oak_stairs[facing=${facing},half=bottom,shape=straight,waterlogged=false]`
  for (let z = 0; z <= 8; z++) {
    bp.set(0, 4, z, stair('east'))
    bp.set(6, 4, z, stair('west'))
    bp.set(1, 5, z, stair('east'))
    bp.set(5, 5, z, stair('west'))
    bp.set(2, 6, z, stair('east'))
    bp.set(4, 6, z, stair('west'))
    bp.set(3, 7, z, 'oak_slab[type=bottom,waterlogged=false]')
  }
  // Giebel
  for (const z of [0, 8]) {
    bp.fill([2, 5, z], [4, 5, z], 'oak_planks')
    bp.set(3, 6, z, 'oak_planks')
  }
  return bp
}
