// Rundgang durch die App im echten Browser, im Ablauf von Fassung 6:
// Minecraft-Ordner wählen → Welt aussuchen → sofort 3D (Texturen aus versions/) → umsehen, weit raus,
// Flugmodus → Haus setzen → anklicken = Anleitung → Karte groß, hinspringen → neu laden, alles noch da.
// Dazu: eingebettet wie im Claude-Artifact, Ladezeit der großen Welt, Galerie der Stile.
// Aufruf: npm run build && npm run test:e2e   (optional JAR=/pfad/26.1.jar, NUR_GALERIE=1, OHNE_GALERIE=1)
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
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

// Minecraft-Ordner mit zwei Welten und versions/26.1 (mit .jar, falls JAR gesetzt) – einmal erzeugen
const MC = `${OUT}minecraft`
rmSync(MC, { recursive: true, force: true })
execFileSync(process.execPath, ['--experimental-strip-types', new URL('./welt-ordner.mjs', import.meta.url).pathname, MC, 'minecraft', ...(process.env.JAR ? [process.env.JAR] : [])])

/** Minecraft-Ordner über „auswählen“ geben und eine Welt wählen (root = Seite oder Frame). */
async function ordnerGeben(page, root, welt) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), root.locator('[data-s="choose"]').click()])
  await chooser.setFiles(MC)
  if (welt) {
    await root.locator('[data-world]').first().waitFor({ timeout: 15000 })
    await root.locator('[data-world]', { hasText: welt }).click()
  }
  await root.locator('#side:not([hidden])').waitFor({ timeout: 30000 })
}

async function warteAufLaden(root, timeout = 120000) {
  await root.locator('#loading').waitFor({ state: 'hidden', timeout })
}

/** Mit der Maus dorthin, wo die Anzeige einen Block nennt (wie ein Mensch zielt). */
async function zielen(page, root, from = 0.45) {
  const c = await root.locator('#three canvas').boundingBox()
  for (let fy = from; fy < 0.9; fy += 0.05)
    for (let fx = 0.4; fx < 0.75; fx += 0.07) {
      const at = [c.x + c.width * fx, c.y + c.height * fy]
      await page.mouse.move(...at)
      await page.waitForTimeout(60)
      if (/grass|sand|leaves|log|cobble|dirt|Block/i.test((await root.locator('#status').textContent()) ?? '')) return at
    }
  return [c.x + c.width / 2, c.y + c.height * 0.6]
}

async function run(theme, width, height, voll) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true })
  page.on('pageerror', e => fail(`${theme} ${width}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') fail(`${theme} ${width} console: ${m.text()}`) })
  const shot = name => page.screenshot({ path: `${OUT}${name}-${theme}-${width}.png` })

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(400)
  await shot('01-start')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-s="choose"]').click()])
  await chooser.setFiles(MC)
  await page.locator('[data-world]').first().waitFor({ timeout: 15000 })
  if ((await page.locator('[data-world]').count()) !== 2) fail(`${theme} ${width}: nicht beide Welten zur Auswahl`)
  const erste = await page.locator('[data-world]').first().textContent()
  if (!erste.includes('Große Testwelt')) fail(`${theme} ${width}: zuletzt gespielte Welt steht nicht oben (${erste})`)
  await shot('02-welten')
  await page.locator('[data-world]', { hasText: 'Große Testwelt' }).click()
  await page.locator('#side:not([hidden])').waitFor({ timeout: 30000 })
  if (process.env.JAR) {
    await page.waitForFunction(() => document.body.textContent.includes('Texturen aus versions/26.1/26.1.jar'), null, { timeout: 90000 })
      .catch(() => fail(`${theme} ${width}: .jar aus versions/ nicht automatisch geladen`))
  } else if (!(await page.locator('[data-act="mojang"]').count())) fail(`${theme} ${width}: ohne .jar kein Mojang-Knopf`)
  await warteAufLaden(page)
  await page.waitForTimeout(800)
  await shot('03-3d')
  if (!voll) {
    await page.close()
    return
  }

  // weit heraus: Umgebung bis zum Horizont (Ferne aus den Kartenkacheln)
  const c = await page.locator('#three canvas').boundingBox()
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(2500)
  await warteAufLaden(page)
  await shot('04-weit')

  // Rad mit dem Mauszeiger im Himmel: der Drehpunkt bleibt stehen (früher wanderte er bis weit aus der Welt)
  const vor = await page.evaluate(() => window.__bp.view3d.scene.focusWorld())
  await page.mouse.move(c.x + c.width * 0.6, c.y + 6)
  for (let i = 0; i < 24; i++) await page.mouse.wheel(0, i % 2 ? 250 : -250)
  await page.waitForTimeout(1200)
  const nach = await page.evaluate(() => window.__bp.view3d.scene.focusWorld())
  if (Math.hypot(nach[0] - vor[0], nach[2] - vor[2]) > 16) fail(`${theme} ${width}: Zoomen im Himmel verschiebt den Drehpunkt (${vor.map(Math.round)} → ${nach.map(Math.round)})`)
  // weit ins Leere geschoben: Kamera kommt an den Rand der Welt zurück
  await page.evaluate(() => window.__bp.view3d.scene.shift(5e6, -900, 8e6))
  await page.waitForTimeout(1000)
  const weg = await page.evaluate(() => [window.__bp.view3d.scene.focusWorld(), window.__bp.S.session.regionBounds()])
  if (weg[0][0] > weg[1].x1 + 400 || weg[0][2] > weg[1].z1 + 400 || weg[0][1] < -64) fail(`${theme} ${width}: Kamera bleibt außerhalb der Welt (${weg[0].map(Math.round)})`)
  // ⌂ zurück: dabei wird die Szene neu aufgebaut (weiter als 1700 Blöcke). Früher sprang die Kamera dabei weiter
  // und lief alle 0,4 s 1700 Blöcke ins Leere (Lukas: X 5.315.601)
  await page.click('[data-t="home"]')
  await page.waitForTimeout(2000)
  const heim = await page.evaluate(() => [window.__bp.view3d.scene.focusWorld(), window.__bp.S.session.hotspots()[0]])
  if (heim[1] && Math.hypot(heim[0][0] - heim[1].x, heim[0][2] - heim[1].z) > 8) fail(`${theme} ${width}: ⌂ landet nicht an der Base (${heim[0].map(Math.round)})`)
  await warteAufLaden(page)

  // Haus setzen, Anleitung erscheint
  await page.click('[data-act="start-place"]')
  const at = await zielen(page, page)
  await page.waitForTimeout(300)
  await shot('05-vorschau')
  await page.mouse.click(...at)
  await page.locator('#guide:not([hidden])').waitFor({ timeout: 8000 }).catch(() => fail(`${theme} ${width}: nach dem Setzen keine Anleitung`))
  await page.waitForTimeout(600)
  await shot('06-gesetzt')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(500)
  await shot('07-ebene')
  // Bau-Ansicht: linkes Panel eingeklappt, Material mit Bild, Haus mitten im freien Bereich
  if (!(await page.locator('body.panel-collapsed').count())) fail(`${theme} ${width}: linkes Panel in der Bau-Ansicht nicht eingeklappt`)
  if (!(await page.locator('.mat .mat-icon').count())) fail(`${theme} ${width}: Materialliste ohne Block-Bilder`)

  // schließen (Panel kommt wieder), dann das Haus wieder anklicken = Anleitung
  await page.click('[data-g="close"]')
  await page.waitForTimeout(300)
  if (await page.locator('body.panel-collapsed').count()) fail(`${theme} ${width}: Panel nach der Bau-Ansicht nicht wieder offen`)
  await page.waitForTimeout(300)
  if (await page.locator('#guide:not([hidden])').count()) fail(`${theme} ${width}: Anleitung bleibt nach Abwählen offen`)
  await page.locator('[data-placement]').first().click()
  await page.locator('#guide:not([hidden])').waitFor({ timeout: 5000 }).catch(() => fail(`${theme} ${width}: Klick auf Bauwerk öffnet keine Anleitung`))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Flugmodus mit Fadenkreuz
  await page.keyboard.press('f')
  await page.waitForTimeout(400)
  if (await page.locator('.crosshair[hidden]').count()) fail(`${theme} ${width}: F zeigt kein Fadenkreuz`)
  await page.keyboard.down('w')
  await page.waitForTimeout(700)
  await page.keyboard.up('w')
  await shot('08-flug')
  await page.keyboard.press('f')
  await page.waitForTimeout(300)

  // Karte groß, hinspringen
  await page.keyboard.press('m')
  await page.waitForTimeout(800)
  await shot('09-karte')
  const m = await page.locator('#mini-map canvas').boundingBox()
  await page.mouse.click(m.x + m.width * 0.75, m.y + m.height * 0.75)
  await page.waitForTimeout(1500)
  await warteAufLaden(page)
  await shot('10-gesprungen')

  // neu laden: Welt ohne Auswahl wieder offen (zuletzt gewählt), Bauwerk noch da
  await page.reload()
  await ordnerGeben(page, page, null)
  if (!(await page.locator('[data-placement]').count())) fail(`${theme} ${width}: Bauwerk nach Neuladen weg`)
  await page.close()
}

// Handy: 3D oben, Panel unten
async function handy() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', e => fail(`handy: ${e.message}`))
  await page.goto(`http://localhost:${PORT}/?demo`)
  await page.locator('#side:not([hidden])').waitFor({ timeout: 10000 })
  await warteAufLaden(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}20-handy-3d.png` })
  await page.click('[data-act="start-place"]')
  const c = await page.locator('#three canvas').boundingBox()
  await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height * 0.3)
  await page.locator('#guide:not([hidden])').waitFor({ timeout: 5000 }).catch(() => fail('handy: Tippen setzt kein Haus'))
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}21-handy-gesetzt.png` })
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  if (over) fail('handy: Seite scrollt seitlich')
  await page.close()
}

// Wie im Claude-Artifact: eingebettet in eine fremde Seite, Ordner über die Dateiauswahl.
async function eingebettet() {
  const host = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${PORT}/" style="border:0;width:100vw;height:100vh"></iframe>`)
  }).listen(PORT + 1)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => fail(`eingebettet: ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT + 1}/`)
  const frame = page.frameLocator('iframe')
  await frame.locator('[data-s="choose"]').waitFor({ timeout: 8000 })
  if (await frame.locator('[data-s="connect"]').count()) fail('eingebettet: Knopf „freigeben“ sichtbar, der dort nicht geht')
  await ordnerGeben(page, frame, 'Realm Testwelt')
  await warteAufLaden(frame)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}30-eingebettet.png` })
  await page.close()
  host.close()
}

// Ladezeit: große Welt (4 volle Regionen), bis Gelände und Karte fertig sind
async function last() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => fail(`last: ${e.message}`))
  await page.goto(`http://localhost:${PORT}/`)
  const t0 = Date.now()
  await ordnerGeben(page, page, 'Große Testwelt')
  await page.locator('#loading').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  await warteAufLaden(page, 300000)
  console.log(`Ladezeit große Welt (4 Regionen, Software-Grafik): ${((Date.now() - t0) / 1000).toFixed(1)} s bis Gelände und Karte fertig`)
  await page.close()
}

// Galerie: je Stil gesetztes Haus in 3D (mit .jar, wenn angegeben), dazu die Varianten
async function galerie() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 2 })
  page.on('pageerror', e => fail(`galerie: ${e.message}`))
  await page.goto(`http://localhost:${PORT}/`)
  await ordnerGeben(page, page, 'Realm Testwelt')
  if (process.env.JAR) await page.waitForFunction(() => document.body.textContent.includes('Texturen aus versions'), null, { timeout: 90000 })
  await warteAufLaden(page)
  const styles = ['mittelalter', 'japan', 'modern', 'wueste', 'steampunk']
  for (const [i, st] of styles.entries()) {
    await page.click(`[data-style="${st}"]`)
    await page.waitForTimeout(600)
    await page.locator('.vars').screenshot({ path: `${OUT}g-${i + 1}-${st}-varianten.png`, scale: 'device' })
    await page.click('[data-t="home"]')
    await page.waitForTimeout(400)
    await page.click('[data-act="start-place"]')
    const at = await zielen(page, page, 0.4 + i * 0.06)
    await page.mouse.click(...at)
    await page.locator('#guide:not([hidden])').waitFor({ timeout: 5000 })
    const id = await page.locator('.item[aria-current="true"][data-placement]').getAttribute('data-placement')
    await page.locator(`[data-placement="${id}"]`).click()
    await page.waitForTimeout(900)
    await page.locator('#three').screenshot({ path: `${OUT}g-${i + 1}-${st}-3d.png` })
    await page.click('[data-g="close"]')
  }
  await page.close()
}

try {
  if (process.env.NUR_GALERIE) await galerie()
  else {
    await run('light', 1440, 900, true)
    await run('dark', 1440, 900, false)
    await run('light', 1024, 768, false)
    await handy()
    await eingebettet()
    await last()
    if (!process.env.OHNE_GALERIE) await galerie()
  }
} catch (e) {
  fail(`Abbruch: ${e.message}`)
}
await browser.close()
server.kill()
if (errors.length) {
  console.error(`${errors.length} Fehler`)
  process.exit(1)
}
console.log('Rundgang ok, Bilder in test/out/')
