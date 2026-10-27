import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const defaultPlaywright = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const defaultEdge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const appUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) || 'http://127.0.0.1:18897/'
const parsedAppUrl = new URL(appUrl)
if (parsedAppUrl.protocol !== 'http:' || parsedAppUrl.hostname !== '127.0.0.1' || parsedAppUrl.port !== '18897' || parsedAppUrl.pathname !== '/' || parsedAppUrl.search || parsedAppUrl.hash) {
  throw new Error('Only the local native-surface QA harness at http://127.0.0.1:18897/ is allowed')
}

const outputDir = path.resolve('docs/screenshots')
const screenshotPath = path.join(outputDir, 'native-surface-full.png')
const reportPath = path.join(outputDir, 'native-surface-full-report.json')
await mkdir(outputDir, { recursive: true })

const playwrightPath = process.env.PLAYWRIGHT_MODULE || defaultPlaywright
const { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href)

function safeUrl(value) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|auth|secret|credential|cookie|key|code/i.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    if (/token|ticket|auth|secret|credential|cookie|key|code/i.test(url.hash)) url.hash = '#[REDACTED]'
    return url.href
  } catch (_) {
    return String(value).replace(/((?:token|ticket|auth|secret|credential|cookie|key|code)=)[^&\s"']+/gi, '$1[REDACTED]')
  }
}

function safeText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrl(url))
    .replace(/((?:token|ticket|auth|secret|credential|cookie|key|code)=)[^&\s"']+/gi, '$1[REDACTED]')
}

function localUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && !!url.port
  } catch (_) { return false }
}

async function visibleCandidate(frame, selector, pattern) {
  const items = frame.locator(selector)
  const count = await items.count()
  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    if (!await item.isVisible().catch(() => false) || !await item.isEnabled().catch(() => true)) continue
    const text = await item.innerText().catch(() => '')
    const aria = await item.getAttribute('aria-label').catch(() => '')
    const title = await item.getAttribute('title').catch(() => '')
    if (pattern.test([text, aria, title].filter(Boolean).join(' '))) return item
  }
  return null
}

async function clickIfVisible(frame, label, pattern, selectors = 'button,[role="tab"],[role="menuitem"]') {
  const item = await visibleCandidate(frame, selectors, pattern)
  if (!item) return { found: false, label }
  const name = await item.innerText().catch(async () => item.getAttribute('aria-label'))
  try {
    await item.click({ timeout: 2500 })
    return { found: true, clicked: true, label, visibleText: safeText((name || '').trim()) }
  } catch (error) {
    return { found: true, clicked: false, label, error: safeText(error.message) }
  }
}

async function openMenu(frame, label, pattern) {
  const item = await visibleCandidate(frame, 'button,[role="button"],[role="tab"],[role="menuitem"]', pattern)
  if (!item) return { found: false, clicked: false, opened: false, label }
  const beforeText = await frame.locator('body').innerText().catch(() => '')
  try {
    await item.click({ timeout: 3000 })
    const popup = frame.locator('[role="menu"],[role="listbox"],[role="dialog"],[role="option"]')
    let popupVisible = false
    let contentChanged = false
    for (let attempt = 0; attempt < 40; attempt++) {
      for (let i = 0, count = await popup.count(); i < count; i++) {
        if (await popup.nth(i).isVisible().catch(() => false)) { popupVisible = true; break }
      }
      if (popupVisible) break
      const afterText = await frame.locator('body').innerText().catch(() => '')
      if (afterText !== beforeText) { contentChanged = true; break }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return { found: true, clicked: true, opened: popupVisible || contentChanged, label, popupVisible, contentChanged }
  } catch (error) {
    return { found: true, clicked: false, opened: false, label, error: safeText(error.message) }
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || defaultEdge,
  headless: true,
  args: ['--disable-background-networking', '--disable-sync']
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const consoleErrors = []
const consoleMessages = []
const pageErrors = []
const requestFailed = []
const blockedRequests = []
const report = {
  target: safeUrl(appUrl),
  actions: {},
  runtime: { consoleMessages, consoleErrors, pageErrors, requestFailed, blockedRequests },
  checks: {}
}

page.on('console', (message) => {
  const item = { type: message.type(), text: safeText(message.text()) }
  consoleMessages.push(item)
  if (message.type() === 'error') consoleErrors.push(item.text)
})
page.on('pageerror', (error) => pageErrors.push(safeText(error.message)))
page.on('dialog', (dialog) => { dialog.dismiss().catch(() => {}) })
page.on('filechooser', (chooser) => { chooser.setFiles([]).catch(() => {}) })
page.on('websocket', (socket) => {
  if (!localUrl(socket.url())) {
    blockedRequests.push({ method: 'WEBSOCKET', url: safeUrl(socket.url()), reason: 'non-loopback destination blocked' })
    socket.close()
  }
})
page.on('requestfailed', (request) => requestFailed.push({
  method: request.method(), url: safeUrl(request.url()), failure: safeText(request.failure()?.errorText || '')
}))
await page.route('**/*', async (route) => {
  const request = route.request()
  const url = request.url()
  if (!localUrl(url)) {
    blockedRequests.push({ method: request.method(), url: safeUrl(url), reason: 'non-loopback destination blocked' })
    return route.abort('blockedbyclient')
  }
  const pathname = new URL(url).pathname.toLowerCase()
  if (request.method() === 'POST' && /\/(?:send|submit|execute|generate|completion|chat\/completions)(?:\/|$)|\/(?:sessions?|runs?|turns?)\/[^/]+\/(?:messages?|turns?|runs?|submit|send)(?:\/|$)/i.test(pathname)) {
    blockedRequests.push({ method: request.method(), url: safeUrl(url), reason: 'message/run submission endpoint blocked' })
    return route.abort('blockedbyclient')
  }
  if (!['GET', 'HEAD', 'OPTIONS', 'POST'].includes(request.method())) {
    blockedRequests.push({ method: request.method(), url: safeUrl(url), reason: 'mutating request blocked by read-only QA' })
    return route.abort('blockedbyclient')
  }
  return route.continue()
})

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  const nativeFrame = page.frameLocator('iframe[title="Native DSH"]')
  await nativeFrame.locator('body').waitFor({ timeout: 45000 })
  await page.waitForTimeout(1800)

  const previewDialog = nativeFrame.getByRole('dialog').filter({ hasText: /预览版说明/ }).first()
  const loginDialog = nativeFrame.getByRole('dialog').filter({ hasText: /登录|sign in|log in|account/i }).first()
  const initialComposer = nativeFrame.locator('textarea,[contenteditable="true"],[role="textbox"]').first()
  let previewState = await Promise.race([
    previewDialog.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'preview-dialog').catch(() => ''),
    initialComposer.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'composer').catch(() => ''),
    loginDialog.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'login-dialog').catch(() => '')
  ])
  assert.ok(previewState, 'No preview explanation, login dialog, or native composer appeared')
  if (previewState === 'composer') {
    await page.waitForTimeout(500)
    if (await previewDialog.isVisible().catch(() => false)) previewState = 'preview-dialog'
    else if (await loginDialog.isVisible().catch(() => false)) previewState = 'login-dialog'
  }
  report.actions.previewExplanation = {
    present: previewState === 'preview-dialog', clickedContinue: false,
    dismissed: previewState === 'composer', alreadyDismissed: previewState === 'composer'
  }
  if (previewState === 'preview-dialog') {
    const continueButton = previewDialog.getByRole('button', { name: '继续', exact: true })
    await continueButton.waitFor({ state: 'visible', timeout: 5000 })
    await continueButton.click({ timeout: 3000 })
    report.actions.previewExplanation.clickedContinue = true
    await previewDialog.waitFor({ state: 'hidden', timeout: 10000 })
    report.actions.previewExplanation.dismissed = true
  }

  if (await loginDialog.count().catch(() => 0) && await loginDialog.isVisible().catch(() => false)) {
    const close = loginDialog.getByRole('button', { name: /^(close|关闭|取消|×)$/i }).first()
    assert.ok(await close.isVisible().catch(() => false), 'Login dialog has no safe close button')
    await close.click({ timeout: 3000 })
    await loginDialog.waitFor({ state: 'hidden', timeout: 8000 })
    report.actions.loginDialog = 'closed without authentication'
    await initialComposer.waitFor({ state: 'visible', timeout: 15000 })
    if (!report.actions.previewExplanation.present) {
      report.actions.previewExplanation.dismissed = true
      report.actions.previewExplanation.alreadyDismissed = true
    }
  } else report.actions.loginDialog = 'none'

  const body = nativeFrame.locator('body')
  await body.waitFor({ state: 'visible', timeout: 10000 })
  report.checks.nativePageVisible = await body.isVisible()
  report.checks.visibleControls = {
    buttons: await nativeFrame.locator('button').count(),
    tabs: await nativeFrame.locator('[role="tab"]').count(),
    composers: await nativeFrame.locator('textarea,[contenteditable="true"]').count()
  }
  report.checks.nativeFrameCount = await page.locator('iframe[title="Native DSH"]').count()
  await page.screenshot({ path: screenshotPath, fullPage: true })

  const openSidebar = await visibleCandidate(nativeFrame, 'button,[role="button"]', /open sidebar|show sidebar|toggle sidebar|展开侧边栏|显示侧边栏|打开侧边栏/i)
  if (openSidebar) await openSidebar.click({ timeout: 2500 })
  const useBash = await visibleCandidate(nativeFrame, '[role="treeitem"]', /use the bash tool to/i)
  report.actions.existingSession = { found: !!useBash, clicked: false }
  assert.ok(useBash, 'Could not find the existing “Use the bash tool to” history row in the native sidebar')
  if (useBash) {
    await useBash.click({ timeout: 5000 })
    report.actions.existingSession.clicked = true
  }

  const conversationTab = nativeFrame.getByRole('tab', { name: '对话', exact: true })
  await conversationTab.waitFor({ state: 'visible', timeout: 10000 })
  await conversationTab.click({ timeout: 5000 })
  report.actions.conversationTab = { found: true, clicked: true }

  report.actions.modelMenu = await openMenu(nativeFrame, 'model menu', /选择模型|模型|model/i)
  assert.equal(report.actions.modelMenu.clicked, true, 'Native model menu button was not found')
  assert.equal(report.actions.modelMenu.opened, true, 'Native model menu did not open visibly')
  if (report.actions.modelMenu.clicked) await nativeFrame.locator('body').press('Escape').catch(() => {})

  report.actions.permissionMenu = await openMenu(nativeFrame, 'permission menu', /访问模式|权限|只读|read.only|workspace.*modify/i)
  assert.equal(report.actions.permissionMenu.clicked, true, 'Native access-mode menu button was not found')
  assert.equal(report.actions.permissionMenu.opened, true, 'Native access-mode menu did not open visibly')
  if (report.actions.permissionMenu.clicked) {
    const options = nativeFrame.locator('[role="menu"],[role="listbox"],[role="dialog"]')
    const optionText = await options.first().innerText({ timeout: 1200 }).catch(() => '')
    report.actions.permissionMenu.readOnlyOptionVisible = /只读|read.only/i.test(optionText)
    report.actions.permissionMenu.workspaceModifyOptionVisible = /工作区内修改|workspace.*modif/i.test(optionText)
    report.actions.permissionMenu.visibleOptionCount = await nativeFrame.locator('[role="option"],[role="menuitem"]').count()
    await nativeFrame.locator('body').press('Escape').catch(() => {})
  }

  report.actions.addFileOrReference = await openMenu(nativeFrame, 'file/reference menu', /add file|attach|file reference|reference|添加文件|文件引用|引用/i)
  assert.equal(report.actions.addFileOrReference.clicked, true, 'Native add-file/reference menu button was not found')
  assert.equal(report.actions.addFileOrReference.opened, true, 'Native add-file/reference menu did not open visibly')
  if (report.actions.addFileOrReference.clicked) await nativeFrame.locator('body').press('Escape').catch(() => {})

  const composers = nativeFrame.locator('textarea,[contenteditable="true"],[role="textbox"]')
  let composer = null
  for (let i = await composers.count() - 1; i >= 0; i--) {
    const candidate = composers.nth(i)
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) { composer = candidate; break }
  }
  report.actions.referenceDraft = { composerFound: !!composer, atTyped: false, sent: false }
  assert.ok(composer, 'Native DSH composer was not visible and enabled')
  if (composer) {
    try {
      await composer.click({ timeout: 2500 })
      await composer.pressSequentially('@', { delay: 80 })
      report.actions.referenceDraft.atTyped = true
      await page.waitForTimeout(700)
      report.actions.referenceDraft.suggestionVisible = await nativeFrame.locator('[role="listbox"],[role="menu"],[role="option"]').first().isVisible().catch(() => false)
      await composer.press('Escape').catch(() => {})
      await composer.fill('').catch(() => {})
    } catch (error) { report.actions.referenceDraft.error = safeText(error.message) }
  }

  const trajectoryTab = nativeFrame.getByRole('tab', { name: '轨迹', exact: true })
  await trajectoryTab.waitFor({ state: 'visible', timeout: 10000 })
  await trajectoryTab.click({ timeout: 5000 })
  report.actions.trajectoryTab = { found: true, clicked: true }
  await page.waitForTimeout(800)
  report.checks.trajectoryContent = {
    tables: await nativeFrame.locator('table,[role="table"],[role="grid"]').count(),
    timelines: await nativeFrame.locator('[class*="timeline" i],[data-testid*="timeline" i],[aria-label*="timeline" i],[aria-label*="轨迹"]').count()
  }
  assert.ok(report.checks.trajectoryContent.tables > 0, 'Native trajectory view did not show its expected table')
  assert.ok(report.checks.trajectoryContent.timelines > 0, 'Native trajectory view did not show its expected timeline')
  report.actions.trajectoryHistoryTab = await clickIfVisible(nativeFrame, 'trajectory history tab', /history|历史/i, '[role="tab"],button,[role="menuitem"]')

  report.checks.duplicateRendererFactoryRegistration = {
    reproduced: consoleMessages.some((item) => /client-modules:\s*duplicate factory registration for ["']@deepseek-ai\/dsh-client-ui-renderer["']/i.test(item.text)),
    occurrences: consoleMessages.filter((item) => /client-modules:\s*duplicate factory registration for ["']@deepseek-ai\/dsh-client-ui-renderer["']/i.test(item.text)).length
  }
  report.checks.authentication = 'No login or account entry performed; only an explicit close control was used.'
  report.checks.modelRequests = 'No send/submit control, Enter key, or file selection was invoked. Known message/run submission endpoints are blocked; other loopback POST requests remain available for native read operations.'
  report.checks.harnessPath = 'Direct local NativeSurfaceGateways harness; this run does not validate the target Node WebSocket tunnel.'
  report.passed = true
  report.screenshotPath = screenshotPath
  report.reportPath = reportPath
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.passed = false
  report.failure = safeText(error.message)
  report.reportPath = reportPath
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  throw error
} finally {
  await browser.close()
}
