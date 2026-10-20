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

// ---- einmal hochgeladener Ordner (<input webkitdirectory>) oder lose Dateien ----

export class UploadSource implements WorldSource {
  kind = 'upload' as const
  private files = new Map<string, File>()
  name: string

  constructor(files: File[]) {
    const level = files.find(f => rel(f).endsWith('level.dat') && rel(f).split('/').length <= 2)
    const prefix = level ? rel(level).slice(0, -'level.dat'.length) : ''
    this.name = prefix.replace(/\/$/, '') || 'Welt'
    for (const f of files) {
      const p = rel(f)
      if (p.startsWith(prefix)) this.files.set(p.slice(prefix.length), f)
    }
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
