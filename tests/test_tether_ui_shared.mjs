import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shared = fs.readFileSync(path.join(root, 'packages/tether-ui/src/app.js'), 'utf8')
const plugin = fs.readFileSync(path.join(root, 'packages/dsh-plugin-tether-client/lib/client.js'), 'utf8')

test('DSH plugin bundle is up to date with the shared tether-ui source', () => {
  const output = execFileSync(process.execPath, ['packages/tether-ui/scripts/build.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /matches shared source/)
})

test('the shared panel body is copied byte for byte into the plugin bundle', () => {
  const start = shared.indexOf('    const C = {')
  const end = shared.indexOf('    return { App, TetherIcon }')
  assert.ok(start > 0 && end > start)
  const body = shared.slice(start, end)
  assert.ok(plugin.includes(body), 'plugin bundle must embed the shared UI body unchanged')
  assert.equal((plugin.match(/function App\(\) \{/g) || []).length, 1, 'only one App implementation ships')
  assert.equal((plugin.match(/function createTetherPanel\(/g) || []).length, 1)
})

test('the shared factory accepts a DSH host and a Web host without DSH globals', async () => {
  const { createTetherPanel } = await import('../packages/tether-ui/src/app.js')
  const { createDshHost } = await import('../packages/tether-ui/src/hosts/dsh.js')
  const { createWebHost, createWebNative } = await import('../packages/tether-ui/src/hosts/web.js')
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState() { return [null, () => {}] },
    useEffect() {}, useRef() { return { current: null } }, useCallback(fn) { return fn }, useId() { return 'id' }
  }
  const Native = {
    chatZh: {}, workspaceZh: {}, toolZh: {}, markdownLabels: () => ({}),
    FileEntryRow: () => null, FileTypeIcon: () => null, MarkdownText: () => null
  }
  const dsh = createTetherPanel({ React, Native, host: createDshHost() })
  assert.equal(typeof dsh.App, 'function')
  assert.equal(typeof dsh.TetherIcon, 'function')
  assert.equal(createDshHost().apiBase(), 'http://127.0.0.1:18890')
  assert.equal(createWebHost().apiBase(), '')

  const web = createTetherPanel({ React, Native: createWebNative(React), host: createWebHost({ apiBase: '/tether' }) })
  assert.equal(typeof web.App, 'function')
  const row = createWebNative(React).FileEntryRow({ entry: { name: 'demo', type: 'directory' }, tree: { onToggle() {} }, expanded: false })
  assert.ok(row && row.type === 'button')
  const markdown = createWebNative(React).MarkdownText({ text: '# Title\n\nbody **bold**' })
  assert.ok(markdown && markdown.type === 'div')
})