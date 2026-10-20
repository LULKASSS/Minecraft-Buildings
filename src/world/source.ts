// Woher die Welt kommt: verbundener Ordner (Chrome), einmal hochgeladener Ordner oder ZIP.
// Alle drei sehen nach außen gleich aus: Pfade relativ zum Weltordner, Inhalte als Blob.

import { BlobReader, BlobWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js'

export interface WorldFile {
  blob: Blob
  modified: number
}

export interface WorldSource {
  kind: 'folder' | 'upload' | 'zip'
  name: string
  read(path: string): Promise<WorldFile | null>
  list(dir: string): Promise<string[]>
}

// ---- verbundener Ordner (File System Access API) ----

export class FolderSource implements WorldSource {
  kind = 'folder' as const
  constructor(readonly handle: FileSystemDirectoryHandle) {}
  get name() {
    return this.handle.name
  }

  private async dir(parts: string[]): Promise<FileSystemDirectoryHandle | null> {
    let d = this.handle
    for (const p of parts) {
      try {
        d = await d.getDirectoryHandle(p)
      } catch {
        return null
      }
    }
    return d
  }

  async read(path: string): Promise<WorldFile | null> {
    const parts = path.split('/').filter(Boolean)
    const file = parts.pop()!
    const d = await this.dir(parts)
    if (!d) return null
    try {
      const f = await (await d.getFileHandle(file)).getFile()
      return { blob: f, modified: f.lastModified }
    } catch {
      return null
    }
  }

  async list(dir: string): Promise<string[]> {
    const d = await this.dir(dir.split('/').filter(Boolean))
    if (!d) return []
    const out: string[] = []
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind === 'file') out.push(name)
    }
    return out
  }
}

// ---- einmal gewählter oder hineingezogener Ordner (<input webkitdirectory>, Drag & Drop) ----

export interface PathFile {
  path: string // relativ zum gewählten Ordner, mit "/" getrennt
  file: File
}

/** Weltordner in einer Dateiliste finden: der flachste Ordner mit level.dat. */
export function findWorldRoot(paths: string[]): string {
  const levels = paths.filter(p => p === 'level.dat' || p.endsWith('/level.dat'))
  if (!levels.length) throw new Error('Keine level.dat gefunden. Bitte den Ordner der Welt wählen (den mit level.dat darin).')
  const depth = (p: string) => p.split('/').length
  const min = Math.min(...levels.map(depth))
  const top = levels.filter(p => depth(p) === min)
  if (top.length > 1) {
    const names = top.map(p => p.split('/').slice(-2, -1)[0] ?? p).join(', ')
    throw new Error(`Hier liegen mehrere Welten (${names}). Bitte genau einen Weltordner wählen.`)
  }
  return top[0].slice(0, -'level.dat'.length)
}

export class UploadSource implements WorldSource {
  kind = 'upload' as const
  private files = new Map<string, File>()
  name: string

  constructor(entries: PathFile[]) {
    const prefix = findWorldRoot(entries.map(e => e.path))
    this.name = prefix.replace(/\/$/, '').split('/').pop() || 'Welt'
    for (const e of entries) {
      if (e.path.startsWith(prefix)) this.files.set(e.path.slice(prefix.length), e.file)
    }
  }

  static fromFiles(files: File[]): UploadSource {
    return new UploadSource(files.map(f => ({ path: rel(f), file: f })))
  }

  async read(path: string): Promise<WorldFile | null> {
    const f = this.files.get(path)
    return f ? { blob: f, modified: f.lastModified } : null
  }

  async list(dir: string): Promise<string[]> {
    const pre = dir.replace(/\/?$/, '/')
    return [...this.files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length))
  }
}

/** Hineingezogene Ordner durchlaufen (geht auch in eingebetteten Seiten, anders als showDirectoryPicker). */
export async function filesFromDrop(items: DataTransferItemList): Promise<PathFile[]> {
  const roots = [...items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  const out: PathFile[] = []
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ path, file })
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      // readEntries liefert in Portionen (Chrome: 100), bis eine leere Liste kommt
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      await Promise.all(batch.map(e => walk(e, `${path}/${e.name}`)))
    }
  }
  await Promise.all(roots.map(r => walk(r, r.name)))
  return out
}

function rel(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
}

// ---- ZIP: liest nur die Einträge, die gebraucht werden ----

export class ZipSource implements WorldSource {
  kind = 'zip' as const
  private entries = new Map<string, FileEntry>()
  private constructor(readonly name: string) {}

  static async open(file: File): Promise<ZipSource> {
    const reader = new ZipReader(new BlobReader(file))
    const all: Entry[] = await reader.getEntries()
    const level = all
      .filter(e => !e.directory && /(^|\/)level\.dat$/.test(e.filename))
      .sort((a, b) => a.filename.length - b.filename.length)[0]
    if (!level) throw new Error('Im ZIP liegt keine level.dat. Ist das wirklich ein Welt-Ordner?')
    const prefix = level.filename.slice(0, -'level.dat'.length)
    const src = new ZipSource(prefix.replace(/\/$/, '').split('/').pop() || file.name.replace(/\.zip$/i, ''))
    for (const e of all) {
      if (!e.directory && e.filename.startsWith(prefix)) src.entries.set(e.filename.slice(prefix.length), e as FileEntry)
    }
    return src
  }

  async read(path: string): Promise<WorldFile | null> {
    const e = this.entries.get(path)
    if (!e) return null
    const blob = await e.getData(new BlobWriter())
    return { blob, modified: e.lastModDate?.getTime?.() ?? 0 }
  }

  async list(dir: string): Promise<string[]> {
    const pre = dir.replace(/\/?$/, '/')
    return [...this.entries.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length))
  }
}
