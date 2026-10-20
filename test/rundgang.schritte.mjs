// Klickpfad für ui-pruefung: Testwelt, Punkt setzen und umbenennen, Testhaus bauen, 3D, Schichten.
export default async (page, foto) => {
  const base = page.url().split('?')[0]
  await page.goto(`${base}?demo`)
  await page.waitForSelector('.world-name', { timeout: 10000 })
  await page.waitForTimeout(1200)
  await foto('karte')
  const box = await page.locator('#map canvas').boundingBox()
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2 + 14)
  await page.waitForSelector('[data-rename]')
  await page.fill('[data-rename]', 'Haus am Hang')
  await page.keyboard.press('Enter')
  await foto('punkt')
  await page.click('[data-act="place"]')
  await page.waitForSelector('#guide:not([hidden])')
  await foto('platziert')
  await page.click('[data-act="open3d"]')
  await page.waitForTimeout(2000)
  await foto('3d')
  await page.click('[data-g="next"]')
  await page.click('[data-g="next"]')
  await page.waitForTimeout(400)
  await foto('ebene')
}
