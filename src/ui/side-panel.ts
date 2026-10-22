// Schwebendes Panel über der 3D-Welt: bauen (Typ, Stil, Varianten), gewähltes Bauwerk, Orte, Welt.

import { boundsOf, type Placement } from '../blueprint/placement'
import { blueprintMaterials } from '../blueprint/materials'
import { buildFromSource, CATALOG, type Category } from '../catalog'
import { MIXES, SPECIES } from '../catalog/nature'
import { STYLES, type Size } from '../catalog/styles'
import { templateList } from '../catalog/template'
import { thumbnail } from '../render/thumbs'
import type { TexturedMesher } from '../render/textured'
import { survivalCost } from '../style/blocks'
import { customPalettes, palettesFor, type Palette, type Role } from '../style/palettes'
import {
  changePlacement, choiceSource, collisions, deletePlacement, newSeeds, nudgePlacement, placedOf,
  renamePlacement, rotatePlacement, S, selectedPlacement, update,
} from '../app/state'
import { coord, esc, num } from '../ui/format'
import { I } from './icons'
import { firstOpenLayer, placeThumb } from './guide'
import { duration } from '../map/map-view'

export interface SideActions {
  closeWorld(): void
  loadTextures(file?: File): void
  mojangTextures(): void
  exportLitematic(): void
  exportSchem(): void
  startPlacing(type: string): void
  cancelPlacing(): void
  toggleTheme(): void
  focusPoint(x: number, z: number): void
  focusPlacement(id: string, tight?: boolean): void
  learnPalette(): void
  importTemplate(): void
  removeTemplate(id: string): void
  terrainCut(id: string): number
  textured(): TexturedMesher | null
  blockColor(id: string): [number, number, number]
  versionName(dataVersion: number): string
}

let lastMode = ''

export function renderSide(el: HTMLElement, a: SideActions): void {
  // Während getippt wird, nicht neu zeichnen (sonst springt der Cursor)
  if (el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return
  el.hidden = !S.session
  if (!S.session) return
  const p = selectedPlacement()
  // anderes Bauwerk oder zurück zum Bauen: oben anfangen, sonst die Stelle halten
  const mode = p?.id ?? 'bauen'
  const scroll = mode === lastMode ? el.querySelector('.side-scroll')?.scrollTop ?? 0 : 0
  lastMode = mode
  el.innerHTML = `
    <div class="panel-head">
      <span class="block-title">${p ? 'Bauwerk' : 'Bauen'}</span>
      <button class="btn ghost small icon" data-act="collapse" title="Panel ein-/ausklappen" aria-expanded="${!S.panelCollapsed}">${S.panelCollapsed ? I.down : I.up}</button>
    </div>
    <div class="side-scroll" ${S.panelCollapsed ? 'hidden' : ''}>
      ${p ? selectedBlocks(p, a) : buildBlock(a)}
      ${placementsBlock()}
      ${traceBlock()}
      ${worldBlock()}
    </div>`
  el.querySelector('.side-scroll')!.scrollTop = scroll
  bind(el, a)
}

/** Versionsordner, in dem die passende .jar liegt (aus level.dat, z. B. 26.1). */
function versionGuess(): string {
  return S.session?.info.versionName || '<Version>'
}

function worldBlock(): string {
  const s = S.session!
  const busy = S.busy
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">Welt</span><button class="btn ghost small" data-act="close">Wechseln</button></div>
      <div class="world-name small-name">${esc(s.info.name)}</div>
      <div class="status-line" style="margin-top:4px">
        <span class="dot ${busy ? 'busy' : 'on'}"></span>${busy ? esc(busy) : `${esc(s.info.versionName || 'Version ?')} · ${num(s.info.regions.length)} Regionen${s.demo ? ' · Testwelt' : ''}`}
      </div>
      ${mapProgress()}
      <div class="row" style="margin-top:12px">
        <span class="small muted grow">${S.textures === 'ready' ? `Texturen aus ${esc(S.texturesFrom ?? 'der .jar')}` : S.textures === 'loading' ? esc(S.texturesFrom ?? 'Texturen werden gelesen …') : 'Einfarbig'}</span>
        ${S.textures === 'none' ? `<button class="btn small" data-act="textures">.jar wählen</button>` : ''}
      </div>
      ${S.textures === 'none' ? `<p class="note muted" style="margin:6px 0 8px">Keine passende .jar gefunden. Am einfachsten: den ganzen ModrinthApp- oder Minecraft-Ordner wählen, dort liegt sie. Die App merkt sie sich danach.</p>
        <button class="btn accent" style="width:100%" data-act="mojang">${I.download}Texturen von Mojang laden (${esc(versionGuess())}, ca. 40 MB)</button>` : ''}
    </div>`
}

function mapProgress(): string {
  const p = S.session!.progress()
  if (p.done >= p.total) return ''
  return `<div class="progress" title="Die Karte lädt erst, was du siehst, danach den Rest für die Spuren">
    <div class="progress-bar"><span style="width:${Math.round((p.done / p.total) * 100)}%"></span></div>
    <span class="small muted">Karte ${num(p.done)} / ${num(p.total)} Regionen</span></div>`
}

/** Spuren: wo ihr am meisten wart und gebaut habt. */
function traceBlock(): string {
  const s = S.session!
  const spots = S.traces ? s.hotspots() : []
  const p = s.progress()
  const items = spots.map((h, i) => `<button class="item" data-spot="${h.x},${h.z}">
      <span class="pin-num">${i + 1}</span><span class="grow"><span class="item-name" style="display:block">X ${coord(h.x)} · Z ${coord(h.z)}</span>
      <span class="item-sub">${duration(h.hours * 3600)} in der Nähe${h.built ? ` · ${num(h.built)} gebaute Stellen` : ''}</span></span></button>`).join('')
  return `
    <div class="block">
      <div class="block-head"><span class="block-title">Hier wart ihr am meisten</span>
        <button class="btn ghost small" data-act="traces" aria-pressed="${S.traces}">${S.traces ? 'Ausblenden' : 'Zeigen'}</button></div>
      ${!S.traces ? `<p class="note muted" style="margin:0">Zeigt auf der Karte, wo ihr wart und wo gebaut ist.</p>`
        : items ? `<div class="list">${items}</div><p class="note muted" style="margin:8px 0 0">Auf der Karte: kräftig = oben liegt Gebautes (Dörfer zählen mit), zart = dort wart ihr.</p>`
        : `<p class="note muted" style="margin:0">${p.done < p.total ? 'Wird beim Laden der Karte gesammelt …' : 'Noch keine Orte mit viel Spielzeit gefunden.'}</p>`}
    </div>`
}

/** Bauen: was als Nächstes gesetzt wird. */
function buildBlock(a: SideActions): string {
  return `<div class="block">${chooser(a)}</div>`
}

/** Alle gesetzten Bauwerke: Klick fliegt hin und zeigt die Anleitung. */
function placementsBlock(): string {
  const list = S.project.placements
  if (!list.length) return ''
  const p = selectedPlacement()
  const hits = collisions()
  const items = list.map(q => `<button class="item" data-placement="${q.id}" aria-current="${p?.id === q.id}"><span class="sq"></span>
      <span class="grow"><span class="item-name" style="display:block">${esc(q.name)}</span>
      <span class="item-sub">${coord(q.pos[0])} ${coord(q.pos[1])} ${coord(q.pos[2])}</span></span>
      ${hits.has(q.id) ? '<span class="warn">überschneidet</span>' : ''}</button>`).join('')
  return `<div class="block"><div class="block-head"><span class="block-title">Eure Bauwerke</span><span class="block-meta">${list.length}</span></div><div class="list">${items}</div></div>`
}

const b = () => S.build
const chip = (attr: string, value: string, label: string, on: boolean, extra = '') => `<button class="chip" ${attr}="${value}" aria-pressed="${on}" ${extra}>${label}</button>`
const SIZE_LABEL: Record<Size, string> = { S: 'Klein', M: 'Mittel', L: 'Groß' }

function chooser(a: SideActions): string {
  const c = b()
  const cats: [Category, string][] = [['gebaeude', 'Gebäude'], ['deko', 'Deko'], ['natur', 'Natur'], ['vorlage', 'Vorlagen']]
  let html = `<div class="seg wide" role="tablist" id="cat-seg">${cats.map(([id, l]) => `<button class="seg-btn" data-cat="${id}" aria-selected="${c.cat === id}">${l}</button>`).join('')}<span class="seg-thumb" aria-hidden="true"></span></div>`
  const types = CATALOG.filter(e => e.category === c.cat && !e.hidden && e.id !== 'vorlage')
  if (types.length) html += `<div class="chips">${types.map(t => chip('data-btype', t.id, t.label, c.type === t.id)).join('')}</div>`

  const cur = CATALOG.find(e => e.id === c.type)
  const forms = cur?.formsFor?.(c.style) ?? []
  if (forms.length > 1) {
    const on = forms.some(f => f.id === c.form) ? c.form : 'alle'
    html += `<div class="sub">Form</div><div class="chips">${chip('data-form', 'alle', 'Alle', on === 'alle')}${forms.map(f => chip('data-form', f.id, f.label, on === f.id)).join('')}</div>`
  }
  if (c.cat === 'gebaeude' || c.cat === 'deko' || (c.cat === 'vorlage' && c.facade)) {
    html += `<div class="sub">Stil</div><div class="chips">${STYLES.map(st => chip('data-style', st.id, st.label, c.style === st.id)).join('')}</div>`
    html += `<div class="sub">Palette</div><div class="pals">${palettesFor(c.style, customPalettes()).map(pal => paletteRow(pal, c.palette === pal.id, a)).join('')}</div>
      <button class="linkish small" data-act="learn">Palette aus der Umgebung lernen</button>`
  }
  if (c.cat === 'natur' && c.type === 'baum') html += `<div class="sub">Holzart</div><div class="chips">${SPECIES.map(sp => chip('data-species', sp.id, sp.label, c.species === sp.id)).join('')}</div>`
  if (c.cat === 'natur' && c.type === 'pinsel') html += `<div class="sub">Mischung</div><div class="chips">${MIXES.map(m => chip('data-mix', m.id, m.label, c.mix === m.id)).join('')}</div>`
  if (c.cat === 'vorlage') html += templatesBlock(a)
  if (c.cat !== 'vorlage' && cur?.sized !== false) {
    html += `<div class="sub">${c.type === 'pinsel' ? 'Fläche' : 'Größe'}</div><div class="chips">${(['S', 'M', 'L'] as Size[]).map(sz => chip('data-size', sz, c.type === 'pinsel' ? { S: '13 × 13', M: '21 × 21', L: '29 × 29' }[sz] : SIZE_LABEL[sz], c.size === sz)).join('')}</div>`
  }
  if (c.cat === 'vorlage' && !c.templateId) return html
  const entry = CATALOG.find(e => e.id === c.type)
  if (entry?.seeded) html += variantsBlock(a)
  html += S.placing
    ? `<p class="note" style="margin:12px 0 8px"><b>Klick</b> ins Gelände setzt · <b>R</b> dreht · <b>Esc</b> bricht ab</p>
       <button class="btn" style="width:100%" data-act="cancel-place">Abbrechen</button>`
    : `<button class="btn accent" style="width:100%;margin-top:12px" data-act="start-place">${I.cube}In die Welt setzen</button>`
  return html
}

function paletteRow(pal: Palette, on: boolean, a: SideActions): string {
  const roles: Role[] = ['sockel', 'wall', 'frame', 'roof', 'trim', 'accent']
  const sw = roles.map(r => {
    const [cr, cg, cb] = a.blockColor(pal.roles[r][0].id)
    return `<i style="background:rgb(${cr | 0},${cg | 0},${cb | 0})"></i>`
  }).join('')
  return `<button class="pal" data-palette="${pal.id}" aria-pressed="${on}"><span class="pal-name">${esc(pal.name)}${pal.custom ? ' <em>eigen</em>' : ''}</span><span class="sw">${sw}</span></button>`
}

const thumbCache = new Map<string, { url: string; label: string }>()

/** Bauform als Vorsatz in der Variantenzeile, z. B. „Winkelhaus · “ */
function formLabel(src: { generator: string; params: Record<string, unknown> }): string {
  const f = CATALOG.find(e => e.id === src.generator)?.formsFor?.(String(src.params.style)).find(x => x.id === src.params.form)
  return f ? `${f.label} · ` : ''
}

function variantsBlock(a: SideActions): string {
  const c = b()
  const cells = c.seeds.map((seed, i) => {
    const src = choiceSource(c, seed, i)
    const key = JSON.stringify(src) + (a.textured() ? 't' : 'f')
    let t = thumbCache.get(key)
    if (!t) {
      try {
        const bp = buildFromSource(src)
        const rows = blueprintMaterials(bp)
        const total = rows.reduce((n, r) => n + r.count, 0)
        const cost = rows.reduce((n, r) => n + r.count * survivalCost(r.item), 0) / Math.max(1, total)
        const amount = total >= 1728 ? `${(total / 1728).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Shulker` : `${Math.ceil(total / 64)} Stacks`
        t = { url: thumbnail(bp, a.textured(), getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#eee'), label: `${formLabel(src)}${amount} · ${cost < 1.6 ? 'günstig' : cost < 2.3 ? 'mittel' : 'aufwendig'}` }
      } catch (e) {
        t = { url: '', label: String((e as Error).message ?? e) }
      }
      thumbCache.set(key, t)
    }
    return `<button class="var" data-pick="${i}" aria-pressed="${c.pick === i}">${t.url ? `<img src="${t.url}" alt="Variante ${i + 1}" />` : ''}<span>${esc(t.label)}</span></button>`
  }).join('')
  return `<div class="sub row"><span class="grow">Varianten</span><button class="linkish small" data-act="reroll">Neu würfeln</button></div><div class="vars">${cells}</div>`
}

function templatesBlock(a: SideActions): string {
  const c = b()
  const list = templateList()
  const world = S.project.dataVersion
  const rows = list.map(t => {
    const warn = t.dataVersion !== world ? `<span class="warn">getestet mit ${esc(a.versionName(t.dataVersion))}</span>` : ''
    return `<div class="row"><button class="item grow" data-template="${t.id}" aria-current="${c.templateId === t.id}"><span class="sq"></span>
      <span class="grow"><span class="item-name" style="display:block">${esc(t.name)}</span><span class="item-sub">${t.size.join(' × ')} · ${esc(a.versionName(t.dataVersion))}</span></span>${warn}</button>
      <button class="btn ghost small icon" data-del-template="${t.id}" title="Vorlage löschen">${I.trash}</button></div>`
  }).join('')
  return `
    <p class="note muted" style="margin:10px 0 8px">Farmen und Redstone nur aus .litematic, die bei dir nachweislich laufen. Die App ändert am Kern nichts.</p>
    ${rows ? `<div class="list">${rows}</div>` : ''}
    <button class="btn" style="width:100%;margin-top:8px" data-act="import-template">${I.download}Vorlage laden (.litematic)</button>
    ${c.templateId ? `<div class="chips" style="margin-top:10px">${chip('data-act', 'toggle-facade', 'Fassade im Stil', c.facade)}</div>` : ''}`
}

function selectedBlocks(p: Placement, a: SideActions): string {
  const { placed } = placedOf(p)
  const bb = boundsOf(placed)
  const [w, h, d] = placed.blueprint.size
  const entry = CATALOG.find(e => e.id === p.source.generator)
  const params = p.source.params as Record<string, unknown>
  const hits = collisions()
  const cut = a.terrainCut(p.id)
  let extra = ''
  if (entry?.styled) {
    const style = String(params.style)
    extra += `<div class="sub">Palette</div><div class="pals">${palettesFor(style, customPalettes()).map(pal => paletteRow(pal, params.palette === pal.id, a).replace('data-palette', 'data-set-palette')).join('')}</div>`
  }
  if (p.source.generator === 'vorlage') {
    const f = params.facade as { palette: string; sides: boolean[]; roof: boolean } | undefined
    extra += `<div class="sub">Fassade</div><div class="chips">
      ${chip('data-act', 'facade-onoff', f ? 'An' : 'Aus', !!f)}
      ${f ? ['Nord', 'Ost', 'Süd', 'West'].map((l, i) => chip('data-side', String(i), l, f.sides[i])).join('') + chip('data-act', 'facade-roof', 'Dach', f.roof) : ''}
    </div>${f?.roof ? '<p class="note muted" style="margin:6px 0 0">Das Dach nimmt Licht. Nicht bei Feldern oder Farmen, die Sonne brauchen.</p>' : ''}`
  }
  return `
    <div class="block">
      <div class="block-head"><button class="linkish small" data-act="deselect">← Zurück zum Bauen</button><span class="block-meta">${w} × ${d} · ${h} hoch</span></div>
      <div class="stack">
        <input class="field" id="placement-name" data-rename-placement="${p.id}" value="${esc(p.name)}" aria-label="Name des Bauwerks" />
        <div class="row wrap">
          <button class="btn small icon" data-act="rotL" title="Gegen den Uhrzeigersinn drehen">${I.rotL}</button>
          <button class="btn small icon" data-act="rotR" title="Im Uhrzeigersinn drehen (R)">${I.rotR}</button>
          ${p.source.generator === 'vorlage' ? '' : `<button class="chip" data-act="mirror" aria-pressed="${p.mirror}">Spiegeln</button>`}
          ${entry?.seeded ? `<button class="chip" data-act="variant">Andere Variante</button>` : ''}
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
        ${cut ? `<p class="note muted" style="margin:0">Gelände: <b>${num(cut)}</b> Blöcke abtragen</p>` : ''}
        ${hits.has(p.id) ? '<p class="note bad" style="margin:0">Überschneidet sich mit einem anderen Bauwerk.</p>' : ''}
        ${extra}
      </div>
    </div>
    <div class="block">
      <div class="block-head"><span class="block-title">Für Litematica</span></div>
      <div class="coords">
        <div class="coord"><b>X</b><span>${coord(bb.min[0])}</span></div>
        <div class="coord"><b>Y</b><span>${coord(bb.min[1])}</span></div>
        <div class="coord"><b>Z</b><span>${coord(bb.min[2])}</span></div>
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
    switch (b.dataset.act) {
      case 'close': return a.closeWorld()
      case 'textures': return a.loadTextures()
      case 'mojang': return a.mojangTextures()
      case 'collapse':
        S.panelCollapsed = !S.panelCollapsed
        return update()
      case 'deselect':
        S.sel = null
        return update()
      case 'theme': return a.toggleTheme()
      case 'traces':
        S.traces = !S.traces
        try { localStorage.setItem('traces', S.traces ? '1' : '0') } catch { /* egal */ }
        return update()
      case 'cancel-place': return a.cancelPlacing()
      case 'start-place': return a.startPlacing(S.build.type)
      case 'reroll':
        S.build.seeds = newSeeds()
        S.build.formOffset = (S.build.formOffset + 1) % 6
        S.build.pick = 0
        return update()
      case 'learn': return a.learnPalette()
      case 'import-template': return a.importTemplate()
      case 'toggle-facade':
        S.build.facade = !S.build.facade
        return update()
      case 'variant': return p && changePlacement(p.id, q => (q.source.seed = Math.floor(Math.random() * 1e6)))
      case 'facade-onoff': return p && changePlacement(p.id, q => {
        q.source.params = q.source.params.facade
          ? { ...q.source.params, facade: undefined }
          : { ...q.source.params, facade: { palette: S.build.palette, sides: [true, true, true, true], roof: false } }
      })
      case 'facade-roof': return p && changePlacement(p.id, q => {
        const f = q.source.params.facade as { roof: boolean }
        q.source.params = { ...q.source.params, facade: { ...f, roof: !f.roof } }
      })
      case 'litematic': return a.exportLitematic()
      case 'schem': return a.exportSchem()
      case 'del-placement': return p && deletePlacement(p.id)
      case 'rotL': return p && rotatePlacement(p.id, -1)
      case 'rotR': return p && rotatePlacement(p.id, 1)
      case 'mirror': return p && changePlacement(p.id, q => (q.mirror = !q.mirror))
    }
  }))
  el.querySelectorAll<HTMLElement>('[data-spot]').forEach(b => b.addEventListener('click', () => {
    const [x, z] = b.dataset.spot!.split(',').map(Number)
    a.focusPoint(x, z)
  }))
  const choose = (attr: string, fn: (v: string) => void) =>
    el.querySelectorAll<HTMLElement>(`[${attr}]`).forEach(x => x.addEventListener('click', () => {
      fn(x.getAttribute(attr)!)
      update()
    }))
  const firstOf = (cat: Category) => CATALOG.find(e => e.category === cat && !e.hidden)!.id
  choose('data-cat', v => {
    S.build.cat = v as Category
    S.build.type = v === 'vorlage' ? 'vorlage' : firstOf(v as Category)
    S.placing = null
  })
  choose('data-btype', v => {
    S.build.type = v
    S.build.form = 'alle'
  })
  choose('data-form', v => (S.build.form = v))
  choose('data-style', v => {
    S.build.style = v
    S.build.palette = STYLES.find(s => s.id === v)!.palettes[0]
  })
  choose('data-palette', v => (S.build.palette = v))
  choose('data-size', v => (S.build.size = v as Size))
  choose('data-species', v => (S.build.species = v as never))
  choose('data-mix', v => (S.build.mix = v as never))
  choose('data-pick', v => (S.build.pick = Number(v)))
  choose('data-template', v => (S.build.templateId = v))
  el.querySelectorAll<HTMLElement>('[data-del-template]').forEach(x => x.addEventListener('click', () => a.removeTemplate(x.dataset.delTemplate!)))
  choose('data-set-palette', v => {
    const p = selectedPlacement()
    if (p) changePlacement(p.id, q => (q.source.params = { ...q.source.params, palette: v }))
  })
  choose('data-side', v => {
    const p = selectedPlacement()
    if (!p) return
    changePlacement(p.id, q => {
      const f = q.source.params.facade as { sides: boolean[] }
      const sides = [...f.sides]
      sides[Number(v)] = !sides[Number(v)]
      q.source.params = { ...q.source.params, facade: { ...f, sides } }
    })
  })
  const thumb = el.querySelector<HTMLElement>('#cat-seg')
  if (thumb) placeThumb(thumb)
  el.querySelectorAll<HTMLElement>('[data-placement]').forEach(b => b.addEventListener('click', () => {
    // wie Anklicken in 3D: Bau-Ansicht ab der ersten offenen Ebene
    const q = S.project.placements.find(x => x.id === b.dataset.placement)
    S.sel = { kind: 'placement', id: b.dataset.placement! }
    S.guide.layer = q ? firstOpenLayer(q) : null
    S.guide.tab = 'layer'
    a.focusPlacement(b.dataset.placement!, true)
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
  commit(el.querySelector<HTMLInputElement>('[data-rename-placement]'), renamePlacement, 'data-rename-placement')
}
