// Worker: Kacheln rendern und Gelände-Ausschnitte lesen, damit die Oberfläche flüssig bleibt.

import type { RGB } from '../render/block-colors'
import { fallbackColor } from '../render/block-colors'
import { readArea, type Box3 } from './area'
import { renderTile, TILE, TRACE } from './tile'

export type WorkerRequest =
  | { id: number; type: 'tile'; blob: Blob; rx: number; rz: number; colors?: Record<string, RGB>; mcc?: Record<string, Blob> }
  | { id: number; type: 'area'; regions: { rx: number; rz: number; blob: Blob; mcc?: Record<string, Blob> }[]; box: Box3 }

const ext = (mcc?: Record<string, Blob>) => mcc ? async (cx: number, cz: number) => mcc[`c.${cx}.${cz}.mcc`] ?? null : undefined

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    if (req.type === 'tile') {
      const colors = req.colors
      const color = colors ? (n: string) => colors[n] ?? fallbackColor(n) : fallbackColor
      const t = await renderTile(req.blob, req.rx, req.rz, color, ext(req.mcc))
      const canvas = new OffscreenCanvas(TILE, TILE)
      canvas.getContext('2d')!.putImageData(new ImageData(t.rgba as Uint8ClampedArray<ArrayBuffer>, TILE, TILE), 0, 0)
      const png = await canvas.convertToBlob({ type: 'image/png' })
      const bitmap = canvas.transferToImageBitmap()
      const tc = new OffscreenCanvas(TRACE, TRACE)
      tc.getContext('2d')!.putImageData(new ImageData(t.trace as Uint8ClampedArray<ArrayBuffer>, TRACE, TRACE), 0, 0)
      const tracePng = await tc.convertToBlob({ type: 'image/png' })
      const trace = tc.transferToImageBitmap()
      ;(self as unknown as Worker).postMessage(
        {
          id: req.id, ok: true,
          result: { bitmap, png, trace, tracePng, heights: t.heights, inhabited: t.inhabited, built: t.built, lodH: t.lodH, lodC: t.lodC, chunks: t.chunks, skipped: t.skipped },
        },
        [bitmap, trace, t.heights.buffer, t.inhabited.buffer, t.built.buffer, t.lodH.buffer, t.lodC.buffer],
      )
    } else {
      const regions = req.regions.map(r => ({ rx: r.rx, rz: r.rz, blob: r.blob, external: ext(r.mcc) }))
      const a = await readArea(regions, req.box)
      ;(self as unknown as Worker).postMessage({ id: req.id, ok: true, result: a }, [a.data.buffer])
    }
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String((e as Error).message ?? e) })
  }
}
