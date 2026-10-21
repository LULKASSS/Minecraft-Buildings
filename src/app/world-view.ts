// Die 3D-Welt: Gelände um den Kamerapunkt stückweise aus den Workern holen (nah in Blöcken, fern als Säulen
// aus den Kartenkacheln), Bauwerke einblenden, Vorschau beim Platzieren, Schicht-Ansicht.
// Kein Bereich mehr: was man ansieht, wird geladen, was weit weg ist, wieder freigegeben.

import type { Vec3 } from '../blueprint/blueprint'
import { isAir, parseState, type BlockState } from '../blueprint/blockstate'
import { boundsOf, type Bounds, type Layer, type Placement } from '../blueprint/placement'
import { transformBlueprint, type Rotation } from '../blueprint/transform'
import { buildFromSource, entryOf } from '../catalog'
import type { Blueprint, BlueprintSource } from '../blueprint/blueprint'
import type { Ground } from '../style/builder'
import { buildLod } from '../render/lod'
import { meshFallback, type MeshData, type VoxelBlock } from '../render/mesher'
import { Scene3D, type Aim, type BuildingMeshes, type CamMode } from '../render/scene'
import { isOpaqueCube } from '../render/shapes'
import type { TexturedMesher } from '../render/textured'
import { areaGet, type AreaResult } from '../world/area'
import { NO_SURFACE } from '../world/chunk'
import { TILE, TRACE } from '../world/tile'
import { addPlacement, choiceSource, newSeeds, placedOf, placementLabel, rememberCamera, S, saveProject, selectedPlacement, toast, update } from './state'
import type { WorldSession } from './world-session'

const PIECE = 32
/** Böden, auf denen Gras und Blumen gesetzt werden können */
const SOIL = /^minecraft:(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|moss_block|mud|muddy_mangrove_roots|farmland|pale_moss_block)/
const PARALLEL = 3
/** Ferne bis hierhin zeigen (Blöcke vom Kamerapunkt) */
const LOD_RADIUS = 2600
/** Weiter als das vom Mittelpunkt der Szene: alles neu um den Kamerapunkt aufbauen (Genauigkeit, Maske) */
const REBASE = 1700

interface Piece {
  key: string
  x0: number
  z0: number
  x1: number
  z1: number
  data: AreaResult | null // mit 1 Block Rand ringsum
  state: 'loading' | 'ready'
}

/** Gleiche durchsichtige Blöcke nebeneinander verdecken sich (Wasser im See, Glasflächen). */
const SAME_HIDES = /^minecraft:(water|lava|glass|.*_stained_glass|ice|bubble_column)$/

export class WorldView {
  readonly scene: Scene3D
  private session: WorldSession | null = null
  private pieces = new Map<string, Piece>()
  private lodBuilt = new Map<string, number>() // Region → Stand der Kachel beim Bauen
  private run = 0
  private inFlight = 0
  private occupied = new Map<string, BlockState>() // Blöcke der Bauwerke
  private buildingBounds = new Map<string, { key: string; b: Bounds }>()
  private ghostRot: Rotation = 0
  private tickTimer: number | undefined
  private userMoved = false
  private start: Vec3 = [0, 64, 0]
  onProgress: (loading: number) => void = () => {}
  onAimText: (html: string) => void = () => {}
  onCamera: () => void = () => {}

  constructor(host: HTMLElement) {
    this.scene = new Scene3D(host)
    this.scene.onAim = a => this.aimChanged(a)
    this.scene.onMove = () => {
      this.aimChanged(this.scene.aim)
      this.schedule()
      this.onCamera()
    }
    this.scene.onClick = a => this.clicked(a)
    this.scene.onMode = m => {
      S.camMode = m
      update()
    }
    // Nutzer hat selbst bewegt: nicht mehr automatisch zur Base springen
    const c = host.querySelector('canvas')!
    for (const ev of ['pointerdown', 'wheel', 'keydown']) c.addEventListener(ev, () => (this.userMoved = true), { passive: true })
    window.addEventListener('keydown', e => { if (/^Key[WASD]$/.test(e.code)) this.userMoved = true })
    setInterval(() => this.tick(), 400)
  }

  setTextures(t: TexturedMesher | null): void {
    this.scene.setTextures(t)
    for (const p of this.pieces.values()) if (p.data) this.meshPiece(p)
    for (const id of this.scene.buildingIds()) this.scene.removeBuilding(id)
    this.buildingBounds.clear()
    this.ghostMeshKey = null
    this.sync()
  }

  /** Welt öffnen: Kamera an die gemerkte Stelle, sonst über den Spawn. */
  open(session: WorldSession): void {
    this.session = session
    const cam = S.project.camera
    const sp = session.info.spawn
    const y = (x: number, z: number) => session.surfaceAt(x, z) ?? 70
    // gemerkte Höhe nicht blind übernehmen: sie kann aus einer Fassung mit falschen Höhen stammen
    this.start = cam ? [cam.x, y(cam.x, cam.z), cam.z] : sp ? [sp[0], y(sp[0], sp[2]), sp[2]] : [0, 70, 0]
    this.groundCheck = true
    this.userMoved = !!cam
    this.rebase(this.start[0], this.start[2])
    this.scene.jumpTo(this.start[0], this.start[1], this.start[2], Math.max(40, cam?.dist ?? 140))
    this.sync()
    this.tick()
  }

  close(): void {
    this.run++
    this.session = null
    this.pieces.clear()
    this.lodBuilt.clear()
    this.scene.clear([0, 0, 0])
  }

  /** Zur Stelle springen, an der die Welt geöffnet wurde. */
  home(): void {
    this.scene.jumpTo(this.start[0], this.start[1], this.start[2], 140)
    this.groundCheck = true
  }

  /** Irgendwohin springen (Minikarte, Orte mit viel Spielzeit). */
  jumpTo(x: number, z: number, dist = 120): void {
    this.userMoved = true
    const y = this.terrainTop(x, z) ?? this.session?.surfaceAt(x, z) ?? this.scene.focusWorld()[1]
    this.scene.jumpTo(x, y, z, dist)
    this.groundCheck = true
  }

  /** Nach dem Öffnen oder Springen: Drehpunkt auf das tatsächlich geladene Gelände setzen. */
  private groundCheck = false

  private fitToGround(): void {
    if (this.scene.mode !== 'orbit') return
    const [fx, fy, fz] = this.scene.focusWorld()
    if (this.groundCheck) {
      const t = this.terrainTop(Math.floor(fx), Math.floor(fz))
      if (t === null) return
      this.groundCheck = false
      if (Math.abs(t + 1 - fy) > 2) this.scene.lift(t + 1 - fy)
    }
    // die Kamera nie unter dem Gelände: von unten sieht man nichts (Flächen zeigen nach oben)
    const [cx, cy, cz] = this.scene.cameraWorld()
    const below = this.terrainTop(cx, cz)
    if (below !== null && cy < below + 2) this.scene.lift(below + 3 - cy)
  }

  /** Einmal automatisch zur Base, sobald die Spuren sie gefunden haben – nur, wenn man selbst noch nicht unterwegs war. */
  maybeGoHome(x: number, z: number): boolean {
    if (this.userMoved || !this.session) return false
    this.userMoved = true
    this.jumpTo(x, z, 140)
    return true
  }

  setMode(m: CamMode): void {
    this.scene.setMode(m)
  }

  private terrainTop(x: number, z: number): number | null {
    const p = this.pieces.get(pieceKey(x, z))
    if (!p?.data) return null
    for (let y = p.data.box.y1; y >= p.data.box.y0; y--) {
      const t = areaGet(p.data, x, y, z)
      if (t && !isAir(t)) return y
    }
    return null
  }

  private rebase(x: number, z: number): void {
    this.run++
    this.inFlight = 0
    this.pieces.clear()
    this.lodBuilt.clear()
    const by = Math.round(this.start[1])
    this.scene.clear([Math.round(x / PIECE) * PIECE, by, Math.round(z / PIECE) * PIECE])
    this.buildingBounds.clear()
    this.ghostMeshKey = null
  }

  private schedule(): void {
    if (this.tickTimer) return
    this.tickTimer = window.setTimeout(() => {
      this.tickTimer = undefined
      this.tick()
    }, 120)
  }

  /** Laden und Freigeben nach dem, was die Kamera gerade sieht. */
  private tick(): void {
    const s = this.session
    if (!s || !this.scene.host.offsetParent) return
    const [fx, fy, fz] = this.scene.focusWorld()
    const [bx, , bz] = this.scene.base
    if (Math.hypot(fx - bx, fz - bz) > REBASE) {
      this.start = [fx, fy, fz]
      this.rebase(fx, fz)
      this.sync()
    }
    const dist = this.scene.viewDistance()
    const radius = Math.max(96, Math.min(288, dist * 1.4))
    const keep = radius + 96

    // Kacheln für die Ferne in der Nähe zuerst
    const rr = Math.ceil(LOD_RADIUS / TILE)
    s.setView(fx, fz, Math.floor(fx / TILE) - rr, Math.floor(fz / TILE) - rr, Math.floor(fx / TILE) + rr, Math.floor(fz / TILE) + rr)

    // nahe Stücke laden
    const want: { x: number; z: number; d: number }[] = []
    const r = Math.ceil(radius / PIECE)
    const cx = Math.floor(fx / PIECE), cz = Math.floor(fz / PIECE)
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const x = (cx + i) * PIECE, z = (cz + j) * PIECE
        const d = Math.hypot(x + PIECE / 2 - fx, z + PIECE / 2 - fz)
        if (d > radius || this.pieces.has(`${x},${z}`)) continue
        if (!s.hasRegion(Math.floor(x / TILE), Math.floor(z / TILE))) continue
        want.push({ x, z, d })
      }
    want.sort((a, b) => a.d - b.d)
    for (const w of want) {
      if (this.inFlight >= PARALLEL) break
      void this.loadPiece(w.x, w.z)
    }

    // ferne Stücke freigeben
    for (const p of [...this.pieces.values()]) {
      if (p.state !== 'ready') continue
      if (Math.hypot(p.x0 + PIECE / 2 - fx, p.z0 + PIECE / 2 - fz) <= keep) continue
      this.pieces.delete(p.key)
      this.scene.setPiece(p.key, null, p.x0, p.z0)
    }

    this.updateLods(fx, fz)
    this.fitToGround()
    this.onProgress(this.inFlight + want.length)
    if (this.scene.mode === 'orbit' && !this.groundCheck) rememberCamera({ x: fx, y: fy, z: fz, dist })
  }

  private async loadPiece(x0: number, z0: number): Promise<void> {
    const s = this.session!
    const run = this.run
    const p: Piece = { key: `${x0},${z0}`, x0, z0, x1: x0 + PIECE - 1, z1: z0 + PIECE - 1, data: null, state: 'loading' }
    this.pieces.set(p.key, p)
    this.inFlight++
    try {
      p.data = await s.area({ x0: p.x0 - 1, z0: p.z0 - 1, x1: p.x1 + 1, z1: p.z1 + 1, y0: NaN, y1: NaN })
    } catch (e) {
      if (run === this.run) toast(`Gelände ${p.key}: ${(e as Error).message}`, true)
    }
    if (run !== this.run) return
    this.inFlight--
    p.state = 'ready'
    if (this.pieces.get(p.key) !== p) return
    this.meshPiece(p)
    // Bauwerke, deren Fundament hier liegt, ans Gelände anpassen
    if (S.project.placements.some(pl => near(pl.pos, p))) this.sync()
    this.schedule()
  }

  /** Ferne aus den Kartenkacheln: Regionen im Umkreis bauen, weit entfernte entfernen. */
  private updateLods(fx: number, fz: number): void {
    const s = this.session!
    let built = 0
    for (const t of s.tiles.values()) {
      const key = `${t.rx},${t.rz}`
      const d = Math.hypot(Math.max(0, Math.abs((t.rx + 0.5) * TILE - fx) - TILE / 2), Math.max(0, Math.abs((t.rz + 0.5) * TILE - fz) - TILE / 2))
      if (d > LOD_RADIUS + 400) {
        if (this.lodBuilt.has(key)) {
          this.scene.setLod(key, null)
          this.lodBuilt.delete(key)
        }
        continue
      }
      if (d > LOD_RADIUS || !t.lodH || !t.lodC || this.lodBuilt.has(key) || built >= 2) continue
      const tiles = s.tiles
      const neighbor = (cx: number, cz: number) => {
        const n = tiles.get(`${Math.floor(cx / TRACE)},${Math.floor(cz / TRACE)}`)
        if (!n?.lodH) return null
        const h = n.lodH[(((cx % TRACE) + TRACE) % TRACE) + (((cz % TRACE) + TRACE) % TRACE) * TRACE]
        return h === NO_SURFACE ? null : h
      }
      this.scene.setLod(key, buildLod(t.lodH, t.lodC, t.rx, t.rz, this.scene.base, neighbor))
      this.lodBuilt.set(key, 1)
      built++
    }
  }

  /** Neue Kartenfarben (.jar) oder neue Kachel: Ferne dieser Region neu bauen. */
  tileChanged(rx: number, rz: number): void {
    // die alte Ferne bleibt stehen, bis die neue gebaut ist (setLod ersetzt)
    this.lodBuilt.delete(`${rx},${rz}`)
    this.schedule()
  }

  private meshPiece(p: Piece): void {
    const a = p.data
    if (!a) return this.scene.setPiece(p.key, null, p.x0, p.z0)
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
    this.scene.setPiece(p.key, this.mesh(blocks, occ, false), p.x0, p.z0)
  }

  private mesh(blocks: VoxelBlock[], occ: (x: number, y: number, z: number, self: BlockState) => boolean, keepTop: boolean): MeshData {
    const t = this.scene.textured
    return t ? t.mesh(blocks, occ, keepTop) : meshFallback(blocks, { occludes: occ, keepTop })
  }

  /** Gelände-Block an Weltposition, sofern geladen. */
  terrainAt(x: number, y: number, z: number): BlockState | null {
    const p = this.pieces.get(pieceKey(x, z))
    return p?.data ? areaGet(p.data, x, y, z) : null
  }

  // ---------- Bauwerke ----------

  /** Bauwerke mit dem Zustand abgleichen. */
  sync(): void {
    if (!this.session) return
    const list = S.project.placements
    this.refreshGround(list)
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
      for (const p of this.pieces.values()) {
        if (changed.some(b => b.min[0] <= p.x1 + 1 && b.max[0] >= p.x0 - 1 && b.min[2] <= p.z1 + 1 && b.max[2] >= p.z0 - 1)) this.meshPiece(p)
      }
    }
    const sel = selectedPlacement()
    this.scene.setGuide(sel ? sel.id : null, S.guide.layer, S.guide.single)
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

  // ---------- Gelände unter Bauwerken ----------

  /** Grund einer Spalte (oberster fester Block, Wasser wird durchschaut), relativ zu ref; null = unbekannt. */
  private surfaceY(x: number, z: number, ref: number): { y: number; wet: boolean; soil: boolean } | null {
    let wet = false
    for (let y = ref + 12; y >= ref - 24; y--) {
      const t = this.terrainAt(x, y, z)
      if (!t) continue
      if (t.startsWith('minecraft:water') || t.includes('seagrass') || t.includes('kelp')) wet = true
      else if (isOpaqueCube(t)) return { y: y - ref, wet, soil: SOIL.test(t) }
    }
    return null
  }

  /** Geländehöhen für Generatoren, die dem Gelände folgen (Fundament, Natur-Pinsel). */
  groundFor(source: BlueprintSource, pos: Vec3, rotation: Rotation, mirror: boolean): Ground | undefined {
    const entry = entryOf(source.generator)
    if (!entry.ground) return undefined
    const { ground: _, ...rest } = source.params as Record<string, unknown>
    void _
    const e = entry.ground({ ...source, params: rest })
    if (!e) return undefined
    const w = e.x1 - e.x0 + 1, d = e.z1 - e.z0 + 1
    const h: number[] = new Array(w * d)
    const wet: number[] = []
    const soil: number[] = []
    for (let k = 0; k < d; k++)
      for (let i = 0; i < w; i++) {
        let dx = e.x0 + i, dz = e.z0 + k
        if (mirror) dx = -dx
        for (let r = 0; r < rotation / 90; r++) [dx, dz] = [-dz, dx]
        const s = this.surfaceY(pos[0] + dx, pos[2] + dz, pos[1])
        h[k * w + i] = s?.y ?? 0
        if (s?.wet) wet.push(k * w + i)
        if (s?.soil && !s.wet) soil.push(k * w + i)
      }
    const g: Ground = { x0: e.x0, z0: e.z0, w, d, h }
    if (wet.length) g.wet = wet
    if (source.generator === 'pinsel') g.soil = soil
    return g
  }

  /** Bei verschobenen oder gedrehten Bauwerken das Fundament neu ans Gelände anpassen. */
  private refreshGround(list: Placement[]): void {
    for (const pl of list) {
      if (!entryOf(pl.source.generator).ground) continue
      // erst anpassen, wenn das Gelände dort geladen ist, sonst würde es flach
      if (this.pieces.get(pieceKey(pl.pos[0], pl.pos[2]))?.state !== 'ready') continue
      const g = this.groundFor(pl.source, pl.pos, pl.rotation, pl.mirror)
      if (JSON.stringify(g) !== JSON.stringify(pl.source.params.ground)) {
        pl.source.params = { ...pl.source.params, ground: g }
        saveProject()
      }
    }
  }

  /** Wie viele Geländeblöcke für ein Bauwerk weg müssen (im Bauwerk ist Luft, im Gelände nicht). */
  terrainCut(id: string): number {
    const pl = S.project.placements.find(p => p.id === id)
    if (!pl) return 0
    const { placed } = placedOf(pl)
    const [ox, oy, oz] = placed.origin
    const [w, h, d] = placed.blueprint.size
    let n = 0
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++) {
          if (placed.blueprint.blocks[placed.blueprint.index(x, y, z)]) continue
          const t = this.terrainAt(ox + x, oy + y, oz + z)
          if (t && isOpaqueCube(t)) n++
        }
    return n
  }

  /** Blöcke rund um den Kamerapunkt zählen (ohne geplante Bauwerke) – Grundlage fürs Paletten-Lernen. */
  blockCounts(radius = 48): Map<BlockState, number> {
    const m = new Map<BlockState, number>()
    const [fx, , fz] = this.scene.focusWorld()
    for (const p of this.pieces.values()) {
      const a = p.data
      if (!a || Math.hypot(p.x0 + PIECE / 2 - fx, p.z0 + PIECE / 2 - fz) > radius) continue
      const counts = new Uint32Array(a.palette.length)
      const { box } = a
      const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
      for (let y = box.y0; y <= box.y1; y++)
        for (let z = p.z0; z <= p.z1; z++)
          for (let x = p.x0; x <= p.x1; x++) counts[a.data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)]]++
      counts.forEach((n, i) => { if (i && n) m.set(a.palette[i], (m.get(a.palette[i]) ?? 0) + n) })
    }
    return m
  }

  // ---------- Platzieren ----------

  rotateGhost(dir: 1 | -1): void {
    this.ghostRot = ((((this.ghostRot + dir * 90) % 360) + 360) % 360) as Rotation
    this.syncGhost()
  }

  private ghostCache: { key: string; bp: Blueprint } | null = null

  private ghostBlueprint(target: Vec3 | null): Blueprint | null {
    if (!S.placing) return null
    const src = choiceSource()
    const ground = target ? this.groundFor(src, target, this.ghostRot, false) : undefined
    const key = JSON.stringify([src, this.ghostRot, ground])
    if (this.ghostCache?.key === key) return this.ghostCache.bp
    try {
      const bp = transformBlueprint(buildFromSource({ ...src, params: { ...src.params, ground } }), this.ghostRot)
      this.ghostCache = { key, bp }
      return bp
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
      S.placing = null
      update()
      return null
    }
  }

  private syncGhost(): void {
    if (!S.placing) {
      this.ghostMeshKey = null
      return this.scene.setGhost(null)
    }
    this.aimChanged(this.scene.aim)
  }

  private ghostMeshKey: string | null = null

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
    if (!S.placing || !a) return this.scene.moveGhost(null)
    const t = this.targetOf(a)
    const bp = this.ghostBlueprint(t)
    if (!bp) return this.scene.moveGhost(null)
    // Vorschau nur neu vermaschen, wenn sich das Bauwerk selbst geändert hat (Fundament, Variante, Drehung)
    const meshKey = `${this.ghostCache?.key}|${!!this.scene.textured}`
    if (meshKey !== this.ghostMeshKey) {
      this.ghostMeshKey = meshKey
      this.scene.setGhost(this.mesh(bp.list(), () => false, true))
    }
    this.scene.moveGhost([t[0] - bp.anchor[0], t[1] - bp.anchor[1], t[2] - bp.anchor[2]])
  }

  private clicked(a: (Aim & { face: Vec3 }) | null): void {
    if (!this.session) return
    if (S.placing) {
      if (!a) return
      const pos = this.targetOf(a)
      const src = choiceSource()
      const ground = this.groundFor(src, pos, this.ghostRot, false)
      const label = placementLabel()
      S.placing = null
      addPlacement({ ...src, params: { ...src.params, ground } }, label, pos, this.ghostRot)
      S.build.seeds = newSeeds()
      return
    }
    if (a?.placementId) {
      S.sel = { kind: 'placement', id: a.placementId }
      S.guide.layer = null
      update()
    } else if (S.sel) {
      S.sel = null
      update()
    }
  }
}

function pieceKey(x: number, z: number): string {
  return `${Math.floor(x / PIECE) * PIECE},${Math.floor(z / PIECE) * PIECE}`
}

/** Liegt ein Bauwerk (Anker) in oder neben diesem Stück? */
function near(pos: Vec3, p: { x0: number; z0: number; x1: number; z1: number }): boolean {
  return pos[0] >= p.x0 - 48 && pos[0] <= p.x1 + 48 && pos[2] >= p.z0 - 48 && pos[2] <= p.z1 + 48
}

function label(state: BlockState): string {
  return parseState(state).name.replace('minecraft:', '').replace(/_/g, ' ')
}
