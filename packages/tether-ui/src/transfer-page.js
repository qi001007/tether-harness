import { newTransferId, transferFile } from './transfer.js'
import { TargetFileExplorer } from './target-file-explorer.js'

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

  function FilePane({ side, deviceId, otherDeviceId, onDevice, path, onPath, selection, onSelection, onEntries,
    onDragItems, onDropItems, onContextItem, active, onActivate, refreshKey = 0 }) {
    const [roots, setRoots] = React.useState([])
    const [entries, setEntries] = React.useState(null)
    const [treeChildren, setTreeChildren] = React.useState({})
    const [expanded, setExpanded] = React.useState({})
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [sort, setSort] = React.useState({ key: 'name', dir: 'asc' })
    const [search, setSearch] = React.useState('')
    const run = React.useRef(0)
    const pathRef = React.useRef(path)
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
      setLoading(true); setError('')
      post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path })
        .then((data) => {
          if (cancelled || token !== run.current) return
          const list = ((data && data.entries) || []).filter((item) => item && item.path && item.name)
          list.sort((left, right) => (left.dir === right.dir ? String(left.name).localeCompare(String(right.name)) : left.dir ? -1 : 1))
          setEntries(list)
          onEntries(list)
        })
        .catch((cause) => {
          if (!cancelled && token === run.current) { setEntries([]); onEntries([]); setError(cause.message || '读取目录失败') }
        })
        .finally(() => { if (!cancelled && token === run.current) setLoading(false) })
      return () => { cancelled = true }
    }, [deviceId, path, refreshKey])
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
        const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path: key })
        const list = ((data && data.entries) || []).filter((entry) => entry && entry.path && entry.name)
        setTreeChildren((current) => ({ ...current, [key]: list }))
      } catch (_) { /* the right pane reports directory errors */ }
    }
    const fileIcon = (item) => h('span', {
      'aria-hidden': true,
      style: { width: 15, height: 15, display: 'grid', placeItems: 'center', color: item.dir ? '#d99a2b' : C.mute, flex: '0 0 auto' }
    }, h(Glyph, { name: item.dir ? 'folderClose' : 'file', size: 14 }))
    return h('div', {
      onMouseDown: onActivate,
      onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' },
      onDrop: (event) => {
        event.preventDefault()
        if (onDropItems) onDropItems()
      },
      style: {
        flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', background: C.bg,
        borderRadius: 8, overflow: 'hidden', outline: active ? '1px solid ' + C.blue : '1px solid transparent'
      }
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: C.soft, flex: '0 0 auto' } },
        h('select', {
          value: deviceId || '', onChange: (event) => { onDevice(event.target.value); onPath(''); onSelection([]); onActivate(); event.currentTarget.blur() },
          'aria-label': '设备', title: '选择这台电脑',
          style: { ...field, flex: '1 1 auto', minWidth: 0 }
        },
          !deviceId ? h('option', { value: '' }, '选择设备…') : null,
          devices.map((item) => h('option', {
            key: item.device_id, value: item.device_id,
            disabled: !item.online || item.device_id === otherDeviceId
          }, (item.name || item.device_id) + (item.online ? '' : ' · 离线') + (item.device_id === otherDeviceId ? ' · 已在另一侧' : ''))))),
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
        onRefresh: (next) => onPath(next),
        onDragItem: (event, item) => {
          const items = selection.includes(item.path) ? selection : [item.path]
          if (onDragItems) onDragItems(items)
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('text/plain', item.path)
        },
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
  const [leftRefresh, setLeftRefresh] = React.useState(0)
  const [rightRefresh, setRightRefresh] = React.useState(0)
  const [overwrite, setOverwrite] = React.useState(false)
  const [job, setJob] = React.useState(null)
  const [menu, setMenu] = React.useState(null)
  const dragRef = React.useRef(null)
  const clipboardRef = React.useRef(null)
  const abortRef = React.useRef(null)
  const queueRef = React.useRef(null)
  const latest = React.useRef({})
  latest.current = { leftDevice, rightDevice, leftPath, rightPath, leftSelection, rightSelection,
    leftEntries, rightEntries, activeSide, overwrite }

  React.useEffect(() => {
    if (leftDevice && rightDevice && leftDevice === rightDevice) {
      const replacement = (onlineDevices.find((item) => item.device_id !== leftDevice) || {}).device_id || ''
      setRightDevice(replacement)
      setRightPath(''); setRightSelection([])
      if (onNotice) onNotice('两侧不能是同一台电脑，已切换另一侧')
    }
  }, [leftDevice, rightDevice])

  const side = (name) => name === 'left'
    ? { device: leftDevice, path: leftPath, selection: leftSelection, entries: leftEntries }
    : { device: rightDevice, path: rightPath, selection: rightSelection, entries: rightEntries }
  const other = (name) => name === 'left' ? 'right' : 'left'
  const itemsFor = (name) => {
    const current = side(name)
    return current.entries.filter((item) => current.selection.includes(item.path) && !item.dir)
  }

  const startQueue = async (fromSide, items, targetPath, cut = false) => {
    const target = side(other(fromSide))
    if (!items.length || !target.path || !target.device) return
    const controller = new AbortController()
    abortRef.current = controller
    const total = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
    const queue = { fromSide, items, targetPath: target.path, targetDevice: target.device, done: 0, index: 0 }
    queueRef.current = queue
    setJob({ state: 'running', percent: 0, transferred: 0, total, count: items.length, index: 0, error: '' })
    let transferred = 0
    let doneBytes = 0
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const destination = joinPath(target.path, item.name)
        const sourceDevice = side(fromSide).device
        await transferFile({
          source: item.path,
          destination,
          transferId: newTransferId(),
          overwrite: latest.current.overwrite,
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
        if (cut) {
          await post('/api/devices/' + encodeURIComponent(sourceDevice) + '/fs/delete', { path: item.path })
            .catch(() => { if (onError) onError(new Error('已复制但未能删除源文件：' + item.name)) })
        }
        doneBytes += Number(item.size) || 0
        transferred = doneBytes
        queue.done = index + 1
        setJob((current) => ({ ...(current || {}), percent: total ? Math.round(doneBytes / total * 100) : 100,
          transferred: doneBytes, index, state: 'running' }))
      }
      setJob((current) => ({ ...(current || {}), state: 'done', percent: 100, transferred, count: items.length }))
      if (onNotice) onNotice('已转移 ' + items.length + ' 个文件（' + formatBytes(transferred) + '）')
      setLeftRefresh((value) => value + 1)
      setRightRefresh((value) => value + 1)
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
    const from = activeSide
    const items = itemsFor(from)
    if (!items.length) return
    void startQueue(from, items, side(other(from)).path)
  }
  const cancel = () => { if (abortRef.current) abortRef.current.abort() }
  const swap = () => {
    setLeftDevice(rightDevice); setRightDevice(leftDevice)
    setLeftPath(rightPath); setRightPath(leftPath)
    setLeftSelection([]); setRightSelection([])
  }
  const selectAll = (name) => {
    const current = side(name)
    const files = current.entries.filter((item) => !item.dir).map((item) => item.path)
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

  const openContext = (sideName) => (item, event) => {
    if (!item) return
    const current = side(sideName)
    if (!current.selection.includes(item.path)) {
      const next = event && (event.ctrlKey || event.metaKey) ? [...current.selection, item.path] : [item.path]
      if (sideName === 'left') setLeftSelection(next); else setRightSelection(next)
    }
    setActiveSide(sideName)
    setMenu({ x: event.clientX, y: event.clientY, side: sideName })
  }

  const progress = job ? Math.max(0, Math.min(100, Number(job.percent) || 0)) : 0
  const sourceCount = itemsFor(activeSide).length
  const target = side(other(activeSide))
  let footerText = '选择文件后拖到另一侧，或用 Ctrl+C / Ctrl+X、Ctrl+V'
  if (job) {
    if (job.state === 'running') footerText = '正在转移 ' + ((job.index || 0) + 1) + '/' + (job.count || 1)
    else if (job.state === 'done') footerText = '已转移 ' + (job.count || 0) + ' 个文件'
    else if (job.state === 'error') footerText = job.error
    else footerText = job.error || '已取消'
  } else if (sourceCount) footerText = '已选 ' + sourceCount + ' 个文件 → ' + (target.path || '先在另一侧选择目录')

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
      FilePane({
        side: 'left', deviceId: leftDevice, otherDeviceId: rightDevice, devices,
        onDevice: (id) => { setLeftDevice(id); setLeftPath(''); setLeftSelection([]) },
        path: leftPath, onPath: setLeftPath, refreshKey: leftRefresh,
        selection: leftSelection, onSelection: setLeftSelection,
        onEntries: setLeftEntries, active: activeSide === 'left',
        onActivate: () => setActiveSide('left'),
        onDragItems: (paths) => { dragRef.current = { side: 'left', paths, entries } },
        onDropItems: () => {
          const drag = dragRef.current
          dragRef.current = null
          if (!drag || drag.side === 'left' || !leftPath) return
          const items = (drag.entries || []).filter((item) => drag.paths.includes(item.path) && !item.dir)
          if (!items.length) return
          void startQueue(drag.side, items, leftPath)
        },
        onContextItem: openContext('left')
      }),
      h('button', {
        type: 'button', onClick: swap, title: '交换两侧电脑', 'aria-label': '交换两侧电脑',
        className: 'tether-hover',
        style: { alignSelf: 'center', width: 28, height: 28, flex: '0 0 auto', display: 'grid', placeItems: 'center',
          border: 0, borderRadius: 999, background: C.soft, color: C.sub, cursor: 'pointer' }
      }, h(Glyph, { name: 'transfer', size: 14 })),
      FilePane({
        side: 'right', deviceId: rightDevice, otherDeviceId: leftDevice, devices,
        onDevice: (id) => { setRightDevice(id); setRightPath(''); setRightSelection([]) },
        path: rightPath, onPath: setRightPath, refreshKey: rightRefresh,
        selection: rightSelection, onSelection: setRightSelection,
        onEntries: setRightEntries, active: activeSide === 'right',
        onActivate: () => setActiveSide('right'),
        onDragItems: (paths) => { dragRef.current = { side: 'right', paths, entries } },
        onDropItems: () => {
          const drag = dragRef.current
          dragRef.current = null
          if (!drag || drag.side === 'right' || !rightPath) return
          const items = (drag.entries || []).filter((item) => drag.paths.includes(item.path) && !item.dir)
          if (!items.length) return
          void startQueue(drag.side, items, rightPath)
        },
        onContextItem: openContext('right')
      })),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: C.panel, flex: '0 0 auto', minWidth: 0 } },
      h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 2 } },
        h('div', { style: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, footerText),
        job ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { style: { flex: '1 1 auto', height: 5, borderRadius: 999, background: C.soft, overflow: 'hidden' } },
            h('div', { style: { width: progress + '%', height: '100%', background: job.state === 'error' ? C.red : C.blue, transition: 'width 150ms ease' } })),
          h('span', { className: 'tether-num', style: { fontSize: 10.5, color: C.mute, whiteSpace: 'nowrap' } }, progress + '% · ' + formatBytes(job.transferred || 0) + ' / ' + formatBytes(job.total || 0))) : null),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.sub, flex: '0 0 auto' } },
        h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }), '覆盖同名'),
      job && job.state === 'running'
        ? h('button', { type: 'button', onClick: cancel, style: { ...field, height: 28, padding: '0 12px', cursor: 'pointer' } }, '取消')
        : h('button', {
          type: 'button', onClick: start, disabled: !sourceCount || !target.path,
          className: 'tether-press',
          style: { height: 28, padding: '0 14px', border: 0, borderRadius: 6, background: C.blue, color: '#fff', fontSize: 12,
            cursor: !sourceCount || !target.path ? 'not-allowed' : 'pointer', opacity: !sourceCount || !target.path ? 0.45 : 1 }
        }, '转移到另一侧')),
    menu ? h('div', {
      role: 'menu',
      onMouseDown: (event) => event.stopPropagation(),
      style: { position: 'fixed', left: menu.x, top: menu.y, zIndex: 2147483000, minWidth: 150, padding: 4,
        background: C.bg, borderRadius: 8, boxShadow: '0 8px 24px rgba(16,24,40,.18)', border: '1px solid ' + C.line }
    },
      [
        ['复制', () => copySelection(menu.side, false)],
        ['剪切', () => copySelection(menu.side, true)],
        ['粘贴到此处', () => pasteInto(menu.side)],
        ['刷新', () => { if (menu.side === 'left') setLeftRefresh((value) => value + 1); else setRightRefresh((value) => value + 1) }]
      ].map(([label, action]) => h('button', {
        key: label, type: 'button',
        onClick: () => { setMenu(null); action() },
        className: 'tether-hover',
        style: { display: 'block', width: '100%', padding: '6px 10px', border: 0, borderRadius: 5, background: 'transparent',
          color: C.ink, fontSize: 12, textAlign: 'left', cursor: 'pointer' }
      }, label))) : null)
}