// Spiel-.jar direkt von Mojang holen, wenn im Minecraft-Ordner keine liegt (der Launcher lädt sie erst beim
// ersten Start einer Version). Mojang erlaubt den Abruf aus dem Browser. Die Datei bleibt im Browser-Speicher,
// damit sie nur einmal geladen wird; ins Repo kommt nichts.

import * as store from '../app/store'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  latest: { release: string }
  versions: { id: string; type: string; url: string }[]
}

/** Version, die geladen wird: die der Welt, sonst die neueste Vollversion. */
export async function resolveVersion(wanted: string): Promise<{ id: string; url: string }> {
  const m = (await (await fetch(MANIFEST)).json()) as Manifest
  const v = m.versions.find(x => x.id === wanted) ?? m.versions.find(x => x.id === m.latest.release)!
  return { id: v.id, url: v.url }
}

export async function cachedJar(version: string): Promise<File | null> {
  const b = await store.get<Blob>('kv', `jar:${version}`).catch(() => undefined)
  return b ? new File([b], `${version}.jar`) : null
}

/** client.jar laden; json = versions/<v>/<v>.json aus dem Minecraft-Ordner, falls vorhanden (spart einen Abruf). */
export async function fetchJar(wanted: string, onProgress: (done: number, total: number) => void, json?: File | null): Promise<File> {
  type Meta = { id: string; downloads?: { client?: { url: string; size: number } } }
  let meta: Meta | null = null
  // die Versionsdatei aus dem Ordner spart einen Abruf – Loader-Profile (Fabric) haben dort aber oft keinen Download-Eintrag
  if (json) try { meta = JSON.parse(await json.text()) as Meta } catch { meta = null }
  if (!meta?.downloads?.client) {
    const v = await resolveVersion(wanted)
    meta = (await (await fetch(v.url)).json()) as Meta
  }
  if (!meta.downloads?.client) throw new Error('Mojang nennt keine Spieldatei für diese Version.')
  const hit = await cachedJar(meta.id)
  if (hit) return hit
  const { url, size } = meta.downloads.client
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Mojang antwortet nicht (${res.status}).`)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let done = 0
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    parts.push(r.value)
    done += r.value.length
    onProgress(done, size)
  }
  const blob = new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'application/java-archive' })
  await store.put('kv', `jar:${meta.id}`, blob).catch(() => {})
  return new File([blob], `${meta.id}.jar`)
}
