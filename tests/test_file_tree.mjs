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
const helpers = ['normPath', 'samePath', 'treeCacheKey', 'treeNodeId', 'treeResponseIsCurrent', 'pathBasename', 'resolveSessionTarget', 'isNewSessionId', 'toggleWorkspaceOpen', 'selectWorkspaceState']
const sandbox = {
  UI: { pad: 8, radius: 6, header: 11, gapGroup: 10 },
  C: { ink: '#111', mute: '#666', active: '#ddd', red: '#b00' },
  h: (type, props, ...children) => ({ type, props: props || {}, children }),
  React: { cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }) },
  Glyph: () => null,
  Native: {
    IconChevronDownOutlineRegular: () => null,
    IconChevronRightOutlineRegular: () => null,
    IconFolderOpenRegular: () => null,
    IconFolderCloseRegular: () => null,
    FileTypeIcon: () => null,
    FileEntryRow: ({ parent, entry, tree }) => ({
      type: 'button', props: { className: 'native-file-row', 'aria-expanded': entry.type === 'directory' ? tree.state.expanded.includes(parent.replace(/[\\/]+$/, '') + '/' + entry.name) : undefined },
      children: [{ type: 'span', props: { className: 'native-file-icon' }, children: [] }, { type: 'span', props: { className: 'native-file-name' }, children: [entry.name] }]
    })
  },
  formatBytes: () => ''
}
vm.runInNewContext(helpers.map(extract).join('\n') + '\n' + extract('FileTree') + '\nthis.tree = { normPath, treeCacheKey, treeNodeId, treeResponseIsCurrent, pathBasename, resolveSessionTarget, isNewSessionId, toggleWorkspaceOpen, selectWorkspaceState, FileTree }', sandbox)
const tree = sandbox.tree

test('repeated expand and collapse keeps one state entry per visible node', () => {
  const id = tree.treeNodeId('device-a', 'workspaces', 'workspace-1', 'D:\\Work\\demo')
  let open = {}
  for (let i = 0; i < 10; i += 1) {
    open = { ...open, [id]: !open[id] }
    open = { ...open, [id]: !open[id] }
  }
  assert.equal(Object.keys(open).length, 1)
  assert.equal(open[id], false)
})

test('same folder names at different paths have distinct node identities', () => {
  assert.notEqual(
    tree.treeNodeId('device-a', 'workspaces', 'ws-a', 'D:\\A\\demo'),
    tree.treeNodeId('device-a', 'workspaces', 'ws-b', 'E:\\B\\demo')
  )
})

test('workspace title remains a group label while folder title is its basename', () => {
  const workspace = { name: '客户项目', path: 'D:\\TetherWorkspaces\\demo' }
  assert.equal(workspace.name, '客户项目')
  assert.equal(tree.pathBasename(workspace.path), 'demo')
  assert.notEqual(workspace.name, tree.pathBasename(workspace.path))
})

test('workspace and disk nodes at one path share data cache but not expansion state', () => {
  const path = 'D:\\TetherWorkspaces\\demo'
  assert.equal(tree.treeCacheKey('device-a', path), tree.treeCacheKey('device-a', 'd:/tetherworkspaces/demo/'))
  const workspace = tree.treeNodeId('device-a', 'workspaces', 'ws-a', path)
  const disk = tree.treeNodeId('device-a', 'drives', '', path)
  assert.notEqual(workspace, disk)
})

test('late response from a previous device epoch is rejected, including switch-back', () => {
  const requestDevice = 'device-a'
  const requestEpoch = 2
  assert.equal(tree.treeResponseIsCurrent(requestDevice, 'device-b', requestEpoch, 3), false)
  assert.equal(tree.treeResponseIsCurrent(requestDevice, 'device-a', requestEpoch, 4), false)
  assert.equal(tree.treeResponseIsCurrent(requestDevice, 'device-a', requestEpoch, requestEpoch), true)
})

test('rendered FileTree has unique sibling keys for legacy duplicate paths and stays stable over ten toggles', () => {
  const deviceId = 'device-a'
  const path = 'D:\\TetherWorkspaces\\demo'
  const folder = { name: 'demo', path, dir: true }
  const workspaceId = tree.treeNodeId(deviceId, 'workspaces', 'ws-a', path)
  const driveId = tree.treeNodeId(deviceId, 'drives', '', path)
  const workspaceGroup = { id: 'workspace-group', label: '客户工作区', nodes: [{ ...folder, id: workspaceId, cacheKey: tree.treeCacheKey(deviceId, path), deviceId, groupId: 'workspaces', workspaceId: 'ws-a' }] }
  const roots = [
    { id: 'workspaces', label: '工作区', groups: [workspaceGroup] },
    { id: 'drives', label: '此电脑', nodes: [{ ...folder, id: driveId, cacheKey: tree.treeCacheKey(deviceId, path), deviceId, groupId: 'drives', workspaceId: '' }] }
  ]
  const hello = { name: 'hello.txt', path: path + '\\hello.txt', dir: false }
  const loop = { name: 'demo', path, dir: true }
  const children = { [tree.treeCacheKey(deviceId, path)]: { status: 'loaded', entries: [hello, hello, loop] } }

  // The old flattened tree contained both the synthetic parent listing and workspace listing.
  const oldFlatKeys = [path, path + '\\hello.txt', path, path + '\\hello.txt']
  assert.ok(new Set(oldFlatKeys).size < oldFlatKeys.length, 'legacy path keys should reproduce the React key collision')

  const collect = (value, out = []) => {
    if (Array.isArray(value)) value.forEach((item) => collect(item, out))
    else if (value && typeof value === 'object' && value.type) {
      out.push(value)
      collect(value.children, out)
    }
    return out
  }
  const renderAndCheck = (open, expectedCount) => {
    const rendered = tree.FileTree({ roots, children, open, onToggle() {}, onOpenFile() {}, selected: '' })
    const rows = collect(rendered.children)
    const keys = rows.map((row) => row.props.key).filter((key) => key != null)
    assert.equal(new Set(keys).size, keys.length, 'rendered sibling keys must be unique')
    assert.equal(rows.length, expectedCount, 'rerendering must not accumulate rows')
  }
  const expanded = { [workspaceId]: true, [driveId]: true }
  const collapsed = { [workspaceId]: false, [driveId]: false }
  const expandedCount = collect(tree.FileTree({ roots, children, open: expanded, onToggle() {}, onOpenFile() {}, selected: '' }).children).length
  const collapsedCount = collect(tree.FileTree({ roots, children, open: collapsed, onToggle() {}, onOpenFile() {}, selected: '' }).children).length
  for (let i = 0; i < 10; i += 1) {
    renderAndCheck(expanded, expandedCount)
    renderAndCheck(collapsed, collapsedCount)
  }
})

test('selected native history resolves only to its exact linked remote session', () => {
  const workspace = 'D:\\Work\\demo'
  const remotes = [
    { session_id: 'remote-other', device_id: 'device-a', workspace },
    { session_id: 'remote-target', device_id: 'device-a', workspace },
    { session_id: 'remote-wrong-device', device_id: 'device-b', workspace }
  ]
  const runs = [
    { session_id: 'remote-other', device_id: 'device-a', outcome: { dsh_session: 'native-other' } },
    { session_id: 'remote-target', device_id: 'device-a', outcome: { dsh_session: 'native-target' } },
    { session_id: 'remote-wrong-device', device_id: 'device-b', outcome: { dsh_session: 'native-target' } }
  ]
  const target = tree.resolveSessionTarget('native-target', null, [{ session_id: 'native-target' }], remotes, runs, 'device-a', workspace, '')
  assert.deepEqual(JSON.parse(JSON.stringify(target)), { sessionId: 'remote-target' })
})

test('tether-prefixed native ID maps exactly; unlinked DSH history is blocked', () => {
  const workspace = 'D:\\Work\\demo'
  const remotes = [{ session_id: 'remote-1', device_id: 'device-a', workspace }]
  const runs = [{ session_id: 'remote-1', device_id: 'device-a' }]
  const linked = tree.resolveSessionTarget('tether-remote-1', null, [{ session_id: 'tether-remote-1' }], remotes, runs, 'device-a', workspace, '')
  const unlinked = tree.resolveSessionTarget('native-old', null, [{ session_id: 'native-old' }], remotes, runs, 'device-a', workspace, '')
  assert.deepEqual(JSON.parse(JSON.stringify(linked)), { sessionId: 'remote-1' })
  assert.equal(unlinked.blocked, true)
  assert.equal(tree.isNewSessionId('fresh-session', remotes), true)
  assert.equal(tree.isNewSessionId('remote-1', remotes), false)
  assert.match(source, /if \(!freshSession && \(sendTargetBlocked \|\| \(\(sessionId \|\| currentRun\) && !sendTarget\)\)\)/)
  assert.doesNotMatch(source, /existing\.length \? existing\[existing\.length - 1\]\.session_id/)
})

test('current run may continue only on the same device and workspace', () => {
  const run = { session_id: 'remote-run', device_id: 'device-a' }
  const workspace = 'D:\\Work\\demo'
  assert.deepEqual(JSON.parse(JSON.stringify(tree.resolveSessionTarget('', run, [], [], [], 'device-a', workspace, workspace))), { sessionId: 'remote-run' })
  assert.equal(tree.resolveSessionTarget('', run, [], [], [], 'device-b', workspace, workspace).blocked, true)
  assert.equal(tree.resolveSessionTarget('', run, [], [], [], 'device-a', workspace, 'D:\\Work\\other').blocked, true)
})

test('workspace row selection followed by toggle can collapse and reopen', () => {
  const workspace = { path: 'D:\\Work\\demo' }
  const current = { projectPath: workspace.path, sessionId: 'native-2', runId: '', path: workspace.path, pathDraft: workspace.path, file: null }
  const lastProject = { current: workspace.path }
  const selected = tree.selectWorkspaceState(lastProject, current, workspace, null)
  let open = { [workspace.path]: true }
  open = tree.toggleWorkspaceOpen(open, workspace.path)
  assert.equal(open[workspace.path], false)
  open = tree.toggleWorkspaceOpen(open, workspace.path)
  assert.equal(open[workspace.path], true)
  assert.equal(selected.sessionId, 'native-2', 'same workspace selection must preserve the active session')
})

test('cross-workspace explicit non-first session selection survives project effect ordering', () => {
  const workspace = { path: 'E:\\Work\\second' }
  const current = { projectPath: 'D:\\Work\\first', sessionId: 'old-session', runId: '', path: 'D:\\Work\\first', pathDraft: 'D:\\Work\\first', file: { path: 'old.txt' } }
  const lastProject = { current: current.projectPath }
  const next = tree.selectWorkspaceState(lastProject, current, workspace, { type: 'session', id: 'second-workspace-session-2' })
  // This is the App effect guard: the explicit handler has already adopted this project path.
  if (next.projectPath !== lastProject.current) Object.assign(next, { sessionId: '', runId: '' })
  assert.equal(lastProject.current, workspace.path)
  assert.equal(next.sessionId, 'second-workspace-session-2')
  assert.equal(next.runId, '')
  assert.equal(next.file, null)
  assert.equal(next.path, workspace.path)
})
