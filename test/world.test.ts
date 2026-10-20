import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { areaGet, readArea, UNDERGROUND } from '../src/world/area'
import { blockAt, decodeChunk } from '../src/world/chunk'
import { openWorld, parseLevel } from '../src/world/level'
import { readChunkBytes, readHeader } from '../src/world/region'
import { findWorldRoot, UploadSource, ZipSource, type WorldSource } from '../src/world/source'
import { renderTile, TILE } from '../src/world/tile'
import { makeWorld, testBlock, WATER_LEVEL } from '../src/world/demo-world'

const world = makeWorld()

/** Oberster Block der Testwelt (mit Bäumen). */
function topOf(x: number, z: number): number {
  for (let y = 100; y > -64; y--) if (testBlock(x, y, z) !== 'minecraft:air') return y
  return -64
}

class MapSource implements WorldSource {
  kind = 'upload' as const
  name = 'Testwelt'
  constructor(private files: Map<string, Uint8Array>) {}
  async read(path: string) {
    const f = this.files.get(path)
    return f ? { blob: new Blob([f as Uint8Array<ArrayBuffer>]), modified: 1 } : null
  }
  async list(dir: string) {
    const pre = dir + '/'
    return [...this.files.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length))
  }
}

const regionBlob = (name: string) => new Blob([world.get(`dimensions/minecraft/overworld/region/${name}`)! as Uint8Array<ArrayBuffer>])

describe('level.dat', () => {
  it('liest Name, Datenversion und Spawn im 26.x-Format', () => {
    const l = parseLevel(world.get('level.dat')!)
    expect(l).toEqual({ name: 'Testwelt', dataVersion: 4786, versionName: '26.1', spawn: [8, 70, 8] })
  })
  it('findet den neuen Region-Ordner', async () => {
    const w = await openWorld(new MapSource(world))
    expect(w.regionDir).toBe('dimensions/minecraft/overworld/region')
    expect(w.regions.map(r => `${r.rx},${r.rz}`).sort()).toEqual(['-1,0', '0,0'])
  })
  it('findet auch den alten region/-Ordner (1.21.x)', async () => {
    const old = new Map([...world].map(([k, v]) => [k.replace('dimensions/minecraft/overworld/region', 'region'), v]))
    const w = await openWorld(new MapSource(old))
    expect(w.regionDir).toBe('region')
  })
})

describe('Region und Chunk', () => {
  it('liest einzelne Chunks und Blöcke, auch bei negativen Koordinaten', async () => {
    for (const [file, cx, cz] of [['r.0.0.mca', 3, 5], ['r.-1.0.mca', -1, 2], ['r.-1.0.mca', -2, 7]] as const) {
      const blob = regionBlob(file)
      const header = await readHeader(blob)
      const bytes = await readChunkBytes(blob, header, cx, cz)
      const r = decodeChunk(bytes!)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      for (const [x, y, z] of [[0, 64, 0], [15, 60, 15], [7, -62, 3], [4, 70, 9], [9, 62, 1]]) {
        expect(blockAt(r.chunk, x, y, z)).toBe(testBlock(cx * 16 + x, y, cz * 16 + z))
      }
      expect(r.chunk.surface[2 + 5 * 16]).toBe(topOf(cx * 16 + 2, cz * 16 + 5) + 1)
    }
  })
  it('meldet fehlende Chunks als null', async () => {
    const blob = regionBlob('r.0.0.mca')
    expect(await readChunkBytes(blob, await readHeader(blob), 20, 20)).toBeNull()
  })
})

describe('Kartenkachel', () => {
  it('färbt vorhandene Spalten und kennt die Höhe', async () => {
    const t = await renderTile(regionBlob('r.0.0.mca'), 0, 0)
    expect(t.chunks).toBe(64)
    expect(t.heights[10 + 20 * TILE]).toBe(Math.max(topOf(10, 20), WATER_LEVEL))
    expect(t.rgba[(10 + 20 * TILE) * 4 + 3]).toBe(255)
    expect(t.rgba[(200 + 200 * TILE) * 4 + 3]).toBe(0) // kein Chunk
  })
})

describe('Gelände-Ausschnitt', () => {
  it('liefert dieselben Blöcke wie die Welt, über Regionsgrenzen hinweg', async () => {
    const box = { x0: -20, y0: 55, z0: 4, x1: 20, y1: 72, z1: 30 }
    const a = await readArea([{ rx: 0, rz: 0, blob: regionBlob('r.0.0.mca') }, { rx: -1, rz: 0, blob: regionBlob('r.-1.0.mca') }], box)
    expect(a.missingChunks).toBe(0)
    const w = 41, d = 27
    for (const [x, y, z] of [[-20, 60, 4], [-1, 64, 10], [0, 64, 10], [20, 72, 30], [5, 58, 17]]) {
      const v = a.data[((y - 55) * d + (z - 4)) * w + (x + 20)]
      expect(a.palette[v]).toBe(testBlock(x, y, z))
    }
  })
})

describe('ZIP', () => {
  it('liest eine gezippte Welt mit Oberordner', async () => {
    const zw = new ZipWriter(new BlobWriter('application/zip'))
    for (const [p, data] of world) await zw.add(`Meine Welt/${p}`, new Uint8ArrayReader(data))
    const blob = await zw.close()
    const src = await ZipSource.open(new File([blob], 'welt.zip'))
    expect(src.name).toBe('Meine Welt')
    const w = await openWorld(src)
    expect(w.name).toBe('Testwelt')
    expect(w.regions).toHaveLength(2)
  })
})

describe('Weltordner aus einer Dateiliste', () => {
  const f = (path: string, data: Uint8Array = new Uint8Array(1)) => ({ path, file: new File([data as Uint8Array<ArrayBuffer>], path.split('/').pop()!) })

  it('findet den Weltordner auch eine Ebene tiefer und liest die Welt', async () => {
    const entries = [...world].map(([p, d]) => f(`Realm Welt/${p}`, d))
    entries.push(f('Realm Welt/level.dat_old'), f('Realm Welt/players/data/x.dat'))
    const src = new UploadSource(entries)
    expect(src.name).toBe('Realm Welt')
    const w = await openWorld(src)
    expect(w.regions).toHaveLength(2)
  })
  it('meldet, wenn kein Weltordner dabei ist', () => {
    expect(() => findWorldRoot(['saves/x/region/r.0.0.mca'])).toThrow(/level\.dat/)
  })
  it('meldet mehrere Welten statt zu raten', () => {
    expect(() => findWorldRoot(['saves/A/level.dat', 'saves/B/level.dat'])).toThrow(/A, B/)
  })
})

describe('Gelände-Ausschnitt ohne feste Höhe', () => {
  it('nimmt die Höhe aus den Heightmaps: vom tiefsten Oberflächenblock minus Untergrund bis zur höchsten Baumkrone', async () => {
    const box = { x0: 0, z0: 0, x1: 63, z1: 63, y0: NaN, y1: NaN }
    const a = await readArea([{ rx: 0, rz: 0, blob: regionBlob('r.0.0.mca') }], box)
    let lo = Infinity, hi = -Infinity
    for (let z = 0; z <= 63; z++) for (let x = 0; x <= 63; x++) {
      const t = topOf(x, z)
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    expect(a.box.y0).toBe(lo - UNDERGROUND)
    expect(a.box.y1).toBe(hi)
    expect(areaGet(a, 5, hi, 5) ?? 'minecraft:air').toBe(testBlock(5, hi, 5))
  })
})
