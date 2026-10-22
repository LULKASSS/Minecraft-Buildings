// Bau-Ansicht rechts: Ebene für Ebene mit Bauplan von oben, Material zum Abhaken und Fortschritt.
// Die 3D-Ansicht daneben zeigt das Bauwerk bis zur aktuellen Ebene, die aktuelle leuchtet, das Gelände ist grau.

import { formatPacking, materialsOf, type MaterialRow } from '../blueprint/materials'
import type { Layer, Placement } from '../blueprint/placement'
import { changePlacement, placedOf, S, selectedPlacement, update } from '../app/state'
import { coord, esc, itemLabel, num } from './format'
import { I } from './icons'
import { itemsFor } from '../blueprint/materials'
import { cellAt, drawIcon, drawPlan, stateHint, usesItem, type PlanGrid, type PlanLook } from './plan'

let timer: number | undefined

const key = (layer: number, item: string) => `${layer}|${item}`

export function isChecked(p: Placement, layer: number, item: string): boolean {
  return !!p.checks?.includes(key(layer, item))
}

export function layerDone(p: Placement, l: Layer): boolean {
  return l.materials.length > 0 && l.materials.every(m => isChecked(p, l.index, m.item))
}

/** Erste Ebene, in der noch etwas fehlt (leere Ebenen zählen nicht). */
export function firstOpenLayer(p: Placement): number {
  const { layers } = placedOf(p)
  const i = layers.findIndex(l => l.blocks.length > 0 && !layerDone(p, l))
  return i < 0 ? 0 : i
}

function toggle(p: Placement, layer: number, item: string): void {
  changePlacement(p.id, q => {
    const set = new Set(q.checks ?? [])
    const k = key(layer, item)
    if (set.has(k)) set.delete(k)
    else set.add(k)
    q.checks = [...set]
  })
}

/** Ganze Ebene abhaken und zur nächsten offenen springen. */
function finishLayer(p: Placement, l: Layer, count: number): void {
  changePlacement(p.id, q => {
    const set = new Set(q.checks ?? [])
    const all = l.materials.every(m => set.has(key(l.index, m.item)))
    for (const m of l.materials) all ? set.delete(key(l.index, m.item)) : set.add(key(l.index, m.item))
    q.checks = [...set]
    if (!all) S.guide.layer = Math.min(count - 1, l.index + 1)
  })
}

let grid: PlanGrid | null = null

export function renderGuide(el: HTMLElement, look: PlanLook): void {
  const p = selectedPlacement()
  el.hidden = !p
  if (!p) {
    stop()
    return
  }
  const { placed, layers } = placedOf(p)
  const g = S.guide
  if (g.layer !== null && g.layer >= layers.length) g.layer = layers.length - 1
  const cur = g.layer === null ? null : layers[g.layer]
  const max = Math.max(...layers.map(l => l.blocks.length), 1)
  const done = layers.filter(l => l.blocks.length && layerDone(p, l)).length
  const filled = layers.filter(l => l.blocks.length).length

  const ticks = layers.map((l, i) => {
    const cls = [g.layer === i ? 'cur' : '', layerDone(p, l) ? 'ok' : ''].join(' ')
    const hgt = 6 + (l.blocks.length / max) * 26
    return `<button class="tick ${cls}" data-layer="${i}" title="Ebene ${i + 1} · Y ${l.y} · ${l.blocks.length} Blöcke${layerDone(p, l) ? ' · fertig' : ''}">
      <span class="bar" style="height:${hgt}px"></span></button>`
  }).join('')

  const total = layers.reduce((n, l) => n + l.blocks.length, 0)
  const head = cur
    ? `<div class="g-layer">Ebene ${cur.index + 1}<small>/ ${layers.length}</small></div>
       <div class="g-info"><b>Y ${coord(cur.y)}</b> · ${num(cur.blocks.length)} ${cur.blocks.length === 1 ? 'Block' : 'Blöcke'}${layerDone(p, cur) ? ' · <span class="ok-txt">fertig</span>' : ''}</div>`
    : `<div class="g-layer">Ganzes Bauwerk<small>${layers.length} Ebenen</small></div>
       <div class="g-info"><b>${num(total)} Blöcke</b> · Y ${coord(layers[0].y)} bis ${coord(layers[layers.length - 1].y)}</div>`

  const perLayer = g.tab === 'layer' && !!cur
  const mats: MaterialRow[] = perLayer ? cur!.materials : materialsOf(layers.flatMap(l => l.blocks.map(b => b.state)))
  const items = mats.reduce((n, m) => n + m.count, 0)
  const icon = `<canvas class="mat-icon" aria-hidden="true"></canvas>`
  const rows = mats.map(m => {
    const on = perLayer && isChecked(p, cur!.index, m.item)
    const count = `<span class="mat-n">${num(m.count)}${m.count >= m.stackSize ? `<small>${formatPacking(m.count, m.stackSize)}</small>` : ''}</span>`
    return perLayer
      ? `<label class="mat check ${on ? 'on' : ''}" data-item="${esc(m.item)}"><input type="checkbox" data-check="${esc(m.item)}" ${on ? 'checked' : ''}/><span class="box">${I.check}</span>${icon}<span class="mat-name">${esc(itemLabel(m.item))}</span>${count}</label>`
      : `<div class="mat" data-item="${esc(m.item)}">${icon}<span class="mat-name">${esc(itemLabel(m.item))}</span>${count}</div>`
  }).join('')

  el.innerHTML = `
    <div class="g-top">
      <div class="g-title">${head}</div>
      <button class="btn ghost small icon" data-g="close" title="Bau-Ansicht schließen (Esc)">${I.close}</button>
    </div>
    <div class="g-controls">
      <button class="chip" data-g="all" aria-pressed="${g.layer === null}">Alles</button>
      <button class="btn small icon" data-g="prev" title="Ebene tiefer (↓)" ${g.layer === 0 ? 'disabled' : ''}>${I.prev}</button>
      <button class="btn small icon ${g.playing ? '' : 'primary'}" data-g="play" title="Abspielen (P)">${g.playing ? I.pause : I.play}</button>
      <button class="btn small icon" data-g="next" title="Ebene höher (↑)" ${g.layer === layers.length - 1 ? 'disabled' : ''}>${I.next}</button>
      <button class="chip" data-g="single" aria-pressed="${g.single}" ${g.layer === null ? 'disabled' : ''}>Nur diese Ebene</button>
    </div>
    <div class="timeline" title="${done} von ${filled} Ebenen fertig">${ticks}</div>
    <div class="g-progress"><span style="width:${filled ? Math.round((done / filled) * 100) : 0}%"></span></div>
    <div class="g-sub">${done} von ${filled} Ebenen fertig</div>
    <div class="plan-wrap">
      <canvas class="plan" aria-label="Bauplan von oben"></canvas>
      <div class="plan-tip" hidden></div>
    </div>
    <div class="g-sub">Von oben, Norden oben · ein Kästchen = ein Block${cur && cur.index > 0 ? ' · blass = Ebene darunter' : ''}</div>
    <div class="seg" role="tablist">
      <button class="seg-btn" data-tab="layer" aria-selected="${perLayer}" ${cur ? '' : 'disabled'}>Diese Ebene</button>
      <button class="seg-btn" data-tab="all" aria-selected="${!perLayer}">Gesamt</button>
      <span class="seg-thumb" aria-hidden="true"></span>
    </div>
    <div class="mats">${rows}</div>
    ${perLayer && cur!.materials.length ? `<button class="btn ${layerDone(p, cur!) ? '' : 'accent'} g-done" data-g="done">${I.check}${layerDone(p, cur!) ? 'Wieder offen' : 'Ebene fertig'}</button>` : ''}
    <div class="mats-sum">${num(items)} ${items === 1 ? 'Teil' : 'Teile'} · ${mats.length} ${mats.length === 1 ? 'Sorte' : 'Sorten'}${perLayer ? ' in dieser Ebene' : ' insgesamt'}</div>`

  placeThumb(el.querySelector('.seg')!)
  // Bild je Material: ein Block aus dem Bauwerk, der dieses Item kostet (Treppe mit Form, Stufe als Hälfte)
  const pool = perLayer ? cur!.blocks : layers.flatMap(l => l.blocks)
  el.querySelectorAll<HTMLElement>('[data-item]').forEach(row => {
    const item = row.dataset.item!
    const state = pool.find(b => usesItem(b.state, item))?.state ?? (item.includes(':') ? item : `minecraft:${item}`)
    drawIcon(row.querySelector<HTMLCanvasElement>('.mat-icon')!, state, look)
  })
  const canvas = el.querySelector<HTMLCanvasElement>('canvas.plan')!
  const [ox, , oz] = placed.origin
  const [w, , d] = placed.blueprint.size
  const wrap = el.querySelector<HTMLElement>('.plan-wrap')!
  const draw = (mark: string | null) => {
    grid = drawPlan(canvas, layers, g.layer, { x0: ox, z0: oz, x1: ox + w - 1, z1: oz + d - 1 }, look, wrap.clientWidth || 340,
      window.innerWidth <= 700 ? 260 : Math.max(380, Math.round(window.innerHeight * 0.58)), mark)
  }
  draw(null)
  // Maus über einem Material: genau diese Kästchen im Plan zeigen
  el.querySelectorAll<HTMLElement>('[data-item]').forEach(row => {
    row.addEventListener('mouseenter', () => draw(row.dataset.item!))
    row.addEventListener('mouseleave', () => draw(null))
  })
  bindPlan(canvas, el.querySelector<HTMLElement>('.plan-tip')!, cur, el)
  bind(el, p, layers, cur)
}

function bindPlan(canvas: HTMLCanvasElement, tip: HTMLElement, cur: Layer | null, el: HTMLElement): void {
  const mark = (items: string[]) => el.querySelectorAll<HTMLElement>('[data-item]').forEach(r => r.classList.toggle('hl', items.includes(r.dataset.item!)))
  canvas.addEventListener('mousemove', e => {
    if (!grid) return
    const r = canvas.getBoundingClientRect()
    const c = cellAt(grid, e.clientX - r.left, e.clientY - r.top)
    const b = c && grid.blocks.get(`${c.x},${c.z}`)
    // umgekehrt: Kästchen unter der Maus = Zeile in der Materialliste
    mark(b ? itemsFor(b.state).map(i => i.item) : [])
    if (!c) {
      tip.hidden = true
      return
    }
    const y = b ? b.y : cur?.y
    const hint = b ? stateHint(b.state) : ''
    tip.innerHTML = `${b ? `<b>${esc(itemLabel(b.state.replace(/\[.*$/, '')))}</b>${hint ? ` · ${esc(hint)}` : ''}<br>` : '<b>frei</b><br>'}X ${coord(c.x)} · Y ${y !== undefined ? coord(y) : '–'} · Z ${coord(c.z)}`
    tip.hidden = false
    const left = Math.min(e.clientX - r.left + 14, canvas.clientWidth - tip.offsetWidth - 4)
    tip.style.left = `${Math.max(4, left)}px`
    tip.style.top = `${e.clientY - r.top + 16}px`
  })
  canvas.addEventListener('mouseleave', () => {
    tip.hidden = true
    mark([])
  })
}

export function placeThumb(seg: HTMLElement): void {
  const sel = seg.querySelector<HTMLElement>('[aria-selected="true"]')
  const thumb = seg.querySelector<HTMLElement>('.seg-thumb')
  if (!sel || !thumb) return
  thumb.style.width = `${sel.offsetWidth}px`
  thumb.style.transform = `translateX(${sel.offsetLeft - 3}px)`
}

function bind(el: HTMLElement, p: Placement, layers: Layer[], cur: Layer | null): void {
  el.querySelectorAll<HTMLElement>('[data-layer]').forEach(b => b.addEventListener('click', () => {
    stop()
    S.guide.layer = Number(b.dataset.layer)
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.addEventListener('click', () => {
    S.guide.tab = b.dataset.tab as 'layer' | 'all'
    update()
  }))
  el.querySelectorAll<HTMLInputElement>('[data-check]').forEach(b => b.addEventListener('change', () => {
    if (cur) toggle(p, cur.index, b.dataset.check!)
  }))
  el.querySelectorAll<HTMLElement>('[data-g]').forEach(b => b.addEventListener('click', () => {
    switch (b.dataset.g) {
      case 'all': stop(); S.guide.layer = null; break
      case 'prev': stop(); step(-1, layers.length); break
      case 'next': stop(); step(1, layers.length); break
      case 'single': S.guide.single = !S.guide.single; break
      case 'play': S.guide.playing ? stop() : play(layers.length); break
      case 'close': stop(); S.sel = null; break
      case 'done': if (cur) return finishLayer(p, cur, layers.length); break
    }
    update()
  }))
}

export function step(d: number, count: number): void {
  const g = S.guide
  g.layer = g.layer === null ? (d > 0 ? 0 : count - 1) : Math.max(0, Math.min(count - 1, g.layer + d))
}

export function play(count: number): void {
  const g = S.guide
  if (g.layer === null || g.layer >= count - 1) g.layer = 0
  g.playing = true
  clearInterval(timer)
  timer = window.setInterval(() => {
    if (S.guide.layer === null || S.guide.layer >= count - 1) {
      stop()
    } else {
      S.guide.layer++
    }
    update()
  }, 1100)
}

export function stop(): void {
  clearInterval(timer)
  S.guide.playing = false
}
