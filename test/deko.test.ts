import { describe, expect, it } from 'vitest'
import blocks from '../data/blocks-26.1.json'
import { parseState } from '../src/blueprint/blockstate'
import type { Blueprint, BlueprintSource } from '../src/blueprint/blueprint'
import { transformBlueprint, type Rotation } from '../src/blueprint/transform'
import { DEKO } from '../src/catalog/deko'
import { buildWell } from '../src/catalog/small'
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
          const bp = buildWell({ generator: 'brunnen', version: 1, seed: 1, params: { style: st.id, palette: pal.id, size, ground: slope } })
          errs.push(...check(bp, `brunnen ${st.id} ${pal.id} ${size}`))
          if (!bp.palette.some(s => s.startsWith('minecraft:water'))) errs.push(`brunnen ${st.id} ${size}: kein Wasser`)
        }
    expect(errs).toEqual([])
  })
})
