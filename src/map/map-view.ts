// Draufsicht der Welt. Kachelweise, zoom- und verschiebbar. Hier werden Bereiche als Rechteck aufgezogen;
// gebaut wird erst in der 3D-Ansicht des Bereichs.

import { boundsOf } from '../blueprint/placement'
import { addArea, collisions, MAX_AREA, normalizeRect, placedOf, S, toast, update } from '../app/state'
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
  private drag: { mode: 'pan' | 'rect'; sx: number; sy: number; cx: number; cz: number; wx: number; wz: number; moved: boolean } | null = null
  private rect: { x0: number; z0: number; x1: number; z1: number } | null = null
  /** Zeichenmodus: nächstes Ziehen legt einen Bereich an (auch mit gedrückter Umschalttaste). */
  drawing = false
  private centeredFor: string | null = null
  onOpen3d: (areaId: string) => void = () => {}

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

  private areaAt(x: number, z: number): string | null {
    for (const a of [...S.project.areas].reverse()) {
      if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return a.id
    }
    return null
  }

  setDrawing(on: boolean): void {
    this.drawing = on
    this.canvas.style.cursor = on ? 'crosshair' : ''
    this.host.classList.toggle('drawing', on)
    this.updateReadout()
    this.invalidate()
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
      const w = this.toWorld(sx, sy)
      c.setPointerCapture(e.pointerId)
      const rect = (this.drawing || e.shiftKey) && !!S.session
      this.drag = { mode: rect ? 'rect' : 'pan', sx, sy, cx: this.cx, cz: this.cz, wx: Math.floor(w.x), wz: Math.floor(w.z), moved: false }
    })

    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      const w = this.toWorld(sx, sy)
      this.hover = { x: Math.floor(w.x), z: Math.floor(w.z) }
      const d = this.drag
      if (d) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true
        if (d.mode === 'pan' && d.moved) {
          this.cx = d.cx - (sx - d.sx) / this.zoom
          this.cz = d.cz - (sy - d.sy) / this.zoom
        } else if (d.mode === 'rect') {
          this.rect = normalizeRect(d.wx, d.wz, this.hover.x, this.hover.z)
        }
      }
      this.updateReadout()
      c.style.cursor = this.drawing || e.shiftKey ? 'crosshair' : d?.mode === 'pan' && d.moved ? 'grabbing' : this.areaAt(this.hover.x, this.hover.z) ? 'pointer' : 'grab'
      this.invalidate()
    })

    c.addEventListener('pointerup', e => {
      const d = this.drag
      this.drag = null
      if (!d) return
      const r = c.getBoundingClientRect()
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top)
      const x = Math.floor(w.x), z = Math.floor(w.z)
      if (d.mode === 'rect') {
        const rect = normalizeRect(d.wx, d.wz, x, z)
        this.rect = null
        this.setDrawing(false)
        if (rect.x1 - rect.x0 < 3 || rect.z1 - rect.z0 < 3) {
          toast('Zum Aufziehen mit gedrückter Maus ein Rechteck ziehen.')
        } else {
          addArea(rect)
          if (rect.clipped) toast(`Auf ${MAX_AREA} × ${MAX_AREA} Blöcke begrenzt.`)
        }
      } else if (!d.moved) {
        const id = this.areaAt(x, z)
        S.sel = id ? { kind: 'area', id } : null
        update()
      }
      this.invalidate()
    })

    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect()
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top)
      const id = this.areaAt(Math.floor(w.x), Math.floor(w.z))
      if (id) this.onOpen3d(id)
    })

    c.addEventListener('pointerleave', () => {
      this.hover = null
      this.updateReadout()
      this.invalidate()
    })
  }

  private updateReadout(): void {
    if (S.view !== 'map') return
    if (this.rect) {
      const r = this.rect
      this.readout.innerHTML = `<b>${r.x1 - r.x0 + 1} × ${r.z1 - r.z0 + 1}</b> Blöcke`
      return
    }
    if (!this.hover) {
      this.readout.textContent = this.drawing ? 'Rechteck mit gedrückter Maus aufziehen' : ''
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

    // Bereiche
    for (const a of S.project.areas) {
      const p = this.toScreen(a.x0, a.z0)
      const q = this.toScreen(a.x1 + 1, a.z1 + 1)
      const sel = (S.sel?.kind === 'area' && S.sel.id === a.id) || S.openArea === a.id
      ctx.fillStyle = this.colors.accentSoft
      ctx.globalAlpha = sel ? 1 : 0.6
      ctx.fillRect(p.sx, p.sy, q.sx - p.sx, q.sy - p.sy)
      ctx.globalAlpha = 1
      ctx.strokeStyle = this.colors.accent
      ctx.lineWidth = sel ? 2.5 : 1.5
      ctx.setLineDash(sel ? [] : [6, 4])
      ctx.strokeRect(p.sx, p.sy, q.sx - p.sx, q.sy - p.sy)
      ctx.setLineDash([])
      this.label(`${a.name} · ${a.x1 - a.x0 + 1} × ${a.z1 - a.z0 + 1}`, p.sx + 8, p.sy - 14, sel)
    }

    // Grundrisse der Bauwerke
    const hits = collisions()
    for (const pl of S.project.placements) {
      const b = boundsOf(placedOf(pl).placed)
      const a = this.toScreen(b.min[0], b.min[2])
      const c = this.toScreen(b.max[0] + 1, b.max[2] + 1)
      const bad = hits.has(pl.id)
      ctx.fillStyle = bad ? this.colors.gapSoft : this.colors.accent
      ctx.globalAlpha = bad ? 1 : 0.55
      ctx.fillRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy)
      ctx.globalAlpha = 1
      if (bad) this.hatch(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy, this.colors.gap)
      ctx.strokeStyle = bad ? this.colors.gap : this.colors.accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy)
    }

    // Rechteck, das gerade aufgezogen wird
    if (this.rect) {
      const p = this.toScreen(this.rect.x0, this.rect.z0)
      const q = this.toScreen(this.rect.x1 + 1, this.rect.z1 + 1)
      ctx.fillStyle = this.colors.accentSoft
      ctx.fillRect(p.sx, p.sy, q.sx - p.sx, q.sy - p.sy)
      ctx.strokeStyle = this.colors.accent
      ctx.lineWidth = 2
      ctx.strokeRect(p.sx, p.sy, q.sx - p.sx, q.sy - p.sy)
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
