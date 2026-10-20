// Draufsicht der Welt. Kachelweise, zoom- und verschiebbar, mit Markierungen und Grundrissen.

import { boundsOf } from '../blueprint/placement'
import { addMarker, collisions, moveMarker, placedOf, S, toast, update } from '../app/state'
import { TILE } from '../world/tile'

const MIN_ZOOM = 1 / 16
const MAX_ZOOM = 16

interface Colors {
  empty: string; grid: string; accent: string; accentSoft: string; gap: string; gapSoft: string
  surface: string; surface2: string; fg: string; fg3: string
}

export class MapView {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  cx = 0
  cz = 0
  zoom = 2
  private dirty = true
  private colors!: Colors
  private hover: { x: number; z: number } | null = null
  private drag: { mode: 'pan' | 'marker'; id?: string; sx: number; sy: number; cx: number; cz: number; moved: boolean } | null = null
  private dragPos: { x: number; z: number } | null = null
  private centeredFor: string | null = null
  onOpen3d: () => void = () => {}

  constructor(private host: HTMLElement, private readout: HTMLElement) {
    host.appendChild(this.canvas)
    this.readColors()
    new ResizeObserver(() => this.resize()).observe(host)
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.themeChanged())
    this.bind()
    const loop = () => {
      if (this.dirty) this.draw()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  themeChanged(): void {
    this.readColors()
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
  }

  /** Beim ersten Öffnen einer Welt auf den Spawn oder die Mitte springen. */
  sync(): void {
    const s = S.session
    if (s && this.centeredFor !== s.key) {
      this.centeredFor = s.key
      const sp = s.info.spawn
      if (sp) {
        this.cx = sp[0]
        this.cz = sp[2]
      } else {
        const b = s.regionBounds()
        this.cx = (b.x0 + b.x1) / 2
        this.cz = (b.z0 + b.z1) / 2
      }
      this.zoom = 2
    }
    this.invalidate()
  }

  focus(x: number, z: number, zoom?: number): void {
    this.cx = x
    this.cz = z
    if (zoom) this.zoom = zoom
    this.invalidate()
  }

  zoomBy(f: number, px?: number, py?: number): void {
    const r = this.canvas.getBoundingClientRect()
    const sx = px ?? r.width / 2, sy = py ?? r.height / 2
    const before = this.toWorld(sx, sy)
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * f))
    const after = this.toWorld(sx, sy)
    this.cx += before.x - after.x
    this.cz += before.z - after.z
    this.invalidate()
  }

  private readColors(): void {
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string) => cs.getPropertyValue(n).trim()
    this.colors = {
      empty: v('--map-empty'), grid: v('--map-grid'), accent: v('--accent'), accentSoft: v('--accent-soft'),
      gap: v('--gap'), gapSoft: v('--gap-soft'), surface: v('--surface'), surface2: v('--surface-2'), fg: v('--fg'), fg3: v('--fg-3'),
    }
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(r.width * dpr))
    this.canvas.height = Math.max(1, Math.round(r.height * dpr))
    this.invalidate()
  }

  toWorld(sx: number, sy: number): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: this.cx + (sx - r.width / 2) / this.zoom, z: this.cz + (sy - r.height / 2) / this.zoom }
  }

  toScreen(x: number, z: number): { sx: number; sy: number } {
    const r = this.canvas.getBoundingClientRect()
    return { sx: (x - this.cx) * this.zoom + r.width / 2, sy: (z - this.cz) * this.zoom + r.height / 2 }
  }

  private markerAt(sx: number, sy: number): string | null {
    for (const m of [...S.project.markers].reverse()) {
      const [x, z] = m.points[0]
      const p = this.toScreen(x + 0.5, z + 0.5)
      if (Math.hypot(p.sx - sx, p.sy - sy) < 11) return m.id
    }
    return null
  }

  private placementAt(x: number, z: number): string | null {
    for (const p of [...S.project.placements].reverse()) {
      const b = boundsOf(placedOf(p).placed)
      if (x >= b.min[0] && x < b.max[0] + 1 && z >= b.min[2] && z < b.max[2] + 1) return p.id
    }
    return null
  }

  private bind(): void {
    const c = this.canvas
    c.addEventListener('wheel', e => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      this.zoomBy(Math.pow(1.0018, -e.deltaY), e.clientX - r.left, e.clientY - r.top)
    }, { passive: false })

    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      const r = c.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      const id = this.markerAt(sx, sy)
      c.setPointerCapture(e.pointerId)
      this.drag = { mode: id ? 'marker' : 'pan', id: id ?? undefined, sx, sy, cx: this.cx, cz: this.cz, moved: false }
    })

    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      const w = this.toWorld(sx, sy)
      this.hover = { x: Math.floor(w.x), z: Math.floor(w.z) }
      this.updateReadout()
      const d = this.drag
      if (d) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true
        if (d.mode === 'pan' && d.moved) {
          this.cx = d.cx - (sx - d.sx) / this.zoom
          this.cz = d.cz - (sy - d.sy) / this.zoom
        } else if (d.mode === 'marker' && d.moved) {
          this.dragPos = { x: Math.floor(w.x), z: Math.floor(w.z) }
        }
      }
      c.style.cursor = d?.mode === 'pan' && d.moved ? 'grabbing' : this.markerAt(sx, sy) ? 'grab' : 'crosshair'
      this.invalidate()
    })

    c.addEventListener('pointerup', async e => {
      const d = this.drag
      this.drag = null
      if (!d) return
      const r = c.getBoundingClientRect()
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top)
      const x = Math.floor(w.x), z = Math.floor(w.z)
      if (d.mode === 'marker' && d.id) {
        if (d.moved) {
          const y = await this.surfaceY(x, z)
          this.dragPos = null
          if (y !== null) moveMarker(d.id, x, z, y)
        } else {
          S.sel = { kind: 'marker', id: d.id }
          update()
        }
      } else if (!d.moved) {
        const pid = this.placementAt(x, z)
        if (pid) {
          S.sel = { kind: 'placement', id: pid }
          update()
        } else if (S.session) {
          const y = await this.surfaceY(x, z)
          if (y === null) toast('Dort ist die Welt noch nicht generiert.', true)
          else addMarker(x, z, y)
        }
      }
      this.invalidate()
    })

    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect()
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top)
      const pid = this.placementAt(Math.floor(w.x), Math.floor(w.z))
      if (pid) {
        S.sel = { kind: 'placement', id: pid }
        this.onOpen3d()
      }
    })

    c.addEventListener('pointerleave', () => {
      this.hover = null
      this.updateReadout()
      this.invalidate()
    })
  }

  private async surfaceY(x: number, z: number): Promise<number | null> {
    return S.session ? S.session.surfaceAtAsync(x, z) : null
  }

  private updateReadout(): void {
    if (!this.hover || S.view !== 'map') {
      this.readout.textContent = ''
      return
    }
    const { x, z } = this.hover
    const y = S.session?.surfaceAt(x, z)
    this.readout.innerHTML = `X <b>${x}</b> · Z <b>${z}</b>${y != null ? ` · Y <b>${y}</b>` : ''}`
  }

  private draw(): void {
    this.dirty = false
    const ctx = this.ctx
    const dpr = window.devicePixelRatio || 1
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = this.colors.empty
    ctx.fillRect(0, 0, W, H)
    const s = S.session
    if (!s) return

    const tl = this.toWorld(0, 0), br = this.toWorld(W, H)
    ctx.imageSmoothingEnabled = this.zoom < 1
    let loading = false
    for (let rz = Math.floor(tl.z / TILE); rz <= Math.floor(br.z / TILE); rz++)
      for (let rx = Math.floor(tl.x / TILE); rx <= Math.floor(br.x / TILE); rx++) {
        if (!s.hasRegion(rx, rz)) continue
        const t = s.tile(rx, rz)
        const p = this.toScreen(rx * TILE, rz * TILE)
        const size = TILE * this.zoom
        if (t?.bitmap) ctx.drawImage(t.bitmap, p.sx, p.sy, size, size)
        else {
          ctx.fillStyle = this.colors.surface2
          ctx.fillRect(p.sx, p.sy, size, size)
          loading = true
        }
      }
    this.host.classList.toggle('is-loading', loading)

    // Chunk-Raster beim Reinzoomen
    if (this.zoom >= 3) {
      ctx.strokeStyle = this.colors.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = Math.floor(tl.x / 16) * 16; x <= br.x; x += 16) {
        const sx = Math.round(this.toScreen(x, 0).sx) + 0.5
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, H)
      }
      for (let z = Math.floor(tl.z / 16) * 16; z <= br.z; z += 16) {
        const sy = Math.round(this.toScreen(0, z).sy) + 0.5
        ctx.moveTo(0, sy)
        ctx.lineTo(W, sy)
      }
      ctx.stroke()
    }

    // Grundrisse
    const hits = collisions()
    for (const p of S.project.placements) {
      const b = boundsOf(placedOf(p).placed)
      const a = this.toScreen(b.min[0], b.min[2])
      const c = this.toScreen(b.max[0] + 1, b.max[2] + 1)
      const bad = hits.has(p.id)
      const sel = S.sel?.kind === 'placement' && S.sel.id === p.id
      ctx.fillStyle = bad ? this.colors.gapSoft : this.colors.accentSoft
      ctx.fillRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy)
      if (bad) this.hatch(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy, this.colors.gap)
      ctx.strokeStyle = bad ? this.colors.gap : this.colors.accent
      ctx.lineWidth = sel ? 2.5 : 1.5
      ctx.strokeRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy)
      if (c.sx - a.sx > 40) this.label(p.name, a.sx + 4, a.sy - 8, false)
    }

    // Markierungen
    for (const m of S.project.markers) {
      const dragging = this.drag?.mode === 'marker' && this.drag.id === m.id && this.dragPos
      const [x, z] = dragging ? [this.dragPos!.x, this.dragPos!.z] : m.points[0]
      const p = this.toScreen(x + 0.5, z + 0.5)
      const sel = S.sel?.kind === 'marker' && S.sel.id === m.id
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, sel ? 7 : 6, 0, Math.PI * 2)
      ctx.fillStyle = sel ? this.colors.accent : this.colors.surface
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = this.colors.accent
      ctx.stroke()
      this.label(m.name, p.sx + 12, p.sy, sel)
    }

    // Block unter der Maus
    if (this.hover && this.zoom >= 2) {
      const p = this.toScreen(this.hover.x, this.hover.z)
      ctx.strokeStyle = this.colors.fg
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1
      ctx.strokeRect(p.sx + 0.5, p.sy + 0.5, this.zoom - 1, this.zoom - 1)
      ctx.globalAlpha = 1
    }
  }

  private label(text: string, x: number, y: number, strong: boolean): void {
    const ctx = this.ctx
    ctx.font = `${strong ? 600 : 500} 12px Geist, system-ui, sans-serif`
    const w = ctx.measureText(text).width
    ctx.fillStyle = this.colors.surface
    ctx.globalAlpha = 0.92
    roundRect(ctx, x - 6, y - 10, w + 12, 20, 10)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = this.colors.fg
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 0.5)
  }

  /** 135°-Schraffur: "anders als der Rest", damit Kollisionen nicht nur an der Farbe hängen. */
  private hatch(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let d = -h; d < w; d += 6) {
      ctx.moveTo(x + d, y + h)
      ctx.lineTo(x + d + h, y)
    }
    ctx.stroke()
    ctx.restore()
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
