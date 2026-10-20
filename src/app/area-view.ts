// Steuert die 3D-Ansicht eines Bereichs: Gelände stückweise aus den Workern holen und vermaschen,
// Bauwerke einblenden, Vorschau am Fadenkreuz beim Platzieren, Schicht-Ansicht.

import type { Vec3 } from '../blueprint/blueprint'
import { isAir, parseState, type BlockState } from '../blueprint/blockstate'
import { boundsOf, type Bounds, type Layer } from '../blueprint/placement'
import { transformBlueprint, type Rotation } from '../blueprint/transform'
import { buildFromSource } from '../catalog'
import { meshFallback, type MeshData, type VoxelBlock } from '../render/mesher'
import { Scene3D, type Aim, type BuildingMeshes } from '../render/scene'
import { isOpaqueCube } from '../render/shapes'
import type { TexturedMesher } from '../render/textured'
import { areaGet, type AreaResult } from '../world/area'
import { addPlacement, openArea, placedOf, placementsIn, S, selectedPlacement, toast, update, type Area } from './state'

const PIECE = 32
const PARALLEL = 4

interface Piece {
  key: string
  x0: number
  z0: number
  x1: number
  z1: number
  data: AreaResult | null // mit 1 Block Rand ringsum
}

/** Gleiche durchsichtige Blöcke nebeneinander verdecken sich (Wasser im See, Glasflächen). */
const SAME_HIDES = /^minecraft:(water|lava|glass|.*_stained_glass|ice|bubble_column)$/

export class AreaView {
  readonly scene: Scene3D
  private areaId: string | null = null
  private pieces: Piece[] = []
  private run = 0
  private occupied = new Map<string, BlockState>() // Blöcke der Bauwerke im Bereich
  private buildingBounds = new Map<string, { key: string; b: Bounds }>()
  private ghostRot: Rotation = 0
  private ghostFor: string | null = null
  loaded = 0
  onProgress: (done: number, total: number) => void = () => {}
  onAimText: (html: string) => void = () => {}

  constructor(host: HTMLElement) {
    this.scene = new Scene3D(host)
    this.scene.onAim = a => this.aimChanged(a)
    this.scene.onMove = () => this.aimChanged(this.scene.aim)
    this.scene.onClick = a => this.clicked(a)
  }

  setTextures(t: TexturedMesher | null): void {
    this.scene.setTextures(t)
    this.remeshAll()
    for (const id of this.scene.buildingIds()) this.scene.removeBuilding(id)
    this.buildingBounds.clear()
    this.ghostFor = null
    this.sync()
  }

  get total(): number {
    return this.pieces.length
  }

  /** Bereich öffnen (oder offen lassen, wenn er es schon ist). */
  async open(area: Area): Promise<void> {
    if (this.areaId === area.id) return this.sync()
    this.areaId = area.id
    const run = ++this.run
    this.pieces = []
    for (let z = area.z0; z <= area.z1; z += PIECE)
      for (let x = area.x0; x <= area.x1; x += PIECE)
        this.pieces.push({ key: `${x},${z}`, x0: x, z0: z, x1: Math.min(area.x1, x + PIECE - 1), z1: Math.min(area.z1, z + PIECE - 1), data: null })
    const midY = S.session?.surfaceAt(Math.round((area.x0 + area.x1) / 2), Math.round((area.z0 + area.z1) / 2)) ?? 64
    this.scene.clear([area.x0, 0, area.z0])
    this.buildingBounds.clear()
    this.occupied.clear()
    this.scene.overview(area.x0, area.z0, area.x1, area.z1, midY)
    this.loaded = 0
    this.onProgress(0, this.pieces.length)
    this.sync()

    // Mitte zuerst, dann nach außen
    const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2
    const queue = [...this.pieces].sort((a, b) => dist(a, cx, cz) - dist(b, cx, cz))
    const worker = async () => {
      for (;;) {
        const p = queue.shift()
        if (!p || run !== this.run || !S.session) return
        try {
          p.data = await S.session.area({ x0: p.x0 - 1, z0: p.z0 - 1, x1: p.x1 + 1, z1: p.z1 + 1, y0: NaN, y1: NaN })
        } catch (e) {
          if (run === this.run) toast(`Gelände ${p.key}: ${(e as Error).message}`, true)
        }
        if (run !== this.run) return
        this.meshPiece(p)
        this.loaded++
        this.onProgress(this.loaded, this.pieces.length)
        await new Promise(r => setTimeout(r, 0)) // Oberfläche atmen lassen
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
  }

  close(): void {
    this.run++
    this.areaId = null
  }

  private meshPiece(p: Piece): void {
    const a = p.data
    if (!a) return this.scene.setPiece(p.key, null)
    const [bx, by, bz] = this.scene.base
    const { box, palette } = a
    const opaque = palette.map(s => isOpaqueCube(s))
    const names = palette.map(s => parseState(s).name)
    const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
    const idx = (x: number, y: number, z: number) => a.data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)]
    const blocks: VoxelBlock[] = []
    for (let y = box.y0; y <= box.y1; y++)
      for (let z = p.z0; z <= p.z1; z++)
        for (let x = p.x0; x <= p.x1; x++) {
          const v = idx(x, y, z)
          if (!v || this.occupied.has(`${x},${y},${z}`)) continue
          blocks.push({ x: x - bx, y: y - by, z: z - bz, state: palette[v] })
        }
    const occ = (lx: number, ly: number, lz: number, self: BlockState) => {
      const x = lx + bx, y = ly + by, z = lz + bz
      if (y < box.y0) return true
      if (y > box.y1 || x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) return false
      if (this.occupied.has(`${x},${y},${z}`)) return false
      const v = idx(x, y, z)
      if (!v) return false
      if (opaque[v]) return true
      return palette[v] === self && SAME_HIDES.test(names[v])
    }
    this.scene.setPiece(p.key, this.mesh(blocks, occ, false))
  }

  private mesh(blocks: VoxelBlock[], occ: (x: number, y: number, z: number, self: BlockState) => boolean, keepTop: boolean): MeshData {
    const t = this.scene.textured
    return t ? t.mesh(blocks, occ, keepTop) : meshFallback(blocks, { occludes: occ, keepTop })
  }

  private remeshAll(): void {
    for (const p of this.pieces) if (p.data) this.meshPiece(p)
  }

  /** Gelände-Block an Weltposition, sofern geladen. */
  terrainAt(x: number, y: number, z: number): BlockState | null {
    for (const p of this.pieces) {
      if (p.data && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return areaGet(p.data, x, y, z)
    }
    return null
  }

  // ---------- Bauwerke ----------

  /** Bauwerke des Bereichs mit dem Zustand abgleichen. */
  sync(): void {
    const area = openArea()
    if (!area || area.id !== this.areaId) return
    const list = placementsIn(area.id)
    const changed: Bounds[] = []
    const seen = new Set<string>()
    for (const pl of list) {
      seen.add(pl.id)
      const { placed, layers } = placedOf(pl)
      const key = JSON.stringify([pl.source, pl.pos, pl.rotation, pl.mirror, !!this.scene.textured])
      const prev = this.buildingBounds.get(pl.id)
      if (prev?.key === key) continue
      if (prev) changed.push(prev.b)
      const b = boundsOf(placed)
      changed.push(b)
      this.buildingBounds.set(pl.id, { key, b })
      this.scene.setBuilding(pl.id, key, this.buildingMeshes(layers))
    }
    for (const id of [...this.buildingBounds.keys()]) {
      if (!seen.has(id)) {
        changed.push(this.buildingBounds.get(id)!.b)
        this.buildingBounds.delete(id)
        this.scene.removeBuilding(id)
      }
    }
    if (changed.length) {
      this.occupied.clear()
      for (const pl of list) for (const l of placedOf(pl).layers) for (const b of l.blocks) this.occupied.set(`${b.x},${b.y},${b.z}`, b.state)
      // Geländestücke unter geänderten Bauwerken neu vermaschen (Gelände dort ausblenden bzw. wieder zeigen)
      for (const p of this.pieces) {
        if (changed.some(b => b.min[0] <= p.x1 + 1 && b.max[0] >= p.x0 - 1 && b.min[2] <= p.z1 + 1 && b.max[2] >= p.z0 - 1)) this.meshPiece(p)
      }
    }
    const sel = selectedPlacement()
    this.scene.setGuide(sel && sel.areaId === area.id ? sel.id : null, S.guide.layer, S.guide.single)
    this.syncGhost()
  }

  focusPlacement(id: string): void {
    const b = this.buildingBounds.get(id)?.b
    if (b) this.scene.focusOn(b.min, b.max)
  }

  private buildingMeshes(layers: Layer[]): BuildingMeshes {
    const [bx, by, bz] = this.scene.base
    const solid = new Set<string>()
    for (const l of layers) for (const b of l.blocks) if (isOpaqueCube(b.state)) solid.add(`${b.x},${b.y},${b.z}`)
    const out: BuildingMeshes = { layers: [], grids: [] }
    for (const l of layers) {
      const blocks = l.blocks.map(b => ({ x: b.x - bx, y: b.y - by, z: b.z - bz, state: b.state }))
      const occ = (lx: number, ly: number, lz: number) => {
        const x = lx + bx, y = ly + by, z = lz + bz
        if (y > l.y) return false // darüber kann ausgeblendet sein
        if (solid.has(`${x},${y},${z}`)) return true
        const t = this.terrainAt(x, y, z)
        return y < l.y && !!t && isOpaqueCube(t) && !this.occupied.has(`${x},${y},${z}`)
      }
      out.layers.push(this.mesh(blocks, occ, true))
      const pts: number[] = []
      for (const b of blocks) {
        const y = b.y + 1.002
        pts.push(b.x, y, b.z, b.x + 1, y, b.z, b.x + 1, y, b.z, b.x + 1, y, b.z + 1,
          b.x + 1, y, b.z + 1, b.x, y, b.z + 1, b.x, y, b.z + 1, b.x, y, b.z)
      }
      out.grids.push(new Float32Array(pts))
    }
    return out
  }

  // ---------- Platzieren ----------

  rotateGhost(dir: 1 | -1): void {
    this.ghostRot = ((((this.ghostRot + dir * 90) % 360) + 360) % 360) as Rotation
    this.ghostFor = null
    this.syncGhost()
  }

  private ghostBlueprint() {
    if (!S.placing) return null
    return transformBlueprint(buildFromSource({ generator: S.placing, version: 1, seed: 0, params: {} }), this.ghostRot)
  }

  private syncGhost(): void {
    const key = S.placing ? `${S.placing}|${this.ghostRot}|${!!this.scene.textured}` : null
    if (key === this.ghostFor) return this.aimChanged(this.scene.aim)
    this.ghostFor = key
    const bp = this.ghostBlueprint()
    if (!bp) return this.scene.setGhost(null)
    const blocks = bp.list().map(b => ({ x: b.x, y: b.y, z: b.z, state: b.state }))
    this.scene.setGhost(this.mesh(blocks, () => false, true))
    this.aimChanged(this.scene.aim)
  }

  /** Weltposition, auf der der Anker landet: auf dem anvisierten Block, an Wänden daneben. */
  private targetOf(a: Aim & { face: Vec3 }): Vec3 {
    if (a.face[1] === 1 || a.placementId) return [a.x, a.y, a.z]
    return [a.x + a.face[0], a.y + Math.min(0, a.face[1]), a.z + a.face[2]]
  }

  private aimChanged(a: (Aim & { face: Vec3 }) | null): void {
    const cam = this.scene.cameraWorld()
    let html = `Du: X <b>${cam[0]}</b> · Y <b>${cam[1]}</b> · Z <b>${cam[2]}</b>`
    if (a) {
      const state = a.placementId ? this.occupied.get(`${a.x},${a.y},${a.z}`) : this.terrainAt(a.x, a.y, a.z)
      html += ` &nbsp;·&nbsp; ${state && !isAir(state) ? label(state) : 'Block'} X <b>${a.x}</b> · Y <b>${a.y}</b> · Z <b>${a.z}</b>`
    }
    this.onAimText(html)
    const bp = S.placing ? this.ghostBlueprint() : null
    if (!bp || !a) return this.scene.moveGhost(null)
    const t = this.targetOf(a)
    this.scene.moveGhost([t[0] - bp.anchor[0], t[1] - bp.anchor[1], t[2] - bp.anchor[2]])
  }

  private clicked(a: (Aim & { face: Vec3 }) | null): void {
    const area = openArea()
    if (!area) return
    if (S.placing) {
      if (!a) return
      const pos = this.targetOf(a)
      if (pos[0] < area.x0 || pos[0] > area.x1 || pos[2] < area.z0 || pos[2] > area.z1) {
        toast('Das liegt außerhalb des Bereichs.')
        return
      }
      const type = S.placing
      S.placing = null
      addPlacement(area.id, type, pos, this.ghostRot)
      return
    }
    if (a?.placementId) {
      S.sel = { kind: 'placement', id: a.placementId }
      S.guide.layer = null
      update()
    } else if (S.sel?.kind === 'placement') {
      S.sel = { kind: 'area', id: area.id }
      update()
    }
  }
}

function dist(p: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): number {
  return Math.hypot((p.x0 + p.x1) / 2 - x, (p.z0 + p.z1) / 2 - z)
}

function label(state: BlockState): string {
  return parseState(state).name.replace('minecraft:', '').replace(/_/g, ' ')
}
