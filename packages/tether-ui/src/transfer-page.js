import { newTransferId, transferFile } from './transfer.js'
import { TargetFileExplorer } from './target-file-explorer.js'
import { invalidateDirectory, loadDirectory } from './file-cache.js'

function separator(path) {
  return String(path || '').includes('\\') ? '\\' : '/'
}

function joinPath(base, name) {
  if (!base) return name
  return String(base).replace(/[\\/]+$/, '') + separator(base) + name
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + ' MB'
  return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function isTextInput(target) {
  if (!target) return false
  const tag = String(target.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true
}

function uniqueName(destination, names) {
  const value = String(destination || '')
  const slash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
  const dir = slash >= 0 ? value.slice(0, slash + 1) : ''
  const file = slash >= 0 ? value.slice(slash + 1) : value
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  const taken = new Set((names || []).map((name) => String(name).toLowerCase()))
  for (let index = 2; index < 1000; index += 1) {
    const candidate = stem + ' (' + index + ')' + ext
    if (!taken.has(candidate.toLowerCase())) return dir + candidate
  }
  return dir + stem + ' (' + Date.now() + ')' + ext
}

export function createTransferPage({ React, Glyph, api, post, C, devices = [], localDevice = '', onNotice, onError }) {
  const h = React.createElement
  const field = {
    height: 26, boxSizing: 'border-box', border: 0, borderRadius: 6,
    background: C.soft, color: C.ink, fontSize: 12, padding: '0 8px', outline: 'none'
  }
  const onlineDevices = devices.filter((item) => item && item.online)
  const initialLeft = localDevice && onlineDevices.some((item) => item.device_id === localDevice)
    ? localDevice
    : (onlineDevices[0] && onlineDevices[0].device_id) || ''
  const initialRight = (onlineDevices.find((item) => item.device_id !== initialLeft) || {}).device_id || ''
  const iconButton = (name, label, onClick, disabled) => h('button', {
    type: 'button', title: label, 'aria-label': label, disabled,
    onClick: () => { if (!disabled && onClick) onClick() },
    className: 'tether-hover',
    style: {
      width: 26, height: 26, flex: '0 0 auto', display: 'grid', placeItems: 'center',
      border: 0, borderRadius: 6, background: 'transparent', color: disabled ? C.mute : C.sub,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1
    }
  }, h(Glyph, { name, size: 15 }))

  function FilePane({ side, deviceId, otherDeviceId, onDevice, path, onPath, selection, onSelection, onEntries,
    onPointerRow, onDropItems, onContextItem, active, onActivate, refreshKey = 0,
    onNewFolder, onNewFile, onRename, onDelete, onRefresh }) {
    const [roots, setRoots] = React.useState([])
    const [entries, setEntries] = React.useState(null)
    const [treeChildren, setTreeChildren] = React.useState({})
    const [expanded, setExpanded] = React.useState({})
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [sort, setSort] = React.useState({ key: 'name', dir: 'asc' })
    const [search, setSearch] = React.useState('')
    const [localRefresh, setLocalRefresh] = React.useState(0)
    const run = React.useRef(0)
    const pathRef = React.useRef(path)
    const lastRefreshRef = React.useRef({ refreshKey, localRefresh })
    pathRef.current = path
    React.useEffect(() => {
      let cancelled = false
      setTreeChildren({}); setExpanded({})
      if (!deviceId) { setRoots([]); setEntries(null); return undefined }
      setLoading(true); setError('')
      Promise.all([
        api('/api/devices/' + encodeURIComponent(deviceId) + '/workspaces').catch(() => ({ workspaces: [] })),
        api('/api/devices/' + encodeURIComponent(deviceId) + '/drives').catch(() => ({ drives: [] }))
      ]).then(([workspaceData, driveData]) => {
        if (cancelled) return
        const list = [
          ...((workspaceData && workspaceData.workspaces) || []).map((item) => ({ name: item.name || item.path, path: item.path, kind: 'workspace', dir: true })),
          ...((driveData && driveData.drives) || []).map((item) => ({ name: item.name || item.path, path: item.path, kind: 'drive', dir: true }))
        ].filter((item) => item.path)
        setRoots(list)
        if (!pathRef.current && list.length) onPath(list[0].path)
      }).catch((cause) => { if (!cancelled) setError(cause.message || '读取根目录失败') })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [deviceId])
    React.useEffect(() => {
      if (!deviceId || !path) { setEntries(null); onEntries([]); return undefined }
      const token = ++run.current
      let cancelled = false
      const fresh = lastRefreshRef.current.refreshKey !== refreshKey || lastRefreshRef.current.localRefresh !== localRefresh
      lastRefreshRef.current = { refreshKey, localRefresh }
      setLoading(true); setError('')
      loadDirectory({
        deviceId, path, fresh,
        load: () => post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path })
          .then((data) => ((data && data.entries) || []).filter((item) => item && item.path && item.name))
      })
        .then((list) => {
          if (cancelled || token !== run.current) return
          list.sort((left, right) => (left.dir === right.dir ? String(left.name).localeCompare(String(right.name)) : left.dir ? -1 : 1))
          setEntries(list)
          onEntries(list)
        })
        .catch((cause) => {
          if (!cancelled && token === run.current) { setEntries([]); onEntries([]); setError(cause.message || '读取目录失败') }
        })
        .finally(() => { if (!cancelled && token === run.current) setLoading(false) })
      return () => { cancelled = true }
    }, [deviceId, path, refreshKey, localRefresh])
    const toggleTree = async (item) => {
      if (!item || !item.dir || !deviceId) return
      const key = item.path
      if (expanded[key]) {
        setExpanded((current) => { const next = { ...current }; delete next[key]; return next })
        return
      }
      setExpanded((current) => ({ ...current, [key]: true }))
      if (treeChildren[key]) return
      try {
        const list = await loadDirectory({
          deviceId, path: key,
          load: () => post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path: key })
            .then((data) => ((data && data.entries) || []).filter((entry) => entry && entry.path && entry.name))
        })
        setTreeChildren((current) => ({ ...current, [key]: list }))
      } catch (_) { /* the right pane shows the directory error */ }
    }
    const fileIcon = (item) => h('span', {
      'aria-hidden': true,
      style: { width: 15, height: 15, display: 'grid', placeItems: 'center', color: item.dir ? '#d99a2b' : C.mute, flex: '0 0 auto' }
    }, h(Glyph, { name: item.dir ? 'folderClose' : 'file', size: 14 }))
    const refresh = () => {
      if (deviceId && path) invalidateDirectory(deviceId, path)
      setLocalRefresh((value) => value + 1)
      if (onRefresh) onRefresh()
    }
    return h('div', {
      'data-pane': side,
      onMouseDown: onActivate,
      onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' },
      onDrop: (event) => { event.preventDefault(); if (onDropItems) onDropItems() },
      style: {
        flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', background: C.bg,
        borderRadius: 8, overflow: 'hidden', outline: active ? '1px solid ' + C.blue : '1px solid transparent'
      }
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: C.soft, flex: '0 0 auto' } },
        h('select', {
          value: deviceId || '', onChange: (event) => { onDevice(event.target.value); onPath(''); onSelection([]); onActivate(); event.currentTarget.blur() },
          'aria-label': '设备', title: '选择这台电脑',
          style: { ...field, flex: '1 1 auto', minWidth: 0 }
        },
          !deviceId ? h('option', { value: '' }, '选择设备…') : null,
          devices.map((item) => h('option', {
            key: item.device_id, value: item.device_id,
            disabled: !item.online || item.device_id === otherDeviceId
          }, (item.name || item.device_id) + (item.online ? '' : ' · 离线') + (item.device_id === otherDeviceId ? ' · 已在另一侧' : '')))),
        iconButton('folderPlus', '新建文件夹', onNewFolder, !deviceId || !path),
        iconButton('filePlus', '新建文件', onNewFile, !deviceId || !path),
        iconButton('pencil', '重命名', onRename, !selection.length),
        iconButton('trash', '删除', onDelete, !selection.length),
        iconButton('refresh', '刷新', refresh, !deviceId || !path)),
      TargetFileExplorer({
        React,
        colors: { bg: C.bg, soft: C.soft, ink: C.ink, sub: C.sub, mute: C.mute, line: C.line, hover: C.soft, red: C.red },
        compact: true,
        roots,
        rootPath: '',
        path,
        entries,
        loading,
        error,
        selectedPaths: selection,
        selectionMode: 'multiple',
        onSelectionChange: onSelection,
        onRoot: (next) => onPath(next),
        onPath: (next) => onPath(next),
        onSelect: () => {},
        onOpen: (item) => { if (item.dir) onPath(item.path) },
        onRefresh: refresh,
        onRowPointerDown: onPointerRow,
        onContextMenu: (item, event) => { if (onContextItem) onContextItem(item, event) },
        fileIcon,
        formatTime: (value) => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '',
        formatSize: (value) => formatBytes(Number(value)),
        limit: Number.MAX_SAFE_INTEGER,
        emptyText: '空文件夹',
        placeholder: '选择左侧的电脑或磁盘',
        sort,
        onSort: setSort,
        search,
        onSearch: setSearch,
        treeChildren,
        expanded,
        onToggleTree: (item) => { void toggleTree(item) }
      }))
  }

  const [leftDevice, setLeftDevice] = React.useState(initialLeft)
  const [rightDevice, setRightDevice] = React.useState(initialRight)
  const [leftPath, setLeftPath] = React.useState('')
  const [rightPath, setRightPath] = React.useState('')
  const [leftSelection, setLeftSelection] = React.useState([])
  const [rightSelection, setRightSelection] = React.useState([])
  const [leftEntries, setLeftEntries] = React.useState([])
  const [rightEntries, setRightEntries] = React.useState([])
  const [activeSide, setActiveSide] = React.useState('left')
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [job, setJob] = React.useState(null)
  const [menu, setMenu] = React.useState(null)
  const [dialog, setDialog] = React.useState(null)
  const [dialogText, setDialogText] = React.useState('')
  const [drag, setDrag] = React.useState(null)
  const [dropSide, setDropSide] = React.useState('')
  const clipboardRef = React.useRef(null)
  const abortRef = React.useRef(null)
  const queueRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const dropSideRef = React.useRef('')
  const latest = React.useRef({})
  latest.current = {
    leftDevice, rightDevice, leftPath, rightPath, leftSelection, rightSelection,
    leftEntries, rightEntries, activeSide
  }

  React.useEffect(() => {
    if (leftDevice && rightDevice && leftDevice === rightDevice) {
      const replacement = (onlineDevices.find((item) => item.device_id !== leftDevice) || {}).device_id || ''
      setRightDevice(replacement)
      setRightPath(''); setRightSelection([])
      if (onNotice) onNotice('两侧不能是同一台电脑，已切换另一侧')
    }
  }, [leftDevice, rightDevice])

  const side = (name) => name === 'left'
    ? { device: leftDevice, path: leftPath, selection: leftSelection, entries: leftEntries, setDevice: setLeftDevice, setPath: setLeftPath, setSelection: setLeftSelection }
    : { device: rightDevice, path: rightPath, selection: rightSelection, entries: rightEntries, setDevice: setRightDevice, setPath: setRightPath, setSelection: setRightSelection }
  const other = (name) => name === 'left' ? 'right' : 'left'
  const itemsFor = (name) => {
    const current = side(name)
    return current.entries.filter((item) => current.selection.includes(item.path) && !item.dir)
  }
  const refresh = () => setRefreshKey((value) => value + 1)

  const askConflict = (item, destination) => new Promise((resolve) => {
    setDialog({ kind: 'conflict', item, destination, resolve })
  })

  const startQueue = async (fromSide, items, targetPath, cut = false) => {
    const target = side(other(fromSide))
    if (!items.length || !target.path || !target.device) return
    const controller = new AbortController()
    abortRef.current = controller
    const total = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
    setJob({ state: 'running', percent: 0, transferred: 0, total, count: items.length, index: 0, error: '' })
    let doneBytes = 0
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const sourceDevice = side(fromSide).device
        let destination = joinPath(target.path, item.name)
        let overwrite = false
        while (true) {
          try {
            const result = await transferFile({
              source: item.path,
              destination,
              transferId: newTransferId(),
              overwrite,
              signal: controller.signal,
              read: (args) => post('/api/devices/' + encodeURIComponent(sourceDevice) + '/fs/read',
                { path: args.path, offset: args.offset, limit: args.limit, encoding: 'base64' }),
              write: (args) => post('/api/devices/' + encodeURIComponent(target.device) + '/fs/write_chunk',
                { ...args, transfer_id: args.transferId }),
              status: (args) => post('/api/devices/' + encodeURIComponent(target.device) + '/fs/transfer_status',
                { path: args.path, transfer_id: args.transferId }),
              cancel: (args) => post('/api/devices/' + encodeURIComponent(target.device) + '/fs/transfer_cancel',
                { path: args.path, transfer_id: args.transferId }),
              onProgress: (value) => {
                const currentBytes = doneBytes + Math.max(0, Number(value && value.transferred) || 0)
                setJob((current) => ({ ...(current || {}), percent: total ? Math.min(99, Math.round(currentBytes / total * 100)) : 0,
                  transferred: currentBytes, index, count: items.length, state: 'running' }))
              }
            })
            doneBytes += Number(result.bytes) || Number(item.size) || 0
            break
          } catch (cause) {
            if (!cause || cause.code !== 'exists') throw cause
            const choice = await askConflict(item, destination)
            if (choice === 'cancel') throw Object.assign(new Error('已取消'), { code: 'aborted' })
            if (choice === 'overwrite') { overwrite = true; continue }
            if (choice === 'keep') {
              destination = uniqueName(destination, (side(other(fromSide)).entries || []).map((entry) => entry.name))
              overwrite = false
              continue
            }
            throw cause
          }
        }
        if (cut) {
          await post('/api/devices/' + encodeURIComponent(sourceDevice) + '/fs/delete', { path: item.path })
            .catch(() => { if (onError) onError(new Error('已复制但未能删除源文件：' + item.name)) })
        }
        setJob((current) => ({ ...(current || {}), percent: total ? Math.round(doneBytes / total * 100) : 100,
          transferred: doneBytes, index, state: 'running' }))
      }
      setJob((current) => ({ ...(current || {}), state: 'done', percent: 100, transferred: doneBytes, count: items.length }))
      if (onNotice) onNotice('已转移 ' + items.length + ' 个文件（' + formatBytes(doneBytes) + '）')
      invalidateDirectory(side(fromSide).device, side(fromSide).path)
      invalidateDirectory(target.device, target.path)
      refresh()
      setLeftSelection([]); setRightSelection([])
    } catch (cause) {
      const aborted = cause && cause.code === 'aborted'
      setJob((current) => ({ ...(current || {}), state: aborted ? 'cancelled' : 'error', error: aborted ? '已取消' : (cause.message || '传输失败') }))
      if (!aborted && onError) onError(cause)
    } finally {
      abortRef.current = null
    }
  }

  const start = () => {
    const items = itemsFor(activeSide)
    if (!items.length) return
    void startQueue(activeSide, items, side(other(activeSide)).path)
  }
  const cancel = () => { if (abortRef.current) abortRef.current.abort() }
  const swap = () => {
    setLeftDevice(rightDevice); setRightDevice(leftDevice)
    setLeftPath(rightPath); setRightPath(leftPath)
    setLeftSelection([]); setRightSelection([])
  }
  const selectAll = (name) => {
    const files = side(name).entries.filter((item) => !item.dir).map((item) => item.path)
    if (name === 'left') setLeftSelection(files); else setRightSelection(files)
  }
  const copySelection = (name, cut) => {
    const items = itemsFor(name)
    if (!items.length) return
    clipboardRef.current = { side: name, items, cut: !!cut }
    if (onNotice) onNotice((cut ? '已剪切 ' : '已复制 ') + items.length + ' 个文件')
  }
  const pasteInto = (name) => {
    const clip = clipboardRef.current
    if (!clip || !clip.items.length || clip.side === name) return
    void startQueue(clip.side, clip.items, side(name).path, clip.cut)
    if (clip.cut) clipboardRef.current = null
  }
  const actionsRef = React.useRef({})
  actionsRef.current = { selectAll, copySelection, pasteInto }

  React.useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || isTextInput(event.target)) return
      const key = String(event.key || '').toLowerCase()
      const actions = actionsRef.current
      if (key === 'a') { event.preventDefault(); actions.selectAll(latest.current.activeSide) }
      else if (key === 'c') { event.preventDefault(); actions.copySelection(latest.current.activeSide, false) }
      else if (key === 'x') { event.preventDefault(); actions.copySelection(latest.current.activeSide, true) }
      else if (key === 'v') { event.preventDefault(); actions.pasteInto(latest.current.activeSide) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [menu])

  const openDialog = (kind, name, extra = {}) => {
    setDialog({ kind, ...extra })
    setDialogText(name || '')
    setTimeout(() => {
      const input = document.getElementById('tether-explorer-name')
      if (input) { input.focus(); input.select() }
    }, 30)
  }
  const closeDialog = () => {
    const current = dialog
    setDialog(null); setDialogText('')
    if (current && current.kind === 'conflict' && current.resolve) current.resolve('cancel')
  }
  const submitName = async () => {
    if (!dialog) return
    const name = dialogText.trim()
    if (!name) return
    const current = side(dialog.side)
    try {
      if (dialog.kind === 'newFolder') await post('/api/devices/' + encodeURIComponent(current.device) + '/fs/mkdir', { path: joinPath(current.path, name) })
      else if (dialog.kind === 'newFile') await post('/api/devices/' + encodeURIComponent(current.device) + '/fs/write', { path: joinPath(current.path, name), text: '', overwrite: false })
      else if (dialog.kind === 'rename') await post('/api/devices/' + encodeURIComponent(current.device) + '/fs/rename', { path: dialog.item.path, dest: joinPath(current.path, name) })
      invalidateDirectory(current.device, current.path)
      setDialog(null); setDialogText('')
      refresh()
    } catch (cause) { if (onError) onError(cause) }
  }
  const deleteSelected = async (name) => {
    const current = side(name)
    const items = current.entries.filter((item) => current.selection.includes(item.path))
    if (!items.length) return
    setDialog({ kind: 'delete', side: name, items })
  }
  const confirmDelete = async () => {
    if (!dialog || dialog.kind !== 'delete') return
    const current = side(dialog.side)
    try {
      for (const item of dialog.items) await post('/api/devices/' + encodeURIComponent(current.device) + '/fs/delete', { path: item.path })
      invalidateDirectory(current.device, current.path)
      setDialog(null)
      if (dialog.side === 'left') setLeftSelection([]); else setRightSelection([])
      refresh()
    } catch (cause) { if (onError) onError(cause) }
  }

  const startRowDrag = (name, event, item) => {
    if (!event || event.button !== 0 || dragRef.current) return
    const current = side(name)
    const selection = current.selection.includes(item.path) ? current.selection : [item.path]
    const items = current.entries.filter((entry) => selection.includes(entry.path))
    if (!items.length) return
    const state = { side: name, items, startX: event.clientX, startY: event.clientY, active: false }
    dragRef.current = state
    const move = (moveEvent) => {
      if (!dragRef.current) return
      if (!state.active && Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) < 6) return
      state.active = true
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
      const pane = element && element.closest ? element.closest('[data-pane]') : null
      const target = pane ? pane.getAttribute('data-pane') : ''
      const nextDrop = target && target !== name ? target : ''
      dropSideRef.current = nextDrop
      setDropSide(nextDrop)
      setDrag({ side: name, items: state.items, x: moveEvent.clientX, y: moveEvent.clientY })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const target = dropSideRef.current
      const dragging = dragRef.current
      dragRef.current = null
      dropSideRef.current = ''
      setDrag(null); setDropSide('')
      if (!dragging || !dragging.active || !target) return
      const targetSide = side(target)
      if (!targetSide.path) return
      void startQueue(dragging.side, dragging.items.filter((entry) => !entry.dir), targetSide.path)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const openContext = (name) => (item, event) => {
    if (!item) return
    const current = side(name)
    if (!current.selection.includes(item.path)) {
      const next = event && (event.ctrlKey || event.metaKey) ? [...current.selection, item.path] : [item.path]
      if (name === 'left') setLeftSelection(next); else setRightSelection(next)
    }
    setActiveSide(name)
    setMenu({ x: event.clientX, y: event.clientY, side: name, item })
  }

  const progress = job ? Math.max(0, Math.min(100, Number(job.percent) || 0)) : 0
  const sourceCount = itemsFor(activeSide).length
  const target = side(other(activeSide))
  let footerText = '拖拽文件到另一侧，或用 Ctrl+C / Ctrl+X、Ctrl+V'
  if (job) {
    if (job.state === 'running') footerText = '正在转移 ' + ((job.index || 0) + 1) + '/' + (job.count || 1)
    else if (job.state === 'done') footerText = '已转移 ' + (job.count || 0) + ' 个文件'
    else footerText = job.error || (job.state === 'error' ? '传输失败' : '已取消')
  } else if (sourceCount) footerText = '已选 ' + sourceCount + ' 个文件 → ' + (target.path || '先在另一侧选择目录')

  const sideProps = (name) => {
    const current = side(name)
    return {
      side: name, deviceId: current.device, otherDeviceId: side(other(name)).device, devices,
      onDevice: (id) => { current.setDevice(id); current.setPath(''); current.setSelection([]) },
      path: current.path, onPath: current.setPath, refreshKey,
      selection: current.selection, onSelection: current.setSelection,
      onEntries: name === 'left' ? setLeftEntries : setRightEntries,
      active: activeSide === name, onActivate: () => setActiveSide(name),
      onPointerRow: (event, item) => startRowDrag(name, event, item),
      onContextItem: openContext(name),
      onNewFolder: () => openDialog('newFolder', '', { side: name }),
      onNewFile: () => openDialog('newFile', '', { side: name }),
      onRename: () => { const item = current.entries.find((entry) => entry.path === current.selection[0]); if (item) openDialog('rename', item.name, { side: name, item }) },
      onDelete: () => { void deleteSelected(name) },
      onRefresh: refresh,
      onDropItems: () => {
        const dragging = dragRef.current
        if (!dragging || dragging.side === name) return
        const targetSide = side(name)
        if (!targetSide.path) return
        void startQueue(dragging.side, dragging.items.filter((entry) => !entry.dir), targetSide.path)
        dragRef.current = null
      }
    }
  }

  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px 14px', gap: 10, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' } },
      h('div', { style: { fontSize: 17, fontWeight: 600, color: C.ink } }, '文件转移'),
      h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, color: C.mute, fontSize: 11.5 } },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, background: C.blue } }),
          (devices.find((item) => item.device_id === leftDevice) || {}).name || '左侧'),
        h(Glyph, { name: 'transfer', size: 14 }),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, background: C.green } }),
          (devices.find((item) => item.device_id === rightDevice) || {}).name || '右侧'))),
    h('div', { style: { display: 'flex', gap: 8, flex: '1 1 auto', minHeight: 0 } },
      h('div', { style: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', outline: dropSide === 'left' ? '2px dashed ' + C.blue : 'none', outlineOffset: -2, borderRadius: 8 } },
        FilePane(sideProps('left')),
        dropSide === 'left' ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, ' + C.blue + ' 10%, transparent)', color: C.blue, fontSize: 12, pointerEvents: 'none', borderRadius: 8 } }, '松开，转移到这里') : null),
      h('button', {
        type: 'button', onClick: swap, title: '交换两侧电脑', 'aria-label': '交换两侧电脑',
        className: 'tether-hover',
        style: { alignSelf: 'center', width: 28, height: 28, flex: '0 0 auto', display: 'grid', placeItems: 'center',
          border: 0, borderRadius: 999, background: C.soft, color: C.sub, cursor: 'pointer' }
      }, h(Glyph, { name: 'transfer', size: 14 })),
      h('div', { style: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', outline: dropSide === 'right' ? '2px dashed ' + C.green : 'none', outlineOffset: -2, borderRadius: 8 } },
        FilePane(sideProps('right')),
        dropSide === 'right' ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, ' + C.green + ' 10%, transparent)', color: C.green, fontSize: 12, pointerEvents: 'none', borderRadius: 8 } }, '松开，转移到这里') : null)),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: C.panel, flex: '0 0 auto', minWidth: 0 } },
      h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 2 } },
        h('div', { style: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, footerText),
        job ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { style: { flex: '1 1 auto', height: 5, borderRadius: 999, background: C.soft, overflow: 'hidden' } },
            h('div', { style: { width: progress + '%', height: '100%', background: job.state === 'error' ? C.red : C.blue, transition: 'width 150ms ease' } })),
          h('span', { className: 'tether-num', style: { fontSize: 10.5, color: C.mute, whiteSpace: 'nowrap' } }, progress + '% · ' + formatBytes(job.transferred || 0) + ' / ' + formatBytes(job.total || 0))) : null),
      job && job.state === 'running'
        ? h('button', { type: 'button', onClick: cancel, style: { ...field, height: 28, padding: '0 12px', cursor: 'pointer' } }, '取消')
        : h('button', {
          type: 'button', onClick: start, disabled: !sourceCount || !target.path, title: '转移到另一侧', 'aria-label': '转移到另一侧',
          className: 'tether-press',
          style: { width: 32, height: 32, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 999,
            background: C.blue, color: '#fff', cursor: !sourceCount || !target.path ? 'not-allowed' : 'pointer',
            opacity: !sourceCount || !target.path ? 0.45 : 1 }
        }, h(Glyph, { name: 'transfer', size: 16 }))),
    menu ? h('div', {
      role: 'menu', onMouseDown: (event) => event.stopPropagation(),
      style: { position: 'fixed', left: menu.x, top: menu.y, zIndex: 2147483000, minWidth: 160, padding: 4,
        background: C.bg, borderRadius: 8, boxShadow: '0 8px 24px rgba(16,24,40,.18)', border: '1px solid ' + C.line }
    },
      [
        ['新建文件夹', () => openDialog('newFolder', '', { side: menu.side })],
        ['新建文件', () => openDialog('newFile', '', { side: menu.side })],
        ['重命名', () => { const current = side(menu.side); const item = current.entries.find((entry) => entry.path === current.selection[0]); if (item) openDialog('rename', item.name, { side: menu.side, item }) }],
        ['删除', () => { void deleteSelected(menu.side) }],
        ['复制', () => copySelection(menu.side, false)],
        ['剪切', () => copySelection(menu.side, true)],
        ['粘贴到此处', () => pasteInto(menu.side)],
        ['刷新', refresh]
      ].map(([label, action]) => h('button', {
        key: label, type: 'button',
        onClick: () => { setMenu(null); action() },
        className: 'tether-hover',
        style: { display: 'block', width: '100%', padding: '6px 10px', border: 0, borderRadius: 5, background: 'transparent',
          color: C.ink, fontSize: 12, textAlign: 'left', cursor: 'pointer' }
      }, label))) : null,
    drag ? h('div', {
      style: { position: 'fixed', left: drag.x + 12, top: drag.y + 12, zIndex: 2147483000, padding: '6px 10px',
        borderRadius: 8, background: C.primary, color: C.onPrimary, fontSize: 12, pointerEvents: 'none',
        boxShadow: '0 8px 24px rgba(16,24,40,.24)' }
    }, drag.items.length + ' 个文件') : null,
    dialog ? h('div', {
      style: { position: 'fixed', inset: 0, zIndex: 2147483000, display: 'grid', placeItems: 'center', background: 'rgba(16,24,40,.45)' },
      onClick: (event) => { if (event.target === event.currentTarget) closeDialog() }
    },
      h('div', {
        role: 'dialog', 'aria-modal': 'true',
        onClick: (event) => event.stopPropagation(),
        style: { width: 'min(380px, calc(100vw - 48px))', display: 'grid', gap: 12, padding: 16, borderRadius: 10, background: C.bg, color: C.ink,
          boxShadow: '0 24px 64px rgba(16,24,40,.28)' }
      },
        h('div', { style: { fontSize: 14, fontWeight: 600 } },
          dialog.kind === 'delete' ? '删除' : dialog.kind === 'conflict' ? '目标位置已有同名文件' : dialog.kind === 'rename' ? '重命名' : dialog.kind === 'newFolder' ? '新建文件夹' : '新建文件'),
        dialog.kind === 'conflict'
          ? h('div', { style: { color: C.sub, fontSize: 12.5, lineHeight: '19px' } },
            dialog.destination + ' 已存在。要覆盖它，还是保留两者？')
          : dialog.kind === 'delete'
            ? h('div', { style: { color: C.sub, fontSize: 12.5, lineHeight: '19px' } }, '将 ' + dialog.items.length + ' 个项目移到 .tether-trash？')
            : h('input', {
              id: 'tether-explorer-name', value: dialogText, autoFocus: true,
              onChange: (event) => setDialogText(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') void submitName(); if (event.key === 'Escape') closeDialog() },
              style: { ...field, height: 30, width: '100%' }
            }),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          h('button', { type: 'button', onClick: closeDialog, style: { ...field, height: 28, padding: '0 12px', cursor: 'pointer' } }, '取消'),
          dialog.kind === 'conflict'
            ? h(React.Fragment, null,
              h('button', { type: 'button', onClick: () => { const resolve = dialog.resolve; setDialog(null); resolve('keep') }, style: { ...field, height: 28, padding: '0 12px', cursor: 'pointer' } }, '保留两者'),
              h('button', { type: 'button', onClick: () => { const resolve = dialog.resolve; setDialog(null); resolve('overwrite') }, style: { height: 28, padding: '0 12px', border: 0, borderRadius: 6, background: C.blue, color: '#fff', fontSize: 12, cursor: 'pointer' } }, '覆盖'))
            : h('button', { type: 'button', onClick: dialog.kind === 'delete' ? confirmDelete : submitName, style: { height: 28, padding: '0 12px', border: 0, borderRadius: 6, background: C.blue, color: '#fff', fontSize: 12, cursor: 'pointer' } }, dialog.kind === 'delete' ? '删除' : '确定')))) : null)
}