import { newTransferId, transferFile } from './transfer.js'

function separator(path) {
  return String(path || '').includes('\\') ? '\\' : '/'
}

function joinPath(base, name) {
  if (!base) return name
  return String(base).replace(/[\\/]+$/, '') + separator(base) + name
}

function parentPath(path) {
  const clean = String(path || '').replace(/[\\/]+$/, '')
  if (!clean) return ''
  if (/^[A-Za-z]:$/.test(clean)) return clean + '\\'
  const slash = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  if (slash < 0) return ''
  const parent = clean.slice(0, slash)
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + ' MB'
  return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

let StableTransferBrowser = null

export function createTransferPage({ React, Glyph, api, post, C, devices = [], localDevice = '', onNotice, onError }) {
  const h = React.createElement
  const field = {
    height: 28, boxSizing: 'border-box', border: 0, borderRadius: 6,
    background: C.soft, color: C.ink, fontSize: 12, padding: '0 8px', outline: 'none'
  }
  const button = (label, onClick, options = {}) => h('button', {
    type: 'button', onClick, disabled: options.disabled, title: options.title || label,
    className: 'tether-hover',
    style: {
      height: 28, padding: '0 10px', border: 0, borderRadius: 6,
      background: options.primary ? C.blue : C.soft,
      color: options.primary ? '#fff' : C.ink, fontSize: 12,
      cursor: options.disabled ? 'default' : 'pointer',
      opacity: options.disabled ? 0.45 : 1, flex: '0 0 auto'
    }
  }, label)

  if (!StableTransferBrowser) {
    StableTransferBrowser = function Browser({ title, deviceId, onDevice, path, onPath, selectedPath, onFile }) {
    const [roots, setRoots] = React.useState([])
    const [entries, setEntries] = React.useState(null)
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [draft, setDraft] = React.useState(path || '')
    const run = React.useRef(0)
    const pathRef = React.useRef(path)
    pathRef.current = path
    React.useEffect(() => {
      let cancelled = false
      if (!deviceId) { setRoots([]); setEntries(null); return undefined }
      setLoading(true); setError('')
      Promise.all([
        api('/api/devices/' + encodeURIComponent(deviceId) + '/workspaces').catch(() => ({ workspaces: [] })),
        api('/api/devices/' + encodeURIComponent(deviceId) + '/drives').catch(() => ({ drives: [] }))
      ]).then(([workspaceData, driveData]) => {
        if (cancelled) return
        const list = [
          ...((workspaceData && workspaceData.workspaces) || []).map((item) => ({ name: item.name || item.path, path: item.path, kind: 'workspace' })),
          ...((driveData && driveData.drives) || []).map((item) => ({ name: item.name || item.path, path: item.path, kind: 'drive' }))
        ].filter((item) => item.path)
        setRoots(list)
        if (!pathRef.current && list.length) onPath(list[0].path)
      }).catch((cause) => { if (!cancelled) setError(cause.message || '读取根目录失败') })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }, [deviceId])
    React.useEffect(() => {
      setDraft(path || '')
      if (!deviceId || !path) { setEntries(null); return undefined }
      const token = ++run.current
      let cancelled = false
      setLoading(true); setError('')
      post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path })
        .then((data) => {
          if (cancelled || token !== run.current) return
          const list = ((data && data.entries) || []).filter((item) => item && item.path && item.name)
          list.sort((left, right) => (left.dir === right.dir ? String(left.name).localeCompare(String(right.name)) : left.dir ? -1 : 1))
          setEntries(list)
        })
        .catch((cause) => { if (!cancelled && token === run.current) { setEntries([]); setError(cause.message || '读取目录失败') } })
        .finally(() => { if (!cancelled && token === run.current) setLoading(false) })
      return () => { cancelled = true }
    }, [deviceId, path])
    const open = (item) => {
      if (item.dir) onPath(item.path)
      else if (onFile) onFile(item)
    }
    return h('div', { style: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', background: C.bg, borderRadius: 10, overflow: 'hidden', border: 0 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', background: C.soft, flex: '0 0 auto', minWidth: 0 } },
        h('span', { style: { fontSize: 12, fontWeight: 600, color: C.ink, flex: '0 0 auto' } }, title),
        h('select', {
          value: deviceId || '', onChange: (event) => { onDevice(event.target.value); onPath('') },
          style: { ...field, flex: '1 1 auto', minWidth: 0 }
        }, devices.map((item) => h('option', { key: item.device_id, value: item.device_id }, (item.name || item.device_id) + (item.online ? '' : ' · 离线'))))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', flex: '0 0 auto', minWidth: 0 } },
        h('select', {
          value: '', onChange: (event) => { if (event.target.value) onPath(event.target.value) },
          title: '工作区与磁盘', style: { ...field, width: 108, flex: '0 0 auto' }
        }, h('option', { value: '' }, '位置…'),
          roots.map((item) => h('option', { key: item.kind + ':' + item.path, value: item.path }, item.name))),
        button('↑', () => { const up = parentPath(path); if (up) onPath(up) }, { title: '上一级', disabled: !path }),
        h('input', {
          value: draft, spellCheck: false, 'aria-label': title + '路径',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter' && draft.trim()) onPath(draft.trim()) },
          style: { ...field, flex: '1 1 auto', minWidth: 0, fontFamily: 'Consolas, monospace' }
        }),
        button('刷新', () => onPath(path), { title: '刷新目录', disabled: !path })),
      error ? h('div', { role: 'alert', style: { padding: '4px 12px', color: C.red, fontSize: 11.5, flex: '0 0 auto' } }, error) : null,
      h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 6px 10px' } },
        loading && !entries ? h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, '加载中…') : null,
        !loading && entries && !entries.length ? h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, error ? '' : '空目录') : null,
        (entries || []).map((item) => {
          const selected = !item.dir && selectedPath === item.path
          return h('button', {
            key: item.path, type: 'button', title: item.path,
            onClick: () => open(item),
            className: 'tether-hover',
            style: {
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px 90px', gap: 8,
              alignItems: 'center', width: '100%', height: 29, padding: '0 8px',
              border: 0, borderRadius: 6, background: selected ? C.soft : 'transparent',
              color: C.ink, fontSize: 12.5, textAlign: 'left', cursor: 'pointer'
            }
          },
            h('span', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
              h('span', { 'aria-hidden': true, style: { width: 14, color: C.mute, fontSize: 11 } }, item.dir ? '▸' : '•'),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name)),
            h('span', { style: { color: C.mute, fontSize: 11 } }, item.mtime ? new Date(item.mtime * 1000).toLocaleString('zh-CN', { hour12: false }) : ''),
            h('span', { style: { color: C.mute, fontSize: 11, textAlign: 'right' } }, item.dir ? '文件夹' : formatBytes(Number(item.size))))
        })))
  }

  }
  const Browser = StableTransferBrowser

  const online = devices.filter((item) => item && item.online)
  const initialSource = localDevice && devices.some((item) => item.device_id === localDevice) ? localDevice : (online[0] && online[0].device_id) || ''
  const [sourceDevice, setSourceDevice] = React.useState(initialSource)
  const [destDevice, setDestDevice] = React.useState((online.find((item) => item.device_id !== initialSource) || {}).device_id || '')
  const [sourcePath, setSourcePath] = React.useState('')
  const [destPath, setDestPath] = React.useState('')
  const [sourceFile, setSourceFile] = React.useState(null)
  const [overwrite, setOverwrite] = React.useState(false)
  const [job, setJob] = React.useState(null)
  const [refresh, setRefresh] = React.useState(0)
  const abortRef = React.useRef(null)
  const transferRef = React.useRef('')
  const sourceItem = devices.find((item) => item.device_id === sourceDevice)
  const destItem = devices.find((item) => item.device_id === destDevice)
  const destination = sourceFile && destPath ? joinPath(destPath, sourceFile.name) : ''
  const running = !!(job && job.state === 'running')
  const canStart = !!(sourceFile && destination && sourceItem && destItem
    && sourceItem.online && destItem.online && !running)
  const start = async () => {
    if (!sourceFile || !destination) return
    const controller = new AbortController()
    abortRef.current = controller
    if (!transferRef.current) transferRef.current = newTransferId()
    const transferId = transferRef.current
    setJob({ state: 'running', percent: 0, transferred: 0, total: Number(sourceFile.size) || 0, destination, error: '' })
    const base = '/api/devices/' + encodeURIComponent(destDevice)
    try {
      const result = await transferFile({
        source: sourceFile.path,
        destination,
        transferId,
        overwrite,
        signal: controller.signal,
        read: (args) => post('/api/devices/' + encodeURIComponent(sourceDevice) + '/fs/read',
          { path: args.path, offset: args.offset, limit: args.limit, encoding: 'base64' }),
        write: (args) => post(base + '/fs/write_chunk', { ...args, transfer_id: args.transferId }),
        status: (args) => post(base + '/fs/transfer_status', { path: args.path, transfer_id: args.transferId }),
        cancel: (args) => post(base + '/fs/transfer_cancel', { path: args.path, transfer_id: args.transferId }),
        onProgress: (value) => setJob((current) => ({ ...(current || {}), ...value, state: 'running' }))
      })
      setJob({ state: 'done', percent: 100, transferred: result.bytes, total: result.bytes, destination, error: '' })
      transferRef.current = ''
      setRefresh((value) => value + 1)
      if (onNotice) onNotice('已转移 ' + sourceFile.name + '（' + formatBytes(result.bytes) + '）')
    } catch (cause) {
      const aborted = cause && cause.code === 'aborted'
      setJob((current) => ({ ...(current || {}), state: aborted ? 'cancelled' : 'error', error: aborted ? '已取消' : (cause.message || '传输失败'), code: cause.code }))
      if (!aborted && onError) onError(cause)
      if (aborted) transferRef.current = ''
    } finally {
      abortRef.current = null
    }
  }
  const cancel = () => { if (abortRef.current) abortRef.current.abort() }
  const progress = job ? Math.max(0, Math.min(100, Number(job.percent) || 0)) : 0
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', padding: '14px 18px 18px', gap: 12, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' } },
      h('div', { style: { fontSize: 18, fontWeight: 600, color: C.ink } }, '文件转移'),
      h('span', { style: { color: C.mute, fontSize: 11.5 } }, '源文件从源设备读取，分块写入目标设备；中断后可从偏移继续。')),
    h('div', { style: { display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0 } },
      h(Browser, {
        title: '源设备', deviceId: sourceDevice, onDevice: (id) => { setSourceDevice(id); setSourceFile(null) },
        path: sourcePath, onPath: setSourcePath, selectedPath: sourceFile && sourceFile.path,
        onFile: (item) => setSourceFile(item)
      }),
      h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', color: C.mute, fontSize: 18, flex: '0 0 auto' } }, '→'),
      h(Browser, {
        key: 'dest:' + refresh, title: '目标目录', deviceId: destDevice, onDevice: (id) => setDestDevice(id),
        path: destPath, onPath: setDestPath, selectedPath: ''
      })),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: C.soft, flex: '0 0 auto', minWidth: 0 } },
      h('div', { style: { flex: '1 1 auto', minWidth: 0, fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        sourceFile ? (sourceFile.name + ' · ' + formatBytes(Number(sourceFile.size)) + ' → ' + (destination || '选择目标目录')) : '从左侧选择一个文件'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.sub, flex: '0 0 auto' } },
        h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }), '覆盖同名文件'),
      running ? button('取消', cancel) : button(job && job.state === 'error' ? '重试' : '开始转移', start, { primary: true, disabled: !canStart })),
    job ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' } },
      h('div', { style: { flex: '1 1 auto', height: 6, borderRadius: 999, background: C.soft, overflow: 'hidden' } },
        h('div', { style: { width: progress + '%', height: '100%', background: job.state === 'error' ? C.red : C.blue, transition: 'width 200ms ease' } })),
      h('span', { className: 'tether-num', style: { color: job.state === 'error' ? C.red : C.mute, fontSize: 11, minWidth: 150, textAlign: 'right' } },
        job.state === 'error' ? job.error : (job.percent || 0) + '% · ' + formatBytes(job.transferred || 0) + ' / ' + formatBytes(job.total || 0))) : null)
}
