import './ui/styles.css'
import type { Vec3 } from './blueprint/blueprint'
import { addPalette, loadProject, nudgePlacement, placedOf, rotatePlacement, S, selectedPlacement, subscribe, toast, update } from './app/state'
import { WorldView } from './app/world-view'
import * as store from './app/store'
import { WorldSession } from './app/world-session'
import { writeLitematic } from './export/litematic'
import { writeSchem } from './export/schem'
import { MapView } from './map/map-view'
import { loadTextures } from './render/textures-loader'
import { cachedJar, fetchJar } from './render/mojang'
import { coord } from './ui/format'
import { play, renderGuide, step, stop } from './ui/guide'
import { I } from './ui/icons'
import { renderSide, type SideActions } from './ui/side-panel'
import { learnPalette } from './style/learn'
import { importTemplate, loadTemplates, removeTemplate, versionName } from './app/templates-store'
import { fallbackColor } from './render/block-colors'
import { makeWorld } from './world/demo-world'
import { ZipSource, type WorldSource } from './world/source'
import { dirFromEntry, dirFromFiles, dirFromHandle, DirSource, jarCandidates, scanFolder, type Dir, type Scan, type WorldEntry } from './world/minecraft'
import { canConnectFolder, hostDownloads, inFrame } from './app/env'
import { isTyping } from './render/fly'
import { esc } from './ui/format'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const $ = (id: string) => document.getElementById(id)!

// ---------- Thema ----------

function applyTheme(): void {
  const t = S.theme
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  mini.themeChanged()
  view3d.scene.applyTheme()
}

try {
  const t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') S.theme = t
  if (localStorage.getItem('traces') === '0') S.traces = false
} catch { /* privat */ }

// ---------- 3D und Karte ----------

const view3d = new WorldView($('three'))
const mini = new MapView($('mini-map'), $('mini-readout'))
mini.onJump = (x, z) => {
  view3d.jumpTo(x, z)
  if (S.bigMap) setBigMap(false)
}
view3d.onCamera = () => {
  const [x, , z] = view3d.scene.focusWorld()
  mini.setCamera(x, z, view3d.scene.heading())
}
view3d.onAimText = html => ($('status').innerHTML = html)
let groundLoading = 0
view3d.onProgress = n => {
  if (n === groundLoading) return
  groundLoading = n
  renderStatusChip()
}

function setBigMap(on: boolean): void {
  S.bigMap = on
  mini.setBig(on)
  update()
}
$('mini-toggle').addEventListener('click', () => setBigMap(!S.bigMap))

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

/** Ergebnis des zuletzt freigegebenen Ordners: Welten zur Auswahl und Spielversionen für die Texturen. */
let scan: Scan | null = null
let choosing = false

async function openSession(src: WorldSource, demo = false): Promise<void> {
  S.busy = 'Welt wird gelesen …'
  update()
  try {
    const session = await WorldSession.open(src, demo)
    S.session?.dispose()
    view3d.close()
    S.session = session
    choosing = false
    const told = new Set<string>()
    session.onTile = t => {
      mini.invalidate()
      view3d.tileChanged(t.rx, t.rz)
      // jede Meldung nur einmal, sonst stapeln sich beim Laden im Hintergrund die Hinweise
      const msg = t.state === 'error' ? `Region ${t.rx}, ${t.rz}: ${t.error}` : t.error
      if (msg && !told.has(msg)) {
        told.add(msg)
        toast(msg, t.state === 'error')
      }
    }
    session.onProgress = () => {
      // sobald alles gelesen ist: einmal zur Base, falls man sich noch nicht selbst bewegt hat
      const p = session.progress()
      const spot = session.hotspots()[0]
      if (p.done >= p.total && spot && view3d.maybeGoHome(spot.x, spot.z)) toast('Zu eurer Base gesprungen: dort wart ihr am längsten.')
      update()
    }
    if (texturesCache) session.setColors(texturesCache.mapColors, texturesCache.id)
    await loadProject(session.key, session.info.name, session.info.dataVersion)
    S.busy = null
    update()
    view3d.open(session)
    if (!texturesCache && !demo) void autoTextures(session.info.versionName)
  } catch (e) {
    toast(String((e as Error).message ?? e), true)
  } finally {
    S.busy = null
    update()
  }
}

/**
 * Texturen ohne Zutun: .jar aus dem gewählten Ordner (mehrere Kandidaten, leere Loader-Hüllen werden übersprungen),
 * sonst eine früher von Mojang geladene, sonst jetzt von Mojang laden. Niemand soll suchen müssen, wo seine .jar liegt.
 */
async function autoTextures(version: string): Promise<void> {
  for (const v of (scan ? jarCandidates(scan.versions, version) : []).slice(0, 4)) {
    if (await useJar(v.jar!, scan!.kind === 'modrinth' ? `Modrinth (${v.version})` : `versions/${v.version}/${v.version}.jar`, true)) return
  }
  const cached = version ? await cachedJar(version) : null
  if (cached && (await useJar(cached, `Minecraft ${version} (gespeichert)`, true))) return
  await actions.mojangTextures()
}

async function openFolder(root: Dir, kind: WorldSource['kind'], lastWorld?: string | null): Promise<void> {
  S.busy = 'Ordner wird durchsucht …'
  update()
  try {
    scan = await scanFolder(root)
  } catch (e) {
    S.busy = null
    toast(String((e as Error).message ?? e), true)
    return update()
  }
  S.busy = null
  if (!scan.worlds.length) {
    toast(scan.kind === 'minecraft' ? 'Im Ordner „saves“ liegt keine Welt.' : 'Keine Welt gefunden (keine level.dat). Bitte den Minecraft-Ordner oder einen Weltordner wählen.', true)
    return update()
  }
  const again = lastWorld ? scan.worlds.find(w => w.folder === lastWorld) : null
  if (scan.worlds.length === 1 || again) return openWorldEntry(again ?? scan.worlds[0], kind)
  choosing = true
  update()
  pendingKind = kind
}

let pendingKind: WorldSource['kind'] = 'folder'

function openWorldEntry(w: WorldEntry, kind: WorldSource['kind'] = pendingKind): Promise<void> {
  try { localStorage.setItem('lastWorld', w.folder) } catch { /* privat */ }
  return openSession(new DirSource(w.dir, kind))
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

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

function lastWorld(): string | null {
  try { return localStorage.getItem('lastWorld') } catch { return null }
}

const start = {
  async connect() {
    try {
      const handle = await (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker({ id: 'minecraft', mode: 'read' })
      await store.put('kv', 'folder', handle)
      S.savedFolder = handle.name
      await openFolder(dirFromHandle(handle), 'folder')
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') return
      // Chrome sperrt manche Systemordner für die Freigabe: dann geht Auswählen oder Hineinziehen
      toast(err.name === 'SecurityError' || /system/i.test(err.message) ? 'Diesen Ordner gibt Chrome nicht frei. Bitte mit „Ordner auswählen“ oder per Hineinziehen.' : String(err.message ?? err), true)
    }
  },
  async reopen() {
    const handle = await store.get<PermHandle>('kv', 'folder')
    if (!handle) return start.connect()
    try {
      if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return
      await openFolder(dirFromHandle(handle), 'folder', lastWorld())
    } catch {
      void start.connect()
    }
  },
  async choose() {
    const files = await pickFile('', true)
    if (!files.length) return
    const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    await openFolder(dirFromFiles(files.map(f => ({ path: rel(f), file: f }))), 'upload', lastWorld())
  },
  async zip() {
    const [f] = await pickFile('.zip,application/zip')
    if (!f) return
    try {
      scan = null
      await openSession(await ZipSource.open(f))
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
    }
  },
  demo() {
    scan = null
    void openSession(new MemorySource(makeWorld()), true)
  },
}

/** .jar laden; leise = Fehler nicht melden (beim automatischen Durchprobieren). Liefert, ob es geklappt hat. */
async function useJar(f: File, from: string, quiet = false): Promise<boolean> {
  S.textures = 'loading'
  S.texturesFrom = 'Texturen werden gelesen …'
  update()
  try {
    texturesCache = await loadTextures(f)
    S.textures = 'ready'
    S.texturesFrom = from
    S.session?.setColors(texturesCache.mapColors, texturesCache.id)
    view3d.setTextures(texturesCache.mesher)
    mini.invalidate()
    update()
    // .jar aus dem Ordner im Browser behalten: wer später nur das Profil oder die Welt wählt, hat trotzdem Texturen
    const version = S.session?.info.versionName
    if (version && !/gespeichert|von Mojang/.test(from)) void store.put('kv', `jar:${version}`, f).catch(e => console.warn('jar merken', e))
    return true
  } catch (e) {
    S.textures = 'none'
    S.texturesFrom = null
    if (!quiet) toast(String((e as Error).message ?? e), true)
    update()
    return false
  }
}

const actions: SideActions = {
  closeWorld() {
    S.session?.dispose()
    S.session = null
    S.sel = null
    S.placing = null
    view3d.close()
    choosing = !!scan && scan.worlds.length > 1
    update()
  },
  async loadTextures(file?: File) {
    const f = file ?? (await pickFile('.jar,.zip'))[0]
    if (f) await useJar(f, f.name)
  },
  async mojangTextures() {
    const version = S.session?.info.versionName || ''
    const json = scan?.versions.find(v => v.version === version)?.json ?? null
    S.textures = 'loading'
    S.texturesFrom = 'Lade von Mojang …'
    update()
    try {
      const f = await fetchJar(version, (done, total) => {
        S.texturesFrom = `Lade von Mojang … ${Math.round((done / total) * 100)} %`
        update()
      }, json)
      await useJar(f, `Minecraft ${f.name.replace(/\.jar$/, '')} (von Mojang)`)
    } catch (e) {
      S.textures = 'none'
      S.texturesFrom = null
      // „Failed to fetch“ heißt: Anfrage gar nicht rausgegangen (in der claude.ai-Vorschau vermutlich gesperrt)
      const blocked = e instanceof TypeError
      toast(blocked
        ? 'Die Vorschau lässt den Download von Mojang nicht zu. Wähl einmal den ganzen ModrinthApp-Ordner (oder den Minecraft-Ordner) – die .jar von dort merkt sich die App, danach reicht auch das Profil.'
        : `Texturen konnten nicht von Mojang geladen werden (${(e as Error).message}).`, true)
      update()
    }
  },
  exportLitematic() {
    exportAs('litematic')
  },
  exportSchem() {
    exportAs('schem')
  },
  startPlacing(type) {
    S.placing = type
    update()
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
  focusPoint(x, z) {
    view3d.jumpTo(x, z, 140)
  },
  focusPlacement(id, tight) {
    view3d.focusPlacement(id, tight)
  },
  learnPalette() {
    const r = learnPalette(view3d.blockCounts(), S.build.style, 'Aus der Umgebung')
    if (!r) return toast('Hier ist noch zu wenig gebaut, um eine Palette abzulesen. Näher an eure Bauten heranfliegen.')
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
    return view3d.terrainCut(id)
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

// ---------- Zeichnen ----------

function render(): void {
  const on = !!S.session
  renderSide($('side'), actions)
  renderGuide($('guide'), { textured: texturesCache?.mesher ?? null, color: s => actions.blockColor(s.replace(/\[.*$/, '')) })
  renderStart()
  renderTools()
  renderStatusChip()
  $('mini').hidden = !on
  $('mini').classList.toggle('big', S.bigMap)
  $('mini-toggle').innerHTML = S.bigMap ? I.shrink : I.expand
  $('mini-toggle').title = S.bigMap ? 'Karte klein (M)' : 'Karte groß (M)'
  document.body.classList.toggle('placing', !!S.placing)
  document.body.classList.toggle('has-guide', !!selectedPlacement())
  document.body.classList.toggle('panel-collapsed', S.panelCollapsed)
  mini.invalidate()
  if (on) view3d.sync()
  else $('status').textContent = ''
}

function renderTools(): void {
  const el = $('tools')
  el.hidden = !S.session
  if (!S.session) return
  const fly = S.camMode === 'fly'
  el.innerHTML = `
    <button class="btn tool ${fly ? 'accent' : ''}" data-t="fly" title="Flugmodus mit Fadenkreuz (F)" aria-pressed="${fly}">${I.fly}<span>Flugmodus</span><kbd>F</kbd></button>
    <button class="btn tool icon" data-t="home" title="Zurück zum Start">${I.home}</button>
    <button class="btn tool icon" data-t="theme" title="Hell / Dunkel">${document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? I.sun : I.moon}</button>`
}
$('tools').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')
  if (!b) return
  if (b.dataset.t === 'fly') view3d.setMode(S.camMode === 'fly' ? 'orbit' : 'fly')
  if (b.dataset.t === 'home') view3d.home()
  if (b.dataset.t === 'theme') actions.toggleTheme()
})

/** Kleiner Hinweis oben: was gerade lädt. */
function renderStatusChip(): void {
  let el = document.getElementById('loading')
  if (!el) {
    el = document.createElement('div')
    el.id = 'loading'
    el.className = 'loading-chip'
    $('app').appendChild(el)
  }
  const s = S.session
  const p = s?.progress()
  const parts: string[] = []
  if (s && groundLoading) parts.push('Gelände lädt')
  if (p && p.done < p.total) parts.push(`Karte ${p.done} / ${p.total}`)
  if (S.textures === 'loading') parts.push(S.texturesFrom ?? 'Texturen')
  el.hidden = !parts.length
  el.innerHTML = `<span class="dot busy"></span>${esc(parts.join(' · '))}`
}

function renderStart(): void {
  const el = $('start')
  el.hidden = !!S.session
  if (S.session) return
  if (S.busy) {
    el.innerHTML = `<div class="start-card"><div class="status-line"><span class="dot busy"></span>${esc(S.busy)}</div></div>`
    return
  }
  if (choosing && scan) {
    const rows = scan.worlds.map((w, i) => `<button class="item" data-world="${i}">
        <span class="sq"></span><span class="grow"><span class="item-name" style="display:block">${esc(w.name)}</span>
        <span class="item-sub">${w.lastPlayed ? `zuletzt ${new Date(w.lastPlayed).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${w.versionName ? ` · ${esc(w.versionName)}` : ''}${w.folder !== w.name ? ` · ${esc(w.folder)}` : ''}</span></span></button>`).join('')
    el.innerHTML = `<div class="start-card wide">
      <h2>Welche Welt?</h2>
      <p class="muted">Zuletzt gespielte zuerst. Ein heruntergeladenes Realm liegt hier wie eine normale Welt.</p>
      <div class="list world-list">${rows}</div>
      <button class="linkish small" data-s="back">Anderen Ordner wählen</button></div>`
    el.querySelectorAll<HTMLElement>('[data-world]').forEach(b => b.addEventListener('click', () => void openWorldEntry(scan!.worlds[Number(b.dataset.world)])))
    el.querySelector('[data-s="back"]')!.addEventListener('click', () => {
      choosing = false
      update()
    })
    return
  }
  // Chrome gibt auf dem Mac nichts unter ~/Library frei (Sperrliste der Ordner-Freigabe), dort also auswählen oder hineinziehen
  const picker = canConnectFolder() && !isMac
  el.innerHTML = `<div class="start-card">
    <h2>Eure Welt in 3D</h2>
    <p class="muted">Gib den Minecraft-Ordner frei. Die App findet eure Welten und die Spiel-.jar für die Texturen selbst. Alles bleibt auf diesem Rechner.</p>
    <div class="stack">
      ${picker && S.savedFolder ? `<button class="btn primary" data-s="reopen">${I.folder}Weiter mit „${esc(S.savedFolder)}“</button>` : ''}
      ${picker ? `<button class="btn ${S.savedFolder ? '' : 'primary'}" data-s="connect">${I.folder}Minecraft-Ordner freigeben</button>` : ''}
      <button class="btn ${picker ? '' : 'primary'}" data-s="choose">${I.folder}${picker ? 'Ordner auswählen' : 'Minecraft-Ordner auswählen'}</button>
    </div>
    <p class="note muted">${isMac ? 'Im Auswahlfenster <b>⇧⌘G</b> drücken, <b>~/Library/Application Support/minecraft</b> eingeben, „Hochladen“ bestätigen (es wird nichts hochgeladen, Chrome nennt das nur so). Oder den Ordner aus dem Finder hierher ziehen. Mit der Modrinth App: deren Ordner wählen (der mit „profiles“ und „meta“, meist ~/Library/Application Support/ModrinthApp).' : 'Unter Windows: <b>%appdata%\\.minecraft</b>. Oder den Ordner hierher ziehen.'}</p>
    <div class="row start-more"><button class="linkish small" data-s="zip">Welt als ZIP</button><button class="linkish small" data-s="demo">Mit Testwelt ausprobieren</button></div>
  </div>`
  el.querySelectorAll<HTMLElement>('[data-s]').forEach(b => b.addEventListener('click', () => void start[b.dataset.s as keyof typeof start]()))
}

subscribe(render)

// ---------- Ordner, ZIP oder .jar hineinziehen ----------

const app = $('app')
app.addEventListener('dragover', e => {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  app.classList.add('drop')
})
app.addEventListener('dragleave', e => {
  if (e.target === app || !app.contains(e.relatedTarget as Node)) app.classList.remove('drop')
})
app.addEventListener('drop', async e => {
  e.preventDefault()
  app.classList.remove('drop')
  const dt = e.dataTransfer
  if (!dt) return
  try {
    const jar = [...dt.files].find(f => /\.jar$/i.test(f.name))
    if (jar && dt.files.length === 1) return void (S.session ? useJar(jar, jar.name) : toast('Erst die Welt laden, dann die .jar.'))
    const zip = [...dt.files].find(f => /\.zip$/i.test(f.name))
    if (zip && dt.files.length === 1) return await openSession(await ZipSource.open(zip))
    const entry = [...dt.items].map(i => i.webkitGetAsEntry?.()).find(x => x?.isDirectory)
    if (!entry) return toast('Bitte einen Ordner hineinziehen (Minecraft-Ordner oder eine Welt).', true)
    await openFolder(dirFromEntry(entry as FileSystemDirectoryEntry), 'upload', lastWorld())
  } catch (err) {
    S.busy = null
    toast(String((err as Error).message ?? err), true)
    update()
  }
})

// ---------- Tastatur ----------

window.addEventListener('keydown', e => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
  if (!S.session) return
  if (e.key === 'Escape') {
    if (S.placing) S.placing = null
    else if (S.bigMap) S.bigMap = false
    else if (S.camMode === 'fly') view3d.setMode('orbit')
    else if (S.sel) S.sel = null
    else return
    mini.setBig(S.bigMap)
    update()
    return
  }
  if (e.code === 'KeyF') {
    view3d.setMode(S.camMode === 'fly' ? 'orbit' : 'fly')
    return
  }
  if (e.code === 'KeyM') {
    setBigMap(!S.bigMap)
    return
  }
  if (e.code === 'KeyR' && S.placing) {
    view3d.rotateGhost(e.shiftKey ? -1 : 1)
    return
  }
  const p = selectedPlacement()
  if (!p) return
  const count = placedOf(p).layers.length
  const moves: Record<string, Vec3> = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1], PageUp: [0, 1, 0], PageDown: [0, -1, 0] }
  // In der Bau-Ansicht (eine Ebene gewählt) blättern die Pfeiltasten durch die Ebenen, statt das Bauwerk zu verschieben
  const layerKeys: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }
  if (e.key === '[' || e.key === ']' || (S.guide.layer !== null && e.key in layerKeys)) {
    e.preventDefault()
    stop()
    step(e.key === ']' ? 1 : e.key === '[' ? -1 : layerKeys[e.key], count)
  } else if (e.code === 'KeyP') {
    S.guide.playing ? stop() : play(count)
  } else if (e.code === 'KeyR') {
    rotatePlacement(p.id, e.shiftKey ? -1 : 1)
  } else if (moves[e.key]) {
    e.preventDefault()
    nudgePlacement(p.id, moves[e.key])
  } else return
  update()
})

// ---------- Start ----------

applyTheme()
void (async () => {
  await loadTemplates()
  const handle = await store.get<FileSystemDirectoryHandle>('kv', 'folder')
  if (handle) S.savedFolder = handle.name
  update()
  if (new URLSearchParams(location.search).has('demo')) start.demo()
})()

// für den Rundgang im Browser (Kamera prüfen und steuern)
;(window as unknown as { __bp: unknown }).__bp = { view3d, S, mini }
