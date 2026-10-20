// 3D-Ansicht eines Bereichs: das ganze Gelände in Stücken, frei durchfliegbar, darin die Bauwerke.
// Koordinaten in der Szene sind Weltkoordinaten minus "base", damit Float32 auch weit draußen genau bleibt.

import * as THREE from 'three'
import type { Vec3 } from '../blueprint/blueprint'
import { parseState, shortName, type BlockState } from '../blueprint/blockstate'
import { FlyControls } from './fly'
import type { MeshData } from './mesher'
import type { TexturedMesher } from './textured'

export interface Aim {
  /** getroffener Block in Weltkoordinaten */
  x: number
  y: number
  z: number
  state: BlockState | null
  /** Bauwerk, falls der Block zu einem gehört */
  placementId: string | null
}

export interface BuildingMeshes {
  /** eine Geometrie pro Schicht, Koordinaten relativ zu base */
  layers: MeshData[]
  /** Gitterlinien je Schicht (Oberseiten der Blöcke) */
  grids: Float32Array[]
}

export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200)
  readonly fly: FlyControls
  base: Vec3 = [0, 0, 0]
  private pieces = new Map<string, THREE.Mesh>()
  private buildings = new Map<string, { key: string; group: THREE.Group; layers: THREE.Group[] }>()
  private ghost: THREE.Group | null = null
  private outline: THREE.LineSegments
  private crosshair: HTMLElement
  private hint: HTMLElement
  private needsRender = true
  private mats!: { normal: THREE.Material; current: THREE.MeshBasicMaterial; terrain: THREE.MeshBasicMaterial; ghost: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial }
  private raycaster = new THREE.Raycaster()
  private mouse: THREE.Vector2 | null = null
  private last = performance.now()
  private frame = 0
  textured: TexturedMesher | null = null
  /** Block unter dem Fadenkreuz bzw. Mauszeiger (welche Seite getroffen wurde in "face") */
  aim: (Aim & { face: Vec3 }) | null = null
  onAim: (a: (Aim & { face: Vec3 }) | null) => void = () => {}
  onClick: (a: (Aim & { face: Vec3 }) | null) => void = () => {}
  onMove: () => void = () => {}

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.tabIndex = 0

    this.fly = new FlyControls(this.camera, this.renderer.domElement)
    this.fly.onChange = () => {
      this.needsRender = true
      this.onMove()
    }

    this.makeMaterials()
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))
    edges.translate(0.5, 0.5, 0.5)
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }))
    this.outline.visible = false
    this.scene.add(this.outline)

    this.crosshair = document.createElement('div')
    this.crosshair.className = 'crosshair'
    this.crosshair.hidden = true
    host.appendChild(this.crosshair)
    this.hint = document.createElement('div')
    this.hint.className = 'fly-hint'
    host.appendChild(this.hint)
    document.addEventListener('pointerlockchange', () => this.lockChanged())
    this.lockChanged()

    this.applyTheme()
    new ResizeObserver(() => this.resize()).observe(host)

    const c = this.renderer.domElement
    let down: { x: number; y: number } | null = null
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect()
      this.mouse = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      this.needsAim = true
    })
    c.addEventListener('pointerleave', () => {
      this.mouse = null
      this.needsAim = true
    })
    c.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }))
    c.addEventListener('pointerup', e => {
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      down = null
      if (!click) return
      this.updateAim()
      this.onClick(this.aim)
    })
    c.addEventListener('dblclick', () => void this.fly.lock())

    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000)
      this.last = t
      if (this.host.offsetParent !== null) {
        if (this.fly.update(dt)) this.needsAim = true
        if (this.needsAim || this.fly.locked) {
          if (++this.frame % 2 === 0 || this.needsAim) this.updateAim()
          this.needsAim = false
        }
        if (this.needsRender) {
          this.needsRender = false
          this.renderer.render(this.scene, this.camera)
        }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  private needsAim = false

  private lockChanged(): void {
    const locked = this.fly.locked
    this.crosshair.hidden = !locked
    this.hint.innerHTML = locked
      ? '<b>WASD</b> fliegen · <b>Leertaste</b>/<b>Shift</b> hoch/runter · <b>Strg</b> schneller · <b>Esc</b> Maus frei'
      : '<b>Ziehen</b> umsehen · <b>WASD</b> fliegen · <b>Leertaste</b>/<b>Shift</b> hoch/runter · <b>Doppelklick</b> Maus fangen'
    this.needsAim = true
  }

  private makeMaterials(): void {
    const tex = this.textured?.texture ?? null
    const base = tex ? { map: tex, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide } : { vertexColors: true }
    this.mats = {
      normal: new THREE.MeshBasicMaterial(base),
      current: new THREE.MeshBasicMaterial({ ...base }),
      terrain: new THREE.MeshBasicMaterial({ ...base }),
      ghost: new THREE.MeshBasicMaterial({ ...base, transparent: true, opacity: 0.6, depthWrite: false }),
      line: new THREE.LineBasicMaterial({ color: 0x7f5fe8, transparent: true, opacity: 0.9 }),
    }
  }

  applyTheme(): void {
    const cs = getComputedStyle(document.documentElement)
    const sky = new THREE.Color(cs.getPropertyValue('--stage').trim() || '#ececf1')
    const accent = new THREE.Color(cs.getPropertyValue('--accent').trim() || '#7f5fe8')
    this.scene.background = sky
    this.scene.fog = new THREE.Fog(sky, 160, 420)
    this.mats.line.color = accent
    this.mats.current.color = new THREE.Color(1, 1, 1).lerp(accent, 0.42)
    this.needsRender = true
  }

  setTextures(t: TexturedMesher | null): void {
    this.textured = t
    this.makeMaterials()
    this.applyTheme()
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return
    this.renderer.setSize(r.width, r.height, false)
    this.camera.aspect = r.width / r.height
    this.camera.updateProjectionMatrix()
    this.needsRender = true
  }

  private geometry(d: MeshData): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3))
    if (d.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(d.indices, 1))
    g.computeBoundingSphere()
    return g
  }

  // ---------- Gelände ----------

  clear(base: Vec3): void {
    this.base = base
    for (const m of this.pieces.values()) {
      this.scene.remove(m)
      m.geometry.dispose()
    }
    this.pieces.clear()
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id)
    this.setGhost(null)
    this.needsRender = true
  }

  setPiece(key: string, data: MeshData | null): void {
    const old = this.pieces.get(key)
    if (old) {
      this.scene.remove(old)
      old.geometry.dispose()
      this.pieces.delete(key)
    }
    if (data && data.indices.length) {
      const m = new THREE.Mesh(this.geometry(data), this.mats.terrain)
      m.name = 'terrain'
      m.userData.piece = key
      this.scene.add(m)
      this.pieces.set(key, m)
    }
    this.needsRender = true
  }

  /** Kamera an den Rand des Bereichs stellen, Blick zur Mitte. */
  overview(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const [bx, by, bz] = this.base
    const cx = (x0 + x1) / 2 - bx, cz = (z0 + z1) / 2 - bz
    const span = Math.max(x1 - x0, z1 - z0)
    this.camera.position.set(cx, y - by + Math.max(24, span * 0.35), z1 - bz + Math.max(10, span * 0.15))
    this.fly.lookAt(new THREE.Vector3(cx, y - by, cz))
  }

  focusOn(min: Vec3, max: Vec3): void {
    const [bx, by, bz] = this.base
    const c = new THREE.Vector3((min[0] + max[0] + 1) / 2 - bx, (min[1] + max[1]) / 2 - by, (min[2] + max[2] + 1) / 2 - bz)
    const r = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) + 1
    this.camera.position.set(c.x + r * 0.9 + 4, c.y + r * 0.7 + 4, c.z + r * 1.1 + 6)
    this.fly.lookAt(c)
  }

  /** Weltposition der Kamera, wie F3 im Spiel. */
  cameraWorld(): Vec3 {
    const p = this.camera.position
    return [Math.floor(p.x + this.base[0]), Math.floor(p.y + this.base[1]), Math.floor(p.z + this.base[2])]
  }

  // ---------- Bauwerke ----------

  setBuilding(id: string, key: string, meshes: BuildingMeshes): void {
    const old = this.buildings.get(id)
    if (old?.key === key) return
    if (old) this.removeBuilding(id)
    const group = new THREE.Group()
    const layers = meshes.layers.map((d, i) => {
      const g = new THREE.Group()
      const mesh = new THREE.Mesh(this.geometry(d), this.mats.normal)
      mesh.name = 'building'
      mesh.userData.placementId = id
      g.add(mesh)
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.BufferAttribute(meshes.grids[i], 3))
      const lines = new THREE.LineSegments(lg, this.mats.line)
      lines.name = 'grid'
      lines.visible = false
      g.add(lines)
      group.add(g)
      return g
    })
    this.scene.add(group)
    this.buildings.set(id, { key, group, layers })
    this.needsRender = true
  }

  removeBuilding(id: string): void {
    const b = this.buildings.get(id)
    if (!b) return
    this.scene.remove(b.group)
    b.group.traverse(o => (o as THREE.Mesh).geometry?.dispose())
    this.buildings.delete(id)
    this.needsRender = true
  }

  buildingIds(): string[] {
    return [...this.buildings.keys()]
  }

  /** Schicht-Ansicht für ein Bauwerk: null = ganz; sonst bis einschließlich layer bzw. nur layer. */
  setGuide(selected: string | null, layer: number | null, single: boolean): void {
    for (const [id, b] of this.buildings) {
      const active = id === selected && layer !== null
      b.layers.forEach((g, i) => {
        const mesh = g.getObjectByName('building') as THREE.Mesh
        const grid = g.getObjectByName('grid') as THREE.LineSegments
        g.visible = !active || (single ? i === layer : i <= layer!)
        mesh.material = active && i === layer ? this.mats.current : this.mats.normal
        grid.visible = active && i === layer
      })
    }
    this.mats.terrain.color.setScalar(layer === null ? 1 : 0.72)
    this.needsRender = true
  }

  // ---------- Vorschau beim Platzieren ----------

  setGhost(data: MeshData | null): void {
    if (this.ghost) {
      this.scene.remove(this.ghost)
      this.ghost.traverse(o => (o as THREE.Mesh).geometry?.dispose())
      this.ghost = null
    }
    if (data) {
      this.ghost = new THREE.Group()
      this.ghost.add(new THREE.Mesh(this.geometry(data), this.mats.ghost))
      this.ghost.visible = false
      this.scene.add(this.ghost)
    }
    this.needsRender = true
  }

  /** Vorschau so legen, dass ihre kleinste Ecke auf der Weltposition origin liegt. */
  moveGhost(origin: Vec3 | null): void {
    if (!this.ghost) return
    this.ghost.visible = !!origin
    if (origin) this.ghost.position.set(origin[0] - this.base[0], origin[1] - this.base[1], origin[2] - this.base[2])
    this.needsRender = true
  }

  // ---------- Zielen ----------

  private updateAim(): void {
    const ndc = this.fly.locked ? new THREE.Vector2(0, 0) : this.mouse
    if (!ndc) {
      this.setAim(null)
      return
    }
    this.raycaster.setFromCamera(ndc, this.camera)
    this.raycaster.far = 300
    const targets: THREE.Object3D[] = [...this.pieces.values()]
    for (const b of this.buildings.values()) b.group.traverse(o => { if (o.name === 'building' && o.parent?.visible) targets.push(o) })
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit?.face) {
      this.setAim(null)
      return
    }
    const n = hit.face.normal
    const p = hit.point.clone().addScaledVector(n, -0.01)
    const x = Math.floor(p.x) + this.base[0], y = Math.floor(p.y) + this.base[1], z = Math.floor(p.z) + this.base[2]
    this.setAim({ x, y, z, state: null, placementId: (hit.object.userData.placementId as string) ?? null, face: [Math.round(n.x), Math.round(n.y), Math.round(n.z)] })
  }

  private setAim(a: (Aim & { face: Vec3 }) | null): void {
    const same = a && this.aim && a.x === this.aim.x && a.y === this.aim.y && a.z === this.aim.z && a.placementId === this.aim.placementId
    this.aim = a
    this.outline.visible = !!a
    if (a) this.outline.position.set(a.x - this.base[0], a.y - this.base[1], a.z - this.base[2])
    this.needsRender = true
    if (!same) this.onAim(a)
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }
}

export function blockLabel(state: BlockState): string {
  return shortName(parseState(state).name).replace(/_/g, ' ')
}
