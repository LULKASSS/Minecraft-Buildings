// Funktionale Vorlagen (Farmen, Redstone): werden nicht generiert, sondern aus einer geprüften .litematic geladen.
// Die App dreht sie nur, setzt sie ein und legt auf Wunsch eine Fassade im Stil drumherum –
// mit einem Block Luft Abstand, damit nichts den Funktionskern berührt.
// Vorlagen liegen nur im Browser des Nutzers (Rechte der Ersteller), nie im Repo.

import { NbtFile, type NbtCompound } from 'deepslate/nbt'
import { formatState, isAir, type BlockState } from '../blueprint/blockstate'
import { Blueprint, type BlueprintSource } from '../blueprint/blueprint'
import { bitsFor, unpackLitematica } from '../export/litematic'
import { Builder } from '../style/builder'
import { getPalette } from '../style/palettes'

export interface TemplateData {
  id: string
  name: string
  dataVersion: number
  size: [number, number, number]
  palette: BlockState[]
  /** Palette-Indizes y → z → x, als Base64 eines Uint16Array */
  blocks: string
  added: number
}

export interface TemplateParams {
  templateId: string
  facade?: { palette: string; sides: [boolean, boolean, boolean, boolean]; roof: boolean } // Norden, Osten, Süden, Westen
}

const registry = new Map<string, TemplateData>()

export function registerTemplates(list: TemplateData[]): void {
  registry.clear()
  for (const t of list) registry.set(t.id, t)
}

export function templateList(): TemplateData[] {
  return [...registry.values()].sort((a, b) => b.added - a.added)
}

export function templateById(id: string): TemplateData | undefined {
  return registry.get(id)
}

// ---------- .litematic lesen ----------

function vec(c: NbtCompound): [number, number, number] {
  return [c.getNumber('x'), c.getNumber('y'), c.getNumber('z')]
}

export function readLitematic(bytes: Uint8Array, fallbackName = 'Vorlage'): Omit<TemplateData, 'id' | 'added'> {
  const root = NbtFile.read(bytes).root
  if (!root.hasCompound('Regions')) throw new Error('Das ist keine .litematic (keine Regionen gefunden).')
  const dataVersion = root.getNumber('MinecraftDataVersion')
  const name = root.hasCompound('Metadata') ? root.getCompound('Metadata').getString('Name') || fallbackName : fallbackName
  const regions: { min: [number, number, number]; len: [number, number, number]; palette: BlockState[]; idx: Uint16Array }[] = []
  root.getCompound('Regions').forEach((_, tag) => {
    const r = tag as NbtCompound
    const pos = vec(r.getCompound('Position'))
    const size = vec(r.getCompound('Size'))
    const min = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p)) as [number, number, number]
    const len = size.map(Math.abs) as [number, number, number]
    const palette = r.getList('BlockStatePalette', 10).map(c => {
      const props: Record<string, string> = {}
      if (c.hasCompound('Properties')) c.getCompound('Properties').forEach((k, v) => (props[k] = v.getAsString()))
      return formatState(c.getString('Name'), props)
    })
    const longs = r.getLongArray('BlockStates').getItems().map(l => l.toBigInt())
    const idx = unpackLitematica(longs, bitsFor(palette.length), len[0] * len[1] * len[2])
    regions.push({ min, len, palette, idx })
  })
  if (!regions.length) throw new Error('Die .litematic ist leer.')
  const lo = [0, 1, 2].map(i => Math.min(...regions.map(r => r.min[i])))
  const hi = [0, 1, 2].map(i => Math.max(...regions.map(r => r.min[i] + r.len[i] - 1)))
  const size: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1]
  const bp = new Blueprint({ size, name, source: { generator: 'vorlage', version: 1, seed: 0, params: {} }, kind: 'functional' })
  for (const r of regions) {
    const [w, h, d] = r.len
    let i = 0
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++, i++) {
          const s = r.palette[r.idx[i]]
          if (s && !isAir(s)) bp.set(r.min[0] - lo[0] + x, r.min[1] - lo[1] + y, r.min[2] - lo[2] + z, s)
        }
  }
  const { palette, blocks } = bp.compact()
  return { name, dataVersion, size, palette, blocks: toBase64(blocks) }
}

function toBase64(a: Uint16Array): string {
  let s = ''
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(s: string): Uint16Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint16Array(bytes.buffer)
}

// ---------- Bauwerk aus Vorlage, mit Fassade ----------

export function buildTemplate(source: BlueprintSource): Blueprint {
  const p = source.params as unknown as TemplateParams
  const t = registry.get(p.templateId)
  if (!t) throw new Error('Diese Vorlage ist in diesem Browser nicht gespeichert. Bitte die .litematic erneut laden.')
  const [w, h, d] = t.size
  const blocks = fromBase64(t.blocks)
  const b = new Builder(p.facade ? getPalette(p.facade.palette) ?? null : null, source.seed)
  b.anchor = [Math.floor(w / 2), 0, Math.floor(d / 2)]
  let i = 0
  for (let y = 0; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++, i++) if (blocks[i]) b.raw(x, y, z, t.palette[blocks[i]])
  if (p.facade && b.palette) facade(b, w, h, d, p.facade.sides, p.facade.roof)
  return b.toBlueprint(t.name, source, 'functional')
}

/** Fassade mit einem Block Abstand zum Kern. Dach aus unteren Stufen: darauf spawnen keine Mobs. */
function facade(b: Builder, w: number, h: number, d: number, sides: [boolean, boolean, boolean, boolean], roof: boolean): void {
  const x0 = -2, x1 = w + 1, z0 = -2, z1 = d + 1, top = h
  const wall = (x: number, z: number, along: number, len: number) => {
    const pillar = along === 0 || along === len - 1 || along % 4 === 0
    for (let y = 0; y <= top; y++) {
      if (pillar) b.beam(x, y, z, 'frame', 'y')
      else if (y === 0) b.role(x, y, z, 'sockel', {}, 1)
      else if (y >= 2 && y <= 3 && along % 4 === 2) b.role(x, y, z, 'window')
      else b.role(x, y, z, 'wall')
    }
  }
  const lenX = x1 - x0 + 1, lenZ = z1 - z0 + 1
  if (sides[0]) for (let x = x0; x <= x1; x++) wall(x, z0, x - x0, lenX)
  if (sides[2]) for (let x = x0; x <= x1; x++) wall(x, z1, x - x0, lenX)
  if (sides[3]) for (let z = z0; z <= z1; z++) wall(x0, z, z - z0, lenZ)
  if (sides[1]) for (let z = z0; z <= z1; z++) wall(x1, z, z - z0, lenZ)
  if (sides[2]) {
    // Tür in der Mitte der Südseite
    const cx = Math.floor((x0 + x1) / 2)
    const door = b.main('door')
    b.set(cx, 1, z1, `${door}[facing=north,half=lower,hinge=left]`)
    b.set(cx, 2, z1, `${door}[facing=north,half=upper,hinge=left]`)
    b.role(cx, 0, z1, 'sockel', {}, 1)
  }
  if (roof) {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1
        b.form(x, top + 1, z, edge ? 'trim' : 'roof', 'slab', { type: 'bottom' })
      }
  }
}

export function templateExtent(source: BlueprintSource) {
  const t = registry.get((source.params as unknown as TemplateParams).templateId)
  if (!t) return null
  const [w, , d] = t.size
  return { x0: -Math.floor(w / 2) - 2, z0: -Math.floor(d / 2) - 2, x1: w - Math.floor(w / 2) + 1, z1: d - Math.floor(d / 2) + 1 }
}
