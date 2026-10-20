import { describe, expect, it } from 'vitest'
import blocks from '../data/blocks-26.1.json'
import { canonical, formatState, parseState } from '../src/blueprint/blockstate'
import { Blueprint } from '../src/blueprint/blueprint'
import { blueprintMaterials, formatPacking, itemsFor, pack } from '../src/blueprint/materials'
import { boundsOf, layersOf, overlaps, place } from '../src/blueprint/placement'
import { transformBlueprint, transformPos, transformState, type Rotation } from '../src/blueprint/transform'
import { testHouse } from '../src/catalog/decorative/test-house'

const BLOCKS = (blocks as unknown as { blocks: Record<string, Record<string, string[]>> }).blocks
const ROTS: Rotation[] = [0, 90, 180, 270]

function valid(state: string): string | null {
  const { name, props } = parseState(state)
  const def = BLOCKS[name.slice(10)]
  if (!def) return `unbekannter Block ${name}`
  for (const [k, v] of Object.entries(props)) {
    if (!def[k]) return `${name}: Property ${k} gibt es nicht`
    if (!def[k].includes(v)) return `${name}: ${k}=${v} nicht erlaubt`
  }
  return null
}

describe('Blockstate', () => {
  it('liest und schreibt kanonisch', () => {
    expect(canonical('oak_stairs[half=bottom,facing=north]')).toBe('minecraft:oak_stairs[facing=north,half=bottom]')
    expect(parseState('stone')).toEqual({ name: 'minecraft:stone', props: {} })
    expect(formatState('minecraft:stone')).toBe('minecraft:stone')
  })
})

describe('Drehen und Spiegeln', () => {
  it('dreht Richtungen im Uhrzeigersinn', () => {
    expect(transformState('minecraft:oak_stairs[facing=north]', 90)).toBe('minecraft:oak_stairs[facing=east]')
    expect(transformState('minecraft:oak_log[axis=x]', 90)).toBe('minecraft:oak_log[axis=z]')
    expect(transformState('minecraft:oak_sign[rotation=15]', 90)).toBe('minecraft:oak_sign[rotation=3]')
    expect(transformState('minecraft:glass_pane[east=true,north=false,south=false,west=true]', 90))
      .toBe('minecraft:glass_pane[east=false,north=true,south=true,west=false]')
    expect(transformState('minecraft:rail[shape=north_east]', 90)).toBe('minecraft:rail[shape=south_east]')
    expect(transformState('minecraft:rail[shape=ascending_north]', 270)).toBe('minecraft:rail[shape=ascending_west]')
  })

  it('spiegelt Treppen, Türen und Truhen mit Seitenwechsel', () => {
    expect(transformState('minecraft:oak_stairs[facing=east,shape=outer_left]', 0, true))
      .toBe('minecraft:oak_stairs[facing=west,shape=outer_right]')
    expect(transformState('minecraft:oak_door[facing=north,hinge=left]', 0, true))
      .toBe('minecraft:oak_door[facing=north,hinge=right]')
    expect(transformState('minecraft:chest[facing=north,type=left]', 0, true))
      .toBe('minecraft:chest[facing=north,type=right]')
  })

  it('erzeugt für jeden Block und jeden Wert nur gültige Zustände', () => {
    const errors: string[] = []
    for (const [id, def] of Object.entries(BLOCKS)) {
      for (const [k, values] of Object.entries(def)) {
        for (const v of values) {
          const props: Record<string, string> = {}
          for (const [k2, vs] of Object.entries(def)) props[k2] = vs[0]
          props[k] = v
          const s = formatState(id, props)
          for (const r of ROTS) for (const m of [false, true]) {
            const err = valid(transformState(s, r, m))
            if (err) errors.push(`${s} ${r}${m ? ' gespiegelt' : ''}: ${err}`)
          }
        }
      }
    }
    expect(errors.slice(0, 10)).toEqual([])
  })

  it('viermal drehen ergibt dasselbe Bauwerk', () => {
    const bp = testHouse()
    let t = bp
    for (let i = 0; i < 4; i++) t = transformBlueprint(t, 90)
    expect(t.size).toEqual(bp.size)
    expect(t.list()).toEqual(bp.list())
    expect(t.anchor).toEqual(bp.anchor)
  })

  it('Spiegeln zweimal ist neutral, Positionen stimmen', () => {
    const bp = testHouse()
    const t = transformBlueprint(transformBlueprint(bp, 0, true), 0, true)
    expect(t.list()).toEqual(bp.list())
    expect(transformPos([0, 0, 0], [7, 8, 10], 90)).toEqual([9, 0, 0])
  })
})

describe('Testhaus', () => {
  it('besteht nur aus gültigen Blockstates', () => {
    const bp = testHouse()
    for (const s of bp.palette.slice(1)) expect(valid(s)).toBeNull()
  })

  it('zählt Tür und Bett einmal, Fackeln als Fackel', () => {
    const m = Object.fromEntries(blueprintMaterials(testHouse()).map(r => [r.item, r.count]))
    expect(m['minecraft:oak_door']).toBe(1)
    expect(m['minecraft:red_bed']).toBe(1)
    expect(m['minecraft:torch']).toBe(3)
    expect(m['minecraft:wall_torch']).toBeUndefined()
    expect(m['minecraft:oak_slab']).toBe(9)
  })
})

describe('Material', () => {
  it('rechnet Sonderfälle', () => {
    expect(itemsFor('minecraft:oak_slab[type=double]')).toEqual([{ item: 'minecraft:oak_slab', count: 2 }])
    expect(itemsFor('minecraft:potted_poppy')).toHaveLength(2)
    expect(itemsFor('minecraft:water[level=3]')).toEqual([])
    expect(itemsFor('minecraft:oak_wall_sign[facing=north]')).toEqual([{ item: 'minecraft:oak_sign', count: 1 }])
    expect(itemsFor('minecraft:cobblestone_wall')).toEqual([{ item: 'minecraft:cobblestone_wall', count: 1 }])
  })
  it('packt in Shulker und Stacks', () => {
    expect(pack(1728 + 64 * 2 + 5, 64)).toEqual({ shulkers: 1, stacks: 2, rest: 5 })
    expect(formatPacking(130, 64)).toBe('2 × 64 + 2')
    expect(formatPacking(0, 64)).toBe('0')
  })
})

describe('Platzierung und Schichten', () => {
  it('legt den Anker auf die Zielkoordinate, auch gedreht', () => {
    const base = testHouse()
    for (const rotation of ROTS) {
      const p = place({ id: 'a', name: 'a', source: base.source, pos: [100, 64, -20], rotation, mirror: false }, base)
      const [ax, ay, az] = p.blueprint.anchor
      expect([p.origin[0] + ax, p.origin[1] + ay, p.origin[2] + az]).toEqual([100, 64, -20])
    }
  })
  it('liefert Schichten in Weltkoordinaten mit allen Blöcken', () => {
    const base = testHouse()
    const p = place({ id: 'a', name: 'a', source: base.source, pos: [0, 70, 0], rotation: 90, mirror: false }, base)
    const layers = layersOf(p)
    expect(layers).toHaveLength(8)
    expect(layers[0].y).toBe(70)
    expect(layers.reduce((n, l) => n + l.blocks.length, 0)).toBe(base.count())
  })
  it('erkennt Überschneidungen', () => {
    const base = testHouse()
    const a = place({ id: 'a', name: 'a', source: base.source, pos: [0, 64, 0], rotation: 0, mirror: false }, base)
    const b = place({ id: 'b', name: 'b', source: base.source, pos: [6, 64, 0], rotation: 0, mirror: false }, base)
    const c = place({ id: 'c', name: 'c', source: base.source, pos: [7, 64, 0], rotation: 0, mirror: false }, base)
    expect(overlaps(boundsOf(a), boundsOf(b))).toBe(true)
    expect(overlaps(boundsOf(a), boundsOf(c))).toBe(false)
  })
  it('Blueprint wirft bei Koordinaten außerhalb', () => {
    const bp = new Blueprint({ size: [1, 1, 1], name: 'x', source: { generator: 'x', version: 1, seed: 0, params: {} } })
    expect(() => bp.set(1, 0, 0, 'stone')).toThrow()
  })
})
