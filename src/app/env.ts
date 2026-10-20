// Wo läuft die App? Eingebettet (z. B. als Claude-Artifact) blockiert Chrome showDirectoryPicker
// und normale Downloads. Dann: Ordner über die Dateiauswahl oder per Drag & Drop, Export über die Plattform.

export const inFrame = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

export function canConnectFolder(): boolean {
  return 'showDirectoryPicker' in window && !inFrame
}

interface DownloadsApi {
  save(r: { filename: string; data: Blob }): Promise<{ status: string }>
}
type ClaudeHost = { use(name: string): Promise<unknown> }

/** Speichern-Dienst des Artifact-Viewers, falls vorhanden. */
export async function hostDownloads(): Promise<DownloadsApi | null> {
  const c = (window as unknown as { claude?: ClaudeHost }).claude
  if (!inFrame || !c?.use) return null
  try {
    return (await c.use('downloads')) as DownloadsApi | null
  } catch {
    return null
  }
}
