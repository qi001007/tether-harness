import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { fetchApiJson } from '../packages/tether-ui/src/app.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')
const server = fs.readFileSync(path.join(root, 'packages/tether-ui/web/server.mjs'), 'utf8')
const supervisor = fs.readFileSync(path.join(root, 'apps/tether-app/supervisor.js'), 'utf8')

test('an aborted request is not retried against the next API base', async () => {
  let calls = 0
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  await assert.rejects(
    fetchApiJson('/api/state', {}, {
      activeBase: 'http://a', apiBaseList: ['http://a', 'http://b'],
      fetcher: async () => { calls += 1; throw abort }
    }),
    (error) => error.name === 'AbortError'
  )
  assert.equal(calls, 1)
})

test('directory navigation reuses cache, seeds the tree, and never reloads the parent after preview', () => {
  assert.match(source, /const dirCacheRef = React\.useRef\(new Map\(\)\)/)
  assert.match(source, /const cached = opts\.fresh === true \? null : dirCacheRef\.current\.get\(key\)/)
  assert.match(source, /revealTree\(nextPath, \{ path: nextPath, entries: cached\.entries \}\)/)
  assert.match(source, /if \(seedKey && node\.cacheKey === seedKey\)/)
  assert.match(source, /const prefetchDir = \(target\) =>/)
  assert.match(source, /const prefetchPreview = \(entry\) =>/)
  assert.match(source, /const stopLoading = \(\) =>/)
  assert.match(source, /onClick: stopLoading/)
  assert.match(source, /if \(loadedDirRef\.current !== requestDevice \+ '\|' \+ normPath\(parent\)\) \{\s*await loadDir\(parent, \{ push: false, keepFile: true \}\)/)
})

test('device switching cannot apply the previous device workspace path', () => {
  assert.match(source, /const \[projectsDevice, setProjectsDevice\] = React\.useState\(''\)/)
  assert.match(source, /if \(projectsDevice !== deviceId\) return/)
  assert.match(source, /setProjectsDevice\(requestDevice\)/)
  assert.match(source, /setProjectsDevice\(''\)/)
})

test('remote device updates order node, installed plugin, then app', async () => {
  const { deviceUpdateComponents, updateAvailableFor } = await import('../packages/tether-ui/src/app.js')
  assert.deepEqual(deviceUpdateComponents({ app_version: '0.2.4', dsh_surface: true }), ['node', 'plugin', 'app'])
  assert.deepEqual(deviceUpdateComponents({ app_version: '0.2.4' }), ['node', 'app'])
  assert.deepEqual(deviceUpdateComponents({ dsh_surface: true }), ['node', 'plugin'])
  assert.equal(updateAvailableFor({ devices: { laptop: { app: { update_available: true } } } }, 'app', 'laptop'), true)
  assert.match(source, /await watchNodeRestart\(scope, entry\.authority\)/)
  assert.match(source, /await watchAppRestart\(scope, entry\.authority, entry\.checked && entry\.checked\.latest_version\)/)
})

test('hover uses an in-app tooltip and double click is guarded', () => {
  assert.match(source, /const \[hoverTip, setHoverTip\] = React\.useState\(null\)/)
  assert.match(source, /role: 'tooltip'/)
  assert.match(source, /border: '1px solid rgba\(16, 24, 40, 0\.16\)'/)
  assert.match(source, /if \(event\.detail > 1\) return/)
  assert.match(source, /onDoubleClick: \(event\) => \{ event\.preventDefault\(\); hideHoverTip\(\); openFile\(entry\) \}/)
  assert.match(source, /onHoverEntry/)
})

test('APP routes the local device file API and surface descriptor to the node and keeps the token server-side', () => {
  assert.match(server, /const LOCAL_ROUTES = \['\/fs\/', '\/workspaces', '\/drives', '\/policy', '\/audit', '\/dsh\/sessions', '\/dsh\/surface', '\/dsh\/workspaces\/register'\]/)
  assert.match(server, /headers\.authorization = 'Bearer ' \+ localToken/)
  assert.match(server, /'x-tether-local': '1'/)
  assert.match(supervisor, /crypto\.randomBytes\(24\)\.toString\('hex'\)/)
  assert.match(supervisor, /env\.TETHER_LOCAL_API_TOKEN = this\.localApiToken/)
})

test('the node console serves session transcripts so local devices do not 404', () => {
  const consoleSource = fs.readFileSync(path.join(root, 'tether/node/console.py'), 'utf8')
  assert.match(consoleSource, /len\(tail\) == 3 and tail\[0\] == "dsh" and tail\[1\] == "sessions"/)
  assert.match(consoleSource, /DSH session not found/)
})

test('errors render as a dismissible overlay instead of pushing the page down', () => {
  assert.match(source, /const renderToasts = \(\) => \{/)
  assert.match(source, /position: 'absolute', bottom: 14, right: 12, zIndex: 85/)
  assert.match(source, /'aria-label': '关闭提示'/)
  assert.match(source, /setProjectsError\(''\)/)
  assert.doesNotMatch(source, /notice \? h\('div', \{ style: \{ padding: '6px 14px'/)
  assert.doesNotMatch(source, /projectsError \? h\('div', \{ role: 'alert', style: \{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px'/)
})
