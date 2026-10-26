window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'tether'
    const BASE = 'http://127.0.0.1:18890'

    const C = {
      ink: '#101828', sub: '#475467', mute: '#667085', line: '#d0d5dd', soft: '#f2f4f7',
      bg: '#ffffff', panel: '#f8fafc', green: '#16a34a', red: '#b42318', blue: '#1570ef',
      amber: '#b54708', dark: '#101828'
    }

    async function api(path, options) {
      const init = { ...(options || {}) }
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
      const res = await fetch(BASE + path, init)
      let data = {}
      try { data = await res.json() } catch (_) { /* keep empty */ }
      if (!res.ok) {
        const detail = data && data.detail
        const message = (detail && detail.error) || (typeof detail === 'string' && detail) || data.error || ('HTTP ' + res.status)
        const err = new Error(message)
        err.code = detail && detail.code
        throw err
      }
      return data
    }

    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })

    function pill(text, color) {
      return h('span', {
        style: {
          fontSize: 11, lineHeight: '18px', padding: '0 7px', borderRadius: 999,
          color: color || C.sub, border: '1px solid ' + (color || C.line),
          background: color ? 'transparent' : C.soft, whiteSpace: 'nowrap'
        }
      }, text)
    }

    function dot(on) {
      return h('span', {
        style: {
          width: 7, height: 7, borderRadius: 4, display: 'inline-block',
          background: on ? C.green : '#98a2b3', marginRight: 7, flex: '0 0 auto'
        }
      })
    }

    function btn(label, onClick, opts) {
      const o = opts || {}
      return h('button', {
        onClick, disabled: o.disabled, title: o.title || label,
        style: {
          height: 28, padding: '0 10px', borderRadius: 6, fontSize: 12,
          border: '1px solid ' + (o.primary ? C.dark : C.line),
          background: o.primary ? C.dark : (o.danger ? '#fff' : '#fff'),
          color: o.primary ? '#fff' : (o.danger ? C.red : C.ink),
          cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.5 : 1,
          whiteSpace: 'nowrap'
        }
      }, label)
    }

    function formatBytes(n) {
      if (n == null) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function eventText(ev) {
      const p = ev.payload || {}
      if (typeof p.text === 'string' && p.text) return p.text
      if (typeof p.delta === 'string' && p.delta) return p.delta
      if (p.name) return p.name + (p.command ? ' · ' + p.command : '')
      if (p.error) return String(p.error)
      return JSON.stringify(p).slice(0, 300)
    }

    function App() {
      const [state, setState] = React.useState(null)
      const [deviceId, setDeviceId] = React.useState('')
      const [devicesOpen, setDevicesOpen] = React.useState(true)
      const [projects, setProjects] = React.useState(null)
      const [project, setProject] = React.useState(null)
      const [path, setPath] = React.useState('')
      const [pathDraft, setPathDraft] = React.useState('')
      const [listing, setListing] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [file, setFile] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [task, setTask] = React.useState('')
      const [runId, setRunId] = React.useState('')
      const [events, setEvents] = React.useState([])
      const [showSettings, setShowSettings] = React.useState(false)
      const [policy, setPolicy] = React.useState(null)
      const [audit, setAudit] = React.useState([])
      const [mode, setMode] = React.useState('readonly')
      const [rootsText, setRootsText] = React.useState('')
      const [rightOpen, setRightOpen] = React.useState(false)
      const [ask, setAsk] = React.useState(null)

      const askValue = (title, value, onOk) => setAsk({ title, value: value || '', onOk })

      const fail = (e) => setNotice(String((e && e.message) || e))
      React.useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(t) }, [notice])

      const loadState = React.useCallback(async () => {
        try {
          const data = await api('/api/state')
          setState(data)
          setDeviceId((current) => {
            if (current && data.devices.some((d) => d.device_id === current)) return current
            const local = data.local_device
            if (local && data.devices.some((d) => d.device_id === local)) return local
            const online = data.devices.find((d) => d.online)
            return (online && online.device_id) || ((data.devices[0] || {}).device_id || '')
          })
        } catch (e) { fail(e) }
      }, [])

      React.useEffect(() => {
        loadState()
        const t = setInterval(loadState, 2500)
        return () => clearInterval(t)
      }, [loadState])

      const device = state && state.devices.find((d) => d.device_id === deviceId)

      const loadProjects = React.useCallback(async () => {
        if (!deviceId) return
        try {
          const data = await api('/api/devices/' + encodeURIComponent(deviceId) + '/workspaces')
          setProjects(data)
          setProject((current) => {
            if (current && data.workspaces.some((w) => w.path === current.path)) return current
            return data.workspaces[0] || null
          })
        } catch (e) {
          setProjects(null)
          fail(e)
        }
      }, [deviceId])

      React.useEffect(() => {
        if (!deviceId) { setPolicy(null); return }
        api('/api/devices/' + encodeURIComponent(deviceId) + '/policy')
          .then(setPolicy)
          .catch(() => setPolicy(null))
      }, [deviceId])

      React.useEffect(() => { setProject(null); setPath(''); setPathDraft(''); setListing(null); setFile(null); setSelected(null); loadProjects() }, [deviceId, loadProjects])

      React.useEffect(() => {
        if (project && project.path !== path) {
          setPath(project.path)
          setPathDraft(project.path)
          setFile(null)
          setSelected(null)
        }
      }, [project])

      const loadDir = React.useCallback(async (target) => {
        if (!deviceId || !target) return
        setBusy(true)
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path: target })
          setListing(data)
          setPath(data.path)
          setPathDraft(data.path)
          setSelected(null)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }, [deviceId])

      React.useEffect(() => { if (path) loadDir(path) }, [path, loadDir])

      const openFile = async (entry) => {
        if (entry.dir) { setPath(entry.path); setPathDraft(entry.path); return }
        setBusy(true)
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/read', { path: entry.path })
          const stat = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/stat', { path: entry.path })
          setFile({ ...data, writable: stat.writable })
          setDraft(data.binary ? '' : data.text)
          setDirty(false)
          setSelected(entry)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const saveFile = async () => {
        if (!file || file.binary) return
        setBusy(true)
        try {
          await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: file.path, text: draft })
          setDirty(false)
          const stat = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/stat', { path: file.path })
          setFile((f) => ({ ...f, size: stat.size, mtime: stat.mtime, writable: stat.writable }))
          setNotice('Saved ' + file.path)
          loadDir(path)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const newFolder = () => {
        askValue('新建文件夹', '', async (name) => {
          try {
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: path + '\\' + name })
            loadDir(path)
          } catch (e) { fail(e) }
        })
      }

      const newFile = () => {
        askValue('新建文件', '', async (name) => {
          const target = path + '\\' + name
          try {
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: target, text: '' })
            loadDir(path)
            openFile({ path: target, dir: false, name })
          } catch (e) { fail(e) }
        })
      }

      const renameEntry = () => {
        if (!selected) return
        askValue('重命名', selected.name, async (name) => {
          if (name === selected.name) return
          const target = path + '\\' + name
          try {
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/rename', { path: selected.path, dest: target })
            setSelected(null)
            if (file && file.path === selected.path) setFile(null)
            loadDir(path)
          } catch (e) { fail(e) }
        })
      }

      const deleteEntry = async () => {
        if (!selected) return
        if (!window.confirm('Move "' + selected.name + '" to .tether-trash?\n\nIt can be restored from the target machine.')) return
        try {
          await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/delete', { path: selected.path })
          setSelected(null)
          if (file && file.path === selected.path) { setFile(null); setDraft('') }
          loadDir(path)
        } catch (e) { fail(e) }
      }

      const newProject = () => {
        if (!projects) return
        askValue('新建项目（' + projects.root + '）', '', async (name) => {
          try {
            const target = projects.root + '\\' + name
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: target })
            await loadProjects()
            setProject({ name, path: target, kind: 'tether' })
            setPath(target)
            loadDir(target)
          } catch (e) { fail(e) }
        })
      }

      const openSettings = async () => {
        setShowSettings(true)
        try {
          const p = await api('/api/devices/' + encodeURIComponent(deviceId) + '/policy')
          setPolicy(p)
          setMode(p.mode)
          setRootsText((p.allowed_roots || []).join('\n'))
          const a = await api('/api/devices/' + encodeURIComponent(deviceId) + '/audit?limit=80')
          setAudit(a.entries || [])
        } catch (e) { fail(e) }
      }

      const savePolicy = async () => {
        if (mode === 'full' && !window.confirm('Full-disk mode lets this Tether plugin write and delete files anywhere the node user can, except protected system directories and credential stores.\n\nEnable it?')) return
        setBusy(true)
        try {
          const roots = rootsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          const p = await post('/api/devices/' + encodeURIComponent(deviceId) + '/policy', { mode, allowed_roots: roots })
          setPolicy(p)
          setNotice('Policy updated: ' + p.mode)
          const a = await api('/api/devices/' + encodeURIComponent(deviceId) + '/audit?limit=80')
          setAudit(a.entries || [])
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const startTask = async () => {
        if (!task.trim() || !deviceId) return
        const workspace = project ? project.path : (projects && projects.node_workspace)
        if (!workspace) { setNotice('Pick a workspace first'); return }
        setBusy(true)
        try {
          const sessions = ((state && state.sessions) || []).filter((s) => s.device_id === deviceId && s.workspace === workspace)
          let sessionId = sessions.length ? sessions[sessions.length - 1].session_id : ''
          if (!sessionId) {
            const created = await post('/api/sessions', { device_id: deviceId, workspace })
            sessionId = created.session_id
          }
          const run = await post('/api/sessions/' + encodeURIComponent(sessionId) + '/runs', {
            request_id: 'ui-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            prompt: task.trim()
          })
          setTask('')
          setRunId(run.run_id)
          setEvents([])
          loadState()
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      React.useEffect(() => {
        if (!runId) return
        let live = true
        const load = async () => {
          try {
            const data = await api('/api/runs/' + encodeURIComponent(runId) + '/events?after_seq=0')
            if (live) setEvents(data.events || [])
          } catch (_) { /* run may not be visible yet */ }
        }
        load()
        const t = setInterval(load, 1200)
        return () => { live = false; clearInterval(t) }
      }, [runId])

      const cancelRun = async () => {
        if (!runId) return
        try { await post('/api/runs/' + encodeURIComponent(runId) + '/cancel'); loadState(); setTimeout(loadState, 1600) } catch (e) { fail(e) }
      }

      const submitAsk = () => {
        if (!ask) return
        const value = ask.value.trim()
        if (!value) return
        const onOk = ask.onOk
        setAsk(null)
        onOk(value)
      }

      const sessions = (state && state.sessions) || []
      const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      const sameWorkspace = (a, b) => {
        const na = normPath(a), nb = normPath(b)
        if (!na || !nb) return false
        return na === nb || (!na.includes('/') && nb.endsWith('/' + na))
      }
      const workspaceOf = (run) => {
        const session = sessions.find((s) => s.session_id === run.session_id)
        return session ? session.workspace : ''
      }
      const runs = ((state && state.runs) || []).filter((r) =>
        (!deviceId || r.device_id === deviceId) && (!project || sameWorkspace(workspaceOf(r), project.path))
      ).slice(0, 40)
      const currentRun = runs.find((r) => r.run_id === runId)
      const activeRun = currentRun && ['queued', 'dispatching', 'running', 'cancelling'].includes(currentRun.state)

      const rowStyle = (active) => ({
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
        cursor: 'pointer', background: active ? C.soft : 'transparent', fontSize: 12.5
      })

      return h('div', { style: { position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.ink, fontSize: 13, overflow: 'hidden' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 15 } }, 'Tether'),
          h('span', { style: { color: C.mute, fontSize: 12 } }, '远程 Agent 工作区'),
          h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
            device ? h('span', { style: { display: 'flex', alignItems: 'center', fontSize: 12, color: C.sub } }, dot(device.online), device.name) : h('span', { style: { color: C.mute } }, 'no device'),
            device && device.capabilities && !device.capabilities.fs ? pill('节点待更新', C.amber) : null,
            policy ? pill(policy.mode === 'full' ? 'full-disk' : (policy.mode === 'locked' ? 'locked' : 'readonly'), policy.mode === 'full' ? C.red : (policy.mode === 'locked' ? C.amber : C.mute)) : null,
            btn(rightOpen ? '隐藏任务' : '显示任务', () => setRightOpen(!rightOpen)),
            btn('权限设置', openSettings)
          )
        ),
        notice ? h('div', { style: { padding: '6px 14px', background: /^Saved |^Policy updated/.test(notice) ? '#ecfdf3' : '#fef3f2', color: /^Saved |^Policy updated/.test(notice) ? '#067647' : C.red, borderBottom: '1px solid ' + (/^Saved |^Policy updated/.test(notice) ? '#abefc6' : '#fecdca'), fontSize: 12 } }, notice) : null,
        h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0 } },
          h('aside', { style: { width: 210, flex: '0 0 auto', borderRight: '1px solid ' + C.line, display: 'flex', flexDirection: 'column', minHeight: 0, background: C.panel } },
            h('div', { style: { padding: '10px 12px 4px', display: 'flex', alignItems: 'center', gap: 6 } },
              h('button', { onClick: () => setDevicesOpen(!devicesOpen), style: { border: 0, background: 'transparent', cursor: 'pointer', color: C.mute, padding: 0, fontSize: 11 } }, devicesOpen ? '▾' : '▸'),
              h('span', { style: { fontSize: 11, fontWeight: 600, color: C.mute, letterSpacing: 0.4 } }, '设备')
            ),
            devicesOpen ? h('div', { style: { padding: '0 8px 8px', overflow: 'auto', maxHeight: 180 } },
              ((state && state.devices) || []).map((d) => h('div', {
                key: d.device_id, onClick: () => setDeviceId(d.device_id), style: rowStyle(d.device_id === deviceId)
              },
                dot(d.online),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name || d.device_id),
                d.device_id === (state && state.local_device) ? pill('local') : null,
                d.online ? null : h('span', { style: { marginLeft: 'auto', fontSize: 10, color: C.mute } }, 'offline')
              ))
            ) : null,
            h('div', { style: { padding: '8px 12px 4px', display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid ' + C.line } },
              h('span', { style: { fontSize: 11, fontWeight: 600, color: C.mute, letterSpacing: 0.4 } }, '项目'),
              h('button', { onClick: newProject, title: '在 ' + ((projects && projects.root) || '工作区根') + ' 下新建项目', style: { marginLeft: 'auto', border: 0, background: 'transparent', color: C.blue, cursor: 'pointer', fontSize: 12 } }, '+ 新建')
            ),
            h('div', { style: { padding: '0 8px 10px', overflow: 'auto', flex: '1 1 auto' } },
              ((projects && projects.workspaces) || []).map((w) => h('div', {
                key: w.path, onClick: () => setProject(w), style: rowStyle(project && project.path === w.path)
              },
                h('span', { style: { fontSize: 13, width: 16, color: C.mute } }, w.kind === 'dsh' ? '◈' : '▣'),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, w.name),
                w.writable ? null : h('span', { style: { marginLeft: 'auto', fontSize: 10, color: C.mute } }, 'ro')
              )),
              (!projects || !projects.workspaces.length) ? h('div', { style: { color: C.mute, fontSize: 12, padding: '6px 8px' } }, '暂无项目') : null
            ),
            h('div', { style: { borderTop: '1px solid ' + C.line, padding: '8px 12px', fontSize: 11, color: C.mute } },
              projects ? ('新项目根: ' + projects.root) : ' '
            )
          ),
          h('main', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
            h('div', { style: { borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px 4px' } },
                btn('↑', () => {
                  if (!path) return
                  const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
                  if (parent && parent !== path) { setPath(parent); setPathDraft(parent) }
                }, { title: '上级目录' }),
                h('input', {
                  value: pathDraft, onChange: (ev) => setPathDraft(ev.target.value),
                  onKeyDown: (ev) => { if (ev.key === 'Enter') loadDir(pathDraft) },
                  spellCheck: false,
                  style: { flex: '1 1 auto', minWidth: 0, height: 28, border: '1px solid ' + C.line, borderRadius: 6, padding: '0 8px', fontFamily: 'Consolas, monospace', fontSize: 12 }
                }),
                btn('刷新', () => loadDir(path), { disabled: !path }),
                listing && !listing.writable ? pill('read-only', C.amber) : null
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 7px' } },
                btn('新建文件夹', newFolder, { disabled: !listing || !listing.writable }),
                btn('新建文件', newFile, { disabled: !listing || !listing.writable }),
                btn('重命名', renameEntry, { disabled: !selected }),
                btn('删除', deleteEntry, { disabled: !selected, danger: true }),
                selected ? h('span', { style: { marginLeft: 6, fontSize: 11.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected.name) : null
              )
            ),
            h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0 } },
              h('div', { style: { width: 240, flex: '0 0 auto', borderRight: '1px solid ' + C.line, overflow: 'auto', background: C.bg } },
                listing ? h('div', null,
                  listing.entries.map((entry) => h('div', {
                    key: entry.path, onClick: () => setSelected(entry), onDoubleClick: () => openFile(entry),
                    style: { ...rowStyle(selected && selected.path === entry.path), padding: '5px 10px', borderRadius: 0 }
                  },
                    h('span', { style: { width: 16, color: C.mute, fontSize: 12 } }, entry.dir ? '▸' : '·'),
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: entry.hidden ? C.mute : C.ink } }, entry.name),
                    h('span', { style: { marginLeft: 'auto', fontSize: 10, color: C.mute, whiteSpace: 'nowrap' } }, entry.dir ? '' : formatBytes(entry.size))
                  )),
                  !listing.entries.length ? h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, '空目录') : null
                ) : h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, path ? (busy ? '加载中…' : '无法读取') : '选择项目')
              ),
              h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' } },
                file ? h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
                    h('span', { style: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.path),
                    file.binary ? pill('binary') : pill(formatBytes(file.size)),
                    file.writable ? null : pill('read-only', C.amber),
                    h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                      file.writable && !file.binary ? btn(dirty ? 'Save *' : 'Save', saveFile, { primary: true, disabled: !dirty || busy }) : null
                    )
                  ),
                  file.binary
                    ? h('div', { style: { padding: 20, color: C.mute, fontSize: 12 } }, 'Binary file. Preview is not supported.')
                    : h('textarea', {
                      value: draft, onChange: (ev) => { setDraft(ev.target.value); setDirty(true) },
                      readOnly: !file.writable, spellCheck: false,
                      style: {
                        flex: '1 1 auto', width: '100%', boxSizing: 'border-box', resize: 'none', border: 0,
                        outline: 'none', padding: '10px 12px', fontFamily: 'Consolas, "Courier New", monospace',
                        fontSize: 12.5, lineHeight: 1.55, background: file.writable ? '#fff' : C.panel, color: C.ink
                      }
                    })
                ) : h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', color: C.mute, fontSize: 12 } },
                  path ? '双击文件查看内容' : '先从左侧选择项目'
                )
              )
            )
          ),
          rightOpen ? h('aside', { style: { width: 310, flex: '0 0 auto', borderLeft: '1px solid ' + C.line, display: 'flex', flexDirection: 'column', minHeight: 0, background: C.panel } },
            h('div', { style: { padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { fontSize: 11, fontWeight: 600, color: C.mute, letterSpacing: 0.4 } }, '任务'),
              activeRun ? pill('running', C.green) : null,
              h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.mute } }, project ? project.name : '')
            ),
            h('div', { style: { padding: '0 10px 8px', display: 'flex', gap: 6 } },
              h('textarea', {
                value: task, onChange: (ev) => setTask(ev.target.value), placeholder: '在当前工作区发起远程任务…',
                style: { flex: '1 1 auto', height: 56, resize: 'none', border: '1px solid ' + C.line, borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }
              }),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                btn('启动', startTask, { primary: true, disabled: !task.trim() || busy }),
                btn('取消', cancelRun, { disabled: !activeRun, danger: true })
              )
            ),
            h('div', { style: { borderTop: '1px solid ' + C.line, overflow: 'auto', maxHeight: 160, flex: '0 0 auto' } },
              runs.map((r) => h('div', {
                key: r.run_id, onClick: () => { setRunId(r.run_id); setEvents([]) }, style: { ...rowStyle(r.run_id === runId), borderRadius: 0, padding: '5px 12px' }
              },
                h('span', { style: { width: 6, height: 6, borderRadius: 3, background: r.state === 'completed' ? C.green : (['failed', 'unknown'].includes(r.state) ? C.red : C.blue), flex: '0 0 auto' } }),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' } }, r.prompt),
                h('span', { style: { fontSize: 10, color: C.mute } }, r.state)
              )),
              !runs.length ? h('div', { style: { padding: '6px 12px', color: C.mute, fontSize: 12 } }, '还没有任务') : null
            ),
            h('div', { style: { borderTop: '1px solid ' + C.line, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
              h('div', { style: { padding: '6px 12px', fontSize: 11, color: C.mute, display: 'flex', gap: 6, alignItems: 'center' } },
                h('span', null, runId ? '事件流' : '选择任务查看事件'),
                currentRun ? pill(currentRun.state, currentRun.state === 'completed' ? C.green : (['failed', 'unknown', 'cancelled'].includes(currentRun.state) ? C.red : C.blue)) : null,
                currentRun && currentRun.finish_reason ? h('span', null, currentRun.finish_reason) : null
              ),
              h('div', { style: { overflow: 'auto', flex: '1 1 auto', padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 } },
                events.map((ev) => h('div', { key: ev.run_id + ':' + ev.seq, style: { fontSize: 11.5, lineHeight: 1.45, color: ev.kind === 'error' ? C.red : C.sub, wordBreak: 'break-word' } },
                  h('span', { style: { color: C.mute, marginRight: 6 } }, ev.seq + ' · ' + ev.kind),
                  eventText(ev)
                )),
                !events.length && runId ? h('div', { style: { color: C.mute, fontSize: 12 } }, '等待事件…') : null
              )
            )
          ) : null
        ),
        showSettings ? h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 20 } },
          h('div', { style: { width: 480, height: '100%', background: '#fff', borderLeft: '1px solid ' + C.line, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(16,24,40,0.12)' } },
            h('div', { style: { padding: '12px 16px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'center' } },
              h('strong', null, '文件权限'),
              device ? h('span', { style: { marginLeft: 8, fontSize: 12, color: C.mute } }, device.name) : null,
              h('button', { onClick: () => setShowSettings(false), style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.mute } }, '×')
            ),
            h('div', { style: { padding: 16, overflow: 'auto', flex: '1 1 auto' } },
              h('div', { style: { display: 'grid', gap: 6, marginBottom: 12 } },
                h('label', { style: { border: '1px solid ' + (mode === 'readonly' ? C.dark : C.line), borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: mode === 'readonly' ? C.panel : '#fff' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('input', { type: 'radio', checked: mode === 'readonly', onChange: () => setMode('readonly') }),
                    h('strong', { style: { fontSize: 13 } }, '默认：全盘只读 + 项目可写')
                  ),
                  h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 3 } }, '全盘可读；仅项目根、已有 DSH 工作区、节点工作目录可写。')
                ),
                h('label', { style: { border: '1px solid ' + (mode === 'locked' ? C.amber : C.line), borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: mode === 'locked' ? '#fffaeb' : '#fff' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('input', { type: 'radio', checked: mode === 'locked', onChange: () => setMode('locked') }),
                    h('strong', { style: { fontSize: 13 } }, '锁定：全部只读')
                  ),
                  h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 3 } }, '任何写入、新建、重命名、删除都被拒绝；适合临时交出只读现场。')
                ),
                h('label', { style: { border: '1px solid ' + (mode === 'full' ? C.red : C.line), borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: mode === 'full' ? '#fef3f2' : '#fff' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    h('input', { type: 'radio', checked: mode === 'full', onChange: () => setMode('full') }),
                    h('strong', { style: { fontSize: 13 } }, '全盘读写')
                  ),
                  h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 3 } }, '目标机主机权限。系统目录、凭据与 AppData 仍拒写；需二次确认。')
                )
              ),
              h('div', { style: { fontSize: 11, fontWeight: 600, color: C.mute, marginBottom: 6, letterSpacing: 0.4 } }, '可写根目录'),
              h('textarea', {
                value: rootsText, onChange: (ev) => setRootsText(ev.target.value), spellCheck: false,
                style: { width: '100%', height: 96, boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 6, padding: 8, fontFamily: 'Consolas, monospace', fontSize: 12, resize: 'vertical' }
              }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
                btn('保存权限', savePolicy, { primary: true, disabled: busy || !device || !device.online }),
                h('span', { style: { fontSize: 11, color: C.mute, alignSelf: 'center' } }, policy ? ('更新于 ' + (policy.updated_by || 'default')) : '')
              ),
              h('div', { style: { fontSize: 11, fontWeight: 600, color: C.mute, margin: '18px 0 6px', letterSpacing: 0.4 } }, '审计（最近 80 条）'),
              h('div', { style: { border: '1px solid ' + C.line, borderRadius: 6, overflow: 'hidden' } },
                h('div', { style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '5px 8px', background: C.panel, fontSize: 10, color: C.mute, borderBottom: '1px solid ' + C.line } },
                  h('span', null, '操作'), h('span', null, '路径'), h('span', null, '结果')
                ),
                h('div', { style: { maxHeight: 240, overflow: 'auto' } },
                  audit.map((a, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '4px 8px', fontSize: 10.5, borderBottom: '1px solid ' + C.soft, color: a.result === 'denied' ? C.red : C.sub } },
                    h('span', null, a.op),
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.path }, a.path),
                    h('span', null, a.phase === 'intent' ? (a.result === 'denied' ? 'denied' : 'intent') : a.result)
                  )),
                  !audit.length ? h('div', { style: { padding: 10, fontSize: 11, color: C.mute } }, '暂无审计') : null
                )
              )
            )
          )
        ) : null,
        ask ? h('div', {
          style: { position: 'absolute', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'grid', placeItems: 'center', zIndex: 30 }
        },
          h('div', { style: { width: 380, background: '#fff', borderRadius: 10, boxShadow: '0 20px 48px rgba(16,24,40,0.24)', padding: 18 } },
            h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 10 } }, ask.title),
            h('input', {
              autoFocus: true, value: ask.value, spellCheck: false,
              onChange: (ev) => setAsk({ ...ask, value: ev.target.value }),
              onKeyDown: (ev) => { if (ev.key === 'Enter') submitAsk(); if (ev.key === 'Escape') setAsk(null) },
              style: { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 6, padding: '0 8px', fontSize: 13 }
            }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } },
              btn('取消', () => setAsk(null)),
              btn('确定', submitAsk, { primary: true, disabled: !ask.value.trim() })
            )
          )
        ) : null
      )
    }

    function TetherIcon() {
      return h('span', { title: 'Tether', style: { display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6, background: '#101828', color: '#fff', fontSize: 12, fontWeight: 700 } }, 'T')
    }

    return {
      name: 'tether',
      inject: ['slots', 'layout'],
      apply(ctx) {
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({ name: 'main', key: PANEL_ID }, App)
        })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => 'Tether'
        }, TetherIcon))
      }
    }
  }
})
