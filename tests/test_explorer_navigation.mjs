import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8')

function extract(name) {
  const start = source.indexOf('    function ' + name + '(')
  assert.notEqual(start, -1, `missing ${name}`)
  const signatureEnd = source.indexOf(') {', start)
  const open = signatureEnd + 2
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1).replace(/^    /gm, '')
    }
  }
  throw new Error(`unterminated ${name}`)
}

const helpers = ['normPath', 'explorerHistory', 'explorerNavigate', 'explorerHistoryStep', 'toggleExplorerSort', 'compareExplorerEntries', 'sortExplorerEntries', 'filterExplorerEntries']
const sandbox = {}
vm.runInNewContext(
  helpers.map(extract).join('\n') + '\nthis.explorer = { ' + helpers.join(', ') + ' }',
  sandbox
)
const explorer = sandbox.explorer

const plain = (value) => JSON.parse(JSON.stringify(value))
const names = (list) => plain(list.map((entry) => entry.name))

test('back walks the stack and forward replays it in order', () => {
  let history = explorer.explorerNavigate({ back: [], forward: [] }, 'C:\\a', 'C:\\b')
  history = explorer.explorerNavigate(history, 'C:\\b', 'C:\\c')
  assert.deepEqual(plain(history.back), ['C:\\a', 'C:\\b'])
  assert.deepEqual(plain(history.forward), [])

  const first = explorer.explorerHistoryStep(history, 'back', 'C:\\c')
  assert.equal(first.target, 'C:\\b')
  assert.deepEqual(plain(first.history), { back: ['C:\\a'], forward: ['C:\\c'] })

  const second = explorer.explorerHistoryStep(first.history, 'back', 'C:\\b')
  assert.equal(second.target, 'C:\\a')
  assert.deepEqual(plain(second.history), { back: [], forward: ['C:\\c', 'C:\\b'] })

  const replay = explorer.explorerHistoryStep(second.history, 'forward', 'C:\\a')
  assert.equal(replay.target, 'C:\\b')
  assert.deepEqual(plain(replay.history), { back: ['C:\\a'], forward: ['C:\\c'] })
})

test('back and forward return null at the ends of the stack', () => {
  assert.equal(explorer.explorerHistoryStep({ back: [], forward: [] }, 'back', 'C:\\a'), null)
  assert.equal(explorer.explorerHistoryStep({ back: [], forward: [] }, 'forward', 'C:\\a'), null)
  assert.equal(explorer.explorerHistoryStep(undefined, 'forward', 'C:\\a'), null)
})

test('a new navigation clears the forward stack while keeping the back stack', () => {
  const stepped = explorer.explorerHistoryStep({ back: ['C:\\a'], forward: ['C:\\c'] }, 'back', 'C:\\b')
  const fresh = explorer.explorerNavigate(stepped.history, 'C:\\a', 'C:\\d')
  assert.deepEqual(plain(fresh.back), ['C:\\a'])
  assert.deepEqual(plain(fresh.forward), [])
})

test('navigating to the current folder does not push history', () => {
  const history = { back: ['C:\\a'], forward: ['C:\\c'] }
  assert.equal(explorer.explorerNavigate(history, 'C:\\Work', 'c:/work/'), history)
  assert.equal(explorer.explorerNavigate(history, '', 'C:\\Work'), history)
  assert.equal(explorer.explorerNavigate(history, 'C:\\Work', ''), history)
})

test('sorting keeps directories above files in both directions', () => {
  const entries = [
    { name: 'z.txt', dir: false, size: 1 },
    { name: 'folder-b', dir: true },
    { name: 'a.txt', dir: false, size: 9 },
    { name: 'folder-a', dir: true }
  ]
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'name', 'asc')), ['folder-a', 'folder-b', 'a.txt', 'z.txt'])
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'name', 'desc')), ['folder-b', 'folder-a', 'z.txt', 'a.txt'])
})

test('name sorting is natural for numbered files', () => {
  const entries = [{ name: 'file10' }, { name: 'file2' }, { name: 'file1' }]
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'name', 'asc')), ['file1', 'file2', 'file10'])
})

test('size sorting orders files by bytes and breaks ties by name ascending', () => {
  const entries = [{ name: 'b', size: 10 }, { name: 'a', size: 10 }, { name: 'c', size: 99 }]
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'size', 'desc')), ['c', 'a', 'b'])
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'size', 'asc')), ['a', 'b', 'c'])
})

test('mtime sorting uses seconds and keeps the newest first when descending', () => {
  const entries = [{ name: 'old', mtime: 100 }, { name: 'new', mtime: 900 }, { name: 'mid', mtime: 500 }]
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'mtime', 'desc')), ['new', 'mid', 'old'])
  assert.deepEqual(names(explorer.sortExplorerEntries(entries, 'mtime', 'asc')), ['old', 'mid', 'new'])
})

test('clicking a sort column toggles direction and defaults new columns sensibly', () => {
  assert.deepEqual(plain(explorer.toggleExplorerSort({ key: 'name', dir: 'asc' }, 'name')), { key: 'name', dir: 'desc' })
  assert.deepEqual(plain(explorer.toggleExplorerSort({ key: 'size', dir: 'desc' }, 'size')), { key: 'size', dir: 'asc' })
  assert.deepEqual(plain(explorer.toggleExplorerSort({ key: 'name', dir: 'asc' }, 'size')), { key: 'size', dir: 'desc' })
  assert.deepEqual(plain(explorer.toggleExplorerSort({ key: 'mtime', dir: 'desc' }, 'name')), { key: 'name', dir: 'asc' })
  assert.deepEqual(plain(explorer.toggleExplorerSort(null, 'mtime')), { key: 'mtime', dir: 'desc' })
})

test('search filters the current listing case-insensitively and ignores blank queries', () => {
  const entries = [{ name: 'README.md' }, { name: 'src' }, { name: 'Notes.txt' }]
  assert.deepEqual(names(explorer.filterExplorerEntries(entries, 'read')), ['README.md'])
  assert.deepEqual(names(explorer.filterExplorerEntries(entries, '  SRC ')), ['src'])
  assert.deepEqual(names(explorer.filterExplorerEntries(entries, 'notes')), ['Notes.txt'])
  assert.deepEqual(names(explorer.filterExplorerEntries(entries, 'missing')), [])
  assert.deepEqual(names(explorer.filterExplorerEntries(entries, '   ')), ['README.md', 'src', 'Notes.txt'])
})

test('the explorer wires history, sort and search into the visible toolbar', () => {
  assert.match(source, /iconButton\('back', '后退 \(Alt\+←\)', goBack, !history\.back\.length\)/)
  assert.match(source, /iconButton\('forward', '前进 \(Alt\+→\)', goForward, !history\.forward\.length\)/)
  assert.match(source, /iconButton\('arrowUp', '上级目录 \(Alt\+↑\)', goUp, !canGoUp\)/)
  assert.match(source, /const canGoUp = !!path && normPath\(parentOf\(path\)\) !== normPath\(path\)/)
  assert.match(source, /const step = explorerHistoryStep\(history, direction, pathRef\.current \|\| path\)/)
  assert.match(source, /if \(event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight' && event\.key !== 'ArrowUp'\) return/)
  assert.match(source, /if \(event\.key === 'ArrowLeft'\) goBack\(\)\s+else if \(event\.key === 'ArrowRight'\) goForward\(\)\s+else goUp\(\)/)
})

test('the explorer exposes sort headers, a search box with a clear action and a search empty state', () => {
  assert.match(source, /usePersisted\('tether\.explorer\.sort', \{ key: 'name', dir: 'asc' \}\)/)
  assert.match(source, /sortHeader\('name', '名称'\), sortHeader\('mtime', '修改日期'\), h\('span', null, '类型'\), sortHeader\('size', '大小', 'right'\)/)
  assert.match(source, /'data-sort': sortKey === key \? sortDir : undefined/)
  assert.match(source, /const entries = filterExplorerEntries\(sortExplorerEntries\(dirEntries, sortKey, sortDir\), search\)/)
  assert.match(source, /'aria-label': '搜索当前目录'/)
  assert.match(source, /'aria-label': '清除搜索', onClick: \(\) => setSearch\(''\)/)
  assert.match(source, /未找到匹配 “' \+ search\.trim\(\) \+ '” 的项目/)
  assert.match(source, /if \(filtering && !entries\.length\) return/)
})

test('a fast folder double-click reuses the prefetched listing without a false read error', () => {
  assert.match(source, /rememberDir\(requestDevice, target, entries\)\s*return data/)
  assert.match(source, /let data = pending \? await pending : null/)
  assert.match(source, /if \(!data\) data = await postRetry\('\/api\/devices\/' \+ encodeURIComponent\(requestDevice\) \+ '\/fs\/list'/)
})

test('directory loading overlays the list instead of shifting it', () => {
  assert.equal(source.includes("'正在刷新…'"), false, 'no inline refresh row')
  assert.match(source, /className: 'tether-dir-loading'/)
  assert.match(source, /\.tether-dir-loading \{ position: absolute; inset: 0;/)
  assert.match(source, /position: 'relative', display: 'flex' \} \},\s*h\('div', \{ className: 'tether-scroll'/)
})
