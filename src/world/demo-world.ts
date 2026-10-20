// Erzeugt eine kleine Testwelt im 26.x-Format: Hügel, ein See, Sand am Ufer.
// Für Tests und zum Ausprobieren ohne eigene Welt. Keine echte Welt im Repo.

import { NbtCompound, NbtFile, NbtInt, NbtIntArray, NbtList, NbtLongArray, NbtString } from 'deepslate/nbt'
import { deflate } from 'pako'

const MIN_SEC = -4
const SECTIONS = 24 // -64 … 319

export const WATER_LEVEL = 62

export function terrainHeight(x: number, z: number): number {
  return Math.round(64 + 6 * Math.sin(x / 12) + 4 * Math.cos(z / 9))
}

/** Bäume auf trockenem Gras, fest verteilt, damit es in 3D etwas zu sehen gibt. */
function treeAt(x: number, z: number): boolean {
  const h = Math.imul(x * 73856093 ^ z * 19349663, 2654435761) >>> 0
  return h % 89 === 0 && terrainHeight(x, z) > WATER_LEVEL + 1
}

const TRUNK = 5

export function testBlock(x: number, y: number, z: number): string {
  const h = terrainHeight(x, z)
  if (y > h && y <= h + TRUNK + 2) {
    if (treeAt(x, z) && y <= h + TRUNK) return 'minecraft:oak_log[axis=y]'
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (!treeAt(x + dx, z + dz)) continue
        const top = terrainHeight(x + dx, z + dz) + TRUNK
        const r = y > top ? 1 : 2
        if (y >= top - 1 && y <= top + 1 && Math.abs(dx) <= r && Math.abs(dz) <= r && (dx || dz || y > top))
          return 'minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]'
      }
  }
  if (y < -60) return 'minecraft:bedrock'
  if (y < h - 3) return 'minecraft:stone'
  if (y < h) return h <= WATER_LEVEL + 1 ? 'minecraft:sand' : 'minecraft:dirt'
  if (y === h) return h <= WATER_LEVEL + 1 ? 'minecraft:sand' : 'minecraft:grass_block[snowy=false]'
  if (y <= WATER_LEVEL) return 'minecraft:water[level=0]'
  return 'minecraft:air'
}

export function packAligned(values: ArrayLike<number>, bits: number): bigint[] {
  const per = Math.floor(64 / bits)
  const out: bigint[] = []
  for (let i = 0; i < values.length; i += per) {
    let v = 0n
    for (let j = 0; j < per && i + j < values.length; j++) v |= BigInt(values[i + j]) << BigInt(j * bits)
    out.push(BigInt.asIntN(64, v))
  }
  return out
}

function stateTag(s: string): NbtCompound {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(s)!
  const c = new NbtCompound().set('Name', new NbtString(m[1]))
  if (m[2]) {
    const p = new NbtCompound()
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=')
      p.set(k, new NbtString(v))
    }
    c.set('Properties', p)
  }
  return c
}

export function makeChunk(cx: number, cz: number, block = testBlock, dataVersion = 4786): Uint8Array {
  const sections: NbtCompound[] = []
  const surface: number[] = []
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      let top = MIN_SEC * 16 - 1
      for (let y = (MIN_SEC + SECTIONS) * 16 - 1; y >= MIN_SEC * 16; y--) {
        if (block(cx * 16 + x, y, cz * 16 + z) !== 'minecraft:air') { top = y; break }
      }
      surface.push(top + 1 - MIN_SEC * 16)
    }
  for (let sy = MIN_SEC; sy < MIN_SEC + SECTIONS; sy++) {
    const palette: string[] = []
    const idx: number[] = []
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const s = block(cx * 16 + x, sy * 16 + y, cz * 16 + z)
          let i = palette.indexOf(s)
          if (i < 0) { i = palette.length; palette.push(s) }
          idx.push(i)
        }
    const bs = new NbtCompound().set('palette', new NbtList(palette.map(stateTag), 10))
    if (palette.length > 1) bs.set('data', new NbtLongArray(packAligned(idx, Math.max(4, Math.ceil(Math.log2(palette.length))))))
    sections.push(new NbtCompound().set('Y', new NbtInt(sy)).set('block_states', bs))
  }
  const root = new NbtCompound()
    .set('DataVersion', new NbtInt(dataVersion))
    .set('xPos', new NbtInt(cx))
    .set('zPos', new NbtInt(cz))
    .set('yPos', new NbtInt(MIN_SEC))
    .set('Status', new NbtString('minecraft:full'))
    .set('sections', new NbtList(sections, 10))
    .set('Heightmaps', new NbtCompound().set('WORLD_SURFACE', new NbtLongArray(packAligned(surface, 9))))
    .set('block_entities', new NbtList([], 10))
  return new NbtFile('', root, 'none', false, undefined).write()
}

/** Region-Datei aus unkomprimierten Chunk-NBTs (lokale Koordinaten 0…31). */
export function makeRegion(chunks: { lx: number; lz: number; nbt: Uint8Array; compression?: 1 | 2 | 3 }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const header = new Uint8Array(8192)
  const hv = new DataView(header.buffer)
  let sector = 2
  for (const c of chunks) {
    const type = c.compression ?? 2
    const body = type === 2 ? deflate(c.nbt) : c.nbt
    const len = body.length + 1
    const total = 4 + len
    const nSec = Math.ceil(total / 4096)
    const buf = new Uint8Array(nSec * 4096)
    const v = new DataView(buf.buffer)
    v.setUint32(0, len)
    v.setUint8(4, type)
    buf.set(body, 5)
    hv.setUint32((c.lx + c.lz * 32) * 4, (sector << 8) | nSec)
    hv.setUint32(4096 + (c.lx + c.lz * 32) * 4, 1700000000)
    parts.push(buf)
    sector += nSec
  }
  const out = new Uint8Array(sector * 4096)
  out.set(header, 0)
  let p = 8192
  for (const b of parts) { out.set(b, p); p += b.length }
  return out
}

export function makeLevelDat(name = 'Testwelt', dataVersion = 4786): Uint8Array {
  const data = new NbtCompound()
    .set('LevelName', new NbtString(name))
    .set('DataVersion', new NbtInt(dataVersion))
    .set('Version', new NbtCompound().set('Name', new NbtString('26.1')).set('Id', new NbtInt(dataVersion)))
    .set('spawn', new NbtCompound().set('pos', new NbtIntArray([8, 70, 8])))
  return new NbtFile('', new NbtCompound().set('Data', data), 'gzip', false, undefined).write()
}

/** Ganze Testwelt: Pfad → Inhalt. Region 0,0 mit chunks × chunks Chunks, Region -1,0 mit 2×8 Chunks (negative x). */
export function makeWorld(chunks = 8): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  files.set('level.dat', makeLevelDat())
  const dir = 'dimensions/minecraft/overworld/region'
  const r00: { lx: number; lz: number; nbt: Uint8Array }[] = []
  for (let lz = 0; lz < chunks; lz++) for (let lx = 0; lx < chunks; lx++) r00.push({ lx, lz, nbt: makeChunk(lx, lz) })
  files.set(`${dir}/r.0.0.mca`, makeRegion(r00))
  const rm10: { lx: number; lz: number; nbt: Uint8Array }[] = []
  for (let lz = 0; lz < 8; lz++) for (let lx = 30; lx < 32; lx++) rm10.push({ lx, lz, nbt: makeChunk(lx - 32, lz) })
  files.set(`${dir}/r.-1.0.mca`, makeRegion(rm10))
  return files
}
