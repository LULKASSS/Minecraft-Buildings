// Linke Spalte: Welt, Markierungen, Bauwerk (Typ, Drehen, Verschieben, Export).

import { boundsOf } from '../blueprint/placement'
import { CATALOG } from '../catalog'
import {
  collisions, deleteMarker, deletePlacement, nudgePlacement, placeAtMarker, placedOf, renameMarker,
  rotatePlacement, changePlacement, S, selectedMarker, selectedPlacement, update,
} from '../app/state'
import { coord, esc, num } from '../ui/format'
import { I } from './icons'

export interface SideActions {
  connectFolder(): void
  reopenFolder(): void
  openZip(): void
  uploadFolder(): void
  demo(): void
  closeWorld(): void
  loadTextures(): void
  exportLitematic(): void
  exportSchem(): void
  open3d(): void
  toggleTheme(): void
  focusMarker(id: string): void
}

export function renderSide(el: HTMLElement, a: SideActions): void {
  // Während getippt wird, nicht neu zeichnen (sonst springt der Cursor)
  if (el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return
  const scroll = el.querySelector('.side-scroll')?.scrollTop ?? 0
  el.innerHTML = `
    <div class="side-scroll">
      ${worldBlock()}
      ${S.session ? markersBlock() + buildBlock() : ''}
    </div>
    <div class="side-foot">
      <span class="small muted">Etappe 1 · Durchstich</span>
      <button class="btn ghost small icon" data-act="theme" title="Hell / Dunkel">${isDark() ? I.sun : I.moon}</button>
    </div>`
  el.querySelector('.side-scroll')!.scrollTop = scroll
  bind(el, a)
}

function isDark(): boolean {
  const t = document.documentElement.dataset.theme
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
}

function worldBlock(): string {
  const s = S.session
  if (!s) {
    const hasPicker = 'showDirectoryPicker' in window
    return `
    <div class="block">
      <div class="block-head"><span class="block-title">Welt</span></div>
      <div class="stack">
        ${S.savedFolder ? `<button class="btn primary" data-act="reopen">${I.folder}Weiter mit „${esc(S.savedFolder)}“</button>` : ''}
        ${hasPicker ? `<button class="btn ${S.savedFolder ? '' : 'primary'}" data-act="folder">${I.folder}Welt-Ordner verbinden</button>` : `<button class="btn primary" data-act="upload">${I.folder}Welt-Ordner wählen</button>`}
        <button class="btn" data-act="zip">${I.zip}ZIP wählen</button>
        <p class="note muted" style="margin:4px 0 0">Unter <b>saves</b> im Minecraft-Ordner, der Ordner mit <b>level.dat</b>. Die Welt bleibt auf diesem Rechner.</p>
        <div><button class="linkish" data-act="demo">Mit Testwelt ausprobieren</button></div>
      </div>
    </div>`
  }
  const busy = S.busy
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">Welt</span><button class="btn ghost small" data-act="close">Wechseln</button></div>
      <div class="world-name">${esc(s.info.name)}</div>
      <div class="status-line" style="margin-top:4px">
        <span class="dot ${busy ? 'busy' : 'on'}"></span>${busy ? esc(busy) : `${esc(s.info.versionName || 'Version ?')} · ${num(s.info.regions.length)} Regionen${s.demo ? ' · Testwelt' : ''}`}
      </div>
      <div class="row" style="margin-top:12px">
        <span class="small muted grow">${S.textures === 'ready' ? 'Texturen aus deiner .jar' : S.textures === 'loading' ? 'Texturen werden gelesen …' : 'Einfarbig'}</span>
        ${S.textures !== 'ready' ? `<button class="btn small" data-act="textures" ${S.textures === 'loading' ? 'disabled' : ''}>.jar wählen</button>` : ''}
      </div>
    </div>`
}

function markersBlock(): string {
  const sel = selectedMarker()
  const items = S.project.markers.map(m => {
    const [x, z] = m.points[0]
    const cur = S.sel?.kind === 'marker' && S.sel.id === m.id
    return `<button class="item" data-marker="${m.id}" aria-current="${cur}">
      <span class="pin"></span><span class="grow"><span class="item-name" style="display:block">${esc(m.name)}</span>
      <span class="item-sub">${coord(x)} · ${coord(m.y)} · ${coord(z)}</span></span></button>`
  }).join('')
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">Markierungen</span><span class="block-meta">${S.project.markers.length || ''}</span></div>
      ${items ? `<div class="list">${items}</div>` : `<p class="note muted" style="margin:0">Klick auf die Karte setzt einen Punkt.</p>`}
      ${sel ? `
        <div class="stack" style="margin-top:12px">
          <input class="field" data-rename="${sel.id}" value="${esc(sel.name)}" aria-label="Name" />
          <div class="row"><span class="grow"></span><button class="btn small danger" data-act="del-marker">${I.trash}Löschen</button></div>
        </div>` : ''}
    </div>`
}

function buildBlock(): string {
  const p = selectedPlacement()
  const m = selectedMarker()
  if (m) {
    const types = CATALOG.map((t, i) => `
      <button class="type" data-type="${t.id}" aria-pressed="${i === 0}">
        <span class="type-name">${t.label}</span><span class="type-sub">${t.kind === 'functional' ? 'Vorlage' : 'Fest eingebaut'}</span>
      </button>`).join('')
    return `
      <div class="block">
        <div class="block-head"><span class="block-title">Bauwerk an „${esc(m.name)}“</span></div>
        <div class="types">${types}</div>
        <button class="btn accent" style="width:100%;margin-top:10px" data-act="place">${I.cube}Hier bauen</button>
      </div>`
  }
  const placements = S.project.placements.map(q => {
    const cur = S.sel?.kind === 'placement' && S.sel.id === q.id
    const bad = collisions().has(q.id)
    return `<button class="item" data-placement="${q.id}" aria-current="${cur}"><span class="sq"></span>
      <span class="grow"><span class="item-name" style="display:block">${esc(q.name)}</span>
      <span class="item-sub">${CATALOG.find(c => c.id === q.source.generator)?.label ?? q.source.generator} · ${q.rotation}°</span></span>
      ${bad ? '<span class="warn">überschneidet</span>' : ''}</button>`
  }).join('')
  if (!p) {
    return placements ? `<div class="block"><div class="block-head"><span class="block-title">Bauwerke</span></div><div class="list">${placements}</div></div>` : ''
  }
  const { placed } = placedOf(p)
  const b = boundsOf(placed)
  const [w, h, d] = placed.blueprint.size
  const bad = collisions().has(p.id)
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">${esc(p.name)}</span><span class="block-meta">${w} × ${d} · ${h} hoch</span></div>
      <div class="stack">
        <div class="row wrap">
          <button class="btn small icon" data-act="rotL" title="Gegen den Uhrzeigersinn drehen">${I.rotL}</button>
          <button class="btn small icon" data-act="rotR" title="Im Uhrzeigersinn drehen (R)">${I.rotR}</button>
          <button class="chip" data-act="mirror" aria-pressed="${p.mirror}">${I.mirror.replace('<svg', '<svg style="width:14px;height:14px;margin-right:6px"')}Spiegeln</button>
          <span class="grow"></span><span class="small muted">${p.rotation}°</span>
        </div>
        <div class="row wrap" aria-label="Verschieben">
          <button class="btn small icon" data-nudge="-1,0,0" title="Westen">${I.left}</button>
          <button class="btn small icon" data-nudge="1,0,0" title="Osten">${I.right}</button>
          <button class="btn small icon" data-nudge="0,0,-1" title="Norden">${I.up}</button>
          <button class="btn small icon" data-nudge="0,0,1" title="Süden">${I.down}</button>
          <span class="grow"></span>
          <button class="btn small" data-nudge="0,-1,0" title="Tiefer">−1</button>
          <button class="btn small" data-nudge="0,1,0" title="Höher">+1</button>
        </div>
        ${bad ? '<p class="note bad" style="margin:0">Überschneidet sich mit einem anderen Bauwerk.</p>' : ''}
        <div class="row"><button class="btn primary grow" data-act="open3d">${I.cube}In 3D ansehen</button></div>
      </div>
    </div>
    <div class="block">
      <div class="block-head"><span class="block-title">Für Litematica</span></div>
      <div class="coords">
        <div class="coord"><b>X</b><span>${coord(b.min[0])}</span></div>
        <div class="coord"><b>Y</b><span>${coord(b.min[1])}</span></div>
        <div class="coord"><b>Z</b><span>${coord(b.min[2])}</span></div>
      </div>
      <p class="note muted" style="margin:8px 0 10px">Platzierung auf diesen Ursprung setzen, Drehung „keine“.</p>
      <div class="row">
        <button class="btn accent grow" data-act="litematic">${I.download}.litematic</button>
        <button class="btn" data-act="schem">${I.download}.schem</button>
      </div>
      <div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn small danger" data-act="del-placement">${I.trash}Bauwerk entfernen</button></div>
    </div>
    ${S.project.placements.length > 1 ? `<div class="block"><div class="block-head"><span class="block-title">Bauwerke</span></div><div class="list">${placements}</div></div>` : ''}`
}

function bind(el: HTMLElement, a: SideActions): void {
  el.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.addEventListener('click', () => {
    const p = selectedPlacement()
    const m = selectedMarker()
    switch (b.dataset.act) {
      case 'folder': return a.connectFolder()
      case 'reopen': return a.reopenFolder()
      case 'zip': return a.openZip()
      case 'upload': return a.uploadFolder()
      case 'demo': return a.demo()
      case 'close': return a.closeWorld()
      case 'textures': return a.loadTextures()
      case 'theme': return a.toggleTheme()
      case 'open3d': return a.open3d()
      case 'litematic': return a.exportLitematic()
      case 'schem': return a.exportSchem()
      case 'del-marker': return m && deleteMarker(m.id)
      case 'del-placement': return p && deletePlacement(p.id)
      case 'rotL': return p && rotatePlacement(p.id, -1)
      case 'rotR': return p && rotatePlacement(p.id, 1)
      case 'mirror': return p && changePlacement(p.id, q => (q.mirror = !q.mirror))
      case 'place': {
        if (!m) return
        const type = el.querySelector<HTMLElement>('.type[aria-pressed="true"]')?.dataset.type ?? CATALOG[0].id
        placeAtMarker(m.id, type)
        return
      }
    }
  }))
  el.querySelectorAll<HTMLElement>('[data-type]').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('[data-type]').forEach(o => o.setAttribute('aria-pressed', String(o === b)))
  }))
  el.querySelectorAll<HTMLElement>('[data-marker]').forEach(b => b.addEventListener('click', () => {
    S.sel = { kind: 'marker', id: b.dataset.marker! }
    a.focusMarker(b.dataset.marker!)
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-placement]').forEach(b => b.addEventListener('click', () => {
    S.sel = { kind: 'placement', id: b.dataset.placement! }
    S.guide.layer = null
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-nudge]').forEach(b => b.addEventListener('click', () => {
    const p = selectedPlacement()
    if (!p) return
    const [x, y, z] = b.dataset.nudge!.split(',').map(Number)
    nudgePlacement(p.id, [x, y, z])
  }))
  const input = el.querySelector<HTMLInputElement>('[data-rename]')
  if (input) {
    const commit = () => renameMarker(input.dataset.rename!, input.value)
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') input.blur()
    })
    input.addEventListener('blur', commit)
  }
}
