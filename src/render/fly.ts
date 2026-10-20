// Fliegen wie im Kreativmodus: WASD waagrecht, Leertaste hoch, Shift runter, Strg schneller.
// Umsehen mit der Maus: nach Klick mit Mausfang (Esc gibt frei), sonst mit gedrückter Maustaste ziehen.

import * as THREE from 'three'

const SPEED = 10.9 // Blöcke pro Sekunde, wie Kreativflug
const SPRINT = 2.2

export class FlyControls {
  yaw = 0
  pitch = -0.35
  /** gedrückte Tasten, auch wenn der Flug aus ist (die Umsehen-Kamera bewegt sich damit) */
  readonly keys = new Set<string>()
  private dragging = false
  private lastX = 0
  private lastY = 0
  enabled = true
  onChange: () => void = () => {}

  constructor(readonly camera: THREE.PerspectiveCamera, private el: HTMLElement) {
    camera.rotation.order = 'YXZ'
    window.addEventListener('keydown', e => {
      if (isTyping(e) || e.metaKey || e.altKey) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyQ', 'KeyE'].includes(e.code)) {
        this.keys.add(e.code)
        if (e.code === 'Space' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') e.preventDefault()
      }
    })
    window.addEventListener('keyup', e => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    document.addEventListener('mousemove', e => {
      if (!this.enabled) return
      if (this.locked) this.look(e.movementX, e.movementY)
      else if (this.dragging) {
        this.look((e.clientX - this.lastX) * 1.2, (e.clientY - this.lastY) * 1.2)
        this.lastX = e.clientX
        this.lastY = e.clientY
      }
    })
    el.addEventListener('pointerdown', e => {
      if (!this.enabled || e.button !== 0 || this.locked) return
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
    })
    window.addEventListener('pointerup', () => (this.dragging = false))
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el
  }

  async lock(): Promise<boolean> {
    try {
      await (this.el.requestPointerLock() as unknown as Promise<void> | undefined)
      return true
    } catch {
      return false // eingebettet oder abgelehnt: Ziehen zum Umsehen geht trotzdem
    }
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx * 0.0022
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * 0.0022))
    this.apply()
  }

  apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0)
    this.onChange()
  }

  /** Blick auf einen Punkt richten. */
  lookAt(target: THREE.Vector3): void {
    const d = target.clone().sub(this.camera.position)
    this.yaw = Math.atan2(-d.x, -d.z)
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
    this.apply()
  }

  update(dt: number): boolean {
    if (!this.enabled || this.keys.size === 0) return false
    const k = this.keys
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ') ? 1 : 0)
    if (!f && !s && !u) return false
    const speed = SPEED * (k.has('ControlLeft') || k.has('ControlRight') ? SPRINT : 1) * dt
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw)
    const len = Math.hypot(f, s) || 1
    this.camera.position.x += ((-sin * f + cos * s) / len) * speed
    this.camera.position.z += ((-cos * f - sin * s) / len) * speed
    this.camera.position.y += u * speed
    this.onChange()
    return true
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
