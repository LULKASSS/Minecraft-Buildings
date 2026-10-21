import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { areaGet, readArea, UNDERGROUND } from '../src/world/area'
import { blockAt, decodeChunk, heightmapBits, paletteEntry } from '../src/world/chunk'
import { openWorld, parseLevel } from '../src/world/level'
import { readChunkBytes, readHeader } from '../src/world/region'
import { findWorldRoot, UploadSource, ZipSource, type WorldSource } from '../src/world/source'
import { renderTile, TILE, TRACE } from '../src/world/tile'
import { findHotspots } from '../src/world/traces'
import { makeChunk, makeLevelDat, makeWorld, testBlock, WATER_LEVEL } from '../src/world/demo-world'
import { compareVersions, dirFromFiles, DirSource, jarCandidates, pickJar, scanFolder } from '../src/world/minecraft'

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
    expect(l).toEqual({ name: 'Testwelt', dataVersion: 4786, versionName: '26.1', spawn: [8, 70, 8], lastPlayed: 1760900000000 })
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

describe('Spuren', () => {
  it('kennt Spielzeit und gebaute Spalten je Chunk und findet den Platz', async () => {
    const t = await renderTile(regionBlob('r.0.0.mca'), 0, 0)
    // Platz x/z 100…110 liegt in Chunk 6,6
    expect(t.built[6 + 6 * 32]).toBeGreaterThan(80)
    expect(t.built[0]).toBe(0) // Gras, Sand, Wasser, Bäume zählen nicht
    expect(t.inhabited[6 + 6 * 32] / 3600).toBeGreaterThan(20)
    const spots = findHotspots([{ rx: 0, rz: 0, inhabited: t.inhabited, built: t.built }])
    expect(spots[0].hours).toBeGreaterThan(20)
    expect(Math.abs(spots[0].x - 105)).toBeLessThan(8)
    expect(Math.abs(spots[0].z - 105)).toBeLessThan(8)
    // der Spawn liegt näher als 192 Blöcke: kein zweiter Ort
    expect(spots).toHaveLength(1)
    // Spuren-Ebene: Platz kräftig, Rest höchstens zart
    const o = ((105 >> 2) + (105 >> 2) * TRACE) * 4
    expect(t.trace[o + 3]).toBe(230)
  })
})

describe('Minecraft-Ordner', () => {
  const file = (path: string, data: Uint8Array | string = new Uint8Array(1)) => ({ path, file: new File([data as BlobPart], path.split('/').pop()!) })
  const mc = () => {
    const list = [file('minecraft/options.txt', 'x')]
    for (const [p, d] of world) list.push(file(`minecraft/saves/Alt/${p}`, p === 'level.dat' ? makeLevelDat('Alte Welt', 4671, 1000) : d))
    for (const [p, d] of world) list.push(file(`minecraft/saves/Realm/${p}`, p === 'level.dat' ? makeLevelDat('Realm', 4786, 2000) : d))
    list.push(file('minecraft/versions/26.1/26.1.json', '{}'), file('minecraft/versions/26.1/26.1.jar'))
    list.push(file('minecraft/versions/26.3/26.3.json', '{}')) // ohne .jar, wie bei Lukas
    list.push(file('minecraft/versions/fabric-loader-0.17-26.3/fabric-loader-0.17-26.3.jar'))
    return dirFromFiles(list)
  }
  it('findet Welten (zuletzt gespielte zuerst) und Versionen', async () => {
    const s = await scanFolder(mc())
    expect(s.kind).toBe('minecraft')
    expect(s.worlds.map(w => w.name)).toEqual(['Realm', 'Alte Welt'])
    expect(s.versions.map(v => v.version).sort()).toEqual(['26.1', '26.3', 'fabric-loader-0.17-26.3'])
  })
  it('nimmt die .jar der Weltversion, sonst die neueste Vanilla-Version, nie Fabric', async () => {
    const s = await scanFolder(mc())
    expect(pickJar(s.versions, '26.1')?.version).toBe('26.1')
    expect(pickJar(s.versions, '26.3')?.version).toBe('26.1') // 26.3 hat keine .jar, Fabric-Hülle kommt zuletzt
    expect(jarCandidates(s.versions, '26.3').map(v => v.version)).toEqual(['26.1', 'fabric-loader-0.17-26.3'])
    expect(compareVersions('26.3', '26.1')).toBeLessThan(0)
    expect(compareVersions('1.21.11', '26.1')).toBeGreaterThan(0)
  })
  it('liest eine Welt aus dem Ordner wie aus der Datei', async () => {
    const s = await scanFolder(mc())
    const w = await openWorld(new DirSource(s.worlds[0].dir))
    expect(w.name).toBe('Realm')
    expect(w.regions).toHaveLength(2)
  })
  it('erkennt auch einen einzelnen Weltordner', async () => {
    const s = await scanFolder(dirFromFiles([...world].map(([p, d]) => file(`Meine Welt/${p}`, d))))
    expect(s.kind).toBe('world')
    expect(s.worlds).toHaveLength(1)
  })
  it('Modrinth App: Welten aller Profile, .jar der Fabric-Kopie unter meta/versions', async () => {
    const list = [file('ModrinthApp/app.db', 'x')]
    for (const [p, d] of world) list.push(file(`ModrinthApp/profiles/Fabric 26.1/saves/Realm/${p}`, p === 'level.dat' ? makeLevelDat('Realm', 4786, 3000) : d))
    for (const [p, d] of world) list.push(file(`ModrinthApp/profiles/Vanilla/saves/Test/${p}`, p === 'level.dat' ? makeLevelDat('Test', 4786, 1000) : d))
    list.push(file('ModrinthApp/meta/versions/26.1-0.17.2/26.1-0.17.2.jar'), file('ModrinthApp/meta/versions/26.1-0.17.2/26.1-0.17.2.json', '{}'))
    list.push(file('ModrinthApp/meta/versions/1.21.11/1.21.11.jar'))
    const s = await scanFolder(dirFromFiles(list))
    expect(s.kind).toBe('modrinth')
    expect(s.worlds.map(w => w.folder)).toEqual(['Fabric 26.1/Realm', 'Vanilla/Test'])
    // die Kopie zur Weltversion vor einer anderen Vanilla-Version, obwohl der Name einen Loader enthält
    expect(jarCandidates(s.versions, '26.1').map(v => v.version)).toEqual(['26.1-0.17.2', '1.21.11'])
  })
  it('Prism Launcher: Welten unter instances, .jar unter libraries', async () => {
    const list = [] as ReturnType<typeof file>[]
    for (const [p, d] of world) list.push(file(`PrismLauncher/instances/Base/.minecraft/saves/Welt/${p}`, d))
    list.push(file('PrismLauncher/libraries/com/mojang/minecraft/26.1/minecraft-26.1-client.jar'))
    const s = await scanFolder(dirFromFiles(list))
    expect(s.kind).toBe('prism')
    expect(s.worlds).toHaveLength(1)
    expect(pickJar(s.versions, '26.1')?.version).toBe('26.1')
  })
  it('verschobene Heightmaps (alte Chunks) werden gegengeprüft, sonst wäre das Gelände abgeschnitten', () => {
    for (const shift of [-64, -16, 20]) {
      const r = decodeChunk(makeChunk(1, 1, testBlock, 4786, undefined, shift))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      for (const [x, z] of [[0, 0], [7, 9], [15, 15]]) {
        let top = 100
        while (testBlock(16 + x, top, 16 + z) === 'minecraft:air') top--
        expect(r.chunk.surface[x + z * 16], `Verschiebung ${shift}`).toBe(top + 1)
      }
    }
  })
  it('Palette ab 26.3 (Text-Liste, {"": id}, {id, properties}) liest dieselben Blöcke wie das alte Format', () => {
    const alt = decodeChunk(makeChunk(2, 3))
    const neu = decodeChunk(makeChunk(2, 3, testBlock, 4786, undefined, 0, true))
    expect(alt.ok && neu.ok).toBe(true)
    if (!alt.ok || !neu.ok) return
    let leaves = 0
    for (let y = -64; y < 160; y += 1)
      for (const [x, z] of [[0, 0], [5, 11], [15, 15], [8, 2]]) {
        const a = blockAt(alt.chunk, x, y, z)
        expect(blockAt(neu.chunk, x, y, z), `${x},${y},${z}`).toBe(a)
        if (a.includes('leaves')) leaves++
      }
    expect(Array.from(neu.chunk.surface)).toEqual(Array.from(alt.chunk.surface))
    expect(leaves).toBeGreaterThan(0)
  })
  it('Palette-Einträge: Standardzustand wird ergänzt, altes Format bleibt', () => {
    expect(paletteEntry('minecraft:oak_stairs')).toBe('minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]')
    expect(paletteEntry({ '': 'minecraft:stone' })).toBe('minecraft:stone')
    expect(paletteEntry({ id: 'minecraft:oak_stairs', properties: { facing: 'east' } })).toBe('minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]')
    expect(paletteEntry({ id: 'minecraft:grass_block' })).toBe('minecraft:grass_block[snowy=false]')
    expect(paletteEntry({ Name: 'minecraft:oak_log', Properties: { axis: 'x' } })).toBe('minecraft:oak_log[axis=x]')
    expect(paletteEntry({ Name: 'minecraft:stone' })).toBe('minecraft:stone')
    expect(paletteEntry({})).toBe('minecraft:air')
  })
  it('Heightmap-Bitbreite aus der Zahl der Longs (384 Blöcke hoch → 9 Bit)', () => {
    expect(heightmapBits(37)).toBe(9)
    expect(heightmapBits(32)).toBe(8)
  })
})
