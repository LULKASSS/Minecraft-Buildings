// Karte zum Hinspringen: klein in der Ecke folgt sie der Kamera, groß aufgeklappt lässt sie sich verschieben.
// Zeigt, wo die Kamera steht und hinschaut, eure Spuren, die Orte mit der meisten Zeit und die Bauwerke.
// Klick = mit der 3D-Kamera dorthin.

import { boundsOf } from '../blueprint/placement'
import { collisions, placedOf, S } from '../app/state'
import { TILE } from '../world/tile'

const MIN_ZOOM = 1 / 16
const MAX_ZOOM = 8

interface Colors {
  empty: string; grid: string; accent: string; gap: string; surface: string; surface2: string; fg: string
}

export class MapView {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  cx = 0
  cz = 0
  zoom = 0.5
  private dirty = true
  private colors!: Colors
  private hover: { x: number; z: number } | null = null
  private drag: { sx: number; sy: number; cx: number; cz: number; moved: boolean } | null = null
  /** groß aufgeklappt: frei verschiebbar und lädt selbst Kacheln */
  big = false
  /** Kamera der 3D-Ansicht (Welt) und Blickrichtung */
  private cam: { x: number; z: number; heading: number } | null = null
  onJump: (x: number, z: number) => void = () => {}

  constructor(private host: HTMLElement, private readout: HTMLElement | null = null) {
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

  setBig(on: boolean): void {
    this.big = on
    if (on) this.zoom = Math.max(this.zoom, 0.5)
    else this.zoom = 0.5
    if (this.cam) this.focus(this.cam.x, this.cam.z)
    this.invalidate()
  }

  /** 3D-Kamera nachführen; klein bleibt die Karte darauf zentriert. */
  setCamera(x: number, z: number, heading: number): void {
    this.cam = { x, z, heading }
    if (!this.big) {
      this.cx = x
      this.cz = z
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
    if (this.big) {
      const after = this.toWorld(sx, sy)
      this.cx += before.x - after.x
      this.cz += before.z - after.z
    }
    this.invalidate()
  }

  private readColors(): void {
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string) => cs.getPropertyValue(n).trim()
    this.colors = {
      empty: v('--map-empty'), grid: v('--map-grid'), accent: v('--accent'), gap: v('--gap'),
      surface: v('--surface'), surface2: v('--surface-2'), fg: v('--fg'),
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
      c.setPointerCapture(e.pointerId)
      this.drag = { sx: e.clientX - r.left, sy: e.clientY - r.top, cx: this.cx, cz: this.cz, moved: false }
    })

    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      const w = this.toWorld(sx, sy)
      this.hover = { x: Math.floor(w.x), z: Math.floor(w.z) }
      const d = this.drag
      if (d) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true
        if (d.moved && this.big) {
          this.cx = d.cx - (sx - d.sx) / this.zoom
          this.cz = d.cz - (sy - d.sy) / this.zoom
        }
      }
      this.updateReadout()
      c.style.cursor = d?.moved && this.big ? 'grabbing' : 'pointer'
      this.invalidate()
    })

    c.addEventListener('pointerup', e => {
      const d = this.drag
      this.drag = null
      if (!d || d.moved) return
      const r = c.getBoundingClientRect()
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top)
      this.onJump(Math.floor(w.x), Math.floor(w.z))
    })

    c.addEventListener('pointerleave', () => {
      this.hover = null
      this.updateReadout()
      this.invalidate()
    })
  }

  private updateReadout(): void {
    if (!this.readout) return
    if (!this.hover || !this.big) {
      this.readout.textContent = ''
      return
    }
    const { x, z } = this.hover
    const y = S.session?.surfaceAt(x, z)
    const c = S.traces ? S.session?.chunkAt(x, z) : null
    const here = c && c.secs >= 60 ? ` · <span class="muted">${duration(c.secs)} hier</span>` : ''
    this.readout.innerHTML = `X <b>${x}</b> · Z <b>${z}</b>${y != null ? ` · Y <b>${y}</b>` : ''}${here}`
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
    if (!s || W < 4) return

    const tl = this.toWorld(0, 0), br = this.toWorld(W, H)
    const rx0 = Math.floor(tl.x / TILE), rx1 = Math.floor(br.x / TILE), rz0 = Math.floor(tl.z / TILE), rz1 = Math.floor(br.z / TILE)
    // groß und verschoben: die Karte bestimmt, was zuerst lädt
    if (this.big) s.setView(this.cx, this.cz, rx0, rz0, rx1, rz1)
    ctx.imageSmoothingEnabled = this.zoom < 1
    const size = TILE * this.zoom
    for (let rz = rz0; rz <= rz1; rz++)
      for (let rx = rx0; rx <= rx1; rx++) {
        const t = s.tile(rx, rz)
        if (!t) continue
        const p = this.toScreen(rx * TILE, rz * TILE)
        if (t.bitmap) ctx.drawImage(t.bitmap, p.sx, p.sy, size, size)
        else {
          ctx.fillStyle = this.colors.surface2
          ctx.fillRect(p.sx, p.sy, size, size)
          if (t.state === 'error') this.hatch(p.sx, p.sy, size, size, this.colors.gap)
        }
      }

    // Spuren: wo ihr wart (zart) und wo oben Gebautes liegt (kräftig)
    if (S.traces) {
      ctx.imageSmoothingEnabled = false
      for (let rz = rz0; rz <= rz1; rz++)
        for (let rx = rx0; rx <= rx1; rx++) {
          const t = s.tiles.get(`${rx},${rz}`)
          if (!t?.trace) continue
          const p = this.toScreen(rx * TILE, rz * TILE)
          ctx.drawImage(t.trace, p.sx, p.sy, size, size)
        }
    }

    // Bauwerke
    const hits = collisions()
    for (const pl of S.project.placements) {
      const b = boundsOf(placedOf(pl).placed)
      const a = this.toScreen(b.min[0], b.min[2])
      const c = this.toScreen(b.max[0] + 1, b.max[2] + 1)
      const w = Math.max(3, c.sx - a.sx), h = Math.max(3, c.sy - a.sy)
      ctx.fillStyle = hits.has(pl.id) ? this.colors.gap : this.colors.accent
      ctx.globalAlpha = S.sel?.id === pl.id ? 1 : 0.75
      ctx.fillRect(a.sx, a.sy, w, h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = this.colors.surface
      ctx.lineWidth = 1
      ctx.strokeRect(a.sx - 0.5, a.sy - 0.5, w + 1, h + 1)
    }

    if (S.traces) {
      s.hotspots().forEach((h, i) => {
        const p = this.toScreen(h.x, h.z)
        if (p.sx < -20 || p.sy < -20 || p.sx > W + 20 || p.sy > H + 20) return
        this.pin(p.sx, p.sy, String(i + 1), this.big ? 11 : 8)
      })
    }

    // Kamera: Punkt mit Blickkegel
    if (this.cam) {
      const p = this.toScreen(this.cam.x, this.cam.z)
      const a = this.cam.heading
      const len = this.big ? 26 : 18
      ctx.save()
      ctx.translate(p.sx, p.sy)
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, len, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5)
      ctx.closePath()
      ctx.fillStyle = this.colors.fg
      ctx.globalAlpha = 0.18
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.restore()
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2)
      ctx.fillStyle = this.colors.fg
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = this.colors.surface
      ctx.stroke()
    }
  }

  /** Nummerierte Stecknadel für einen Ort aus „Hier wart ihr am meisten“. */
  private pin(x: number, y: number, text: string, r: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = this.colors.accent
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = this.colors.surface
    ctx.stroke()
    ctx.fillStyle = this.colors.surface
    ctx.font = `600 ${r > 9 ? 12 : 10}px Geist, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + 0.5)
    ctx.textAlign = 'start'
  }

  /** 135°-Schraffur: "anders als der Rest", damit Fehler nicht nur an der Farbe hängen. */
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

/** Spielzeit lesbar: „40 Min.“, „3 Std.“, „120 Std.“ */
export function duration(secs: number): string {
  const m = secs / 60
  if (m < 60) return `${Math.round(m)} Min.`
  const h = m / 60
  return `${h < 10 ? h.toFixed(1).replace('.', ',') : Math.round(h)} Std.`
}
