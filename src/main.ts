import './ui/styles.css'
import type { Vec3 } from './blueprint/blueprint'
import { boundsOf } from './blueprint/placement'
import { loadProject, nudgePlacement, placedOf, rotatePlacement, S, selectedPlacement, subscribe, toast, update } from './app/state'
import * as store from './app/store'
import { WorldSession } from './app/world-session'
import { writeLitematic } from './export/litematic'
import { writeSchem } from './export/schem'
import { MapView } from './map/map-view'
import { blockLabel, Scene3D } from './render/scene'
import { loadTextures } from './render/textures-loader'
import { coord } from './ui/format'
import { placeThumb, play, renderGuide, step, stop } from './ui/guide'
import { I } from './ui/icons'
import { renderSide, type SideActions } from './ui/side-panel'
import type { AreaResult, Box3 } from './world/area'
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
  scene?.applyTheme()
}

try {
  const t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') S.theme = t
} catch { /* privat */ }

// ---------- Ansichten ----------

const map = new MapView($('map'), $('readout'))
let scene: Scene3D | null = null
map.onOpen3d = () => setView('3d')
applyTheme()

const mapTools = document.createElement('div')
mapTools.className = 'map-tools'
mapTools.innerHTML = `
  <button class="btn icon" data-z="in" title="Hineinzoomen">${I.plus}</button>
  <button class="btn icon" data-z="out" title="Herauszoomen">${I.minus}</button>
  <button class="btn icon" data-z="spawn" title="Zum Spawn">${I.target}</button>`
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
  if (v === '3d' && !selectedPlacement()) {
    toast('Erst ein Bauwerk auf der Karte wählen oder platzieren.')
    v = 'map'
  }
  S.view = v
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
    session.onTile = t => {
      map.invalidate()
      if (t.state === 'error') toast(`Region ${t.rx}, ${t.rz}: ${t.error}`, true)
      else if (t.error) toast(t.error)
    }
    if (texturesCache) session.setColors(texturesCache.mapColors)
    await loadProject(session.key, session.info.name, session.info.dataVersion)
    area = null
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
    area = null
    update()
  },
  async loadTextures() {
    const [f] = await pickFile('.jar,.zip')
    if (!f) return
    S.textures = 'loading'
    update()
    try {
      texturesCache = await loadTextures(f)
      S.textures = 'ready'
      S.session?.setColors(texturesCache.mapColors)
      ensureScene().setTextures(texturesCache.mesher)
      lastSceneKey = ''
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
  open3d() {
    setView('3d')
  },
  toggleTheme() {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    S.theme = dark ? 'light' : 'dark'
    try { localStorage.setItem('theme', S.theme) } catch { /* privat */ }
    applyTheme()
    update()
  },
  focusMarker(id) {
    const m = S.project.markers.find(m => m.id === id)
    if (m) map.focus(m.points[0][0] + 0.5, m.points[0][1] + 0.5)
  },
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

// ---------- 3D abgleichen ----------

let area: AreaResult | null = null
let areaLoading = false
let lastSceneKey = ''
const MARGIN = 20

function ensureScene(): Scene3D {
  if (!scene) {
    scene = new Scene3D($('three'))
    scene.onHover = h => {
      $('readout').innerHTML = h
        ? `${blockLabel(h.state)} · X <b>${coord(h.x)}</b> · Y <b>${coord(h.y)}</b> · Z <b>${coord(h.z)}</b>${h.part === 'terrain' ? ' · Gelände' : ''}`
        : ''
    }
    if (texturesCache) scene.setTextures(texturesCache.mesher)
  }
  return scene
}

function contains(outer: Box3, min: Vec3, max: Vec3): boolean {
  return min[0] >= outer.x0 + 4 && max[0] <= outer.x1 - 4 && min[2] >= outer.z0 + 4 && max[2] <= outer.z1 - 4 && min[1] >= outer.y0 && max[1] <= outer.y1
}

async function sync3d(): Promise<void> {
  const p = selectedPlacement()
  if (S.view !== '3d' || !p || !S.session) return
  const sc = ensureScene()
  const { placed, layers } = placedOf(p)
  const b = boundsOf(placed)
  if (!area || !contains(area.box, b.min, b.max)) {
    if (areaLoading) return
    areaLoading = true
    $('stage').classList.add('busy')
    try {
      const box: Box3 = {
        x0: b.min[0] - MARGIN, x1: b.max[0] + MARGIN, z0: b.min[2] - MARGIN, z1: b.max[2] + MARGIN,
        y0: b.min[1] - 14, y1: b.max[1] + 24,
      }
      area = await S.session.area(box)
      lastSceneKey = ''
    } catch (e) {
      toast(`Gelände nicht lesbar: ${(e as Error).message}`, true)
    } finally {
      areaLoading = false
      $('stage').classList.remove('busy')
    }
    return sync3d()
  }
  const key = JSON.stringify([p.id, p.pos, p.rotation, p.mirror, area.box])
  if (key !== lastSceneKey) {
    const sameArea = lastSceneKey && JSON.parse(lastSceneKey)[0] === p.id && JSON.stringify(JSON.parse(lastSceneKey)[4]) === JSON.stringify(area.box)
    if (sameArea) sc.setBuilding(placed, layers)
    else sc.setScene(area, placed, layers)
    lastSceneKey = key
  }
  sc.setGuide(S.guide.layer, S.guide.single)
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
  if (S.view === '3d') void sync3d()
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
  el.innerHTML = `<div><h2>Deine Welt als Karte</h2><p>Weltordner hierher ziehen oder wählen, dann einen Bauplatz anklicken.</p>
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
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  const p = selectedPlacement()
  if (!p) return
  const count = placedOf(p).layers.length
  const moves: Record<string, Vec3> = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1], PageUp: [0, 1, 0], PageDown: [0, -1, 0] }
  if (e.key === '[' || e.key === ']') {
    stop()
    step(e.key === ']' ? 1 : -1, count)
  } else if (e.key === ' ') {
    e.preventDefault()
    S.guide.playing ? stop() : play(count)
  } else if (e.key === 'r' || e.key === 'R') {
    rotatePlacement(p.id, e.shiftKey ? -1 : 1)
  } else if (moves[e.key] && S.view === '3d') {
    e.preventDefault()
    nudgePlacement(p.id, moves[e.key])
  } else if (e.key === 'Escape') {
    S.sel = null
    S.view = 'map'
  } else return
  update()
})

// ---------- Start ----------

void (async () => {
  const handle = await store.get<FileSystemDirectoryHandle>('kv', 'folder')
  if (handle) S.savedFolder = handle.name
  update()
  if (new URLSearchParams(location.search).has('demo')) actions.demo()
})()
