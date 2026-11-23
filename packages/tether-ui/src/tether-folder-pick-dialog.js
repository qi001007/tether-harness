import { TargetFileExplorer } from './target-file-explorer.js'
import { createGlyph } from './tether-glyph.js'

function targetJoinPath(parent, name) {
  const base = String(parent || '')
  const separator = base.includes('\\') ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + separator + name
}

function pickRootOf(path, roots) {
  const value = String(path || '').toLowerCase()
  if (!value) return ''
  const match = roots.find((item) => value === item.path.toLowerCase()
    || value.startsWith(item.path.toLowerCase().replace(/[\\/]+$/, '') + '\\')
    || value.startsWith(item.path.toLowerCase().replace(/[\\/]+$/, '') + '/'))
  return match ? match.path : ''
}

function formatPickTime(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value * 1000)
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) + ' ' +
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatPickSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

// The one Tether resource-manager dialog shared by every surface: the Tether
// shell (embedded Codeg page, target DSH native surface) and the DSH target
// attachments picker. It owns only the chrome and the explorer; where the
// roots and directory listings come from is injected so DSH keeps its own
// target-device bridge and identity checks:
//
// - `kind: 'folder'` — folders open on a click and "选择此文件夹" answers with
//   the current directory. With `multiple` the rows are ticked instead and the
//   confirm action answers with the selected folders (double-click still walks
//   into one).
// - `kind: 'file'` — a click selects a file and the confirm action answers with
//   it; with `multiple` several files can be ticked. Folders still open.
//
// Data source: without `loadRoots`/`listDirectory` the dialog reads the Tether
// device file API through `api`/`post` for `device`. A surface that already has
// its own reader (DSH) passes `loadRoots()` and `listDirectory(path)` instead.
//
// Cancelling answers `cancelled` (an empty string); the guest treats an empty
// answer the same way. Confirming answers the chosen paths plus the matching
// entry objects so the caller can read them without re-listing.
export function TetherFolderPickDialog({
  React, C, Glyph, api, post, device, kind = 'folder', multiple = false,
  title = '', loadRoots, listDirectory, onDone
}) {
  const h = React.createElement
  const fileMode = kind === 'file'
  const DrawGlyph = Glyph || createGlyph(React)
  const [rootList, setRootList] = React.useState({ workspaces: [], drives: [] })
  const [deviceName, setDeviceName] = React.useState(String(device || ''))
  const [path, setPath] = React.useState('')
  const [entries, setEntries] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [sort, setSort] = React.useState({ key: 'name', dir: 'asc' })
  const [search, setSearch] = React.useState('')
  const [selectedPath, setSelectedPath] = React.useState('')
  const [selectedPaths, setSelectedPaths] = React.useState([])
  const seq = React.useRef(0)
  // `post`/`api`/`loadRoots` are rebuilt on every host render; the dialog must
  // not restart its directory loads because of that, so it reads them through
  // a ref.
  const io = React.useRef({ post, api, device, loadRoots, listDirectory })
  io.current = { post, api, device, loadRoots, listDirectory }
  const cancel = React.useCallback(() => onDone(''), [onDone])

  React.useEffect(() => {
    const onKeyDown = (event) => { if (event && event.key === 'Escape') cancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel])

  const enter = React.useCallback(async (next) => {
    const target = String(next || '').trim()
    if (!target) return
    const ioNow = io.current
    const injected = typeof ioNow.listDirectory === 'function'
    if (!injected && !ioNow.device) return
    const current = seq.current + 1
    seq.current = current
    setBusy(true)
    setError('')
    setPath(target)
    setEntries(null)
    setSearch('')
    setSelectedPath('')
    setSelectedPaths([])
    try {
      let listed
      if (injected) {
        listed = await ioNow.listDirectory(target)
        if (!Array.isArray(listed)) throw new Error('目录读取失败')
      } else {
        const data = await ioNow.post('/api/devices/' + encodeURIComponent(ioNow.device) + '/fs/list', { path: target })
        if (!data || !Array.isArray(data.entries)) throw new Error('目录读取失败')
        if (data.device_id && data.device_id !== ioNow.device) throw new Error('目标设备身份校验失败')
        listed = data.entries
      }
      if (current !== seq.current) return
      // The injected reader already vouches for its entry paths; the device API
      // answers carry only names, so the dialog composes those paths itself.
      setEntries(listed.map((entry) => injected
        ? { ...entry }
        : { ...entry, path: targetJoinPath(target, entry.name) }))
    } catch (err) {
      if (current !== seq.current) return
      setEntries([])
      setError(String((err && err.message) || err || '目录读取失败'))
    } finally {
      if (current === seq.current) setBusy(false)
    }
  }, [])

  React.useEffect(() => {
    if (!device && typeof io.current.loadRoots !== 'function') return undefined
    let live = true
    const readRoots = async () => {
      const ioNow = io.current
      if (typeof ioNow.loadRoots === 'function') return (await ioNow.loadRoots()) || null
      const base = '/api/devices/' + encodeURIComponent(ioNow.device)
      const read = (next) => (typeof ioNow.api === 'function' ? ioNow.api(next).catch(() => null) : Promise.resolve(null))
      const [workspaceData, driveData] = await Promise.all([read(base + '/workspaces'), read(base + '/drives')])
      return {
        deviceId: ioNow.device,
        workspaces: workspaceData && Array.isArray(workspaceData.workspaces) ? workspaceData.workspaces : [],
        drives: driveData && Array.isArray(driveData.drives) ? driveData.drives : []
      }
    }
    readRoots().then((data) => {
      if (!live || !data) return
      const workspaces = Array.isArray(data.workspaces)
        ? data.workspaces
          .filter((item) => item && typeof item.path === 'string' && item.path && item.kind !== 'node')
          .map((item) => ({ name: item.name === 'default-workspace' ? '默认工作区' : (item.name || item.path), path: item.path }))
        : []
      const drives = Array.isArray(data.drives)
        ? data.drives
          .filter((item) => item && typeof item.path === 'string' && item.path)
          .map((item) => ({ name: item.name || item.path, path: item.path }))
        : []
      setRootList({ workspaces, drives })
      if (typeof data.deviceId === 'string' && data.deviceId) setDeviceName(data.deviceId)
      if (data.warning) setError(String(data.warning))
      // Land in the first workspace instead of an empty pane: that is where a
      // project almost always lives.
      if (workspaces.length) void enter(workspaces[0].path)
    }).catch((err) => {
      if (live) setError(String((err && err.message) || err || '读取目标设备失败'))
    })
    return () => { live = false }
  }, [device, enter])

  const roots = [
    ...rootList.workspaces.map((item) => ({ ...item, kind: 'workspace', dir: true })),
    ...rootList.drives.map((item) => ({ ...item, kind: 'drive', dir: true }))
  ]
  const isDriveRoot = rootList.drives.some((item) => item.path === path)
  const canConfirm = !!path && !isDriveRoot
  // What the confirm action would answer, resolved against the entries on
  // screen so a tick on the wrong kind of row (a file while picking folders,
  // a folder while picking files) never reaches the guest.
  const kindOf = (target) => {
    const entry = Array.isArray(entries) ? entries.find((item) => item && item.path === target) : null
    return entry ? (entry.dir ? 'dir' : 'file') : ''
  }
  const ticked = multiple ? selectedPaths : (selectedPath ? [selectedPath] : [])
  const chosen = fileMode
    ? ticked.filter((target) => kindOf(target) === 'file')
    : multiple
      ? (() => {
        const dirs = ticked.filter((target) => kindOf(target) === 'dir')
        return dirs.length ? dirs : (canConfirm ? [path] : [])
      })()
      : (canConfirm ? [path] : [])
  const canPick = chosen.length > 0 && !busy
  const confirmLabel = fileMode
    ? (chosen.length > 1 ? '选择文件（' + chosen.length + '）' : '选择文件')
    : multiple
      ? (chosen.length > 1 ? '选择文件夹（' + chosen.length + '）' : '选择文件夹')
      : '选择此文件夹'
  const chosenEntries = () => (Array.isArray(entries)
    ? entries.filter((entry) => entry && chosen.includes(entry.path))
    : [])
  const dialogTitle = title || (fileMode ? '选择文件' : '选择工作区文件夹')
  const fileIcon = (item) => h('span', {
    style: { display: 'grid', placeItems: 'center', color: item && item.dir ? C.sub : C.mute }
  }, h(DrawGlyph, { name: item && item.dir ? 'workspace' : 'files', size: 14 }))
  const mutedButton = {
    height: 28, padding: '0 12px', border: '1px solid ' + C.line, borderRadius: 6,
    background: C.bg, color: C.sub, fontSize: 12, cursor: 'pointer'
  }
  return h('div', {
    style: {
      position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      background: 'rgba(16, 24, 40, 0.45)'
    },
    onClick: (event) => { if (event && event.target === event.currentTarget) cancel() }
  },
    h('div', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': dialogTitle,
      onClick: (event) => { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
      style: {
        width: 'min(880px, 100%)', height: 'min(600px, 100%)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', background: C.bg, color: C.ink, border: '1px solid ' + C.line, borderRadius: 12,
        boxShadow: 'var(--dsw-elevation-panel, 0 24px 64px rgba(16, 24, 40, 0.28))', font: 'inherit'
      }
    },
      h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' }
      },
        h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
          h('div', { style: { height: 20, lineHeight: '20px', fontSize: 15, fontWeight: 600, color: C.ink } },
            dialogTitle),
          h('div', {
            style: { marginTop: 2, height: 18, lineHeight: '18px', color: C.mute, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          }, (multiple && !fileMode ? '可按住 Ctrl 多选文件夹；' : multiple ? '可按住 Ctrl 多选文件；' : '')
            + (deviceName || '正在连接设备…'))),
        h('button', {
          type: 'button', 'aria-label': '关闭', title: '关闭', onClick: cancel,
          style: { width: 28, height: 28, flex: '0 0 auto', border: 0, borderRadius: 6, background: 'transparent', color: C.sub, fontSize: 18, lineHeight: '22px', cursor: 'pointer' }
        }, '×')),
      h(TargetFileExplorer, {
        React,
        colors: { bg: C.bg, soft: C.soft, ink: C.ink, sub: C.sub, mute: C.mute, line: C.line, hover: C.hover, blue: C.blue, red: C.red },
        roots,
        rootPath: pickRootOf(path, roots),
        path,
        entries,
        loading: busy,
        error,
        onDismissError: () => setError(''),
        disabled: busy,
        placeholder: '从左侧选择工作区或磁盘',
        emptyText: '空文件夹',
        sort,
        onSort: setSort,
        search,
        onSearch: setSearch,
        onRoot: (next) => { void enter(next) },
        onPath: (next) => { void enter(next) },
        selectionMode: multiple ? 'multiple' : 'single',
        selectedPath,
        selectedPaths,
        onSelectionChange: (next) => setSelectedPaths(Array.isArray(next) ? next : []),
        onSelect: (item) => {
          if (multiple) return
          setSelectedPath(fileMode && item && !item.dir ? item.path : '')
        },
        // A folder click walks in while picking a folder; a file reveals itself
        // by being ticked, and a double click answers with it.
        singleClickOpens: !fileMode && !multiple,
        onOpen: (item) => {
          if (!item) return
          if (item.dir) { void enter(item.path); return }
          if (fileMode) onDone([item.path], [item])
        },
        onRefresh: (next) => { void enter(next) },
        fileIcon,
        formatTime: formatPickTime,
        formatSize: formatPickSize,
        layoutKey: 'tether-folder-pick'
      }),
      h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 18px', borderTop: '1px solid ' + C.line, flex: '0 0 auto' }
      },
        h('button', { type: 'button', onClick: cancel, style: mutedButton }, '取消'),
        h('button', {
          type: 'button', disabled: !canPick, onClick: () => onDone(chosen, chosenEntries()),
          style: {
            height: 28, padding: '0 14px', border: 0, borderRadius: 6, background: C.primary, color: C.onPrimary,
            fontSize: 12, cursor: !canPick ? 'default' : 'pointer', opacity: !canPick ? 0.55 : 1
          }
        }, confirmLabel)))
  )
}