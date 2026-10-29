import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function loadHelpers() {
  const start = source.indexOf('const versionRank = ')
  const lineStart = source.indexOf('export function versionLine(')
  const end = source.indexOf('\n\n', lineStart)
  assert.ok(start >= 0 && lineStart > start && end > lineStart, 'version helpers are present')
  return vm.runInNewContext(source.slice(start, end).replace(/export /g, '') + '\n;({ versionTuple, versionLine })')
}

test('version tuple keeps current(latest) with a stable shape', () => {
  const { versionTuple } = loadHelpers()
  assert.equal(versionTuple('0.2.16', '0.2.15'), '0.2.16(0.2.16)')
  assert.equal(versionTuple('0.2.21', '0.2.20'), '0.2.21(0.2.21)')
  assert.equal(versionTuple('0.2.16', ''), '0.2.16(0.2.16)')
  assert.equal(versionTuple('', '0.2.15'), '-(-)')
  assert.equal(versionTuple(undefined, undefined), '-(-)')
  assert.equal(versionTuple('0.2.16', '0.2.16'), '0.2.16(0.2.16)')
})

test('APP and plugin lines use the same slash format with their own latest versions', () => {
  const { versionLine } = loadHelpers()
  assert.equal(versionLine('APP', { current: '0.2.16', latest: '0.2.15' }, { current: '0.2.16', latest: '0.2.15' }),
    'APP 0.2.16(0.2.16)/Node 0.2.16(0.2.16)')
  assert.equal(versionLine('插件', { current: '0.2.16', latest: '0.2.15' }, { current: '0.2.16', latest: '0.2.15' }),
    '插件 0.2.16(0.2.16)/Node 0.2.16(0.2.16)')
  assert.equal(versionLine('插件', { current: '0.2.15', latest: '0.2.16' }, { current: '0.2.14', latest: '0.2.16' }),
    '插件 0.2.15(0.2.16)/Node 0.2.14(0.2.16)')
})

test('update cards no longer render mode-dependent text', () => {
  assert.equal(source.includes("'当前 '"), false, 'leading 当前 prefix is gone')
  assert.equal(source.includes("' · 最新 '"), false, 'trailing 最新 suffix is gone')
  assert.equal(source.includes('（已安装 '), false, 'installed-pending suffix is not part of the version line')
  assert.ok(source.includes("versionLine(product === 'desktop' ? 'APP' : '插件'"), 'product card uses versionLine')
  assert.ok(source.includes("versionRows.push('APP ' + versionTuple("), 'device card renders the APP line')
  assert.ok(source.includes("versionRows.push('插件 ' + versionTuple("), 'device card renders the plugin line')
  assert.ok(source.includes("if (!versionRows.length) versionRows.push('Node ' + nodeTuple)"), 'device card falls back to Node only')
})
