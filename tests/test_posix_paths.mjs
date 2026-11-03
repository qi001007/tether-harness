import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function extractFrom(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, `missing ${name} in ${file}`)
  const signatureEnd = source.indexOf(') {', start)
  const open = signatureEnd + 2
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unterminated ${name}`)
}

const appSource = new URL('../packages/tether-ui/src/app.js', import.meta.url)
const appText = fs.readFileSync(appSource, 'utf8')
const app = {}
vm.runInNewContext(
  ['joinPath', 'pathSegments'].map((name) => extractFrom('../packages/tether-ui/src/app.js', name)).join('\n') +
    '\nthis.paths = { joinPath, pathSegments }',
  app
)

test('POSIX child paths keep the leading slash', () => {
  assert.equal(app.paths.joinPath('/', 'srv'), '/srv')
  assert.equal(app.paths.joinPath('/', 'lost+found'), '/lost+found')
  assert.equal(app.paths.joinPath('/home', 'user'), '/home/user')
  assert.equal(app.paths.joinPath('/home/', 'user'), '/home/user')
})

test('Windows child paths keep backslashes and drive roots', () => {
  assert.equal(app.paths.joinPath('C:\\', 'Work'), 'C:\\Work')
  assert.equal(app.paths.joinPath('D:\\Work', 'a.txt'), 'D:\\Work\\a.txt')
  assert.equal(app.paths.joinPath('D:/Work', 'a.txt'), 'D:/Work/a.txt')
})

test('POSIX breadcrumbs start at root', () => {
  assert.deepEqual(
    [...app.paths.pathSegments('/srv').map((item) => item.path)],
    ['/', '/srv']
  )
  assert.deepEqual(
    [...app.paths.pathSegments('/home/user').map((item) => item.path)],
    ['/', '/home', '/home/user']
  )
})

test('Windows breadcrumbs keep drive letters', () => {
  assert.deepEqual(
    [...app.paths.pathSegments('C:\\Work\\demo').map((item) => item.path)],
    ['C:\\', 'C:\\Work', 'C:\\Work\\demo']
  )
})

const explorerSource = fs.readFileSync(new URL('../packages/tether-ui/src/target-file-explorer.js', import.meta.url), 'utf8')
const parentStart = explorerSource.indexOf('function parentOf(')
assert.notEqual(parentStart, -1, 'missing parentOf')
const parentEnd = explorerSource.indexOf('\n}', parentStart) + 2
const parentOf = vm.runInNewContext(explorerSource.slice(parentStart, parentEnd) + '\nthis.parentOf = parentOf', {})
assert.equal(parentOf('/srv'), '/')
assert.equal(parentOf('/srv/data'), '/srv')
assert.equal(parentOf('/'), '')
assert.equal(parentOf('C:\\Work'), 'C:\\')
assert.equal(parentOf('D:\\Work\\demo'), 'D:\\Work')
