// Linke Spalte: Welt, Bereiche, und in der 3D-Ansicht: bauen (Typ, Drehen, Verschieben, Export).

import { boundsOf } from '../blueprint/placement'
import { CATALOG } from '../catalog'
import {
  changePlacement, collisions, deleteArea, deletePlacement, nudgePlacement, openArea, placedOf, placementsIn,
  renameArea, renamePlacement, rotatePlacement, S, selectedArea, selectedPlacement, update, type Area,
} from '../app/state'
import { coord, esc, num } from '../ui/format'
import { I } from './icons'
import { canConnectFolder } from '../app/env'

export interface SideActions {
  connectFolder(): void
  reopenFolder(): void
  openZip(): void
  uploadFolder(): void
  demo(): void
  closeWorld(): void
  loadTextures(file?: File): void
  exportLitematic(): void
  exportSchem(): void
  openArea(id: string): void
  drawArea(): void
  startPlacing(type: string): void
  cancelPlacing(): void
  toggleTheme(): void
  focusArea(id: string): void
  focusPlacement(id: string): void
}

export function renderSide(el: HTMLElement, a: SideActions): void {
  // Während getippt wird, nicht neu zeichnen (sonst springt der Cursor)
  if (el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return
  const scroll = el.querySelector('.side-scroll')?.scrollTop ?? 0
  const body = !S.session ? '' : S.view === '3d' && openArea() ? buildBlocks(openArea()!) : areaBlocks()
  el.innerHTML = `
    <div class="side-scroll">
      ${worldBlock()}
      ${body}
    </div>
    <div class="side-foot">
      <span class="small muted">Etappe 1 · Durchstich</span>
      <button class="btn ghost small icon" data-act="theme" title="Hell / Dunkel">${isDark() ? I.sun : I.moon}</button>
    </div>`
  el.querySelector('.side-scroll')!.scrollTop = scroll
  bind(el, a)
}

/** Versionsordner, in dem die passende .jar liegt (aus level.dat, z. B. 26.1). */
function versionGuess(): string {
  return S.session?.info.versionName || '<Version>'
}

function isDark(): boolean {
  const t = document.documentElement.dataset.theme
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
}

function worldBlock(): string {
  const s = S.session
  if (!s) {
    const hasPicker = canConnectFolder()
    return `
    <div class="block">
      <div class="block-head"><span class="block-title">Welt</span></div>
      <div class="stack">
        ${S.savedFolder && hasPicker ? `<button class="btn primary" data-act="reopen">${I.folder}Weiter mit „${esc(S.savedFolder)}“</button>` : ''}
        ${hasPicker ? `<button class="btn ${S.savedFolder ? '' : 'primary'}" data-act="folder">${I.folder}Welt-Ordner verbinden</button>` : `<button class="btn primary" data-act="upload">${I.folder}Welt-Ordner wählen</button>`}
        <button class="btn" data-act="zip">${I.zip}ZIP wählen</button>
        <p class="note muted" style="margin:4px 0 0">Unter <b>saves</b> im Minecraft-Ordner, der Ordner mit <b>level.dat</b>. Geht auch per Hineinziehen. Die Welt bleibt auf diesem Rechner.</p>
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
      ${S.textures === 'none' ? `<p class="note muted" style="margin:6px 0 0">Texturen aus <b>minecraft/versions/${esc(versionGuess())}/${esc(versionGuess())}.jar</b>, oder die Datei auf die Karte ziehen.</p>` : ''}
    </div>`
}

function size(a: Area): string {
  return `${a.x1 - a.x0 + 1} × ${a.z1 - a.z0 + 1}`
}

/** Karte: Bereiche aufziehen, auswählen, in 3D öffnen. */
function areaBlocks(): string {
  const sel = selectedArea()
  const items = S.project.areas.map(ar => {
    const cur = S.sel?.kind === 'area' && S.sel.id === ar.id
    const n = placementsIn(ar.id).length
    return `<button class="item" data-area="${ar.id}" aria-current="${cur}">
      <span class="sq outline"></span><span class="grow"><span class="item-name" style="display:block">${esc(ar.name)}</span>
      <span class="item-sub">${size(ar)} · ${n === 0 ? 'noch leer' : n === 1 ? '1 Bauwerk' : `${n} Bauwerke`}</span></span></button>`
  }).join('')
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">Bereiche</span><span class="block-meta">${S.project.areas.length || ''}</span></div>
      ${items ? `<div class="list">${items}</div>` : ''}
      <button class="btn ${items ? '' : 'primary'}" style="width:100%;margin-top:${items ? 10 : 0}px" data-act="draw">${I.rect}Bereich aufziehen</button>
      ${sel ? `
        <div class="stack" style="margin-top:14px">
          <input class="field" id="area-name" data-rename-area="${sel.id}" value="${esc(sel.name)}" aria-label="Name des Bereichs" />
          <div class="small muted">X ${coord(sel.x0)} bis ${coord(sel.x1)} · Z ${coord(sel.z0)} bis ${coord(sel.z1)}</div>
          <button class="btn accent" data-act="open-area">${I.cube}In 3D öffnen</button>
          <div class="row"><span class="grow"></span><button class="btn small danger" data-act="del-area">${I.trash}Bereich löschen</button></div>
        </div>` : ''}
    </div>`
}

/** 3D: im offenen Bereich bauen. */
function buildBlocks(area: Area): string {
  const p = selectedPlacement()
  const list = placementsIn(area.id)
  const hits = collisions()
  const items = list.map(q => {
    const cur = p?.id === q.id
    return `<button class="item" data-placement="${q.id}" aria-current="${cur}"><span class="sq"></span>
      <span class="grow"><span class="item-name" style="display:block">${esc(q.name)}</span>
      <span class="item-sub">${CATALOG.find(c => c.id === q.source.generator)?.label ?? q.source.generator} · ${coord(q.pos[0])} ${coord(q.pos[1])} ${coord(q.pos[2])}</span></span>
      ${hits.has(q.id) ? '<span class="warn">überschneidet</span>' : ''}</button>`
  }).join('')
  const types = CATALOG.map(t => `
      <button class="type" data-type="${t.id}" aria-pressed="${S.placing === t.id}">
        <span class="type-name">${t.label}</span><span class="type-sub">${t.kind === 'functional' ? 'Vorlage' : 'Fest eingebaut'}</span>
      </button>`).join('')

  let html = `
    <div class="block">
      <div class="block-head"><span class="block-title">${esc(area.name)}</span><span class="block-meta">${size(area)}</span></div>
      <div class="block-head" style="margin:6px 0 8px"><span class="block-title">Bauen</span></div>
      <div class="types">${types}</div>
      ${S.placing
        ? `<p class="note" style="margin:10px 0 8px"><b>Klick</b> setzt das Bauwerk · <b>R</b> dreht · <b>Esc</b> bricht ab</p>
           <button class="btn" style="width:100%" data-act="cancel-place">Abbrechen</button>`
        : `<p class="note muted" style="margin:10px 0 0">Typ wählen, dann im Gelände an die Stelle klicken.</p>`}
    </div>`
  if (items) html += `<div class="block"><div class="block-head"><span class="block-title">Bauwerke hier</span></div><div class="list">${items}</div></div>`
  if (!p || p.areaId !== area.id) return html

  const { placed } = placedOf(p)
  const b = boundsOf(placed)
  const [w, h, d] = placed.blueprint.size
  return html + `
    <div class="block">
      <div class="block-head"><span class="block-title">Ausgewählt</span><span class="block-meta">${w} × ${d} · ${h} hoch</span></div>
      <div class="stack">
        <input class="field" id="placement-name" data-rename-placement="${p.id}" value="${esc(p.name)}" aria-label="Name des Bauwerks" />
        <div class="row wrap">
          <button class="btn small icon" data-act="rotL" title="Gegen den Uhrzeigersinn drehen">${I.rotL}</button>
          <button class="btn small icon" data-act="rotR" title="Im Uhrzeigersinn drehen (R)">${I.rotR}</button>
          <button class="chip" data-act="mirror" aria-pressed="${p.mirror}">${I.mirror.replace('<svg', '<svg style="width:14px;height:14px;margin-right:6px"')}Spiegeln</button>
          <span class="grow"></span><span class="small muted">${p.rotation}°</span>
        </div>
        <div class="row wrap" aria-label="Verschieben">
          <button class="btn small icon" data-nudge="-1,0,0" title="Westen (Pfeil links)">${I.left}</button>
          <button class="btn small icon" data-nudge="1,0,0" title="Osten (Pfeil rechts)">${I.right}</button>
          <button class="btn small icon" data-nudge="0,0,-1" title="Norden (Pfeil hoch)">${I.up}</button>
          <button class="btn small icon" data-nudge="0,0,1" title="Süden (Pfeil runter)">${I.down}</button>
          <span class="grow"></span>
          <button class="btn small" data-nudge="0,-1,0" title="Tiefer (Bild runter)">−1</button>
          <button class="btn small" data-nudge="0,1,0" title="Höher (Bild hoch)">+1</button>
        </div>
        ${hits.has(p.id) ? '<p class="note bad" style="margin:0">Überschneidet sich mit einem anderen Bauwerk.</p>' : ''}
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
    </div>`
}

function bind(el: HTMLElement, a: SideActions): void {
  el.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.addEventListener('click', () => {
    const p = selectedPlacement()
    const ar = selectedArea()
    switch (b.dataset.act) {
      case 'folder': return a.connectFolder()
      case 'reopen': return a.reopenFolder()
      case 'zip': return a.openZip()
      case 'upload': return a.uploadFolder()
      case 'demo': return a.demo()
      case 'close': return a.closeWorld()
      case 'textures': return a.loadTextures()
      case 'theme': return a.toggleTheme()
      case 'draw': return a.drawArea()
      case 'open-area': return ar && a.openArea(ar.id)
      case 'del-area': return ar && deleteArea(ar.id)
      case 'cancel-place': return a.cancelPlacing()
      case 'litematic': return a.exportLitematic()
      case 'schem': return a.exportSchem()
      case 'del-placement': return p && deletePlacement(p.id)
      case 'rotL': return p && rotatePlacement(p.id, -1)
      case 'rotR': return p && rotatePlacement(p.id, 1)
      case 'mirror': return p && changePlacement(p.id, q => (q.mirror = !q.mirror))
    }
  }))
  el.querySelectorAll<HTMLElement>('[data-type]').forEach(b => b.addEventListener('click', () => {
    if (S.placing === b.dataset.type) a.cancelPlacing()
    else a.startPlacing(b.dataset.type!)
  }))
  el.querySelectorAll<HTMLElement>('[data-area]').forEach(b => {
    b.addEventListener('click', () => {
      S.sel = { kind: 'area', id: b.dataset.area! }
      a.focusArea(b.dataset.area!)
      update()
    })
    b.addEventListener('dblclick', () => a.openArea(b.dataset.area!))
  })
  el.querySelectorAll<HTMLElement>('[data-placement]').forEach(b => b.addEventListener('click', () => {
    S.sel = { kind: 'placement', id: b.dataset.placement! }
    S.guide.layer = null
    a.focusPlacement(b.dataset.placement!)
    update()
  }))
  el.querySelectorAll<HTMLElement>('[data-nudge]').forEach(b => b.addEventListener('click', () => {
    const p = selectedPlacement()
    if (!p) return
    const [x, y, z] = b.dataset.nudge!.split(',').map(Number)
    nudgePlacement(p.id, [x, y, z])
  }))
  const commit = (input: HTMLInputElement | null, fn: (id: string, v: string) => void, attr: string) => {
    if (!input) return
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') input.blur()
      e.stopPropagation() // WASD und R nicht an die 3D-Steuerung geben
    })
    input.addEventListener('blur', () => fn(input.getAttribute(attr)!, input.value))
  }
  commit(el.querySelector<HTMLInputElement>('[data-rename-area]'), renameArea, 'data-rename-area')
  commit(el.querySelector<HTMLInputElement>('[data-rename-placement]'), renamePlacement, 'data-rename-placement')
}
