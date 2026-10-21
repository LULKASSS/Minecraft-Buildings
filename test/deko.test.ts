import { describe, expect, it } from 'vitest'
import blocks from '../data/blocks-26.1.json'
import { parseState } from '../src/blueprint/blockstate'
import type { Blueprint, BlueprintSource } from '../src/blueprint/blueprint'
import { transformBlueprint, type Rotation } from '../src/blueprint/transform'
import { DEKO } from '../src/catalog/deko'
import { buildWell, wellForms } from '../src/catalog/small'
import { bridgeForms, bridgeSpan, buildBridge } from '../src/catalog/bridge'
import { STYLES, type Size } from '../src/catalog/styles'
import type { Ground } from '../src/style/builder'
import { palettesFor } from '../src/style/palettes'

const DATA = (blocks as unknown as { blocks: Record<string, Record<string, string[]>> }).blocks
const SIZES: Size[] = ['S', 'M', 'L']

function invalid(state: string): string | null {
  const { name, props } = parseState(state)
  const def = DATA[name.slice(10)]
  if (!def) return `unbekannter Block ${name}`
  for (const [k, v] of Object.entries(props)) if (!def[k]?.includes(v)) return `${name}: ${k}=${v}`
  for (const k of Object.keys(def)) if (!(k in props)) return `${name}: ${k} fehlt`
  return null
}

function check(bp: Blueprint, what: string): string[] {
  const errs = bp.palette.slice(1).map(invalid).filter(Boolean) as string[]
  for (const r of [90, 180] as Rotation[]) for (const s of transformBlueprint(bp, r).palette.slice(1)) {
    const e = invalid(s)
    if (e) errs.push(`gedreht ${r}: ${e}`)
  }
  if (bp.count() < 3) errs.push('leer')
  return errs.map(e => `${what}: ${e}`)
}

// Hang: 3 Blöcke Gefälle nach Osten, damit das Auffüllen mitläuft
const slope: Ground = { x0: -8, z0: -8, w: 17, d: 17, h: Array.from({ length: 17 * 17 }, (_, i) => -Math.floor((i % 17) / 5)) }

describe('Deko', () => {
  it('jedes Ding baut in allen Stilen, Paletten und Größen mit gültigen Blöcken', () => {
    const errs: string[] = []
    for (const e of DEKO)
      for (const st of STYLES)
        for (const pal of palettesFor(st.id))
          for (const size of SIZES) {
            const source: BlueprintSource = { generator: e.id, version: 1, seed: 11, params: { style: st.id, palette: pal.id, size, ground: slope } }
            try {
              errs.push(...check(e.build(source), `${e.id} ${st.id} ${pal.id} ${size}`))
            } catch (err) {
              errs.push(`${e.id} ${st.id} ${pal.id} ${size}: ${(err as Error).message}`)
            }
          }
    expect(errs).toEqual([])
  })
  it('Größen machen einen Unterschied', () => {
    for (const e of DEKO.filter(e => e.sized)) {
      const n = SIZES.map(size => e.build({ generator: e.id, version: 1, seed: 3, params: { style: 'mittelalter', palette: 'mittel-eiche', size } }).count())
      expect(new Set(n).size, e.id).toBeGreaterThan(1)
    }
  })
  it('Bodenfläche liegt im angegebenen Geländebereich', () => {
    for (const e of DEKO.filter(e => e.ground))
      for (const size of SIZES) {
        const source: BlueprintSource = { generator: e.id, version: 1, seed: 5, params: { style: 'mittelalter', palette: 'mittel-eiche', size } }
        const bp = e.build(source)
        const ext = e.ground!(source)!
        const [ax, , az] = bp.anchor
        expect(-ax, `${e.id} ${size} x0`).toBeGreaterThanOrEqual(ext.x0)
        expect(-az, `${e.id} ${size} z0`).toBeGreaterThanOrEqual(ext.z0)
        expect(bp.size[0] - 1 - ax, `${e.id} ${size} x1`).toBeLessThanOrEqual(ext.x1 + 3) // Dachüberstand darf übers Gelände ragen
        expect(bp.size[2] - 1 - az, `${e.id} ${size} z1`).toBeLessThanOrEqual(ext.z1 + 3)
      }
  })
})

describe('Brunnen', () => {
  it('baut in allen Stilen und Größen, Wasser im Becken', () => {
    const errs: string[] = []
    for (const st of STYLES)
      for (const pal of palettesFor(st.id))
        for (const size of SIZES) {
          for (const f of [undefined, ...wellForms(st.id).map(f => f.id)]) {
            const what = `brunnen ${f ?? '-'} ${st.id} ${pal.id} ${size}`
            try {
              const bp = buildWell({ generator: 'brunnen', version: 1, seed: 1, params: { style: st.id, palette: pal.id, size, ground: slope, ...(f ? { form: f } : {}) } })
              errs.push(...check(bp, what))
              if (!bp.palette.some(s => s.startsWith('minecraft:water'))) errs.push(`${what}: kein Wasser`)
            } catch (err) {
              errs.push(`${what}: ${(err as Error).message}`)
            }
          }
        }
    expect(errs).toEqual([])
  })
  it('Bauarten sehen verschieden aus, ohne Form wie bisher', () => {
    for (const st of STYLES) {
      const sizes = wellForms(st.id).map(f => buildWell({ generator: 'brunnen', version: 1, seed: 1, params: { style: st.id, palette: st.palettes[0], size: 'M', form: f.id } }).size.join('x') + f.id)
      expect(new Set(sizes).size, st.id).toBe(wellForms(st.id).length)
      const alt = buildWell({ generator: 'brunnen', version: 1, seed: 1, params: { style: st.id, palette: st.palettes[0], size: 'M' } })
      const klassisch = buildWell({ generator: 'brunnen', version: 1, seed: 1, params: { style: st.id, palette: st.palettes[0], size: 'M', form: 'klassisch' } })
      expect(Array.from(klassisch.blocks)).toEqual(Array.from(alt.blocks))
    }
  })
})

/** Fluss quer zur Brücke: Wasser von x = -4 bis 5, Grund 3 tief, Wasserspiegel -1, Ufer auf 0 (links) und 2 (rechts). */
function river(hw: number): Ground {
  const x0 = -46, z0 = -hw - 1, w = 93, d = 2 * hw + 3
  const h: number[] = [], wet: number[] = []
  for (let k = 0; k < d; k++)
    for (let i = 0; i < w; i++) {
      const x = x0 + i
      const inWater = x >= -4 && x <= 5
      h.push(inWater ? -4 : x < 0 ? 0 : 2)
      if (inWater) wet.push(k * w + i)
    }
  return { x0, z0, w, d, h, wet, water: -1 }
}

describe('Brücke', () => {
  it('spannt von Ufer zu Ufer, auch wenn der Mauszeiger am Ufer steht', () => {
    const g = river(2)
    expect(bridgeSpan(g, 'M')).toEqual({ a: -5, e: 6, water: -1, overWater: true })
    const shifted: Ground = { ...g, x0: g.x0 - 10 } // Mauszeiger 10 Blöcke rechts vom Fluss, am Ufer
    expect(bridgeSpan(shifted, 'M')).toMatchObject({ a: -15, e: -4 })
    expect(bridgeSpan(undefined, 'M')).toMatchObject({ overWater: false })
  })
  it('baut in allen Stilen, Formen und Größen mit gültigen Blöcken, Fahrbahn über dem Wasser', () => {
    const errs: string[] = []
    for (const st of STYLES)
      for (const pal of palettesFor(st.id))
        for (const size of SIZES)
          for (const f of bridgeForms(st.id)) {
            const what = `brücke ${f.id} ${st.id} ${pal.id} ${size}`
            try {
              const hw = { S: 1, M: 2, L: 3 }[size]
              const bp = buildBridge({ generator: 'bruecke', version: 1, seed: 2, params: { style: st.id, palette: pal.id, size, form: f.id, ground: river(hw) } })
              errs.push(...check(bp, what))
              // über der Flussmitte (x = 0) liegt eine Fahrbahn über dem Wasser, darunter bleibt eine Reihe Luft für Boote
              const [ax, ay, az] = bp.anchor
              let top = -99
              for (let y = 0; y < bp.size[1]; y++) if (bp.get(ax, y, az) !== 'minecraft:air') top = y - ay
              if (top < 1) errs.push(`${what}: keine Fahrbahn über dem Wasser (oberster Block ${top})`)
              if (bp.get(ax, ay, az) !== 'minecraft:air') errs.push(`${what}: kein Platz für Boote (y 0 belegt)`)
              // reicht bis an beide Ufer
              if (-ax > -5 || bp.size[0] - 1 - ax < 6) errs.push(`${what}: zu kurz (${-ax} … ${bp.size[0] - 1 - ax})`)
            } catch (err) {
              errs.push(`${what}: ${(err as Error).message}`)
            }
          }
    expect(errs).toEqual([])
  })
})
