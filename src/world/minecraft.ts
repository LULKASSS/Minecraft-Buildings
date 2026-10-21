// Den ganzen Minecraft-Ordner freigeben: Welten aus saves/, Spiel-.jar aus versions/ (für die Texturen).
// Geht auch mit dem saves-Ordner oder einem einzelnen Weltordner. Gelesen wird nur, was gebraucht wird.

import { parseLevel } from './level'
import type { WorldFile, WorldSource } from './source'

/** Ordner, egal woher: verbunden (Chrome), hineingezogen oder per Dateiauswahl. */
export interface Dir {
  name: string
  entries(): Promise<{ name: string; kind: 'file' | 'dir' }[]>
  dir(name: string): Promise<Dir | null>
  file(name: string): Promise<File | null>
}

export function dirFromHandle(h: FileSystemDirectoryHandle): Dir {
  return {
    name: h.name,
    async entries() {
      const out: { name: string; kind: 'file' | 'dir' }[] = []
      for await (const [name, e] of (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries())
        out.push({ name, kind: e.kind === 'file' ? 'file' : 'dir' })
      return out
    },
    async dir(name) {
      try {
        return dirFromHandle(await h.getDirectoryHandle(name))
      } catch {
        return null
      }
    },
    async file(name) {
      try {
        return await (await h.getFileHandle(name)).getFile()
      } catch {
        return null
      }
    },
  }
}

/** Hineingezogener Ordner: erst beim Öffnen eines Unterordners wird er gelesen. */
export function dirFromEntry(e: FileSystemDirectoryEntry): Dir {
  let cache: Promise<FileSystemEntry[]> | null = null
  const all = () =>
    (cache ??= (async () => {
      const reader = e.createReader()
      const out: FileSystemEntry[] = []
      for (;;) {
        // readEntries liefert in Portionen (Chrome: 100), bis eine leere Liste kommt
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) return out
        out.push(...batch)
      }
    })())
  return {
    name: e.name,
    async entries() {
      return (await all()).map(x => ({ name: x.name, kind: x.isFile ? 'file' : 'dir' }))
    },
    async dir(name) {
      const x = (await all()).find(y => y.name === name && y.isDirectory)
      return x ? dirFromEntry(x as FileSystemDirectoryEntry) : null
    },
    async file(name) {
      const x = (await all()).find(y => y.name === name && y.isFile)
      return x ? new Promise<File>((res, rej) => (x as FileSystemFileEntry).file(res, rej)) : null
    },
  }
}

interface Node { dirs: Map<string, Node>; files: Map<string, File> }

/** Dateiliste aus <input webkitdirectory> (oder Tests) als Ordnerbaum. */
export function dirFromFiles(list: { path: string; file: File }[]): Dir {
  const root: Node = { dirs: new Map(), files: new Map() }
  for (const { path, file } of list) {
    const parts = path.split('/').filter(Boolean)
    let n = root
    for (const p of parts.slice(0, -1)) {
      let c = n.dirs.get(p)
      if (!c) n.dirs.set(p, (c = { dirs: new Map(), files: new Map() }))
      n = c
    }
    n.files.set(parts[parts.length - 1], file)
  }
  // gewählter Ordner selbst ist die erste Pfadstufe
  const top = root.files.size === 0 && root.dirs.size === 1 ? [...root.dirs.entries()][0] : ['Ordner', root] as const
  const wrap = (name: string, n: Node): Dir => ({
    name,
    async entries() {
      return [...[...n.dirs.keys()].map(k => ({ name: k, kind: 'dir' as const })), ...[...n.files.keys()].map(k => ({ name: k, kind: 'file' as const }))]
    },
    async dir(k) {
      const c = n.dirs.get(k)
      return c ? wrap(k, c) : null
    },
    async file(k) {
      return n.files.get(k) ?? null
    },
  })
  return wrap(top[0], top[1])
}

async function walk(d: Dir, path: string): Promise<Dir | null> {
  let cur: Dir | null = d
  for (const p of path.split('/').filter(Boolean)) {
    if (!cur) return null
    cur = await cur.dir(p)
  }
  return cur
}

/** Weltquelle über einem Ordner. */
export class DirSource implements WorldSource {
  constructor(readonly root: Dir, readonly kind: WorldSource['kind'] = 'folder') {}
  get name() {
    return this.root.name
  }

  async read(path: string): Promise<WorldFile | null> {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    const d = await walk(this.root, parts.join('/'))
    const f = d ? await d.file(name) : null
    return f ? { blob: f, modified: f.lastModified } : null
  }

  async list(dir: string): Promise<string[]> {
    const d = await walk(this.root, dir)
    return d ? (await d.entries()).filter(e => e.kind === 'file').map(e => e.name) : []
  }
}

export interface WorldEntry {
  /** Ordnername unter saves */
  folder: string
  dir: Dir
  name: string
  lastPlayed: number
  versionName: string
  dataVersion: number
}

export interface VersionEntry {
  version: string
  jar: File | null
  /** versions/<v>/<v>.json: darin steht, wo Mojang die .jar bereitstellt */
  json: File | null
}

export interface Scan {
  kind: 'minecraft' | 'modrinth' | 'prism' | 'saves' | 'world'
  worlds: WorldEntry[]
  versions: VersionEntry[]
}

const MODDED = /fabric|forge|quilt|optifine|labymod|lunar|feather|badlion|iris|sodium/i

async function readWorld(folder: string, d: Dir): Promise<WorldEntry | null> {
  const f = await d.file('level.dat')
  if (!f) return null
  try {
    const l = parseLevel(new Uint8Array(await f.arrayBuffer()))
    return { folder, dir: d, name: l.name, lastPlayed: l.lastPlayed || f.lastModified, versionName: l.versionName, dataVersion: l.dataVersion }
  } catch {
    return { folder, dir: d, name: folder, lastPlayed: f.lastModified, versionName: '', dataVersion: 0 }
  }
}

const subdirs = async (d: Dir) => (await d.entries()).filter(e => e.kind === 'dir').map(e => e.name)

/** Welten in einem saves-Ordner; label kommt vor den Ordnernamen (Profil bei Modrinth/Prism). */
async function worldsIn(saves: Dir, label = ''): Promise<WorldEntry[]> {
  const names = (await subdirs(saves)).slice(0, 300)
  const found = await Promise.all(names.map(async n => {
    const d = await saves.dir(n)
    return d ? readWorld(label ? `${label}/${n}` : n, d) : null
  }))
  return found.filter((w): w is WorldEntry => !!w)
}

/** versions/<v>/<v>.jar (offizieller Launcher, Modrinth unter meta/versions). */
async function versionsIn(vdir: Dir): Promise<VersionEntry[]> {
  const out: VersionEntry[] = []
  for (const n of await subdirs(vdir)) {
    const d = await vdir.dir(n)
    if (d) out.push({ version: n, jar: await d.file(`${n}.jar`), json: await d.file(`${n}.json`) })
  }
  return out
}

/**
 * Was liegt in dem gewählten Ordner? Welten (zuletzt gespielte zuerst) und Spielversionen mit .jar.
 * Erkennt: Minecraft-Ordner (saves, versions), Modrinth App (profiles/<Profil>/saves, meta/versions),
 * Prism Launcher (instances/<Instanz>/.minecraft/saves, libraries/com/mojang/minecraft), saves-Ordner, einzelne Welt.
 */
export async function scanFolder(root: Dir): Promise<Scan> {
  const top = await root.entries()
  if (top.some(e => e.kind === 'file' && e.name === 'level.dat')) {
    const w = await readWorld(root.name, root)
    return { kind: 'world', worlds: w ? [w] : [], versions: [] }
  }
  const has = (n: string) => top.some(e => e.kind === 'dir' && e.name === n)
  const sort = (ws: WorldEntry[]) => ws.sort((a, b) => b.lastPlayed - a.lastPlayed)

  // Modrinth App: Welten aller Profile, .jar je Profil unter meta/versions/<Spiel>-<Loader>/
  if (has('profiles') && has('meta')) {
    const profiles = (await root.dir('profiles'))!
    const worlds: WorldEntry[] = []
    for (const name of await subdirs(profiles)) {
      const saves = await (await profiles.dir(name))?.dir('saves')
      if (saves) worlds.push(...(await worldsIn(saves, name)))
    }
    const vdir = await (await root.dir('meta'))!.dir('versions')
    return { kind: 'modrinth', worlds: sort(worlds), versions: vdir ? await versionsIn(vdir) : [] }
  }
  // Prism / MultiMC
  if (has('instances')) {
    const inst = (await root.dir('instances'))!
    const worlds: WorldEntry[] = []
    for (const name of await subdirs(inst)) {
      const i = await inst.dir(name)
      const game = (await i?.dir('.minecraft')) ?? (await i?.dir('minecraft'))
      const saves = await game?.dir('saves')
      if (saves) worlds.push(...(await worldsIn(saves, name)))
    }
    const versions: VersionEntry[] = []
    const mc = await walkDir(root, 'libraries/com/mojang/minecraft')
    if (mc)
      for (const v of await subdirs(mc)) {
        const d = await mc.dir(v)
        if (d) versions.push({ version: v, jar: await d.file(`minecraft-${v}-client.jar`), json: null })
      }
    return { kind: 'prism', worlds: sort(worlds), versions }
  }
  const isMc = has('saves') || has('versions')
  const savesDir = isMc ? await root.dir('saves') : root
  const worlds = savesDir ? await worldsIn(savesDir) : []
  const vdir = isMc ? await root.dir('versions') : null
  return { kind: isMc ? 'minecraft' : 'saves', worlds: sort(worlds), versions: vdir ? await versionsIn(vdir) : [] }
}

async function walkDir(d: Dir, path: string): Promise<Dir | null> {
  let cur: Dir | null = d
  for (const p of path.split('/')) cur = cur ? await cur.dir(p) : null
  return cur
}

/** Versionsnummern vergleichen (26.3 > 26.2 > 1.21.11); Snapshots und Unbekanntes zuletzt. */
export function compareVersions(a: string, b: string): number {
  const num = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null)
  const x = num(a), y = num(b)
  if (!x || !y) return x ? -1 : y ? 1 : a.localeCompare(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d) return d
  }
  return 0
}

/**
 * .jar-Kandidaten in der Reihenfolge, in der sie probiert werden: genau die Weltversion, dann deren
 * Loader-Kopien (Modrinth: „26.1-0.17.2“), dann die neuesten Vanilla-Versionen, Loader-Ordner zuletzt
 * (beim offiziellen Launcher liegt dort oft nur eine leere Hülle – das merkt erst das Laden).
 */
export function jarCandidates(versions: VersionEntry[], worldVersion: string): VersionEntry[] {
  const withJar = versions.filter(v => v.jar)
  const rank = (v: VersionEntry) =>
    v.version === worldVersion ? 0 : worldVersion && v.version.startsWith(`${worldVersion}-`) ? 1 : MODDED.test(v.version) ? 3 : 2
  return withJar.sort((a, b) => rank(a) - rank(b) || compareVersions(a.version.split('-')[0], b.version.split('-')[0]))
}

/** Erste Wahl unter den Kandidaten. */
export function pickJar(versions: VersionEntry[], worldVersion: string): VersionEntry | null {
  return jarCandidates(versions, worldVersion)[0] ?? null
}
