// 3D-Vorschau: Gelände rund um das Bauwerk, das Bauwerk Schicht für Schicht.
// Koordinaten in der Szene sind Weltkoordinaten minus "base", damit Float32 auch weit draußen genau bleibt.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Vec3 } from '../blueprint/blueprint'
import { shortName, parseState, type BlockState } from '../blueprint/blockstate'
import type { Layer, Placed } from '../blueprint/placement'
import type { AreaResult } from '../world/area'
import { meshFallback, type MeshData, type VoxelBlock } from './mesher'
import { isOpaqueCube } from './shapes'
import type { TexturedMesher } from './textured'

export interface Hover {
  x: number
  y: number
  z: number
  state: BlockState
  part: 'building' | 'terrain'
}

export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
  private controls: OrbitControls
  private base: Vec3 = [0, 0, 0]
  private terrain: THREE.Mesh | null = null
  private layerMeshes: THREE.Group[] = []
  private terrainLookup: ((x: number, y: number, z: number) => BlockState | null) | null = null
  private buildingLookup = new Map<string, BlockState>()
  private needsRender = true
  private mats: { normal: THREE.Material; current: THREE.Material; terrain: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial }
  private raycaster = new THREE.Raycaster()
  private lastFit: string | null = null
  textured: TexturedMesher | null = null
  onHover: (h: Hover | null) => void = () => {}

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.addEventListener('change', () => (this.needsRender = true))
    this.mats = this.makeMaterials()
    this.applyTheme()
    new ResizeObserver(() => this.resize()).observe(host)
    this.renderer.domElement.addEventListener('pointermove', e => this.pick(e))
    this.renderer.domElement.addEventListener('pointerleave', () => this.onHover(null))
    const loop = () => {
      if (this.controls.update() || this.needsRender) {
        this.needsRender = false
        this.renderer.render(this.scene, this.camera)
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  private makeMaterials() {
    const tex = this.textured?.texture ?? null
    const opts = tex ? { map: tex, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide } : { vertexColors: true }
    return {
      normal: new THREE.MeshBasicMaterial(opts),
      current: new THREE.MeshBasicMaterial({ ...opts, color: new THREE.Color(1, 1, 1) }),
      terrain: new THREE.MeshBasicMaterial({ ...opts }),
      line: new THREE.LineBasicMaterial({ color: 0x7f5fe8, transparent: true, opacity: 0.9 }),
    }
  }

  applyTheme(): void {
    const cs = getComputedStyle(document.documentElement)
    const bg = new THREE.Color(cs.getPropertyValue('--stage').trim() || '#ececf1')
    const accent = new THREE.Color(cs.getPropertyValue('--accent').trim() || '#7f5fe8')
    this.scene.background = bg
    this.scene.fog = new THREE.Fog(bg, 80, 220)
    this.mats.line.color = accent
    ;(this.mats.current as THREE.MeshBasicMaterial).color = new THREE.Color(1, 1, 1).lerp(accent, 0.42)
    this.needsRender = true
  }

  setTextures(t: TexturedMesher | null): void {
    this.textured = t
    this.mats = this.makeMaterials()
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

  private toGeometry(d: MeshData): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3))
    if (d.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(d.indices, 1))
    return g
  }

  private mesh(blocks: VoxelBlock[], occludes: (x: number, y: number, z: number) => boolean, keepTop = false): MeshData {
    return this.textured ? this.textured.mesh(blocks, occludes, keepTop) : meshFallback(blocks, { occludes, keepTop })
  }

  /** Gelände setzen. Blöcke, an denen das Bauwerk etwas setzt, werden ausgespart. */
  setScene(area: AreaResult | null, placed: Placed, layers: Layer[]): void {
    const [bx, by, bz] = placed.origin
    this.base = area ? [area.box.x0, area.box.y0, area.box.z0] : [bx - 16, by - 8, bz - 16]
    const [ox, oy, oz] = this.base

    this.buildingLookup.clear()
    for (const l of layers) for (const b of l.blocks) this.buildingLookup.set(`${b.x},${b.y},${b.z}`, b.state)

    // Gelände
    if (this.terrain) {
      this.scene.remove(this.terrain)
      this.terrain.geometry.dispose()
      this.terrain = null
    }
    this.terrainLookup = null
    if (area) {
      const { box, palette, data } = area
      const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1
      const at = (x: number, y: number, z: number): BlockState | null => {
        if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) return null
        const v = data[((y - box.y0) * d + (z - box.z0)) * w + (x - box.x0)]
        return v ? palette[v] : null
      }
      this.terrainLookup = at
      const opaque = palette.map(s => isOpaqueCube(s))
      const blocks: VoxelBlock[] = []
      let i = 0
      for (let y = box.y0; y <= box.y1; y++)
        for (let z = box.z0; z <= box.z1; z++)
          for (let x = box.x0; x <= box.x1; x++, i++) {
            const v = data[i]
            if (!v || this.buildingLookup.has(`${x},${y},${z}`)) continue
            blocks.push({ x: x - ox, y: y - oy, z: z - oz, state: palette[v] })
          }
      const occ = (x: number, y: number, z: number) => {
        const wx = x + ox, wy = y + oy, wz = z + oz
        if (wx < box.x0 || wx > box.x1 || wz < box.z0 || wz > box.z1) return true // Rand zu, spart Flächen
        if (wy < box.y0) return true
        if (wy > box.y1) return false
        if (this.buildingLookup.has(`${wx},${wy},${wz}`)) return false
        const v = data[((wy - box.y0) * d + (wz - box.z0)) * w + (wx - box.x0)]
        return v !== 0 && opaque[v]
      }
      this.terrain = new THREE.Mesh(this.toGeometry(this.mesh(blocks, occ)), this.mats.terrain)
      this.terrain.name = 'terrain'
      this.scene.add(this.terrain)
    }
    this.setBuilding(placed, layers)
  }

  /** Nur das Bauwerk neu (nach Drehen/Verschieben, wenn das Gelände-Stück noch reicht). */
  setBuilding(placed: Placed, layers: Layer[]): void {
    const [ox, oy, oz] = this.base
    for (const g of this.layerMeshes) {
      this.scene.remove(g)
      g.traverse(o => (o as THREE.Mesh).geometry?.dispose())
    }
    this.layerMeshes = []
    this.buildingLookup.clear()
    for (const l of layers) for (const b of l.blocks) this.buildingLookup.set(`${b.x},${b.y},${b.z}`, b.state)
    const solid = new Set<string>()
    for (const [k, s] of this.buildingLookup) if (isOpaqueCube(s)) solid.add(k)

    for (const l of layers) {
      const g = new THREE.Group()
      g.name = `layer-${l.index}`
      const blocks = l.blocks.map(b => ({ x: b.x - ox, y: b.y - oy, z: b.z - oz, state: b.state }))
      const occ = (x: number, y: number, z: number) => {
        const wx = x + ox, wy = y + oy, wz = z + oz
        if (wy > l.y) return false // darüber kann ausgeblendet sein
        if (solid.has(`${wx},${wy},${wz}`)) return true
        const t = this.terrainLookup?.(wx, wy, wz)
        return wy < l.y && !!t && isOpaqueCube(t) && !this.buildingLookup.has(`${wx},${wy},${wz}`)
      }
      const mesh = new THREE.Mesh(this.toGeometry(this.mesh(blocks, occ, true)), this.mats.normal)
      mesh.name = 'building'
      g.add(mesh)
      // Raster auf der Oberseite der Blöcke, damit man in der aktuellen Schicht zählen kann
      const pts: number[] = []
      for (const b of blocks) {
        const y = b.y + 1.002
        pts.push(b.x, y, b.z, b.x + 1, y, b.z, b.x + 1, y, b.z, b.x + 1, y, b.z + 1,
          b.x + 1, y, b.z + 1, b.x, y, b.z + 1, b.x, y, b.z + 1, b.x, y, b.z)
      }
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const lines = new THREE.LineSegments(lg, this.mats.line)
      lines.visible = false
      lines.name = 'grid'
      g.add(lines)
      this.layerMeshes.push(g)
      this.scene.add(g)
    }

    const key = `${placed.placement.id}`
    if (this.lastFit !== key) {
      this.lastFit = key
      this.fit(placed)
    }
    this.needsRender = true
  }

  fit(placed: Placed): void {
    const [w, h, d] = placed.blueprint.size
    const [x, y, z] = placed.origin
    const c = new THREE.Vector3(x - this.base[0] + w / 2, y - this.base[1] + h / 3, z - this.base[2] + d / 2)
    const r = Math.max(w, h, d)
    const dist = r * 1.05 + 9
    this.controls.target.copy(c)
    this.camera.position.set(c.x + dist * 0.75, c.y + dist * 0.7, c.z + dist)
    this.controls.update()
    this.needsRender = true
  }

  /** Schicht-Ansicht: null = ganzes Bauwerk; sonst bis einschließlich layer, bzw. nur layer. */
  setGuide(layer: number | null, single: boolean): void {
    this.layerMeshes.forEach((g, i) => {
      const mesh = g.getObjectByName('building') as THREE.Mesh
      const grid = g.getObjectByName('grid') as THREE.LineSegments
      if (layer === null) {
        g.visible = true
        mesh.material = this.mats.normal
        grid.visible = false
        return
      }
      g.visible = single ? i === layer : i <= layer
      mesh.material = i === layer ? this.mats.current : this.mats.normal
      grid.visible = i === layer
    })
    this.mats.terrain.color.setScalar(layer === null ? 1 : 0.72)
    this.needsRender = true
  }

  private pick(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = []
    for (const g of this.layerMeshes) if (g.visible) targets.push(g.getObjectByName('building')!)
    if (this.terrain) targets.push(this.terrain)
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit || !hit.face) return this.onHover(null)
    const p = hit.point.clone().addScaledVector(hit.face.normal, -0.01)
    const x = Math.floor(p.x) + this.base[0], y = Math.floor(p.y) + this.base[1], z = Math.floor(p.z) + this.base[2]
    const inBuilding = hit.object.name === 'building'
    const state = inBuilding ? this.buildingLookup.get(`${x},${y},${z}`) : this.terrainLookup?.(x, y, z)
    this.onHover(state ? { x, y, z, state, part: inBuilding ? 'building' : 'terrain' } : null)
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }
}

export function blockLabel(state: BlockState): string {
  return shortName(parseState(state).name).replace(/_/g, ' ')
}
