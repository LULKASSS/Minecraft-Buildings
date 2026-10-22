import { describe, expect, it } from 'vitest'
import blocks from '../data/blocks-26.1.json'
import { parseState } from '../src/blueprint/blockstate'
import type { BlueprintSource } from '../src/blueprint/blueprint'
import { transformBlueprint, type Rotation } from '../src/blueprint/transform'
import { CATALOG, buildFromSource } from '../src/catalog'
import { testHouse } from '../src/catalog/decorative/test-house'
import { MIXES, SPECIES } from '../src/catalog/nature'
import { STYLES, type Size } from '../src/catalog/styles'
import { buildTemplate, readLitematic, registerTemplates } from '../src/catalog/template'
import { writeLitematic } from '../src/export/litematic'
import { isOpaqueCube } from '../src/render/shapes'
import { complete, fixConnections, fixStairShapes, formOf, stemOf, survivalCost } from '../src/style/blocks'
import type { Ground } from '../src/style/builder'
import { learnPalette } from '../src/style/learn'
import { PALETTES, validatePalette } from '../src/style/palettes'

const DATA = (blocks as unknown as { blocks: Record<string, Record<string, string[]>> }).blocks
const SIZES: Size[] = ['S', 'M', 'L']
const ROTS: Rotation[] = [0, 90, 180, 270]

function invalid(state: string): string | null {
  const { name, props } = parseState(state)
  const def = DATA[name.slice(10)]
  if (!def) return `unbekannter Block ${name}`
  for (const [k, v] of Object.entries(props)) if (!def[k]?.includes(v)) return `${name}: ${k}=${v}`
  for (const k of Object.keys(def)) if (!(k in props)) return `${name}: ${k} fehlt`
  return null
}

function check(source: BlueprintSource): string[] {
  const bp = buildFromSource(source)
  const errs = bp.palette.slice(1).map(invalid).filter(Boolean) as string[]
  for (const r of ROTS) {
    const t = transformBlueprint(bp, r, r === 90)
    for (const s of t.palette.slice(1)) {
      const e = invalid(s)
      if (e) errs.push(`gedreht ${r}: ${e}`)
    }
  }
  if (bp.count() < 1) errs.push('leer')
  return errs.map(e => `${source.generator} ${JSON.stringify(source.params)} #${source.seed}: ${e}`)
}

describe('Blockkatalog', () => {
  it('kennt die Familien', () => {
    expect(stemOf('oak_planks')).toBe('oak')
    expect(stemOf('stone_bricks')).toBe('stone_brick')
    expect(stemOf('quartz_block')).toBe('quartz')
    expect(formOf('deepslate_tiles', 'stairs')).toBe('minecraft:deepslate_tile_stairs')
    expect(formOf('cut_sandstone', 'stairs')).toBeNull()
    expect(formOf('copper_block', 'door')).toBe('minecraft:copper_door')
  })
  it('ergänzt Zustände vollständig', () => {
    expect(complete('oak_stairs[facing=east]')).toBe('minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]')
    expect(() => complete('oak_stairs[facing=up]')).toThrow()
  })
  it('bewertet Survival-Aufwand', () => {
    expect(survivalCost('cobblestone')).toBe(1)
    expect(survivalCost('stone_bricks')).toBe(2)
    expect(survivalCost('quartz_block')).toBe(3)
    expect(survivalCost('obsidian')).toBe(4)
  })
})

describe('Treppenformen und Verbindungen wie im Spiel', () => {
  it('Ecke aus zwei Treppenreihen wird außen rund', () => {
    const g = new Map<string, string>()
    const k = (x: number, y: number, z: number) => `${x},${y},${z}`
    // Reihe nach Süden (z=0), Reihe nach Osten (x=0), treffen sich in (0,0)
    for (let x = 0; x < 3; x++) g.set(k(x, 0, 0), complete('oak_stairs[facing=south]'))
    for (let z = 1; z < 3; z++) g.set(k(0, 0, z), complete('oak_stairs[facing=east]'))
    fixStairShapes([3, 1, 3], (x, y, z) => g.get(k(x, y, z)) ?? 'minecraft:air', (x, y, z, s) => g.set(k(x, y, z), s))
    expect(parseState(g.get(k(0, 0, 0))!).props.shape).toBe('outer_left')
    expect(parseState(g.get(k(1, 0, 0))!).props.shape).toBe('straight')
  })
  it('Glasscheibe zwischen zwei Steinen verbindet nach Ost und West', () => {
    const g: Record<string, string> = { '0,0,0': 'minecraft:stone', '1,0,0': complete('glass_pane'), '2,0,0': 'minecraft:stone' }
    fixConnections([3, 1, 1], (x, y, z) => g[`${x},${y},${z}`] ?? 'minecraft:air', (x, y, z, s) => (g[`${x},${y},${z}`] = s))
    expect(parseState(g['1,0,0']).props).toMatchObject({ east: 'true', west: 'true', north: 'false', south: 'false' })
  })
})

describe('Paletten', () => {
  it('jede fertige Palette hat alle Formen, die ihre Rollen brauchen', () => {
    for (const p of PALETTES) expect(validatePalette(p)).toEqual([])
  })
  it('jeder Block jeder Palette existiert in 26.1', () => {
    for (const p of PALETTES) for (const list of Object.values(p.roles)) for (const w of list) expect(DATA[w.id], `${p.id}: ${w.id}`).toBeDefined()
  })
  it('jeder Stil nennt nur vorhandene Paletten', () => {
    for (const st of STYLES) for (const id of st.palettes) expect(PALETTES.find(p => p.id === id), id).toBeDefined()
  })
})

describe('Generatoren: alle Stile, Paletten, Größen, Varianten', () => {
  it('Häuser und kleine Bauwerke sind gültig und drehbar', () => {
    const errs: string[] = []
    for (const gen of ['haus', 'turm', 'brunnen', 'marktstand', 'laterne'])
      for (const st of STYLES)
        for (const pal of st.palettes)
          for (const size of SIZES)
            for (const seed of gen === 'haus' ? [0, 1, 2, 3] : [0, 1]) errs.push(...check({ generator: gen, version: 1, seed, params: { style: st.id, palette: pal, size } }))
    expect(errs.slice(0, 8)).toEqual([])
  })
  it('jede Bauform in jedem Stil, jeder Palette und Größe ist gültig', () => {
    const errs: string[] = []
    for (const st of STYLES)
      for (const form of st.forms)
        for (const pal of st.palettes)
          for (const size of SIZES)
            for (const seed of [0, 7]) errs.push(...check({ generator: 'haus', version: 2, seed, params: { style: st.id, palette: pal, size, form } }).map(e => `${st.id}/${form}: ${e}`))
    expect(errs.slice(0, 8)).toEqual([])
  }, 60000)
  it('Häuser haben einen Erdgeschoss-Boden, die Wände stehen nicht auf dem Gelände', () => {
    // Fassung 13: die Ebene unter den Wänden fehlte (Lukas: „eine Ebene fehlt“)
    const air = (s: string) => /:(air|cave_air)$/.test(s)
    for (const st of STYLES)
      for (const form of st.forms)
        for (const seed of [0, 3]) {
          const bp = buildFromSource({ generator: 'haus', version: 2, seed, params: { style: st.id, palette: st.palettes[0], size: 'M', form } })
          const [w, h, d] = bp.size
          const doorY = bp.list().find(b => b.state.includes('_door[') && b.state.includes('half=lower'))!.y
          let walls = 0, floating = 0, floor = 0
          for (let z = 0; z < d; z++)
            for (let x = 0; x < w; x++) {
              const at = (y: number) => (y >= 0 && y < h ? bp.get(x, y, z) : 'minecraft:air')
              if (!air(at(doorY - 1))) floor++
              if ([0, 1, 2].some(i => air(at(doorY + i)) || !isOpaqueCube(at(doorY + i)))) continue
              walls++
              if (air(at(doorY - 1))) floating++
            }
          expect(floating, `${st.id}/${form}/${seed}: ${floating} von ${walls} Wandsäulen ohne Block darunter`).toBe(0)
          expect(floor, `${st.id}/${form}/${seed}: Boden`).toBeGreaterThan(walls)
        }
  })
  it('Version 3: jede Dachform in jedem Stil und jeder Bauform gültig, mit Boden', () => {
    const errs: string[] = []
    for (const st of STYLES)
      for (const form of st.forms)
        for (const roofShape of ['sattel', 'walm', 'kruppelwalm', 'mansard', 'gauben'])
          for (const size of SIZES)
            errs.push(...check({ generator: 'haus', version: 3, seed: 5, params: { style: st.id, palette: st.palettes[0], size, form, roofShape } }).map(e => `${st.id}/${form}/${roofShape}: ${e}`))
    expect(errs.slice(0, 8)).toEqual([])
  }, 120000)
  it('Version 3: Dachformen sehen verschieden aus, Gauben haben Fenster im Dach', () => {
    const src = (roofShape: string, seed = 2) => ({ generator: 'haus', version: 3, seed, params: { style: 'mittelalter', palette: 'mittel-putz', size: 'L', form: 'rechteck', roofShape } })
    const shapes = new Set(['sattel', 'walm', 'kruppelwalm', 'mansard'].map(r => buildFromSource(src(r)).list().filter(b => b.state.includes('stairs')).map(b => `${b.x},${b.y},${b.z}`).sort().join('|')))
    expect(shapes.size).toBe(4)
    // Gauben: Fenster oberhalb der Traufe an der Längsseite
    const glassUp = (bp: ReturnType<typeof buildFromSource>) => {
      const door = bp.list().find(b => b.state.includes('_door[') && b.state.includes('half=lower'))!.y
      return bp.list().filter(b => /pane|glass/.test(b.state) && b.y > door + 6).length
    }
    for (const seed of [1, 2, 3]) expect(glassUp(buildFromSource(src('gauben', seed))), `Seed ${seed}`).toBeGreaterThan(glassUp(buildFromSource(src('sattel', seed))))
  })
  it('Version 2 bleibt unverändert (gesetzte Häuser ändern sich nicht)', () => {
    const v2 = { generator: 'haus', version: 2, seed: 9, params: { style: 'mittelalter', palette: 'mittel-putz', size: 'M', form: 'rechteck' } }
    const a = buildFromSource(v2), b = buildFromSource({ ...v2, params: { ...v2.params, roofShape: 'mansard' } })
    expect(b.list()).toEqual(a.list())
  })
  it('Varianten unterscheiden sich in der Form, nicht nur im Material', () => {
    for (const st of STYLES) {
      const shapes = new Set(st.forms.map(form => {
        const bp = buildFromSource({ generator: 'haus', version: 2, seed: 11, params: { style: st.id, palette: st.palettes[0], size: 'M', form } })
        return `${bp.size.join('x')}`
      }))
      expect(shapes.size, st.id).toBeGreaterThanOrEqual(Math.min(3, st.forms.length))
    }
  })
  it('Natur ist gültig, Laub zerfällt nicht', () => {
    const errs: string[] = []
    for (const sp of SPECIES) for (const size of SIZES) for (const seed of [0, 1, 2]) errs.push(...check({ generator: 'baum', version: 1, seed, params: { species: sp.id, size } }))
    for (const gen of ['busch', 'fels']) for (const size of SIZES) errs.push(...check({ generator: gen, version: 1, seed: 1, params: { size } }))
    for (const m of MIXES) for (const size of SIZES) errs.push(...check({ generator: 'pinsel', version: 1, seed: 3, params: { mix: m.id, size } }))
    expect(errs.slice(0, 8)).toEqual([])
    const tree = buildFromSource({ generator: 'baum', version: 1, seed: 1, params: { species: 'oak', size: 'L' } })
    for (const s of tree.palette) if (s.includes('leaves')) expect(s).toContain('persistent=true')
  })
  it('gleiche Quelle, gleiches Bauwerk; anderer Seed, anderes Bauwerk', () => {
    const src = { generator: 'haus', version: 1, seed: 5, params: { style: 'mittelalter', palette: 'mittel-eiche', size: 'M' } }
    expect(buildFromSource(src).list()).toEqual(buildFromSource(src).list())
    const sizes = new Set([0, 1, 2, 3, 4, 5].map(seed => buildFromSource({ ...src, seed }).size.join('x') + buildFromSource({ ...src, seed }).count()))
    expect(sizes.size).toBeGreaterThan(1)
  })
  it.each(['rechteck', 'winkel', 'zwerchgiebel', 'turm', 'anbau', 'doppel'])('Fundament (%s) folgt dem Hang, ersetzt aber nie Gelände unter dem Geländeblock', form => {
    const src: BlueprintSource = { generator: 'haus', version: 2, seed: 2, params: { style: 'mittelalter', palette: 'mittel-fichte', size: 'M', form } }
    const e = CATALOG.find(c => c.id === 'haus')!.ground!(src)!
    const w = e.x1 - e.x0 + 1, d = e.z1 - e.z0 + 1
    const h = Array.from({ length: w * d }, (_, i) => -Math.floor((i % w) / 3)) // fällt nach Osten ab
    const ground: Ground = { x0: e.x0, z0: e.z0, w, d, h }
    const bp = buildFromSource({ ...src, params: { ...src.params, ground } })
    const [ax, ay, az] = bp.anchor
    let below = 0
    for (const b of bp.each()) {
      const lx = b.x - ax, ly = b.y - ay, lz = b.z - az
      const gy = lx >= e.x0 && lx <= e.x1 && lz >= e.z0 && lz <= e.z1 ? h[(lz - e.z0) * w + (lx - e.x0)] : 0
      if (ly < 0) below++
      expect(ly, `${b.state} bei ${lx},${ly},${lz}`).toBeGreaterThanOrEqual(Math.min(0, gy))
    }
    expect(below).toBeGreaterThan(10)
  })
})

describe('Vorlagen', () => {
  const house = testHouse()
  const bytes = writeLitematic(house, { name: 'Testfarm', dataVersion: 4786 })
  const t = readLitematic(bytes)
  registerTemplates([{ ...t, id: 't1', added: 1 }])

  it('liest eine .litematic verlustfrei', () => {
    expect(t.name).toBe('Testfarm')
    expect(t.dataVersion).toBe(4786)
    expect(t.size).toEqual(house.size)
  })
  it('Fassade lässt den Kern unverändert und berührt ihn nicht', () => {
    const plain = buildTemplate({ generator: 'vorlage', version: 1, seed: 0, params: { templateId: 't1' } })
    const withFacade = buildTemplate({ generator: 'vorlage', version: 1, seed: 0, params: { templateId: 't1', facade: { palette: 'mittel-eiche', sides: [true, true, true, true], roof: true } } })
    const off = [withFacade.anchor[0] - plain.anchor[0], withFacade.anchor[1] - plain.anchor[1], withFacade.anchor[2] - plain.anchor[2]]
    for (const b of plain.each()) expect(withFacade.get(b.x + off[0], b.y + off[1], b.z + off[2])).toBe(b.state)
    // Ein Block Luft rund um den Kern
    const [w, , d] = plain.size
    for (let y = 0; y < plain.size[1]; y++) {
      for (let x = -1; x <= w; x++) for (const z of [-1, d]) expect(withFacade.get(x + off[0], y + off[1], z + off[2])).toBe('minecraft:air')
      for (let z = -1; z <= d; z++) for (const x of [-1, w]) expect(withFacade.get(x + off[0], y + off[1], z + off[2])).toBe('minecraft:air')
    }
    expect(withFacade.kind).toBe('functional')
  })
})

describe('Palette aus dem Bestand lernen', () => {
  it('ordnet Dach, Rahmen, Wand und Fenster aus einem gebauten Haus zu', () => {
    const counts = new Map<string, number>()
    for (const b of testHouse().each()) counts.set(b.state, (counts.get(b.state) ?? 0) + 1)
    counts.set('minecraft:grass_block[snowy=false]', 500)
    const r = learnPalette(counts, 'mittelalter', 'Mein Haus')!
    expect(r.roles.roof).toBe('oak_planks')
    expect(r.roles.window).toBe('glass_pane')
    expect(r.roles.frame).toBe('oak_log')
    expect(r.palette.custom).toBe(true)
    expect(validatePalette(r.palette)).toEqual([])
  })
})

describe('Natur-Pinsel und Wasser', () => {
  it('pflanzt nichts auf Wasserflächen', () => {
    const rad = 10, w = 2 * rad + 1
    const h = new Array(w * w).fill(-3)
    const wet: number[] = []
    for (let k = 0; k < w; k++) for (let i = 0; i < w; i++) if (i < rad) wet.push(k * w + i) // westliche Hälfte ist See
    const bp = buildFromSource({ generator: 'pinsel', version: 1, seed: 7, params: { mix: 'wald', size: 'M', ground: { x0: -rad, z0: -rad, w, d: w, h, wet } } })
    const [ax, , az] = bp.anchor
    for (const b of bp.each()) {
      const lx = b.x - ax, lz = b.z - az
      // Stammfüße und Bodenpflanzen stehen direkt auf dem Grund (Höhe -3 + 1); Äste dürfen übers Wasser ragen
      if (/_log\[axis=y|grass|fern|poppy|dandelion|tulip|cobblestone|andesite/.test(b.state) && b.y - bp.anchor[1] <= -2) expect(lx, `${b.state} bei ${lx},${lz}`).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Natur-Pinsel und Boden', () => {
  it('setzt Gras und Blumen nur auf Erde, nicht auf Sand', () => {
    const rad = 10, w = 2 * rad + 1
    const h = new Array(w * w).fill(0)
    const soil: number[] = []
    for (let k = 0; k < w; k++) for (let i = rad; i < w; i++) soil.push(k * w + i) // nur die östliche Hälfte hat Erde
    const bp = buildFromSource({ generator: 'pinsel', version: 1, seed: 3, params: { mix: 'wiese', size: 'M', ground: { x0: -rad, z0: -rad, w, d: w, h, soil } } })
    const [ax, ay] = bp.anchor
    let plants = 0
    for (const b of bp.each()) {
      if (b.y - ay !== 1 || !/short_grass|poppy|dandelion|cornflower|daisy|bluet|allium|tulip|tall_grass|rose_bush|lilac|peony|large_fern/.test(b.state)) continue
      plants++
      expect(b.x - ax, b.state).toBeGreaterThanOrEqual(0)
    }
    expect(plants).toBeGreaterThan(20)
  })
})
