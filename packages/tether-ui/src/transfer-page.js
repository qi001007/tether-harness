import { newTransferId, transferFile, transferFileCroc } from './transfer.js'
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

async function copyText(text) {
  const value = String(text || '')
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch (_) { /* fall through */ }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch (_) { return false }
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

function directError(payload, status, operation) {
  const detail = payload && payload.error && typeof payload.error === 'object' ? payload.error : {}
  const error = new Error(detail.message || (operation + ' failed with HTTP ' + status))
  error.code = detail.code || 'direct_http_' + status
  error.directApplicationError = true
  return error
}

function isDirectTransportStatus(status) {
  return status === 502 || status === 503 || status === 504
}

function isTransferAbort(error, signal) {
  return Boolean(signal && signal.aborted) || !!(error && (error.code === 'aborted' || error.name === 'AbortError'))
}

function transferAborted() {
  return Object.assign(new Error('已取消'), { code: 'aborted' })
}

async function directErrorResponse(response, operation, signal) {
  let payload = null
  try { payload = await response.json() } catch (error) {
    if (isTransferAbort(error, signal)) throw transferAborted()
  }
  if (isTransferAbort(null, signal)) throw transferAborted()
  return directError(payload, response.status, operation)
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
  const directCache = new Map()
  const directInfo = async (deviceId) => {
    const key = String(deviceId || '')
    if (!key) return null
    if (directCache.has(key)) return directCache.get(key)
    let info = null
    try {
      const response = await post('/api/devices/' + encodeURIComponent(key) + '/fs/direct_info', {})
      info = response && response.value && typeof response.value === 'object' ? response.value : response
    } catch (_) { info = null }
    const value = info && typeof info.host === 'string' && info.host
      && Number.isInteger(info.port) && info.port > 0 && info.port <= 65535
      && typeof info.token === 'string' && info.token ? info : null
    const normalized = value && key === String(localDevice || '')
      ? { ...value, host: '127.0.0.1' }
      : value
    if (normalized) directCache.set(key, normalized)
    return normalized
  }
  const postFs = async (deviceId, operation, body, signal) => {
    if (signal && signal.aborted) throw transferAborted()
    const info = await directInfo(deviceId)
    if (signal && signal.aborted) throw transferAborted()
    if (info) {
      let response = null
      try {
        response = await fetch('http://' + info.host + ':' + info.port + '/fs/' + operation, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + info.token },
          body: JSON.stringify(body),
          ...(signal ? { signal } : {})
        })
      } catch (error) {
        if (isTransferAbort(error, signal)) throw transferAborted()
        directCache.delete(String(deviceId || ''))
        /* the mesh may be down; use the Hub */
      }
      if (response && response.ok) {
        let payload
        try { payload = await response.json() } catch (error) {
          if (isTransferAbort(error, signal)) throw transferAborted()
          throw directError(null, response.status, operation)
        }
        if (isTransferAbort(null, signal)) throw transferAborted()
        if (payload && payload.ok === true) return payload.value
        throw directError(payload, response.status, operation)
      }
      if (response && !isDirectTransportStatus(response.status)) {
        directCache.delete(String(deviceId || ''))
        throw await directErrorResponse(response, operation, signal)
      }
    }
    if (signal && signal.aborted) throw transferAborted()
    return post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/' + operation, body,
      undefined, signal ? { signal } : undefined)
  }
  const directRead = async (deviceId, args) => {
    if (args.signal && args.signal.aborted) throw transferAborted()
    const info = await directInfo(deviceId)
    if (args.signal && args.signal.aborted) throw transferAborted()
    if (!info) return null
    try {
      const response = await fetch('http://' + info.host + ':' + info.port + '/fs/read_raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + info.token },
        body: JSON.stringify({ path: args.path, offset: args.offset, limit: args.limit }),
        ...(args.signal ? { signal: args.signal } : {})
      })
      if (!response.ok) {
        if (isDirectTransportStatus(response.status)) { directCache.delete(String(deviceId || '')); return null }
        throw await directErrorResponse(response, 'read_raw', args.signal)
      }
      const rawSize = response.headers.get('X-Tether-Size')
      const rawOffset = response.headers.get('X-Tether-Offset')
      if (rawSize === null || rawOffset === null
          || !Number.isSafeInteger(Number(rawSize)) || Number(rawSize) < 0
          || !Number.isSafeInteger(Number(rawOffset)) || Number(rawOffset) < 0) {
        const payload = await response.json().catch(() => null)
        throw directError(payload, response.status, 'read_raw')
      }
      const buffer = await response.arrayBuffer()
      const size = Number(rawSize)
      const offset = Number(rawOffset)
      return {
        bytes: new Uint8Array(buffer),
        size,
        offset,
        reset: response.headers.get('X-Tether-Reset') === '1'
      }
    } catch (error) {
      if (isTransferAbort(error, args.signal)) throw transferAborted()
      if (error && error.directApplicationError) throw error
      directCache.delete(String(deviceId || ''))
      return null
    }
  }
  const directWrite = async (deviceId, args) => {
    if (args.signal && args.signal.aborted) throw transferAborted()
    const info = await directInfo(deviceId)
    if (args.signal && args.signal.aborted) throw transferAborted()
    if (!info) return null
    try {
      const query = new URLSearchParams({
        path: args.path, transfer_id: args.transferId, offset: String(args.offset),
        total: String(args.total), final: args.final ? '1' : '0',
        overwrite: args.overwrite ? '1' : '0', resume: args.resume ? '1' : '0'
      })
      const response = await fetch('http://' + info.host + ':' + info.port + '/fs/write_raw?' + query.toString(), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + info.token },
        body: args.bytes,
        ...(args.signal ? { signal: args.signal } : {})
      })
      if (!response.ok) {
        if (isDirectTransportStatus(response.status)) { directCache.delete(String(deviceId || '')); return null }
        throw await directErrorResponse(response, 'write_raw', args.signal)
      }
      let payload
      try { payload = await response.json() } catch (error) {
        if (isTransferAbort(error, args.signal)) throw transferAborted()
        throw directError(null, response.status, 'write_raw')
      }
      if (isTransferAbort(null, args.signal)) throw transferAborted()
      if (payload && payload.ok === true) return payload.value
      throw directError(payload, response.status, 'write_raw')
    } catch (error) {
      if (isTransferAbort(error, args.signal)) throw transferAborted()
      if (error && error.directApplicationError) throw error
      directCache.delete(String(deviceId || ''))
      return null
    }
  }
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

  function FilePane({ side, deviceId, deviceName = '', otherDeviceId, onDevice, path, onPath, selection, onSelection, onEntries,
    onPointerRow, onDropItems, onContextItem, onBlankContextItem, active, onActivate, refreshKey = 0,
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
      setTreeChildren({}); setExpanded({}); setRoots([]); setEntries(null)
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
        load: () => postFs(deviceId, 'list', { path })
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
          load: () => postFs(deviceId, 'list', { path: key })
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
        deviceName,
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
        onBlankContextMenu: (event) => { if (onBlankContextItem) onBlankContextItem(null, event) },
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
  React.useEffect(() => {
    const ids = onlineDevices.map((item) => item.device_id)
    if (!ids.length) return
    const nextLeft = leftDevice && ids.includes(leftDevice)
      ? leftDevice
      : (localDevice && ids.includes(localDevice) ? localDevice : ids[0])
    const nextRight = rightDevice && ids.includes(rightDevice) && rightDevice !== nextLeft
      ? rightDevice
      : (ids.find((id) => id !== nextLeft) || '')
    if (nextLeft !== leftDevice) { setLeftDevice(nextLeft); setLeftPath(''); setLeftSelection([]) }
    if (nextRight !== rightDevice) { setRightDevice(nextRight); setRightPath(''); setRightSelection([]) }
  }, [devices, localDevice, leftDevice, rightDevice])
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
    let useCroc = false
  let cancelByTransferId = false
    try {
      const [sourceInfo, targetInfo] = await Promise.all([
        postFs(side(fromSide).device, 'transfer_info', {}),
        postFs(target.device, 'transfer_info', {})
      ])
      useCroc = !!(sourceInfo && sourceInfo.available && sourceInfo.relay
        && targetInfo && targetInfo.available && targetInfo.relay)
      cancelByTransferId = !!(sourceInfo && sourceInfo.cancel_by_transfer_id
        && targetInfo && targetInfo.cancel_by_transfer_id)
    } catch (error) {
      if (error && error.directApplicationError) {
        setJob((current) => ({ ...(current || {}), state: 'error', error: error.message || '传输能力检查失败' }))
        if (onError) onError(error)
        return
      }
      useCroc = false
    }
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const sourceDevice = side(fromSide).device
        if (useCroc) {
          let name = item.name
          let overwrite = false
          if ((target.entries || []).some((entry) => entry.name === name)) {
            const choice = await askConflict(item, joinPath(target.path, name))
            if (choice === 'cancel') throw Object.assign(new Error('已取消'), { code: 'aborted' })
            if (choice === 'overwrite') overwrite = true
            else if (choice === 'keep') name = uniqueName(item.name, (target.entries || []).map((entry) => entry.name))
          }
          const result = await transferFileCroc({
            source: item.path,
            destination: target.path,
            name,
            transferId: newTransferId(),
            overwrite,
            signal: controller.signal,
            cancelByTransferId,
            send: (args) => postFs(sourceDevice, 'transfer_send', args),
            receive: (args) => postFs(target.device, 'transfer_receive', args),
            status: (args) => postFs(target.device, 'transfer_status', args),
            finish: (args) => postFs(target.device, 'transfer_finish', args),
            cancel: (args) => postFs(target.device, 'transfer_cancel', args),
            cancelSend: (args) => postFs(sourceDevice, 'transfer_cancel', args),
            onProgress: (value) => {
              const percent = Number(value && value.percent) || 0
              const currentBytes = doneBytes + (Number(item.size) || 0) * percent / 100
              setJob((current) => ({ ...(current || {}), percent: total ? Math.min(99, Math.round(currentBytes / total * 100)) : 0,
                transferred: currentBytes, index, count: items.length, state: 'running' }))
            }
          })
          doneBytes += Number(result.bytes) || Number(item.size) || 0
          if (cut) {
            await postFs(sourceDevice, 'delete', { path: item.path })
              .catch(() => { if (onError) onError(new Error('已复制但未能删除源文件：' + item.name)) })
          }
          setJob((current) => ({ ...(current || {}), percent: total ? Math.round(doneBytes / total * 100) : 100,
            transferred: doneBytes, index, state: 'running' }))
          continue
        }
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
              read: (args) => postFs(sourceDevice, 'read',
                { path: args.path, offset: args.offset, limit: args.limit, encoding: 'base64' }, args.signal),
              readBytes: (args) => directRead(sourceDevice, args),
              writeBytes: (args) => directWrite(target.device, args),
              write: (args) => {
                const { signal, ...body } = args
                return postFs(target.device, 'write_chunk', { ...body, transfer_id: args.transferId }, signal)
              },
              status: (args) => postFs(target.device, 'transfer_status',
                { path: args.path, transfer_id: args.transferId }, args.signal),
              cancel: (args) => postFs(target.device, 'transfer_cancel',
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
          await postFs(sourceDevice, 'delete', { path: item.path })
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
      if (dialog.kind === 'newFolder') await postFs(current.device, 'mkdir', { path: joinPath(current.path, name) })
      else if (dialog.kind === 'newFile') await postFs(current.device, 'write', { path: joinPath(current.path, name), text: '', overwrite: false })
      else if (dialog.kind === 'rename') await postFs(current.device, 'rename', { path: dialog.item.path, dest: joinPath(current.path, name) })
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
      for (const item of dialog.items) await postFs(current.device, 'delete', { path: item.path })
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
    if (!event) return
    event.preventDefault(); event.stopPropagation()
    const current = side(name)
    if (item) {
      if (!current.selection.includes(item.path)) {
        const next = event.ctrlKey || event.metaKey ? [...current.selection, item.path] : [item.path]
        if (name === 'left') setLeftSelection(next); else setRightSelection(next)
      }
    } else if (current.selection.length) {
      if (name === 'left') setLeftSelection([]); else setRightSelection([])
    }
    setActiveSide(name)
    setMenu({ x: event.clientX, y: event.clientY, side: name, item: item || null })
  }

  React.useEffect(() => {
    if (!job || job.state === 'running') return undefined
    const timer = setTimeout(() => setJob(null), job.state === 'done' ? 4000 : 8000)
    return () => clearTimeout(timer)
  }, [job && job.state])

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
      deviceName: (devices.find((item) => item.device_id === current.device) || {}).name || current.device || '',
      onDevice: (id) => { current.setDevice(id); current.setPath(''); current.setSelection([]) },
      path: current.path, onPath: current.setPath, refreshKey,
      selection: current.selection, onSelection: current.setSelection,
      onEntries: name === 'left' ? setLeftEntries : setRightEntries,
      active: activeSide === name, onActivate: () => setActiveSide(name),
      onPointerRow: (event, item) => startRowDrag(name, event, item),
      onContextItem: openContext(name),
      onBlankContextItem: openContext(name),
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
        : !job && sourceCount && target.path
          ? h('button', {
            type: 'button', onClick: start, title: '转移到另一侧', 'aria-label': '转移到另一侧',
            className: 'tether-press',
            style: { width: 32, height: 32, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 999,
              background: C.blue, color: '#fff', cursor: 'pointer' }
          }, h(Glyph, { name: 'transfer', size: 16 }))
          : null),
    menu ? h('div', {
      role: 'menu', onMouseDown: (event) => event.stopPropagation(),
      style: { position: 'fixed', left: menu.x, top: menu.y, zIndex: 2147483000, minWidth: 160, padding: 4,
        background: C.bg, borderRadius: 8, boxShadow: '0 8px 24px rgba(16,24,40,.18)', border: '1px solid ' + C.line }
    },
      (menu.item ? [
        ['复制', () => copySelection(menu.side, false)],
        ['剪切', () => copySelection(menu.side, true)],
        ['复制路径', () => { void copyText(menu.item.path).then((ok) => { if (onNotice) onNotice(ok ? '已复制路径' : '复制路径失败') }) }],
        ['重命名', () => { const current = side(menu.side); const item = current.entries.find((entry) => entry.path === current.selection[0]); if (item) openDialog('rename', item.name, { side: menu.side, item }) }],
        ['删除', () => { void deleteSelected(menu.side) }],
        ['刷新', refresh]
      ] : [
        ['新建文件夹', () => openDialog('newFolder', '', { side: menu.side })],
        ['新建文件', () => openDialog('newFile', '', { side: menu.side })],
        clipboardRef.current ? ['粘贴到此处', () => pasteInto(menu.side)] : null,
        ['复制当前路径', () => { void copyText(side(menu.side).path).then((ok) => { if (onNotice) onNotice(ok ? '已复制当前路径' : '复制路径失败') }) }],
        ['刷新', refresh]
      ]).filter(Boolean).map(([label, action]) => h('button', {
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
