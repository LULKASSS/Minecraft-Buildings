// 3D-Welt: nahes Gelände in Blöcken, die Ferne als grobe Säulen, darin die Bauwerke.
// Kamera wie bei der Marineford-Seite: ziehen = umsehen, Rad = näher/weiter, F = Flugmodus mit Fadenkreuz.
// Koordinaten in der Szene sind Weltkoordinaten minus "base", damit Float32 auch weit draußen genau bleibt.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Vec3 } from '../blueprint/blueprint'
import { parseState, shortName, type BlockState } from '../blueprint/blockstate'
import { FlyControls } from './fly'
import { DetailMask, lodMaterial, type LodMesh } from './lod'
import type { MeshData } from './mesher'
import type { TexturedMesher } from './textured'

export type CamMode = 'orbit' | 'fly'
const PIECE = 32

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
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000)
  readonly fly: FlyControls
  readonly orbit: OrbitControls
  mode: CamMode = 'orbit'
  base: Vec3 = [0, 0, 0]
  private pieces = new Map<string, THREE.Mesh>()
  private lods = new Map<string, THREE.Mesh>()
  readonly mask = new DetailMask(PIECE)
  private lodMat = lodMaterial(this.mask)
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
  onMode: (m: CamMode) => void = () => {}

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.tabIndex = 0

    this.fly = new FlyControls(this.camera, this.renderer.domElement)
    this.fly.enabled = false
    this.fly.onChange = () => {
      this.needsRender = true
      this.onMove()
    }

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.14
    this.orbit.screenSpacePanning = false
    // Rad-Zoom macht wheel() selbst: das Zoomen „zum Mauszeiger“ von OrbitControls schob den Drehpunkt
    // bei Zeiger im Himmel oder am Horizont um Tausende Blöcke weiter, bis man außerhalb der Welt stand
    this.orbit.zoomToCursor = false
    this.orbit.minDistance = 4
    this.orbit.maxDistance = 2600
    this.orbit.maxPolarAngle = Math.PI * 0.49
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    this.orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    this.orbit.addEventListener('change', () => {
      this.needsRender = true
      this.needsAim = true
      this.onMove()
    })

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
    const toNdc = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    c.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }))
    c.addEventListener('pointerup', e => {
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      down = null
      if (!click) return
      // Tippen am Handy: vorher gab es keine Mausbewegung, Ziel also aus dem Tipp selbst
      if (e.pointerType !== 'mouse' || !this.mouse) this.mouse = toNdc(e)
      this.updateAim()
      this.onClick(this.aim)
    })
    c.addEventListener('dblclick', e => {
      // Doppelklick: dorthin fliegen (auch auf die Ferne)
      if (this.mode !== 'orbit') return
      const r = c.getBoundingClientRect()
      const hit = this.pick(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), true)
      if (hit) this.glideTo(hit.point)
    })
    c.addEventListener('contextmenu', e => e.preventDefault())
    // vor OrbitControls abfangen (Capture am Elternteil), damit nur ein Zoom läuft
    host.addEventListener('wheel', e => this.wheel(e), { capture: true, passive: false })

    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000)
      this.last = t
      if (this.host.offsetParent !== null) {
        if (this.mode === 'fly' ? this.fly.update(dt) : this.walk(dt)) this.needsAim = true
        if (this.glide) this.stepGlide(dt)
        if (this.zoom) this.stepZoom()
        if (this.mode === 'orbit' && this.orbit.update()) this.needsAim = true
        this.updateFog()
        if (this.needsAim || this.mode === 'fly') {
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
    // Esc gibt die Maus frei: zurück zum Umsehen
    if (!locked && this.mode === 'fly' && this.wasLocked) this.setMode('orbit')
    this.wasLocked = locked
    this.crosshair.hidden = this.mode !== 'fly'
    this.hint.innerHTML = this.mode === 'fly'
      ? '<b>WASD</b> fliegen · <b>Leertaste</b>/<b>Shift</b> hoch/runter · <b>Strg</b> schneller · <b>Klick</b> setzen/wählen · <b>F</b> zurück'
      : '<b>Ziehen</b> umsehen · <b>Rechts ziehen</b> verschieben · <b>Rad</b> näher/weiter · <b>Doppelklick</b> hinfliegen · <b>F</b> Flugmodus mit Fadenkreuz'
    this.needsAim = true
  }

  private wasLocked = false

  /** Umsehen (Kamera kreist um einen Punkt) oder Flugmodus mit Fadenkreuz. */
  setMode(m: CamMode): void {
    if (m === this.mode) return
    this.mode = m
    this.glide = null
    if (m === 'fly') {
      this.orbit.enabled = false
      this.fly.enabled = true
      const d = new THREE.Vector3()
      this.camera.getWorldDirection(d)
      this.fly.yaw = Math.atan2(-d.x, -d.z)
      this.fly.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)))
      this.fly.apply()
      void this.fly.lock()
    } else {
      this.fly.enabled = false
      if (document.pointerLockElement) document.exitPointerLock()
      // neuer Drehpunkt: was in der Bildmitte liegt, sonst 40 Blöcke voraus
      const hit = this.pick(new THREE.Vector2(0, 0), true)
      const d = new THREE.Vector3()
      this.camera.getWorldDirection(d)
      const t = hit && hit.distance < 600 ? hit.point : this.camera.position.clone().addScaledVector(d, 40)
      this.orbit.target.copy(t)
      this.orbit.enabled = true
      this.orbit.update()
    }
    this.applyFree()
    this.lockChanged()
    this.onMode(m)
    this.needsRender = true
  }

  /** WASD im Umsehen-Modus: Drehpunkt und Kamera gemeinsam verschieben, schneller, je weiter weg. */
  private walk(dt: number): boolean {
    const k = this.fly.keys
    if (!k.size) return false
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ') ? 1 : 0)
    if (!f && !s && !u) return false
    this.glide = null
    const dist = this.camera.position.distanceTo(this.orbit.target)
    const speed = Math.max(12, dist * 0.9) * (k.has('ControlLeft') || k.has('ControlRight') ? 2.2 : 1) * dt
    const fwd = new THREE.Vector3().subVectors(this.orbit.target, this.camera.position).setY(0)
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(s))
    if (move.lengthSq()) move.normalize().multiplyScalar(speed)
    move.y = u * speed * 0.6
    this.camera.position.add(move)
    this.orbit.target.add(move)
    this.orbit.update()
    this.onMove()
    return true
  }

  private glide: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null
  /** laufender Rad-Zoom: Fixpunkt (Szene) und noch ausstehender Faktor als Logarithmus */
  private zoom: { pivot: THREE.Vector3; log: number; sx: number; sy: number; at: number } | null = null

  /**
   * Rad: näher heran zum Gelände unter dem Mauszeiger (der Punkt bleibt unter dem Zeiger stehen),
   * weiter weg immer gerade vom Drehpunkt weg. Trifft der Zeiger nichts (Himmel, ungeladen), zoomt es auf den Drehpunkt.
   * So kann der Drehpunkt nur zu echtem Gelände wandern, nie ins Leere.
   */
  private wheel(e: WheelEvent): void {
    if (this.mode !== 'orbit' || !this.orbit.enabled) return
    e.preventDefault()
    e.stopPropagation()
    this.glide = null
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
    if (e.ctrlKey) dy *= 3 // Trackpad-Zwicken liefert kleine Werte
    const log = Math.max(-0.5, Math.min(0.5, dy * 0.0012))
    const r = this.renderer.domElement.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const z = this.zoom
    // derselbe Fixpunkt, solange der Zeiger stillhält und die Geste weiterläuft (spart Strahlen gegen die Ferne)
    const same = z && Math.hypot(z.sx - sx, z.sy - sy) < 6 && performance.now() - z.at < 250 && Math.sign(z.log) === Math.sign(log)
    let pivot = same ? z!.pivot : this.orbit.target.clone()
    if (!same && log < 0) {
      const hit = this.pick(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), true)
      const dist = this.camera.position.distanceTo(this.orbit.target)
      if (hit && hit.distance < Math.max(300, dist * 3)) pivot = hit.point.clone()
    }
    this.zoom = { pivot, log: (same ? z!.log : 0) + log, sx, sy, at: performance.now() }
  }

  /** Rad-Zoom weich über ein paar Bilder verteilen. */
  private stepZoom(): void {
    const z = this.zoom!
    const step = Math.abs(z.log) < 0.002 ? z.log : z.log * 0.35
    z.log -= step
    const dist = this.camera.position.distanceTo(this.orbit.target)
    const want = Math.max(this.orbit.minDistance, Math.min(this.orbit.maxDistance, dist * Math.exp(step)))
    const k = want / dist
    // Kamera und Drehpunkt um den Fixpunkt skalieren: der Fixpunkt bleibt im Bild, wo er war
    this.camera.position.sub(z.pivot).multiplyScalar(k).add(z.pivot)
    this.orbit.target.sub(z.pivot).multiplyScalar(k).add(z.pivot)
    this.orbit.update()
    if (z.log === 0 || k === 1) this.zoom = null
    this.needsRender = true
    this.needsAim = true
    this.onMove()
  }

  /** Drehpunkt sanft an eine Stelle (Szenenkoordinaten) schieben, Kamera wandert mit. */
  private glideTo(p: THREE.Vector3): void {
    if (this.mode !== 'orbit') return
    this.glide = { from: this.orbit.target.clone(), to: p.clone(), t: 0 }
  }

  private stepGlide(dt: number): void {
    const g = this.glide!
    g.t = Math.min(1, g.t + dt / 0.6)
    const e = 1 - Math.pow(1 - g.t, 3)
    const next = g.from.clone().lerp(g.to, e)
    const delta = next.clone().sub(this.orbit.target)
    this.orbit.target.add(delta)
    this.camera.position.add(delta)
    this.orbit.update()
    this.needsRender = true
    this.needsAim = true
    this.onMove()
    if (g.t >= 1) this.glide = null
  }

  /** Zu einer Weltstelle springen: Blick schräg von oben aus dist Blöcken Abstand. */
  jumpTo(x: number, y: number, z: number, dist = 90): void {
    if (this.mode === 'fly') this.setMode('orbit')
    this.glide = null
    this.zoom = null
    const t = new THREE.Vector3(x - this.base[0], y - this.base[1], z - this.base[2])
    // schräg von oben (etwa 35°), Himmelsrichtung wie bisher; ohne Richtung von Südosten
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.orbit.target).setY(0)
    if (dir.lengthSq() < 1) dir.set(0.5, 0, 0.85)
    dir.normalize().setY(0.7).normalize().multiplyScalar(dist)
    this.orbit.target.copy(t)
    this.camera.position.copy(t).add(dir)
    this.orbit.update()
    this.needsRender = true
    this.needsAim = true
    this.onMove()
  }

  /** Kamera und Drehpunkt gemeinsam anheben/absenken (an das echte Gelände anpassen). */
  lift(dy: number): void {
    this.shift(0, dy, 0)
  }

  /** Kamera und Drehpunkt gemeinsam verschieben (im Flug nur die Kamera). */
  shift(dx: number, dy: number, dz: number): void {
    const d = new THREE.Vector3(dx, dy, dz)
    this.camera.position.add(d)
    if (this.mode === 'orbit') {
      this.orbit.target.add(d)
      this.orbit.update()
    }
    if (this.glide) {
      this.glide.from.add(d)
      this.glide.to.add(d)
    }
    if (this.zoom) this.zoom.pivot.add(d)
    this.needsRender = true
    this.needsAim = true
  }

  /**
   * Freier Bereich zwischen den Panels (CSS-Pixel im 3D-Fenster). Die Bildmitte – und damit der Drehpunkt –
   * liegt dann in seiner Mitte statt hinter einem Panel.
   */
  private free: { x: number; y: number; w: number; h: number } | null = null

  setFree(f: { x: number; y: number; w: number; h: number } | null): void {
    const k = (v: typeof f) => (v ? `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.w)},${Math.round(v.h)}` : '')
    if (k(f) === k(this.free)) return
    this.free = f
    this.applyFree()
  }

  private applyFree(): void {
    const r = this.host.getBoundingClientRect()
    const f = this.free
    if (!f || r.width < 2 || this.mode === 'fly') this.camera.clearViewOffset()
    else this.camera.setViewOffset(r.width, r.height, r.width / 2 - (f.x + f.w / 2), r.height / 2 - (f.y + f.h / 2), r.width, r.height)
    this.camera.updateProjectionMatrix()
    this.needsRender = true
    this.needsAim = true
  }

  /** Punkt, um den sich gerade alles dreht (Welt); im Flug die Kamera selbst. */
  focusWorld(): Vec3 {
    const p = this.mode === 'orbit' ? this.orbit.target : this.camera.position
    return [p.x + this.base[0], p.y + this.base[1], p.z + this.base[2]]
  }

  /** Abstand der Kamera zum Geschehen (bestimmt, wie weit Blöcke geladen werden). */
  viewDistance(): number {
    return this.mode === 'orbit' ? this.camera.position.distanceTo(this.orbit.target) : 30
  }

  /** Blickrichtung (Bogenmaß, 0 = Norden, im Uhrzeigersinn) für die Minikarte. */
  heading(): number {
    const d = new THREE.Vector3()
    this.camera.getWorldDirection(d)
    return Math.atan2(d.x, -d.z)
  }

  private fogKey = ''

  private updateFog(): void {
    const d = this.mode === 'orbit' ? this.camera.position.distanceTo(this.orbit.target) : 40
    const near = Math.max(220, d * 1.8)
    const far = Math.min(8000, Math.max(900, d * 6))
    const key = `${near | 0}|${far | 0}`
    if (key === this.fogKey) return
    this.fogKey = key
    const fog = this.scene.fog as THREE.Fog | null
    if (fog) {
      fog.near = near
      fog.far = far
    }
    this.lodMat.uniforms.fogNear.value = near
    this.lodMat.uniforms.fogFar.value = far
    this.needsRender = true
  }

  /** Bau-Ansicht: Gelände und andere Bauwerke grau (0 = normal, 1 = grau) */
  private gray = { value: 0 }
  /** Schnitt: über cutY und innerhalb von cutBox (x0, z0, x1, z1 in Szenen-Koordinaten) wird Gelände weggelassen */
  private cutBox = { value: new THREE.Vector4(0, 0, -1, -1) }
  private cutY = { value: 1e9 }
  /** Schnittfläche auf Höhe der aktuellen Ebene, halb durchsichtig (die Ebene darunter scheint durch) */
  private cutPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8c8c94, transparent: true, opacity: 0.7, depthWrite: false }),
  )
  /** Wände der Baugrube: ohne sie schaut man in das hohle, weggeschnittene Gelände und sieht den Himmel */
  private cutWalls = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x74747c, side: THREE.DoubleSide }))

  private makeMaterials(): void {
    const tex = this.textured?.texture ?? null
    const base = tex ? { map: tex, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide } : { vertexColors: true }
    const terrain = new THREE.MeshBasicMaterial({ ...base })
    terrain.onBeforeCompile = sh => {
      sh.uniforms.gray = this.gray
      sh.uniforms.cutBox = this.cutBox
      sh.uniforms.cutY = this.cutY
      sh.vertexShader = `varying vec3 vScene;\n${sh.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
        vScene = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
      sh.fragmentShader = `uniform float gray;\nuniform vec4 cutBox;\nuniform float cutY;\nvarying vec3 vScene;\n${sh.fragmentShader}`
        .replace('void main() {', `void main() {
        if (vScene.y > cutY && vScene.x > cutBox.x && vScene.x < cutBox.z && vScene.z > cutBox.y && vScene.z < cutBox.w) discard;`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum * 0.5 + 0.3), gray * 0.9);`)
    }
    this.mats = {
      normal: new THREE.MeshBasicMaterial(base),
      current: new THREE.MeshBasicMaterial({ ...base }),
      terrain,
      ghost: new THREE.MeshBasicMaterial({ ...base, transparent: true, opacity: 0.6, depthWrite: false }),
      line: new THREE.LineBasicMaterial({ color: 0x7f5fe8, transparent: true, opacity: 0.9 }),
    }
  }

  applyTheme(): void {
    const cs = getComputedStyle(document.documentElement)
    // eigener Himmel-Ton: im Dunkelmodus war der Himmel fast schwarz, ohne geladenes Gelände sah die 3D-Ansicht kaputt aus
    const sky = new THREE.Color(cs.getPropertyValue('--sky').trim() || '#ececf1')
    const accent = new THREE.Color(cs.getPropertyValue('--accent').trim() || '#7f5fe8')
    this.scene.background = sky
    this.scene.fog = new THREE.Fog(sky, 220, 900)
    this.lodMat.uniforms.fogColor.value = sky
    this.fogKey = ''
    this.mats.line.color = accent
    // nur leicht getönt: die Blöcke der aktuellen Ebene sollen erkennbar bleiben, das Raster obendrauf markiert sie
    this.mats.current.color = new THREE.Color(1, 1, 1).lerp(accent, 0.16)
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
    this.applyFree()
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

  /** Alles Gelände weg, neuer Bezugspunkt. Kamera und Drehpunkt bleiben an ihrer Weltstelle. */
  clear(base: Vec3): void {
    const [ox, oy, oz] = this.base
    this.base = base
    // Szenenkoordinaten sind relativ zu base: ohne diese Verschiebung sprang die Kamera bei jedem Neuaufbau
    // um den Abstand weiter, was den nächsten Neuaufbau auslöste – sie lief alle 0,4 s 1.700 Blöcke weiter ins Leere
    this.shift(ox - base[0], oy - base[1], oz - base[2])
    for (const m of [...this.pieces.values(), ...this.lods.values()]) {
      this.scene.remove(m)
      m.geometry.dispose()
    }
    this.pieces.clear()
    this.lods.clear()
    this.mask.center()
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id)
    this.setGhost(null)
    this.needsRender = true
  }

  /** Geländestück (32 × 32) setzen; x0/z0 in Weltkoordinaten für die Maske der Ferne. */
  setPiece(key: string, data: MeshData | null, x0?: number, z0?: number): void {
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
    if (x0 !== undefined && z0 !== undefined) this.mask.set(x0 - this.base[0] + 1, z0 - this.base[2] + 1, !!data)
    this.needsRender = true
  }

  /** Ferne einer Region setzen oder entfernen. */
  setLod(key: string, data: LodMesh | null): void {
    const old = this.lods.get(key)
    if (old) {
      this.scene.remove(old)
      old.geometry.dispose()
      this.lods.delete(key)
    }
    if (data && data.indices.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
      g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
      g.setAttribute('owner', new THREE.BufferAttribute(data.owner, 2))
      g.setIndex(new THREE.BufferAttribute(data.indices, 1))
      g.computeBoundingSphere()
      const m = new THREE.Mesh(g, this.lodMat)
      m.name = 'lod'
      this.scene.add(m)
      this.lods.set(key, m)
    }
    this.needsRender = true
  }

  lodKeys(): string[] {
    return [...this.lods.keys()]
  }

  /** Ganzes Bauwerk ins Bild (schräg von Südosten). */
  focusOn(min: Vec3, max: Vec3): void {
    const [bx, by, bz] = this.base
    const c = new THREE.Vector3((min[0] + max[0] + 1) / 2 - bx, (min[1] + max[1]) / 2 - by, (min[2] + max[2] + 1) / 2 - bz)
    const r = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) + 1
    if (this.mode === 'fly') this.setMode('orbit')
    this.glide = null
    this.zoom = null
    this.orbit.target.copy(c)
    this.camera.position.set(c.x + r * 0.9 + 4, c.y + r * 0.7 + 4, c.z + r * 1.1 + 6)
    this.orbit.update()
    this.needsRender = true
    this.onMove()
  }

  /**
   * Bau-Ansicht: Blick von Süden schräg von oben auf die Ebene y (Norden oben wie im Bauplan), so weit weg,
   * dass die Grundfläche den freien Bereich gut füllt. keep: Blickwinkel und Abstand des Nutzers behalten,
   * nur den Drehpunkt auf die Ebene setzen (beim Weiterblättern).
   */
  frameBuild(min: Vec3, max: Vec3, y: number, keep: boolean): void {
    const [bx, by, bz] = this.base
    const c = new THREE.Vector3((min[0] + max[0] + 1) / 2 - bx, y - by, (min[2] + max[2] + 1) / 2 - bz)
    if (this.mode === 'fly') this.setMode('orbit')
    this.glide = null
    this.zoom = null
    let offset: THREE.Vector3
    if (keep) offset = this.camera.position.clone().sub(this.orbit.target)
    else {
      const r = this.host.getBoundingClientRect()
      const f = this.free ?? { x: 0, y: 0, w: r.width, h: r.height }
      // Grundfläche (mit etwas Rand) soll den freien Bereich gut füllen (schräg gesehen wirkt sie kleiner)
      const span = Math.max(max[0] - min[0], max[2] - min[2]) + 5
      const px = 0.8 * Math.min(f.w, f.h)
      const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
      const dist = Math.max(14, Math.min(400, (span * r.height) / (2 * tan * Math.max(80, px))))
      const elev = THREE.MathUtils.degToRad(58), az = THREE.MathUtils.degToRad(18)
      offset = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).multiplyScalar(dist)
    }
    this.orbit.target.copy(c)
    this.camera.position.copy(c).add(offset)
    this.orbit.update()
    this.needsRender = true
    this.needsAim = true
    this.onMove()
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
  setGuide(selected: string | null, layer: number | null, single: boolean, cut: { min: Vec3; max: Vec3; y: number; walls: Float32Array } | null = null): void {
    for (const [id, b] of this.buildings) {
      const active = id === selected && layer !== null
      const other = selected !== null && id !== selected
      b.layers.forEach((g, i) => {
        const mesh = g.getObjectByName('building') as THREE.Mesh
        const grid = g.getObjectByName('grid') as THREE.LineSegments
        g.visible = !active || (single ? i === layer : i <= layer!)
        mesh.material = active && i === layer ? this.mats.current : other ? this.mats.terrain : this.mats.normal
        grid.visible = active && i === layer
      })
    }
    // Bau-Ansicht: alles außer dem gewählten Bauwerk grau, damit nur das zählt, was gebaut wird
    this.gray.value = selected ? 1 : 0
    this.lodMat.uniforms.gray.value = this.gray.value
    // Schnitt: Gelände über der aktuellen Ebene rund ums Bauwerk weglassen, damit Hang und Wasser nichts verdecken
    const [bx, by, bz] = this.base
    const m = 4
    if (cut) {
      const x0 = cut.min[0] - m - bx, z0 = cut.min[2] - m - bz, x1 = cut.max[0] + 1 + m - bx, z1 = cut.max[2] + 1 + m - bz
      this.cutBox.value.set(x0, z0, x1, z1)
      this.cutY.value = cut.y + 1 - by
      this.cutPlane.scale.set(x1 - x0, 1, z1 - z0)
      this.cutPlane.position.set((x0 + x1) / 2, cut.y - by + 0.01, (z0 + z1) / 2)
      if (!this.cutPlane.parent) this.scene.add(this.cutPlane)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(cut.walls, 3))
      this.cutWalls.geometry.dispose()
      this.cutWalls.geometry = g
      if (!this.cutWalls.parent) this.scene.add(this.cutWalls)
    } else {
      this.cutBox.value.set(0, 0, -1, -1)
      this.cutY.value = 1e9
      this.scene.remove(this.cutPlane)
      this.scene.remove(this.cutWalls)
    }
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

  /** Strahl von der Kamera: zuerst Gelände und Bauwerke, auf Wunsch auch die Ferne. */
  private pick(ndc: THREE.Vector2, far = false): THREE.Intersection | null {
    this.raycaster.setFromCamera(ndc, this.camera)
    this.raycaster.far = far ? 9000 : 600
    const targets: THREE.Object3D[] = [...this.pieces.values()]
    for (const b of this.buildings.values()) b.group.traverse(o => { if (o.name === 'building' && o.parent?.visible) targets.push(o) })
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (hit || !far) return hit ?? null
    return this.raycaster.intersectObjects([...this.lods.values()], false)[0] ?? null
  }

  private updateAim(): void {
    const ndc = this.mode === 'fly' ? new THREE.Vector2(0, 0) : this.mouse
    if (!ndc) {
      this.setAim(null)
      return
    }
    const hit = this.pick(ndc)
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
