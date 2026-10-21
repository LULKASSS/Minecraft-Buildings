// Vorschau zum Prüfen der Generatoren: ?gen=haus&style=mittelalter&size=M&forms=rechteck,winkel&seeds=1,2
// Mit .jar (Eingabefeld) in echten Texturen. Der Rundgang macht davon Bilder.
import * as THREE from 'three'
import { buildFromSource } from '../src/catalog'
import { meshFallback } from '../src/render/mesher'
import { isOpaqueCube } from '../src/render/shapes'
import { loadTextures } from '../src/render/textures-loader'
import type { TexturedMesher } from '../src/render/textured'
import { STYLES } from '../src/catalog/styles'
import type { Blueprint } from '../src/blueprint/blueprint'

const q = new URLSearchParams(location.search)
const W = 480, H = 360
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H, false)
renderer.outputColorSpace = THREE.SRGBColorSpace

function shot(bp: Blueprint, t: TexturedMesher | null, angle: number): string {
  const solid = new Set<string>()
  const list = bp.list()
  for (const b of list) if (isOpaqueCube(b.state)) solid.add(`${b.x},${b.y},${b.z}`)
  const occ = (x: number, y: number, z: number) => solid.has(`${x},${y},${z}`)
  const data = t ? t.mesh(list, occ, false) : meshFallback(list, { occludes: occ })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
  if (data.uvs) g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(data.indices, 1))
  const mat = t ? new THREE.MeshBasicMaterial({ map: t.texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ vertexColors: true })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#dfe3e8')
  scene.add(new THREE.Mesh(g, mat))
  const [w, h, d] = bp.size
  const c = new THREE.Vector3(w / 2, h * 0.4, d / 2)
  const r = Math.max(w, h * 1.1, d)
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 1000)
  const a = angle
  cam.position.set(c.x + Math.sin(a) * r * 1.7, c.y + r * 0.7, c.z + Math.cos(a) * r * 1.7)
  cam.lookAt(c)
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  g.dispose()
  mat.dispose()
  return url
}

async function run(t: TexturedMesher | null): Promise<void> {
  const gen = q.get('gen') ?? 'haus'
  const styles = (q.get('style') ?? STYLES.map(s => s.id).join(',')).split(',')
  const forms = (q.get('forms') ?? 'alle').split(',')
  const seeds = (q.get('seeds') ?? '1').split(',').map(Number)
  const size = q.get('size') ?? 'M'
  const angle = Number(q.get('angle') ?? 0.6)
  const grid = document.getElementById('grid')!
  grid.style.setProperty('--cols', q.get('cols') ?? '3')
  grid.innerHTML = ''
  const pair = q.has('pair')
  for (const style of styles)
    for (const [fi, form] of forms.entries())
      for (const seed of pair ? [seeds[0] + fi] : seeds) {
        const st = STYLES.find(s => s.id === style)!
        const palette = q.get('palette') ?? st.palettes[seed % st.palettes.length]
        const fig = document.createElement('figure')
        try {
          const bp = buildFromSource({ generator: gen, version: 2, seed, params: { style, palette, size, form } })
          fig.innerHTML = `<img src="${shot(bp, t, angle)}"><figcaption>${style} · ${form} · ${palette} · Seed ${seed} · ${bp.size.join('×')}</figcaption>`
        } catch (e) {
          fig.innerHTML = `<figcaption>${style} · ${form} · Fehler: ${(e as Error).message}</figcaption>`
        }
        grid.appendChild(fig)
      }
  document.body.dataset.done = '1'
}

document.getElementById('jar')!.addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const t = await loadTextures(f)
  await run(t.mesher)
})
if (!q.has('jar')) void run(null)
