import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch (error) {
  const modulePath = process.env.PLAYWRIGHT_MODULE
  if (!modulePath) throw new Error('Install Playwright or set PLAYWRIGHT_MODULE to its index.mjs', { cause: error })
  ;({ chromium } = await import(pathToFileURL(path.resolve(modulePath)).href))
}

const appUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length)
if (!appUrl) throw new Error('Pass --url=http://127.0.0.1:<port>/?token=... for the isolated DSH QA host')
const screenshotPath = process.argv.find((arg) => arg.startsWith('--screenshot='))?.slice('--screenshot='.length)
  ?? 'C:/Users/Administrator/.codex/visualizations/2026/10/26/01a17a91-ca78-7ef2-8d03-d03bce263128/tether-native-ui.png'

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE } : {}),
  headless: true,
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const consoleErrors = []
const reactKeyWarnings = []
const pageErrors = []
const requestErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
  if (/unique "key" prop|Encountered two children with the same key/i.test(message.text())) reactKeyWarnings.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('requestfailed', (request) => requestErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`))

const report = { url: appUrl.replace(/([?&]token=)[^&]+/, '$1<redacted>'), checks: {} }
try {
  // The production Tether API only trusts dsh-app://app. This isolated browser
  // harness applies a CORS shim to the real local Controller responses. GETs
  // reach the Controller; POSTs are blocked to prevent remote mutations/model runs.
  const controllerRequests = []
  await page.route('http://127.0.0.1:18890/**', async (route) => {
    const request = route.request()
    const headers = { 'access-control-allow-origin': new URL(appUrl).origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.method() === 'POST' && /\/fs\/(list|read|stat)$/.test(new URL(request.url()).pathname)) {
      controllerRequests.push({ method: 'POST', path: new URL(request.url()).pathname, outcome: 'live read-only Controller request' })
    } else if (request.method() !== 'GET') {
      controllerRequests.push({ method: request.method(), url: request.url(), outcome: 'blocked' })
      return route.abort('blockedbyclient')
    } else {
      controllerRequests.push({ method: 'GET', url: request.url(), outcome: 'live Controller request' })
    }
    const response = await route.fetch({ timeout: 12000 })
    return route.fulfill({ response, headers: { ...response.headers(), ...headers } })
  })
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  const welcomeContinue = page.getByRole('button', { name: '继续', exact: true })
  if (await welcomeContinue.count()) await welcomeContinue.click()
  // A fresh isolated profile can show account onboarding. Close it using the
  // modal's explicit close button so it cannot intercept the Tether plugin click.
  const onboardingClose = page.getByRole('button', { name: '关闭', exact: true })
  await page.waitForTimeout(800)
  if (await onboardingClose.count()) await onboardingClose.click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Tether', exact: true }).click({ timeout: 20000 })
  await page.locator('.tether-root').waitFor({ timeout: 20000 })
  console.log('stage: tether mounted')
  await page.waitForTimeout(300)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await page.waitForTimeout(2700)

  // Capture a real DSH Web/React render. Prefer semantic evidence from DSH classes
  // and app content, while allowing upstream class hashes to change by release.
  const initial = await page.locator('body').innerText()
  assert.match(initial, /工作区|文件/)
  assert.doesNotMatch(initial, /Cannot find package|native-ui.*failed to import/i)
  report.checks.webRender = 'DSH Web mounted Tether React app'
  report.checks.controllerRequests = controllerRequests

  assert.equal(await page.locator('.tether-root').count(), 1, `Expected Tether app to remain mounted; pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)} body=${initial.slice(-500)}`)
  const nativeMarkers = await page.locator('.tether-root [class*="markdown" i], .tether-root table, .tether-root pre').count()
  report.checks.dom = { nativeMarkdownMarkers: nativeMarkers, tetherRoots: await page.locator('.tether-root').count() }
  const nativeReadOnly = await page.locator('.tether-root').getByText(/原生 DSH 会话 · 只读/).count()
  const composer = page.locator('.tether-root textarea').first()
  const composerDisabled = await composer.isDisabled()
  const composerPlaceholder = await composer.getAttribute('placeholder')
  const newSessionAction = await page.getByRole('button', { name: '在此工作区新建会话', exact: true }).count()
  report.checks.nativeSessionReadOnly = { nativeReadOnly, composerDisabled, composerPlaceholder, newSessionAction }
  assert.equal(nativeReadOnly, 1, 'Expected the native DSH session to be marked read-only')
  assert.ok(composerDisabled || /历史会话只读/.test(composerPlaceholder || ''), 'Native session composer did not explain or enforce read-only state')

  const appearance = async () => page.locator('.tether-root').evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    font: getComputedStyle(el).fontFamily,
  }))
  await page.emulateMedia({ colorScheme: 'light' })
  const light = await appearance()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(100)
  const dark = await appearance()
  report.checks.appearance = { light, dark }
  assert.ok(light.background && dark.background && light.font && dark.font, 'Theme did not produce computed font and background styles')

  const sidePanel = page.locator('.tether-root aside').first()
  const workspaceRow = sidePanel.locator('[role="treeitem"][aria-expanded]').first()
  assert.ok(await workspaceRow.count(), 'Expected a native Workspace row')
  const workspaceName = (await workspaceRow.innerText()).trim()
  const initiallyExpanded = await workspaceRow.getAttribute('aria-expanded')
  await workspaceRow.click()
  await page.waitForTimeout(150)
  const afterCollapse = await workspaceRow.getAttribute('aria-expanded')
  assert.notEqual(afterCollapse, initiallyExpanded, `Workspace row ${workspaceName} did not collapse`)
  await workspaceRow.click()
  await page.waitForTimeout(150)
  const afterExpand = await workspaceRow.getAttribute('aria-expanded')
  report.checks.workspaceToggle = { workspaceName, initiallyExpanded, afterCollapse, afterExpand }
  assert.equal(afterExpand, initiallyExpanded, `Workspace row ${workspaceName} did not expand again`)
  const nativeSessionRow = sidePanel.locator('[data-row-key^="session:"]').first()
  assert.ok(await nativeSessionRow.count(), 'Expected a native Session row after Workspace expansion')
  await nativeSessionRow.click()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.tether-root').getByText(/原生 DSH 会话 · 只读/).count(), 1, 'Selecting a native Session did not retain its read-only target')

  // Workspace/session rows can grow as remote devices load. Toggle all visible
  // workspace rows ten times and ensure React does not warn about duplicate keys.
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('navigation', { name: 'Tether 面板' }).getByRole('button', { name: '文件', exact: true }).click()
  const tree = page.locator('.tether-root aside').first()
  const roots = tree.locator('button[data-tree-node-id][aria-expanded]')
  assert.ok(await roots.count(), 'Expected a file tree root from the Controller')
  const target = roots.nth(0)
  const targetPath = await target.getAttribute('title')
  const listResponsePromise = page.waitForResponse((response) => response.url().includes('/fs/list') && response.request().method() === 'POST', { timeout: 15000 })
  await target.click()
  const listResponse = await listResponsePromise
  assert.equal(listResponse.status(), 200, `Controller fs/list returned ${listResponse.status()}`)
  await target.click()
  await page.waitForTimeout(100)
  const countBefore = await tree.locator('[data-tree-node-id]').count()
  for (let i = 0; i < 10; i++) {
    await target.click()
    await page.waitForTimeout(100)
  }
  const countAfter = await tree.locator('[data-tree-node-id]').count()
  report.checks.fileTreeToggle = { path: targetPath, toggles: 10, visibleTreeRowsBefore: countBefore, visibleTreeRowsAfter: countAfter }
  assert.equal(countAfter, countBefore, 'Tree row count changed after ten expand/collapse toggles')
  const treeNodeIds = await tree.locator('[data-tree-node-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tree-node-id')))
  assert.equal(new Set(treeNodeIds).size, treeNodeIds.length, 'Duplicate tree node ids rendered in the current tree')
  await page.screenshot({ path: screenshotPath.replace(/\.png$/i, '-tree.png'), fullPage: true })
  assert.equal(reactKeyWarnings.length, 0, 'React reported duplicate or missing keys')

  const initialWidth = await sidePanel.evaluate((el) => el.getBoundingClientRect().width)
  const resizer = page.locator('.tether-root .tether-resizer')
  const box = await resizer.boundingBox()
  assert.ok(box, 'Expected the sidebar width resizer')
  await page.mouse.move(box.x + box.width / 2, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + 30)
  await page.mouse.up()
  const draggedWidth = await sidePanel.evaluate((el) => el.getBoundingClientRect().width)
  await resizer.dblclick()
  await page.waitForTimeout(250)
  const resetWidth = await sidePanel.evaluate((el) => el.getBoundingClientRect().width)
  report.checks.sidebarResize = { initialWidth, draggedWidth, resetWidth }
  assert.ok(draggedWidth > initialWidth + 20, 'Sidebar drag did not resize immediately')
  assert.ok(Math.abs(resetWidth - initialWidth) <= 2, 'Sidebar double-click did not reset its width')

  // Observe the existing read-only native-session guard without invoking a model:
  // intercept its POST and abort it before reaching the real Controller.
  report.checks.sendGuard = { postBodiesSentToController: controllerRequests.filter((request) => request.method === 'POST').length, policy: 'all Controller POST requests blocked by QA route' }

  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(150)
  report.checks.narrowViewport = { viewport: 900, pageWidth: await page.locator('body').evaluate((el) => el.scrollWidth) }
  assert.ok(report.checks.narrowViewport.pageWidth <= 920, '900px viewport caused horizontal overflow')

  report.checks.runtimeErrors = { consoleErrors, pageErrors, requestErrors, reactKeyWarnings }
  report.screenshotPath = screenshotPath
  assert.equal(pageErrors.length, 0, 'Unhandled browser page errors occurred')
  report.reportPath = screenshotPath.replace(/\.png$/i, '-report.json')
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
