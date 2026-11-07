import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function loadHelpers() {
  const start = source.indexOf('export function versionTuple(')
  const lineStart = source.indexOf('export function versionLine(')
  const end = source.indexOf('\n\n', lineStart)
  assert.ok(start >= 0 && lineStart > start && end > lineStart, 'version helpers are present')
  return vm.runInNewContext(source.slice(start, end).replace(/export /g, '') + '\n;({ versionTuple, versionLine })')
}

test('version tuple shows the manifest latest for every device', () => {
  const { versionTuple } = loadHelpers()
  assert.equal(versionTuple('0.2.16', '0.2.15'), '0.2.16(0.2.15)')
  assert.equal(versionTuple('0.2.21', '0.2.20'), '0.2.21(0.2.20)')
  assert.equal(versionTuple('0.2.16', ''), '0.2.16(0.2.16)')
  assert.equal(versionTuple('', '0.2.15'), '-(-)')
  assert.equal(versionTuple(undefined, undefined), '-(-)')
  assert.equal(versionTuple('0.2.16', '0.2.16'), '0.2.16(0.2.16)')
})

test('APP version line includes Node while plugin version stays independent', () => {
  const { versionLine } = loadHelpers()
  assert.equal(versionLine('APP', { current: '0.2.16', latest: '0.2.15' }, { current: '0.2.16', latest: '0.2.15' }),
    'APP 0.2.16(0.2.15)/Node 0.2.16(0.2.15)')
  assert.equal(versionLine('插件', { current: '0.2.16', latest: '0.2.15' }), '插件 0.2.16(0.2.15)/Node -(-)')
})

test('update cards no longer render mode-dependent text', () => {
  assert.equal(source.includes("'当前 '"), false, 'leading 当前 prefix is gone')
  assert.equal(source.includes("' · 最新 '"), false, 'trailing 最新 suffix is gone')
  assert.equal(source.includes('（已安装 '), false, 'installed-pending suffix is not part of the version line')
  assert.ok(source.includes("versionLine('APP'"), 'desktop card uses APP version line')
  assert.ok(source.includes("'插件 ' + versionTuple(infos[0].runtime_version || infos[0].current_version"), 'plugin card keeps its own version')
  assert.ok(source.includes("versionRows.push('APP ' + versionTuple("), 'device card renders the APP line')
  assert.ok(!source.includes("versionRows.push('插件 '"), 'device card does not render a plugin update row')
  assert.ok(source.includes("if (!versionRows.length) versionRows.push('Node ' + nodeTuple)"), 'device card falls back to Node only')
})
