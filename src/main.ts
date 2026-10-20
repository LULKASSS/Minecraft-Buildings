import './ui/styles.css'
import type { Vec3 } from './blueprint/blueprint'
import { addPalette, loadProject, nudgePlacement, placedOf, rotatePlacement, S, selectedArea, selectedPlacement, subscribe, toast, update } from './app/state'
import { AreaView } from './app/area-view'
import * as store from './app/store'
import { WorldSession } from './app/world-session'
import { writeLitematic } from './export/litematic'
import { writeSchem } from './export/schem'
import { MapView } from './map/map-view'
import { loadTextures } from './render/textures-loader'
import { coord } from './ui/format'
import { placeThumb, play, renderGuide, step, stop } from './ui/guide'
import { I } from './ui/icons'
import { renderSide, type SideActions } from './ui/side-panel'
import { learnPalette } from './style/learn'
import { importTemplate, loadTemplates, removeTemplate, versionName } from './app/templates-store'
import { fallbackColor } from './render/block-colors'
import { makeWorld } from './world/demo-world'
import { filesFromDrop, FolderSource, UploadSource, ZipSource, type WorldSource } from './world/source'
import { canConnectFolder, hostDownloads, inFrame } from './app/env'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const $ = (id: string) => document.getElementById(id)!

// ---------- Thema ----------

function applyTheme(): void {
  const t = S.theme
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  map.themeChanged()
  view3d?.scene.applyTheme()
}

try {
  const t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') S.theme = t
  if (localStorage.getItem('traces') === '0') S.traces = false
} catch { /* privat */ }

// ---------- Ansichten ----------

const map = new MapView($('map'), $('readout'))
map.onOpen3d = id => actions.openArea(id)
applyTheme()

const mapTools = document.createElement('div')
mapTools.className = 'map-tools'
mapTools.innerHTML = `
  <button class="btn icon" data-z="in" title="Hineinzoomen">${I.plus}</button>
  <button class="btn icon" data-z="out" title="Herauszoomen">${I.minus}</button>
  <button class="btn icon" data-z="spawn" title="Zum Spawn">${I.target}</button>`
const drawBtn = document.createElement('button')
drawBtn.className = 'btn map-draw'
drawBtn.innerHTML = `${I.rect}Bereich aufziehen`
drawBtn.title = 'Rechteck mit gedrückter Maus aufziehen (oder Umschalttaste + Ziehen)'
drawBtn.addEventListener('click', () => actions.drawArea())
$('map').appendChild(drawBtn)
$('map').appendChild(mapTools)
mapTools.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-z]')
  if (!b) return
  if (b.dataset.z === 'in') map.zoomBy(1.6)
  if (b.dataset.z === 'out') map.zoomBy(1 / 1.6)
  if (b.dataset.z === 'spawn') {
    const sp = S.session?.info.spawn
    if (sp) map.focus(sp[0], sp[2], 2)
  }
})

function setView(v: 'map' | '3d'): void {
  if (v === '3d') {
    const id = S.openArea ?? selectedArea()?.id ?? S.project.areas[0]?.id
    if (!id) {
      toast('Erst auf der Karte einen Bereich aufziehen.')
      return
    }
    return actions.openArea(id)
  }
  if (document.pointerLockElement) document.exitPointerLock()
  S.placing = null
  S.view = 'map'
  update()
}

$('switch').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]')
  if (b) setView(b.dataset.view as 'map' | '3d')
})

// ---------- Welt öffnen ----------

class MemorySource implements WorldSource {
  kind = 'upload' as const
  name = 'Testwelt'
  constructor(private files: Map<string, Uint8Array>) {}
  async read(path: string) {
    const f = this.files.get(path)
    return f ? { blob: new Blob([f as Uint8Array<ArrayBuffer>]), modified: 1 } : null
  }
  async list(dir: string) {
    const pre = dir.replace(/\/?$/, '/')
    return [...this.files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length))
  }
}

async function openSession(src: WorldSource, demo = false): Promise<void> {
  S.busy = 'Welt wird gelesen …'
  update()
  try {
    const session = await WorldSession.open(src, demo)
    S.session?.dispose()
    S.session = session
    const told = new Set<string>()
    session.onTile = t => {
      map.invalidate()
      // jede Meldung nur einmal, sonst stapeln sich beim Hintergrund-Laden die Hinweise
      const msg = t.state === 'error' ? `Region ${t.rx}, ${t.rz}: ${t.error}` : t.error
      if (msg && !told.has(msg)) {
        told.add(msg)
        toast(msg, t.state === 'error')
      }
    }
    session.onProgress = () => update()
    if (texturesCache) session.setColors(texturesCache.mapColors, texturesCache.id)
    await loadProject(session.key, session.info.name, session.info.dataVersion)
    view3d?.close()
    S.view = 'map'
    map.sync()
  } catch (e) {
    toast(String((e as Error).message ?? e), true)
  } finally {
    S.busy = null
    update()
  }
}

function pickFile(accept: string, dir = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    if (dir) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
}

type DirPicker = (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
type PermHandle = FileSystemDirectoryHandle & { requestPermission(o: { mode: 'read' }): Promise<PermissionState> }

const actions: SideActions = {
  async connectFolder() {
    try {
      const handle = await (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker({ id: 'mc-world', mode: 'read' })
      await store.put('kv', 'folder', handle)
      S.savedFolder = handle.name
      await openSession(new FolderSource(handle))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(String((e as Error).message ?? e), true)
    }
  },
  async reopenFolder() {
    const handle = await store.get<PermHandle>('kv', 'folder')
    if (!handle) return actions.connectFolder()
    try {
      if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return
      await openSession(new FolderSource(handle))
    } catch {
      actions.connectFolder()
    }
  },
  async openZip() {
    const [f] = await pickFile('.zip,application/zip')
    if (!f) return
    try {
      await openSession(await ZipSource.open(f))
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
    }
  },
  async uploadFolder() {
    const files = await pickFile('', true)
    if (!files.length) return
    try {
      await openSession(UploadSource.fromFiles(files))
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
    }
  },
  demo() {
    void openSession(new MemorySource(makeWorld()), true)
  },
  closeWorld() {
    S.session?.dispose()
    S.session = null
    S.sel = null
    S.view = 'map'
    S.openArea = null
    view3d?.close()
    update()
  },
  async loadTextures(file?: File) {
    const f = file ?? (await pickFile('.jar,.zip'))[0]
    if (!f) return
    S.textures = 'loading'
    update()
    try {
      texturesCache = await loadTextures(f)
      S.textures = 'ready'
      S.session?.setColors(texturesCache.mapColors, texturesCache.id)
      view3d?.setTextures(texturesCache.mesher)
      map.invalidate()
      toast(`${texturesCache.count} Texturen geladen.`)
    } catch (e) {
      S.textures = 'none'
      toast(String((e as Error).message ?? e), true)
    }
    update()
  },
  exportLitematic() {
    exportAs('litematic')
  },
  exportSchem() {
    exportAs('schem')
  },
  openArea(id) {
    const ar = S.project.areas.find(a => a.id === id)
    if (!ar || !S.session) return
    S.openArea = id
    if (S.sel?.kind !== 'placement' || selectedPlacement()?.areaId !== id) S.sel = { kind: 'area', id }
    S.view = '3d'
    map.setDrawing(false)
    update()
    void ensureView().open(ar)
  },
  drawArea() {
    if (S.view !== 'map') setView('map')
    map.setDrawing(!map.drawing)
  },
  startPlacing(type) {
    S.placing = type
    update()
    // am Handy steht die 3D-Ansicht oben: dorthin zurück, damit man gleich ins Gelände tippen kann
    if (window.innerWidth <= 700) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
  cancelPlacing() {
    S.placing = null
    update()
  },
  toggleTheme() {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    S.theme = dark ? 'light' : 'dark'
    try { localStorage.setItem('theme', S.theme) } catch { /* privat */ }
    applyTheme()
    update()
  },
  focusArea(id) {
    const a = S.project.areas.find(a => a.id === id)
    if (a && S.view === 'map') map.focus((a.x0 + a.x1 + 1) / 2, (a.z0 + a.z1 + 1) / 2)
  },
  focusPoint(x, z) {
    if (S.view !== 'map') setView('map')
    map.focus(x, z, Math.max(map.zoom, 2))
  },
  focusPlacement(id) {
    view3d?.focusPlacement(id)
  },
  learnPalette() {
    if (!view3d) return
    const area = S.project.areas.find(a => a.id === S.openArea)
    const r = learnPalette(view3d.blockCounts(), S.build.style, `Aus ${area?.name ?? 'Bereich'}`)
    if (!r) return toast('In diesem Bereich ist noch zu wenig gebaut, um eine Palette abzulesen.')
    addPalette(r.palette)
    S.build.palette = r.palette.id
    const found = Object.entries(r.roles).map(([role, id]) => `${ROLE_LABEL[role] ?? role}: ${String(id).replace(/_/g, ' ')}`).join(', ')
    toast(`Palette gelernt. ${found || 'Rest aus der ähnlichsten fertigen Palette.'}`)
    update()
  },
  async importTemplate() {
    const [f] = await pickFile('.litematic')
    if (!f) return
    try {
      const t = await importTemplate(f)
      S.build.templateId = t.id
      const warn = t.dataVersion !== S.project.dataVersion ? ` Getestet mit ${versionName(t.dataVersion)}, deine Welt ist ${versionName(S.project.dataVersion)}: im Spiel prüfen, ob sie noch läuft.` : ''
      toast(`Vorlage „${t.name}“ geladen.${warn}`, !!warn)
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
    }
    update()
  },
  async removeTemplate(id) {
    await removeTemplate(id)
    if (S.build.templateId === id) S.build.templateId = null
    update()
  },
  terrainCut(id) {
    return view3d?.terrainCut(id) ?? 0
  },
  textured() {
    return texturesCache?.mesher ?? null
  },
  blockColor(id) {
    const name = id.includes(':') ? id : `minecraft:${id}`
    return texturesCache?.mapColors[name] ?? fallbackColor(name)
  },
  versionName,
}

let texturesCache: Awaited<ReturnType<typeof loadTextures>> | null = null

function exportAs(kind: 'litematic' | 'schem'): void {
  const p = selectedPlacement()
  if (!p) return
  const { placed } = placedOf(p)
  const meta = { name: p.name, dataVersion: S.project.dataVersion, description: `Ursprung ${placed.origin.join(' ')}` }
  const bytes = kind === 'litematic' ? writeLitematic(placed.blueprint, meta) : writeSchem(placed.blueprint, meta)
  const filename = `${p.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'bauwerk'}.${kind}`
  void saveFile(filename, bytes).then(how => {
    if (!how) return
    const where = `In Litematica auf ${placed.origin.map(coord).join(' ')} setzen.`
    toast(how === 'zip' ? `Als ZIP gespeichert (die Vorschau erlaubt keine .${kind}). Entpacken, dann ${where}` : `Gespeichert. ${where}`)
  })
}

/** Normal als Download; eingebettet über den Speichern-Dialog der Plattform, die nur bestimmte Endungen erlaubt (u. a. .zip). */
async function saveFile(filename: string, bytes: Uint8Array): Promise<'file' | 'zip' | null> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
  if (!inFrame) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return 'file'
  }
  const dl = await hostDownloads()
  if (!dl) {
    toast('Speichern geht in dieser eingebetteten Ansicht nicht. Bitte die App direkt öffnen.', true)
    return null
  }
  const zw = new ZipWriter(new BlobWriter('application/zip'))
  await zw.add(filename, new Uint8ArrayReader(bytes))
  const zip = await zw.close()
  try {
    await dl.save({ filename: `${filename}.zip`, data: zip })
    return 'zip'
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code !== 'declined') toast(`Speichern nicht möglich (${code ?? 'Fehler'}).`, true)
    return null
  }
}

const ROLE_LABEL: Record<string, string> = { sockel: 'Sockel', wall: 'Wand', frame: 'Balken', roof: 'Dach', trim: 'Kante', floor: 'Boden', window: 'Fenster', door: 'Tür', detail: 'Holz', light: 'Licht', accent: 'Stoff' }

// ---------- 3D ----------

let view3d: AreaView | null = null

function ensureView(): AreaView {
  if (!view3d) {
    view3d = new AreaView($('three'))
    if (texturesCache) view3d.setTextures(texturesCache.mesher)
    const progress = document.createElement('div')
    progress.className = 'progress'
    progress.hidden = true
    $('three').appendChild(progress)
    view3d.onProgress = (done, total) => {
      progress.hidden = done >= total
      progress.innerHTML = `<span>Gelände ${Math.round((done / Math.max(1, total)) * 100)} %</span><i style="width:${(done / Math.max(1, total)) * 100}%"></i>`
    }
    const home = document.createElement('button')
    home.className = 'btn map-draw'
    home.innerHTML = `${I.target}Übersicht`
    home.title = 'Kamera zurück über den Bereich'
    home.addEventListener('click', () => view3d?.overview())
    $('three').appendChild(home)
    view3d.onAimText = html => {
      if (S.view === '3d') $('readout').innerHTML = html
    }
  }
  return view3d
}

// ---------- Zeichnen ----------

function render(): void {
  renderSide($('side'), actions)
  renderGuide($('guide'))
  $('map').hidden = S.view !== 'map'
  $('three').hidden = S.view !== '3d'
  document.querySelectorAll<HTMLElement>('#switch [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === S.view)))
  placeThumb($('switch'))
  $('switch').hidden = !S.session
  renderEmpty()
  map.invalidate()
  drawBtn.hidden = !S.session
  drawBtn.setAttribute('aria-pressed', String(map.drawing))
  $('stage').classList.toggle('placing', !!S.placing)
  if (S.view === '3d') view3d?.sync()
  else if (!S.session) $('readout').textContent = ''
}

function renderEmpty(): void {
  let el = document.getElementById('empty')
  if (S.session) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'empty'
    el.className = 'empty'
    $('map').appendChild(el)
  }
  const label = S.savedFolder && canConnectFolder() ? `Weiter mit „${S.savedFolder}“` : canConnectFolder() ? 'Welt-Ordner verbinden' : 'Welt-Ordner wählen'
  el.innerHTML = `<div><h2>Deine Welt als Karte</h2><p>Weltordner hierher ziehen oder wählen, dann einen Bereich aufziehen.</p>
    <button class="btn primary" data-e="go">${I.folder}${label}</button></div>`
  el.querySelector('[data-e="go"]')!.addEventListener('click', () => (!canConnectFolder() ? actions.uploadFolder() : S.savedFolder ? actions.reopenFolder() : actions.connectFolder()))
}

subscribe(render)

// ---------- Ordner oder ZIP hineinziehen ----------

const stage = $('stage')
stage.addEventListener('dragover', e => {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  stage.classList.add('drop')
})
stage.addEventListener('dragleave', e => {
  if (e.target === stage || !stage.contains(e.relatedTarget as Node)) stage.classList.remove('drop')
})
stage.addEventListener('drop', async e => {
  e.preventDefault()
  stage.classList.remove('drop')
  const dt = e.dataTransfer
  if (!dt) return
  try {
    const jar = [...dt.files].find(f => /\.jar$/i.test(f.name))
    if (jar && dt.files.length === 1) return void (S.session ? actions.loadTextures(jar) : toast('Erst die Welt laden, dann die .jar.'))
    const zip = [...dt.files].find(f => /\.zip$/i.test(f.name))
    if (zip && dt.files.length === 1) return await openSession(await ZipSource.open(zip))
    S.busy = 'Ordner wird gelesen …'
    update()
    const entries = await filesFromDrop(dt.items)
    await openSession(new UploadSource(entries))
  } catch (err) {
    S.busy = null
    toast(String((err as Error).message ?? err), true)
    update()
  }
})

// ---------- Tastatur ----------

window.addEventListener('keydown', e => {
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
  if (e.key === 'Escape') {
    if (map.drawing) map.setDrawing(false)
    else if (S.placing) S.placing = null
    else return
    update()
    return
  }
  if ((e.key === 'r' || e.key === 'R') && S.placing) {
    view3d?.rotateGhost(e.shiftKey ? -1 : 1)
    return
  }
  if ((e.key === 'b' || e.key === 'B') && S.view === 'map' && S.session) {
    actions.drawArea()
    return
  }
  const p = selectedPlacement()
  if (!p) return
  const count = placedOf(p).layers.length
  const moves: Record<string, Vec3> = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1], PageUp: [0, 1, 0], PageDown: [0, -1, 0] }
  if (e.key === '[' || e.key === ']') {
    stop()
    step(e.key === ']' ? 1 : -1, count)
  } else if (e.key === 'p' || e.key === 'P') {
    S.guide.playing ? stop() : play(count)
  } else if (e.key === 'r' || e.key === 'R') {
    rotatePlacement(p.id, e.shiftKey ? -1 : 1)
  } else if (moves[e.key] && S.view === '3d') {
    e.preventDefault()
    nudgePlacement(p.id, moves[e.key])
  } else return
  update()
})

// ---------- Start ----------

void (async () => {
  await loadTemplates()
  const handle = await store.get<FileSystemDirectoryHandle>('kv', 'folder')
  if (handle) S.savedFolder = handle.name
  update()
  if (new URLSearchParams(location.search).has('demo')) actions.demo()
})()
