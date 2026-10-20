// Rundgang durch die App im echten Browser, im neuen Ablauf:
// Bereich auf der Karte aufziehen → in 3D öffnen → fliegen → Testhaus setzen → Schichten → Export.
// Dazu: eingebettet wie im Claude-Artifact (Ordner über Dateiauswahl) und ein Lasttest mit 500 × 500.
// Aufruf: npm run build && npm run test:e2e   (optional JAR=/pfad/26.1.jar)
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const PORT = 4179
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1500))

const executablePath = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
const fail = msg => { errors.push(msg); console.error('✗', msg) }

const weltOrdner = (name, chunks) =>
  execFileSync(process.execPath, ['--experimental-strip-types', new URL('./welt-ordner.mjs', import.meta.url).pathname, `${OUT}${name}`, String(chunks)]).toString().trim()

/** Bereich auf der Karte aufziehen: von (ax,ay) nach (bx,by) relativ zur Kartenmitte, in Bildschirmpixeln. */
async function aufziehen(page, root, ax, ay, bx, by) {
  await root.locator('.map-draw').click()
  const box = await root.locator('#map canvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx + ax, cy + ay)
  await page.mouse.down()
  await page.mouse.move(cx + (ax + bx) / 2, cy + (ay + by) / 2, { steps: 4 })
  await page.mouse.move(cx + bx, cy + by, { steps: 4 })
  await page.mouse.up()
  await root.locator('[data-act="open-area"]').waitFor({ timeout: 5000 })
}

async function warteAufGelaende(root, timeout = 30000) {
  await root.locator('.progress').waitFor({ state: 'hidden', timeout })
}

async function run(theme, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true })
  page.on('pageerror', e => fail(`${theme} ${width}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') fail(`${theme} ${width} console: ${m.text()}`) })
  const shot = name => page.screenshot({ path: `${OUT}${name}-${theme}-${width}.png` })

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(400)
  await shot('01-start')
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.waitForSelector('.world-name', { timeout: 8000 })
  await page.waitForTimeout(1200)

  if (process.env.JAR && width === 1440) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="textures"]')])
    await chooser.setFiles(process.env.JAR)
    await page.waitForFunction(() => document.body.textContent.includes('Texturen aus deiner .jar'), null, { timeout: 60000 })
    await page.waitForTimeout(1200)
  }
  await shot('02-karte')

  await aufziehen(page, page, -60, -50, 120, 90)
  await shot('03-bereich')
  await page.click('[data-act="open-area"]')
  await warteAufGelaende(page)
  await page.waitForTimeout(600)
  await shot('04-3d-bereich')

  // Fliegen: eine Sekunde vorwärts, dann etwas hoch
  await page.locator('#three canvas').focus()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  await page.keyboard.down('Space')
  await page.waitForTimeout(300)
  await page.keyboard.up('Space')
  await page.waitForTimeout(300)
  const pos = await page.locator('#readout').textContent()
  if (!/Du: X/.test(pos ?? '')) fail(`${theme} ${width}: Kameraposition fehlt in der Anzeige ("${pos}")`)
  await shot('05-geflogen')

  // Platzieren: Typ wählen, ins Gelände unterhalb der Mitte zielen, klicken
  await page.click('[data-act="start-place"]')
  const box = await page.locator('#three canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.62)
  await page.waitForTimeout(400)
  await shot('06-vorschau')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62)
  await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 })
  await page.waitForTimeout(500)
  await shot('07-platziert')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(400)
  await shot('08-ebene2')
  await page.click('[data-act="rotR"]')
  await page.waitForTimeout(500)
  await shot('09-gedreht')

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="litematic"]')])
  await dl.saveAs(`${OUT}export-${theme}.litematic`)

  // Neu laden: Bereich und Bauwerk müssen noch da sein
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.waitForSelector('.world-name')
  await page.waitForTimeout(800)
  if ((await page.locator('[data-area]').count()) < 1) fail(`${theme} ${width}: Bereich nach Neuladen weg`)
  if (!(await page.locator('[data-area]').first().textContent()).includes('Bauwerk')) fail(`${theme} ${width}: Bauwerk nach Neuladen weg`)
  await page.close()
}

// Wie im Claude-Artifact: eingebettet in eine fremde Seite, Ordner über die Dateiauswahl.
async function eingebettet() {
  const dir = weltOrdner('Realm Testwelt', 8)
  const host = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${PORT}/" style="border:0;width:100vw;height:100vh"></iframe>`)
  }).listen(PORT + 1)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => fail(`eingebettet: ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT + 1}/`)
  const frame = page.frameLocator('iframe')
  await frame.locator('[data-act="upload"]').waitFor({ timeout: 8000 })
  if (await frame.locator('[data-act="folder"]').count()) fail('eingebettet: Knopf "verbinden" sichtbar, der dort nicht geht')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[data-act="upload"]').click()])
  await chooser.setFiles(dir)
  await frame.locator('.world-name').waitFor({ timeout: 10000 })
  await page.waitForTimeout(1000)
  await aufziehen(page, frame, -40, -30, 80, 60)
  await frame.locator('[data-act="open-area"]').click()
  await warteAufGelaende(frame)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}10-eingebettet.png` })
  await page.close()
  host.close()
}

// Lasttest: volle Region, Bereich 500 × 500, Zeit bis alles geladen ist.
async function last() {
  const dir = weltOrdner('Grosse Testwelt', 32)
  const host = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${PORT}/" style="border:0;width:100vw;height:100vh"></iframe>`)
  }).listen(PORT + 2)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => fail(`last: ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT + 2}/`)
  const frame = page.frameLocator('iframe')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), frame.locator('[data-act="upload"]').click()])
  await chooser.setFiles(dir)
  await frame.locator('.world-name').waitFor({ timeout: 30000 })
  await page.waitForTimeout(3000)
  for (let i = 0; i < 4; i++) await frame.locator('[data-z="out"]').click()
  await page.waitForTimeout(500)
  const z = 2 / Math.pow(1.6, 4) // Zoom nach 4 × heraus, Karte steht auf dem Spawn (8, 8)
  await aufziehen(page, frame, -6 * z, -6 * z, 494 * z, 494 * z)
  const size = await frame.locator('[data-area] .item-sub').first().textContent()
  const t0 = Date.now()
  await frame.locator('[data-act="open-area"]').click()
  await warteAufGelaende(frame, 300000)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`Lasttest: Bereich ${size} in ${secs} s geladen (Software-Grafik, ohne GPU)`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}11-last-500.png` })
  await page.close()
  host.close()
}


// Galerie: je Stil Varianten-Bilder und ein gesetztes Haus in 3D (mit .jar, wenn angegeben)
async function galerie() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 2, acceptDownloads: true })
  page.on('pageerror', e => fail(`galerie: ${e.message}`))
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.waitForSelector('.world-name', { timeout: 8000 })
  await page.waitForTimeout(1000)
  if (process.env.JAR) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="textures"]')])
    await chooser.setFiles(process.env.JAR)
    await page.waitForFunction(() => document.body.textContent.includes('Texturen aus deiner .jar'), null, { timeout: 60000 })
  }
  await aufziehen(page, page, -70, -60, 140, 110)
  await page.click('[data-act="open-area"]')
  await warteAufGelaende(page)
  const styles = ['mittelalter', 'japan', 'modern', 'wueste', 'steampunk']
  for (const [i, st] of styles.entries()) {
    await page.click(`[data-style="${st}"]`)
    await page.waitForTimeout(600)
    await page.locator('#side').screenshot({ path: `${OUT}g-${i + 1}-${st}-auswahl.png` })
    await page.locator('.vars').screenshot({ path: `${OUT}g-${i + 1}-${st}-varianten.png`, scale: 'device' })
    await page.click('#three .map-draw')
    await page.waitForTimeout(300)
    await page.click('[data-act="start-place"]')
    const box = await page.locator('#three canvas').boundingBox()
    const px = box.x + box.width * [0.3, 0.45, 0.6, 0.38, 0.55][i], py = box.y + box.height * [0.55, 0.62, 0.55, 0.72, 0.7][i]
    await page.mouse.move(px, py)
    await page.waitForTimeout(300)
    await page.mouse.click(px, py)
    await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 })
    await page.waitForTimeout(500)
    const id = await page.locator('.item[aria-current="true"][data-placement]').getAttribute('data-placement')
    await page.locator(`[data-placement="${id}"]`).click()
    await page.waitForTimeout(700)
    await page.locator('#three').screenshot({ path: `${OUT}g-${i + 1}-${st}-3d.png` })
  }
  // Natur
  await page.click('[data-cat="natur"]')
  await page.waitForTimeout(500)
  await page.locator('#side').screenshot({ path: `${OUT}g-6-natur-auswahl.png` })
  await page.click('[data-btype="pinsel"]')
  await page.waitForTimeout(500)
  await page.click('#three .map-draw')
  await page.waitForTimeout(300)
  await page.click('[data-act="start-place"]')
  const box = await page.locator('#three canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7)
  await page.waitForTimeout(300)
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.7)
  await page.waitForTimeout(800)
  await page.locator('#three').screenshot({ path: `${OUT}g-7-natur-3d.png` })

  // Vorlage: das gesetzte Haus als .litematic exportieren und als "Farm" wieder einlesen (Rundweg Export → Import)
  await page.locator('[data-placement]').first().click()
  await page.waitForTimeout(300)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="litematic"]')])
  await dl.saveAs(`${OUT}probe-farm.litematic`)
  await page.click('[data-cat="vorlage"]')
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="import-template"]')])
  await ch.setFiles(`${OUT}probe-farm.litematic`)
  await page.waitForSelector('[data-template]', { timeout: 5000 })
  await page.click('[data-act="toggle-facade"]')
  await page.waitForTimeout(300)
  await page.locator('#side').screenshot({ path: `${OUT}g-8-vorlage-auswahl.png` })
  await page.click('#three .map-draw')
  await page.waitForTimeout(300)
  await page.click('[data-act="start-place"]')
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.75)
  await page.waitForTimeout(300)
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.75)
  await page.waitForSelector('#guide:not([hidden])', { timeout: 5000 })
  await page.waitForTimeout(600)
  await page.locator('#three').screenshot({ path: `${OUT}g-9-vorlage-3d.png` })
  await page.close()
}

try {
  if (process.env.NUR_GALERIE) await galerie()
  else if (process.env.NUR_LAST) await last()
  else {
    await eingebettet()
    await run('light', 1440, 900)
    await run('dark', 1440, 900)
    await run('light', 1024, 700)
    if (!process.env.OHNE_LAST) await last()
  }
} catch (e) {
  fail(String(e))
} finally {
  await browser.close()
  server.kill()
}
if (errors.length) { console.error(`${errors.length} Fehler`); process.exit(1) }
console.log('Rundgang ok, Bilder in test/out/')
