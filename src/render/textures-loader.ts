// Liest Blockzustände, Modelle und Texturen aus der Minecraft-.jar (oder einem Ressourcenpaket obendrauf)
// und baut daraus den Atlas für die 3D-Ansicht und die Kartenfarben.

import { BlobReader, BlobWriter, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import { Identifier } from 'deepslate/core'
import { BlockDefinition, BlockModel, TextureAtlas, type Cull } from 'deepslate/render'
import * as THREE from 'three'
import blocks from '../../data/blocks-26.1.json'
import { parseState, shortName, type BlockState } from '../blueprint/blockstate'
import { fallbackColor, type RGB } from './block-colors'
import { MeshBuilder, type MeshData, type VoxelBlock } from './mesher'
import { isInvisible, shapeOf } from './shapes'
import type { TexturedMesher } from './textured'

const DEFAULTS = (blocks as unknown as { defaults: Record<string, Record<string, string>> }).defaults
const WHITE = 'basenplaner:white'

interface Base {
  definitions: Map<string, unknown>
  models: Map<string, unknown>
  textures: Map<string, Blob>
}

let base: Base | null = null

export interface LoadedTextures {
  /** woran der Kachel-Speicher die Farben erkennt (Dateiname + Größe) */
  id: string
  count: number
  mesher: TexturedMesher
  mapColors: Record<string, RGB>
}

export async function loadTextures(file: File): Promise<LoadedTextures> {
  const reader = new ZipReader(new BlobReader(file))
  const entries = (await reader.getEntries()).filter(e => !e.directory) as FileEntry[]
  const pick = (re: RegExp) => entries.filter(e => re.test(e.filename))
  const defs = pick(/^assets\/minecraft\/blockstates\/[^/]+\.json$/)
  const models = pick(/^assets\/minecraft\/models\/(block\/)?[^/]+\.json$/)
  const textures = pick(/^assets\/minecraft\/textures\/block\/[^/]+\.png$/)

  if (defs.length < 100 && !base) {
    await reader.close()
    throw new Error('In dieser Datei stecken keine Blockmodelle. Bitte die normale Minecraft-.jar wählen: versions/<Version>/<Version>.jar, nicht die aus dem fabric-loader-Ordner. Ein Ressourcenpaket danach.')
  }
  const next: Base = base && defs.length < 100
    ? { definitions: new Map(base.definitions), models: new Map(base.models), textures: new Map(base.textures) }
    : { definitions: new Map(), models: new Map(), textures: new Map() }

  const json = async (e: FileEntry) => JSON.parse(await e.getData(new TextWriter()))
  await Promise.all(defs.map(async e => next.definitions.set(`minecraft:${e.filename.replace(/^assets\/minecraft\/blockstates\//, '').slice(0, -5)}`, await json(e))))
  await Promise.all(models.map(async e => next.models.set(`minecraft:${e.filename.replace(/^assets\/minecraft\/models\//, '').slice(0, -5)}`, await json(e))))
  await Promise.all(textures.map(async e => next.textures.set(`minecraft:${e.filename.replace(/^assets\/minecraft\/textures\//, '').slice(0, -4)}`, await e.getData(new BlobWriter('image/png')))))
  await reader.close()
  if (defs.length >= 100) base = next

  return { ...(await build(next)), id: `tex:${file.name}:${file.size}` }
}

async function build(src: Base): Promise<Omit<LoadedTextures, 'id'>> {
  const white = await new Promise<Blob>(r => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 16, 16)
    c.toBlob(b => r(b!), 'image/png')
  })
  const atlas = await TextureAtlas.fromBlobs({ ...Object.fromEntries(src.textures), [WHITE]: white })

  const modelMap = new Map<string, BlockModel>()
  for (const [id, data] of src.models) {
    try { modelMap.set(id, BlockModel.fromJson(data)) } catch { /* kaputtes Modell überspringen */ }
  }
  const provider = { getBlockModel: (id: Identifier) => modelMap.get(id.toString()) ?? null }
  for (const m of modelMap.values()) {
    try { m.flatten(provider) } catch { /* fehlender Elternteil */ }
  }
  const defMap = new Map<string, BlockDefinition>()
  for (const [id, data] of src.definitions) {
    try { defMap.set(id, BlockDefinition.fromJson(data)) } catch { /* überspringen */ }
  }

  const img = atlas.getTextureAtlas()
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.putImageData(img, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  // Nah scharf (Nearest), in der Ferne Verkleinerungsstufen statt Pixelrauschen. Die Stufen entstehen selbst und nur bis
  // 1 Pixel je Block (16 → 1): Jede Textur liegt auf einem 16er-Raster, so mischt sich keine mit ihrer Nachbarin.
  texture.mipmaps = mipChain(img, 4)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.generateMipmaps = false
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace

  const whiteUV = atlas.getTextureUV(Identifier.parse(WHITE))
  const whitePt: [number, number] = [(whiteUV[0] + whiteUV[2]) / 2, (whiteUV[1] + whiteUV[3]) / 2]
  const mesher = new DeepslateMesher(texture, defMap, provider, atlas, whitePt)
  return { count: src.textures.size, mesher, mapColors: mapColors(defMap, provider, atlas, img) }
}

const DIRS = ['up', 'down', 'north', 'south', 'east', 'west'] as const
const OFF: Record<(typeof DIRS)[number], [number, number, number]> = {
  up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0],
}

type Quads = { pos: number[]; uv: number[]; col: number[]; n: [number, number, number] }[]

class DeepslateMesher implements TexturedMesher {
  private cache = new Map<string, Quads | null>()
  private parsed = new Map<string, { id: Identifier; name: string; props: Record<string, string> }>()

  constructor(
    readonly texture: THREE.Texture,
    private defs: Map<string, BlockDefinition>,
    private provider: { getBlockModel(id: Identifier): BlockModel | null },
    private atlas: TextureAtlas,
    private white: [number, number],
  ) {}

  private icons = new Map<BlockState, HTMLCanvasElement | null>()

  icon(state: BlockState): HTMLCanvasElement | null {
    if (this.icons.has(state)) return this.icons.get(state)!
    let out: HTMLCanvasElement | null = null
    // oberste Fläche, die nach oben zeigt; ohne solche (z. B. Tür) die größte Seitenfläche
    const qs = this.quads(state, 0)
    const ups = qs?.filter(q => q.n[1] > 0.5) ?? []
    const q = ups.sort((a, b) => Math.max(b.pos[1], b.pos[4], b.pos[7]) - Math.max(a.pos[1], a.pos[4], a.pos[7]))[0] ?? qs?.[0]
    const img = this.texture.image as HTMLCanvasElement | undefined
    if (q && img) {
      const us = [q.uv[0], q.uv[2], q.uv[4], q.uv[6]], vs = [q.uv[1], q.uv[3], q.uv[5], q.uv[7]]
      const u0 = Math.min(...us) * img.width, v0 = Math.min(...vs) * img.height
      const w = Math.max(1, (Math.max(...us) - Math.min(...us)) * img.width), h = Math.max(1, (Math.max(...vs) - Math.min(...vs)) * img.height)
      out = document.createElement('canvas')
      out.width = out.height = 16
      const ctx = out.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, u0, v0, w, h, 0, 0, 16, 16)
      // Färbung (Gras, Laub, Wasser) steckt in den Eckfarben
      const [r, g, b] = q.col
      if (r < 0.99 || g < 0.99 || b < 0.99) {
        const d = ctx.getImageData(0, 0, 16, 16)
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] *= r
          d.data[i + 1] *= g
          d.data[i + 2] *= b
        }
        ctx.putImageData(d, 0, 0)
      }
    }
    this.icons.set(state, out)
    return out
  }

  private quads(state: BlockState, mask: number): Quads | null {
    const key = `${state}|${mask}`
    if (this.cache.has(key)) return this.cache.get(key)!
    let p = this.parsed.get(state)
    if (!p) {
      const { name, props } = parseState(state)
      p = { id: Identifier.parse(name), name, props }
      this.parsed.set(state, p)
    }
    const def = this.defs.get(p.name)
    let out: Quads | null = null
    if (def) {
      try {
        const cull: Cull = {}
        DIRS.forEach((d, i) => { if (mask & (1 << i)) cull[d] = true })
        const mesh = def.getMesh(p.id, p.props, this.atlas, this.provider, cull)
        out = mesh.quads.map(q => {
          const n = q.normal()
          const vs = q.vertices()
          return {
            pos: vs.flatMap(v => [v.pos.x, v.pos.y, v.pos.z]),
            uv: vs.flatMap(v => v.texture ?? this.white),
            col: vs.flatMap(v => [v.color[0], v.color[1], v.color[2]]),
            n: [n.x, n.y, n.z] as [number, number, number],
          }
        })
        if (out.length === 0) out = null // Wasser, Truhen, Schilder: im Spiel eigene Renderer
      } catch {
        out = null
      }
    }
    this.cache.set(key, out)
    return out
  }

  mesh(blocks: VoxelBlock[], occludes: (x: number, y: number, z: number, self: BlockState) => boolean, keepTop: boolean): MeshData {
    const mb = new MeshBuilder()
    for (const b of blocks) {
      if (isInvisible(b.state)) continue
      let mask = 0
      DIRS.forEach((d, i) => {
        if (d === 'up' && keepTop) return
        const o = OFF[d]
        if (occludes(b.x + o[0], b.y + o[1], b.z + o[2], b.state)) mask |= 1 << i
      })
      const quads = this.quads(b.state, mask)
      if (quads) {
        for (const q of quads) {
          const s = shade(q.n)
          const v = [0, 1, 2, 3].map(i => [q.pos[i * 3] + b.x, q.pos[i * 3 + 1] + b.y, q.pos[i * 3 + 2] + b.z])
          const uv = [0, 1, 2, 3].map(i => [q.uv[i * 2], q.uv[i * 2 + 1]])
          mb.quad(v, q.n, [q.col[0] * s, q.col[1] * s, q.col[2] * s], uv)
        }
      } else {
        this.fallback(mb, b, mask)
      }
    }
    return mb.build()
  }

  private fallback(mb: MeshBuilder, b: VoxelBlock, mask: number): void {
    const rgb = fallbackColor(parseState(b.state).name)
    const uv = [this.white, this.white, this.white, this.white]
    for (const [x0, y0, z0, x1, y1, z1] of shapeOf(b.state)) {
      DIRS.forEach((d, i) => {
        const edge = (d === 'up' && y1 === 1) || (d === 'down' && y0 === 0) || (d === 'north' && z0 === 0) || (d === 'south' && z1 === 1) || (d === 'west' && x0 === 0) || (d === 'east' && x1 === 1)
        if (edge && mask & (1 << i)) return
        const n = OFF[d]
        const s = shade(n)
        mb.quad(faceVertsLocal(d, b.x + x0, b.y + y0, b.z + z0, b.x + x1, b.y + y1, b.z + z1), n, [rgb[0] / 255 * s, rgb[1] / 255 * s, rgb[2] / 255 * s], uv)
      })
    }
  }
}

function shade(n: [number, number, number]): number {
  if (n[1] > 0.5) return 1
  if (n[1] < -0.5) return 0.5
  return Math.abs(n[2]) > Math.abs(n[0]) ? 0.8 : 0.6
}

function faceVertsLocal(face: (typeof DIRS)[number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
  switch (face) {
    case 'up': return [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]
    case 'down': return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
    case 'north': return [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]
    case 'south': return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    case 'east': return [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]
    case 'west': return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]
  }
}

/** Kartenfarbe je Block: Mittelwert der Textur auf der Oberseite, mit Biom-Standardtönung. */
/** Stufe 0 … levels, jeweils halbe Größe; Farbe nach Deckkraft gewichtet, damit Laubränder nicht dunkel werden. */
function mipChain(img: ImageData, levels: number): ImageData[] {
  const out = [img]
  for (let l = 1; l <= levels; l++) {
    const src = out[l - 1]
    const w = src.width >> 1, h = src.height >> 1
    if (w < 1 || h < 1) break
    const dst = new ImageData(w, h)
    const a = src.data, d = dst.data, sw = src.width
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, al = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const i = ((y * 2 + dy) * sw + x * 2 + dx) * 4
          const k = a[i + 3]
          r += a[i] * k; g += a[i + 1] * k; b += a[i + 2] * k; al += k
        }
        const o = (y * w + x) * 4
        if (al) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al }
        d[o + 3] = al / 4
      }
    out.push(dst)
  }
  return out
}

function mapColors(defs: Map<string, BlockDefinition>, provider: { getBlockModel(id: Identifier): BlockModel | null }, atlas: TextureAtlas, img: ImageData): Record<string, RGB> {
  const out: Record<string, RGB> = {}
  for (const [name, def] of defs) {
    const id = shortName(name)
    const defaults = DEFAULTS[id] ?? {}
    try {
      const mesh = def.getMesh(Identifier.parse(name), defaults, atlas, provider, {})
      const top = mesh.quads.filter(q => q.normal().y > 0.5)
      const q = top[0] ?? mesh.quads[0]
      if (!q) continue
      const vs = q.vertices()
      const us = vs.map(v => v.texture?.[0] ?? 0), ws = vs.map(v => v.texture?.[1] ?? 0)
      const avg = average(img, Math.min(...us), Math.min(...ws), Math.max(...us), Math.max(...ws))
      if (!avg) continue
      const c = vs[0].color
      out[name] = [avg[0] * c[0], avg[1] * c[1], avg[2] * c[2]]
    } catch { /* Fallback-Farbe */ }
  }
  return out
}

function average(img: ImageData, u0: number, v0: number, u1: number, v1: number): RGB | null {
  const x0 = Math.floor(u0 * img.width), x1 = Math.ceil(u1 * img.width)
  const y0 = Math.floor(v0 * img.height), y1 = Math.ceil(v1 * img.height)
  let r = 0, g = 0, b = 0, a = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4
      const al = img.data[i + 3] / 255
      r += img.data[i] * al
      g += img.data[i + 1] * al
      b += img.data[i + 2] * al
      a += al
    }
  return a > 0.5 ? [r / a, g / a, b / a] : null
}
