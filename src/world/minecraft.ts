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
  kind: 'minecraft' | 'saves' | 'world'
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

/** Was liegt in dem freigegebenen Ordner? Welten (zuletzt gespielte zuerst) und Spielversionen. */
export async function scanFolder(root: Dir): Promise<Scan> {
  const top = await root.entries()
  if (top.some(e => e.kind === 'file' && e.name === 'level.dat')) {
    const w = await readWorld(root.name, root)
    return { kind: 'world', worlds: w ? [w] : [], versions: [] }
  }
  const has = (n: string) => top.some(e => e.kind === 'dir' && e.name === n)
  const isMc = has('saves') || has('versions')
  const savesDir = isMc ? await root.dir('saves') : root
  const worlds: WorldEntry[] = []
  if (savesDir) {
    const subs = (await savesDir.entries()).filter(e => e.kind === 'dir').slice(0, 300)
    const found = await Promise.all(subs.map(async e => {
      const d = await savesDir.dir(e.name)
      return d ? readWorld(e.name, d) : null
    }))
    for (const w of found) if (w) worlds.push(w)
  }
  worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)
  const versions: VersionEntry[] = []
  const vdir = isMc ? await root.dir('versions') : null
  if (vdir) {
    for (const e of await vdir.entries()) {
      if (e.kind !== 'dir') continue
      const d = await vdir.dir(e.name)
      if (!d) continue
      versions.push({ version: e.name, jar: await d.file(`${e.name}.jar`), json: await d.file(`${e.name}.json`) })
    }
  }
  return { kind: isMc ? 'minecraft' : 'saves', worlds, versions }
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

/** Passende .jar: die Version der Welt, sonst die neueste Vanilla-Version mit .jar. */
export function pickJar(versions: VersionEntry[], worldVersion: string): VersionEntry | null {
  const vanilla = versions.filter(v => v.jar && !MODDED.test(v.version)).sort((a, b) => compareVersions(a.version, b.version))
  return vanilla.find(v => v.version === worldVersion) ?? vanilla[0] ?? null
}
