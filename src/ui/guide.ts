// Untere Leiste: Bauanleitung Schicht für Schicht, mit Materialliste.

import { formatPacking, materialsOf, type MaterialRow } from '../blueprint/materials'
import type { Layer } from '../blueprint/placement'
import { placedOf, S, selectedPlacement, update } from '../app/state'
import { fallbackColor } from '../render/block-colors'
import { coord, esc, itemLabel, num } from './format'
import { I } from './icons'

let timer: number | undefined

export function renderGuide(el: HTMLElement): void {
  const p = selectedPlacement()
  el.hidden = !p
  if (!p) {
    stop()
    return
  }
  const { layers } = placedOf(p)
  const g = S.guide
  if (g.layer !== null && g.layer >= layers.length) g.layer = layers.length - 1
  const cur = g.layer === null ? null : layers[g.layer]
  const max = Math.max(...layers.map(l => l.blocks.length), 1)
  const every = layers.length > 32 ? 4 : layers.length > 16 ? 2 : 1

  const ticks = layers.map((l, i) => {
    const cls = g.layer === null ? '' : i === g.layer ? 'cur' : i < g.layer ? 'done' : ''
    const hgt = 8 + (l.blocks.length / max) * 34
    return `<button class="tick ${cls}" data-layer="${i}" title="Ebene ${i + 1} · Y ${l.y} · ${l.blocks.length} Blöcke">
      <span class="bar" style="height:${hgt}px"></span><span class="lbl">${i % every === 0 || i === g.layer ? l.y : ''}</span></button>`
  }).join('')

  const total = layers.reduce((n, l) => n + l.blocks.length, 0)
  const head = cur
    ? `<div class="g-layer">Ebene ${cur.index + 1}<small>/ ${layers.length} · Y ${coord(cur.y)}</small></div>
       <div class="g-info"><b>${num(cur.blocks.length)} Blöcke</b> · ${extent(cur)}</div>`
    : `<div class="g-layer">Ganzes Bauwerk<small>${layers.length} Ebenen</small></div>
       <div class="g-info"><b>${num(total)} Blöcke</b> · Y ${coord(layers[0].y)} bis ${coord(layers[layers.length - 1].y)}</div>`

  const mats: MaterialRow[] = g.tab === 'layer' && cur ? cur.materials : materialsOf(layers.flatMap(l => l.blocks.map(b => b.state)))
  const items = mats.reduce((n, m) => n + m.count, 0)

  el.innerHTML = `
    <div class="g-left">
      <div class="g-head">
        <div>${head}</div>
        <div class="g-controls">
          <button class="chip" data-g="all" aria-pressed="${g.layer === null}">Alles</button>
          <button class="btn small icon" data-g="prev" title="Ebene tiefer ([)" ${g.layer === 0 ? 'disabled' : ''}>${I.prev}</button>
          <button class="btn small icon ${g.playing ? '' : 'primary'}" data-g="play" title="Abspielen (P)">${g.playing ? I.pause : I.play}</button>
          <button class="btn small icon" data-g="next" title="Ebene höher (])" ${g.layer === layers.length - 1 ? 'disabled' : ''}>${I.next}</button>
          <button class="chip" data-g="single" aria-pressed="${g.single}" ${g.layer === null ? 'disabled' : ''}>Nur diese Ebene</button>
        </div>
      </div>
      <div class="timeline">${ticks}</div>
      <div class="g-blocks">${cur ? blockLine(cur) : ''}</div>
    </div>
    <div class="g-right">
      <div class="seg" role="tablist">
        <button class="seg-btn" data-tab="layer" aria-selected="${g.tab === 'layer' && !!cur}" ${cur ? '' : 'disabled'}>Diese Ebene</button>
        <button class="seg-btn" data-tab="all" aria-selected="${g.tab === 'all' || !cur}">Gesamt</button>
        <span class="seg-thumb" aria-hidden="true"></span>
      </div>
      <div class="mats">${mats.map(m => {
        const [r, gg, b] = fallbackColor(m.item)
        return `<div class="mat"><span class="swatch" style="background:rgb(${r},${gg},${b})"></span>
          <span class="mat-name">${esc(itemLabel(m.item))}</span>
          <span class="mat-n">${num(m.count)}${m.count >= m.stackSize ? `<small>${formatPacking(m.count, m.stackSize)}</small>` : ''}</span></div>`
      }).join('')}</div>
      <div class="mats-sum">${num(items)} Teile · ${mats.length} Sorten</div>
    </div>`
  placeThumb(el.querySelector('.g-right .seg')!)
  bind(el, layers)
}

function extent(l: Layer): string {
  if (!l.blocks.length) return 'leer'
  const xs = l.blocks.map(b => b.x), zs = l.blocks.map(b => b.z)
  return `X ${coord(Math.min(...xs))} bis ${coord(Math.max(...xs))} · Z ${coord(Math.min(...zs))} bis ${coord(Math.max(...zs))}`
}

function blockLine(l: Layer): string {
  // Erster Block der Schicht (nördlichste Reihe, dann westlichster) als Anhaltspunkt im Spiel
  if (!l.blocks.length) return ''
  const first = l.blocks[0]
  return `Beginn bei <b>${coord(first.x)} ${coord(first.y)} ${coord(first.z)}</b>`
}

export function placeThumb(seg: HTMLElement): void {
  const sel = seg.querySelector<HTMLElement>('[aria-selected="true"]')
  const thumb = seg.querySelector<HTMLElement>('.seg-thumb')
  if (!sel || !thumb) return
  thumb.style.width = `${sel.offsetWidth}px`
  thumb.style.transform = `translateX(${sel.offsetLeft - 3}px)`
}

function bind(el: HTMLElement, layers: Layer[]): void {
  el.querySelectorAll<HTMLElement>('[data-layer]').forEach(b => b.addEventListener('click', () => {
    stop()
    S.guide.layer = Number(b.dataset.layer)
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.addEventListener('click', () => {
    S.guide.tab = b.dataset.tab as 'layer' | 'all'
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-g]').forEach(b => b.addEventListener('click', () => {
    switch (b.dataset.g) {
      case 'all': stop(); S.guide.layer = null; break
      case 'prev': stop(); step(-1, layers.length); break
      case 'next': stop(); step(1, layers.length); break
      case 'single': S.guide.single = !S.guide.single; break
      case 'play': S.guide.playing ? stop() : play(layers.length); break
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
