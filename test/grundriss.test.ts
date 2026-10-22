import { describe, expect, it } from 'vitest'
import { layersOf, place, type Placement } from '../src/blueprint/placement'
import { buildFromSource } from '../src/catalog'
import { fillOutline, fitFootprint, rectsOf } from '../src/catalog/footprint'
import { isOpaqueCube } from '../src/render/shapes'
import { STYLES } from '../src/catalog/styles'

/** Umriss eines Rechtecks als Wollzellen */
function ring(x0: number, z0: number, w: number, d: number): [number, number][] {
  const out: [number, number][] = []
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) if (x === x0 || z === z0 || x === x0 + w - 1 || z === z0 + d - 1) out.push([x, z])
  return out
}

/** L-förmiger Umriss: Hauptteil 11 × 9, Flügel 6 × 5 rechts unten (nur der Rand liegt als Wolle) */
function lShape(): [number, number][] {
  const filled = new Set<string>()
  for (let z = 100; z < 109; z++) for (let x = 200; x < 211; x++) filled.add(`${x},${z}`)
  for (let z = 104; z < 109; z++) for (let x = 211; x < 217; x++) filled.add(`${x},${z}`)
  const edge: [number, number][] = []
  for (const k of filled) {
    const [x, z] = k.split(',').map(Number)
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !filled.has(`${x + dx},${z + dz}`))) edge.push([x, z])
  }
  return edge
}

describe('Grundriss aus Wolle', () => {
  it('schließt einen Umriss zur Fläche und zerlegt sie in Rechtecke', () => {
    expect(fillOutline(ring(0, 0, 7, 5))).toHaveLength(35)
    const { rects, leftover } = rectsOf(fillOutline(lShape()))
    expect(rects.map(r => r.w * r.d).reduce((a, b) => a + b)).toBe(11 * 9 + 6 * 5)
    expect(leftover).toBe(0)
  })

  it('Außenwände stehen genau auf der Wolle, in jeder Lage und jedem Stil', () => {
    const wool = lShape()
    const area = new Set(fillOutline(wool).map(([x, z]) => `${x},${z}`))
    const woolSet = new Set(wool.map(([x, z]) => `${x},${z}`))
    // gedreht und gespiegelt: Tür muss mal nach Süden, mal woanders hin
    const variants: [number, number][][] = [wool, wool.map(([x, z]) => [-x, z]), wool.map(([x, z]) => [z, x]), wool.map(([x, z]) => [x, -z])]
    for (const st of STYLES)
      for (const [vi, cells] of variants.entries()) {
        const set = vi === 0 ? woolSet : new Set(cells.map(([x, z]) => `${x},${z}`))
        const inside = vi === 0 ? area : new Set(fillOutline(cells).map(([x, z]) => `${x},${z}`))
        const fit = fitFootprint(cells, 64)!
        const source = { generator: 'haus', version: 2, seed: 3, params: { style: st.id, palette: st.palettes[0], size: 'M', footprint: fit.footprint } }
        const pl: Placement = { id: 'x', name: 'x', source, pos: fit.pos, rotation: fit.rotation, mirror: false }
        const placed = place(pl, buildFromSource(source))
        const layers = layersOf(placed)
        const door = layers.flatMap(l => l.blocks).find(b => b.state.includes('_door[') && b.state.includes('half=lower'))!
        // Boden auf Höhe der Wolle, Wände darüber
        expect(door.y, `${st.id}/${vi}`).toBe(64 + st.sockel)
        const wallRow = layers.find(l => l.y === door.y)!.blocks.filter(b => isOpaqueCube(b.state)).map(b => `${b.x},${b.z}`)
        // außerhalb höchstens Anbauten direkt an der Wand (Kamin, Fass vor der Tür), nie ganze Wände daneben
        const near = (k: string) => {
          const [x, z] = k.split(',').map(Number)
          return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => inside.has(`${x + dx},${z + dz}`))
        }
        const outside = wallRow.filter(k => !inside.has(k))
        expect(outside.filter(k => !near(k)), `${st.id}/${vi}: Wand außerhalb des Grundrisses`).toEqual([])
        expect(outside.length, `${st.id}/${vi}: zu viel außerhalb`).toBeLessThan(8)
        // fast jede Wollzelle trägt Wand, Fenster oder Tür (Japan: viel Papierfenster)
        const row = new Set(layers.find(l => l.y === door.y)!.blocks.map(b => `${b.x},${b.z}`))
        const onWool = [...set].filter(k => row.has(k)).length
        expect(onWool / set.size, `${st.id}/${vi}: Wolle mit Wand`).toBeGreaterThan(0.6)
        // die Tür liegt am Rand und führt nach draußen
        expect(set.has(`${door.x},${door.z}`), `${st.id}/${vi}: Tür nicht in der Außenwand`).toBe(true)
      }
  })
})
