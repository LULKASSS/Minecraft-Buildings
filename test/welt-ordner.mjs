// Schreibt die Testwelt als echten Ordner auf die Platte (für den Rundgang mit Ordnerauswahl).
// Aufruf: node --experimental-strip-types test/welt-ordner.mjs <zielordner>
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeWorld } from '../src/world/demo-world.ts'

const ziel = process.argv[2] ?? 'test/out/Realm Testwelt'
for (const [p, data] of makeWorld()) {
  mkdirSync(dirname(join(ziel, p)), { recursive: true })
  writeFileSync(join(ziel, p), data)
}
console.log(ziel)
