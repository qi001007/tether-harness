// tether-host-directory-flow v2
// tether_native=1 时，DSH 的目录/工作区选择动作整体交给 Tether 宿主资源管理器：
// 1) 两个 directoryFlow 槽位保留无渲染 occupant（侧栏“+”自动 flow、快捷键、错误重试），
//    升起 open 即向宿主发 pick，结果经 owner 的 onPicked 回填（createWorkspace→startSession）。
// 2) conversation.hero.workspace 槽位直接换 occupant：hero 工作区 chip/“创建项目”不再弹
//    DSH 自己的工作区列表 Menu，open 升起即发 pick，选中后 uiWorkspace.workspaces.create
//    回填并 onPick 导航——弹窗外壳只有宿主资源管理器一个。
// 3) uiWorkspace.pickDirectory 兜底改道宿主：即使原生 flow occupant 意外渲染，也不弹 OS 对话框。
// 请求经 webview hash / iframe postMessage 发给 Tether 宿主（与 Codeg 附件选择同一桥协议），
// 宿主弹 TetherFolderPickDialog 并回传路径。桌面直连 DSH（无 tether_native）不注册，原样保留。
try {
  if (new URL(window.location.href).searchParams.has('tether_native')) {
    // 本机直连快路：DSH 页自身就在 127.0.0.1/localhost，冻结插件把回环页误当成
    // 网关同源，把设备文件请求发到 <本页 origin>/tether-device-fs/…，DSH 的 404
    // 被映射成“目标电脑的 Tether Node 版本过旧”。回环页一律改走本机节点通道：
    // APP 18892 的本地设备代理 /api/devices/<id>/fs/*（与页面内插件的 baseList 同路）；
    // 非回环网关页保持原 origin 路径（surface cookie 只在该 origin 生效）。
    const tetherLoopbackPage = (() => {
      try {
        const host = new URL(window.location.href).hostname
        return host === '127.0.0.1' || host === 'localhost'
      } catch (_) { return false }
    })()
    if (tetherLoopbackPage && !window.__tetherDeviceFsChannel && typeof window.fetch === 'function') {
      window.__tetherDeviceFsChannel = true
      const tetherFetch = window.fetch.bind(window)
      const tetherDeviceSuffix = (suffix) => ({
        '/list': '/fs/list', '/read': '/fs/read', '/write_chunk': '/fs/write_chunk'
      })[suffix] || suffix
      const tetherFsRoutes = ['/drives', '/workspaces', '/list', '/read', '/write_chunk']
      // 回环页不能直连 APP 18892：页面 origin 与 APP 不同，proxy cookie 是
      // SameSite=Strict，跨源只会拿到 401/403。设备文件请求改投宿主桥（webview hash /
      // iframe postMessage），由宿主在 APP 同源完成 /api/devices/<本机>/fs/* 并回传。
      const tetherFsMode = () => {
        try { if (window.parent && window.parent !== window) return 'iframe' } catch (_) { return 'iframe' }
        try { if (/Electron\//.test(navigator.userAgent || '')) return 'hash' } catch (_) { /* user agent is advisory */ }
        return ''
      }
      const tetherFsUuid = () => {
        let id = ''
        try { id = crypto.randomUUID() } catch (_) { /* insecure context fallback below */ }
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
          })
        }
        return id
      }
      const tetherFsBase64Url = (text) => {
        const bytes = new TextEncoder().encode(String(text || ''))
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }
      const tetherFsChunkChars = 262144
      const tetherFsPending = new Map()
      let tetherFsListening = false
      const onTetherFsMessage = (event) => {
        const data = event && event.data
        if (!data || typeof data !== 'object') return
        if (data.type !== 'tether:fs-chunk' && data.type !== 'tether:fs-result') return
        const id = String(data.id || '')
        const entry = tetherFsPending.get(id)
        if (!entry) return
        if (data.type === 'tether:fs-chunk') {
          if (entry.ack) entry.ack(Number(data.seq))
          return
        }
        tetherFsPending.delete(id)
        clearTimeout(entry.timer)
        if (entry.removeAbort) entry.removeAbort()
        if (data.ok === true) {
          entry.resolve({ status: Number(data.status) || 200, data: data.data === undefined ? null : data.data })
          return
        }
        const error = new Error(String(data.message || ('HTTP ' + (Number(data.status) || 0))))
        error.status = Number(data.status) || 0
        error.code = typeof data.code === 'string' ? data.code : ''
        entry.reject(error)
      }
      // hash 通道同一时刻只允许一段在途：同步连写 hash 会被浏览器合并成一次导航，
      // 拿两个并发请求（getRoots 的 drives+workspaces）就会丢一条。整段发送串行，
      // 宿主逐片回执后才发下一条，回包按 request_id 各归各。
      let tetherFsSendQueue = Promise.resolve()
      const tetherFsRelay = (request, signal) => {
        const mode = tetherFsMode()
        if (!mode) return Promise.reject(new Error('当前页面没有宿主文件通道'))
        if (!tetherFsListening) {
          tetherFsListening = true
          window.addEventListener('message', onTetherFsMessage)
        }
        const id = tetherFsUuid()
        let settle = null
        const result = new Promise((resolve, reject) => { settle = { resolve, reject } })
        const entry = { resolve: settle.resolve, reject: settle.reject, timer: null, ack: null, removeAbort: null }
        const abortError = () => new DOMException('The operation was aborted', 'AbortError')
        const drop = () => {
          if (tetherFsPending.get(id) !== entry) return false
          tetherFsPending.delete(id)
          clearTimeout(entry.timer)
          return true
        }
        const failRequest = (error) => {
          if (!drop()) return
          entry.reject(error)
        }
        tetherFsPending.set(id, entry)
        entry.timer = setTimeout(() => {
          const error = new Error('宿主文件通道响应超时')
          error.status = 0
          failRequest(error)
        }, 120000)
        if (signal) {
          const onAbort = () => {
            if (entry.ack) entry.ack(-1)
            failRequest(abortError())
          }
          if (signal.aborted) { onAbort(); return result }
          try {
            signal.addEventListener('abort', onAbort, { once: true })
            entry.removeAbort = () => signal.removeEventListener('abort', onAbort)
          } catch (_) { /* an exotic signal simply skips cancellation */ }
        }
        if (mode === 'iframe') {
          try {
            window.parent.postMessage({ type: 'tether:fs-request', id, method: request.method,
              path: request.path, query: request.query || '', device: request.device,
              body: request.body === undefined ? null : request.body }, '*')
          } catch (_) {
            failRequest(new Error('宿主文件通道不可用'))
          }
          return result
        }
        const chunks = []
        if (typeof request.body === 'string' && request.body) {
          const encoded = tetherFsBase64Url(request.body)
          for (let offset = 0; offset < encoded.length; offset += tetherFsChunkChars) {
            chunks.push(encoded.slice(offset, offset + tetherFsChunkChars))
          }
        }
        const sendChunk = (seq) => new Promise((ackDone, ackFail) => {
          const timer = setTimeout(() => {
            if (!entry.ack) return
            entry.ack = null
            ackFail(new Error('宿主文件通道响应超时'))
          }, 20000)
          entry.ack = (got) => {
            if (got !== seq && got !== -1) return
            clearTimeout(timer)
            entry.ack = null
            if (got === -1) ackFail(abortError())
            else ackDone()
          }
          const params = new URLSearchParams({
            tether_action: 'fs', request_id: id, fs_device: request.device || '',
            fs_method: request.method, fs_path: request.path,
            fs_seq: String(seq), fs_total: String(chunks.length)
          })
          if (request.query) params.set('fs_query', request.query)
          if (chunks[seq]) params.set('fs_chunk', chunks[seq])
          window.location.hash = params.toString()
        })
        const sendAll = async () => {
          if (!tetherFsPending.has(id)) throw abortError()
          if (!chunks.length) { await sendChunk(0); return }
          for (let seq = 0; seq < chunks.length; seq += 1) {
            if (!tetherFsPending.has(id)) throw abortError()
            await sendChunk(seq)
          }
        }
        const sending = tetherFsSendQueue.then(sendAll, sendAll)
        tetherFsSendQueue = sending.catch(() => {})
        sending.catch((error) => {
          if (entry.ack) entry.ack = null
          failRequest(error)
        })
        return result
      }
      window.fetch = function (input, init) {
        try {
          const raw = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : '')
          const parsed = new URL(raw, window.location.href)
          let suffix = ''
          let deviceId = ''
          if (raw && parsed.origin === window.location.origin && parsed.pathname.indexOf('/tether-device-fs/') === 0) {
            suffix = parsed.pathname.slice('/tether-device-fs'.length)
            deviceId = parsed.searchParams.get('device_id') || ''
          } else if (raw && (parsed.origin === 'http://127.0.0.1:18892' || parsed.origin === 'http://127.0.0.1:18890')) {
            // 新版插件在回环页把 surfaceOrigin 判成空串，会直连 18892/18890；
            // 这些请求同样绕不过跨源门，改为认领后走宿主中继。
            const match = parsed.pathname.match(/^\/api\/devices\/([^/]+)\/(drives|workspaces|fs\/[A-Za-z_]+)$/)
            if (match) { deviceId = decodeURIComponent(match[1]); suffix = '/' + match[2].replace(/^fs\//, '') }
          }
          let body = init ? init.body : undefined
          if (body !== undefined && body !== null && typeof body !== 'string') return tetherFetch(input, init)
          if (typeof body === 'string') {
            try {
              const value = JSON.parse(body)
              if (value && typeof value === 'object' && typeof value.device_id === 'string' && value.device_id) {
                deviceId = value.device_id
              }
            } catch (_) { /* keep the original body */ }
          }
          if (deviceId && tetherFsRoutes.indexOf(suffix) >= 0) {
            const method = String((init && init.method) || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
            return tetherFsRelay({ method, path: tetherDeviceSuffix(suffix), query: parsed.search || '',
              body: typeof body === 'string' ? body : undefined, device: deviceId },
            init && init.signal).then((reply) => new Response(
              reply.data === null || reply.data === undefined ? '' : JSON.stringify(reply.data),
              { status: reply.status, headers: { 'Content-Type': 'application/json' } }
            ))
          }
        } catch (_) { /* fall back to the untouched request */ }
        return tetherFetch(input, init)
      }
    }
    const tetherPickPending = new Map()
    let tetherPickListening = false
    const tetherPickMode = () => {
      try { if (window.parent && window.parent !== window) return 'iframe' } catch (_) { return 'iframe' }
      try { if (/Electron\//.test(navigator.userAgent || '')) return 'hash' } catch (_) { /* user agent is advisory */ }
      return ''
    }
    const onTetherPickResult = (event) => {
      const data = event && event.data
      if (!data || typeof data !== 'object' || data.type !== 'tether:pick-folder-result') return
      const id = String(data.id || '')
      const settle = tetherPickPending.get(id)
      if (!settle) return
      tetherPickPending.delete(id)
      const rawPaths = data.paths
      const rawPath = data.path
      const list = Array.isArray(rawPaths)
        ? rawPaths.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
        : (typeof rawPath === 'string' && rawPath.trim() ? [rawPath.trim()] : [])
      settle(list.length ? list : null)
    }
    const requestTetherHostPick = (options) => {
      const channel = tetherPickMode()
      if (!channel) return Promise.resolve(null)
      if (!tetherPickListening) {
        tetherPickListening = true
        window.addEventListener('message', onTetherPickResult)
      }
      const kind = options && options.kind === 'file' ? 'file' : 'folder'
      const multiple = !!(options && options.multiple)
      let id = ''
      try { id = crypto.randomUUID() } catch (_) { /* insecure context fallback below */ }
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
        })
      }
      return new Promise((resolve) => {
        // 宿主缺席（版本错配）时不让 DSH 的选择流程永久挂起。
        const timer = setTimeout(() => {
          if (!tetherPickPending.has(id)) return
          tetherPickPending.delete(id)
          resolve(null)
        }, 300000)
        tetherPickPending.set(id, (paths) => { clearTimeout(timer); resolve(paths) })
        if (channel === 'iframe') {
          try { window.parent.postMessage({ type: 'tether:pick-folder', id, kind, multiple }, '*') }
          catch (_) { clearTimeout(timer); tetherPickPending.delete(id); resolve(null) }
          return
        }
        const params = new URLSearchParams({ tether_action: 'pick_folder', request_id: id })
        if (kind === 'file') params.set('pick_kind', 'file')
        if (multiple) params.set('pick_multiple', '1')
        window.location.hash = params.toString()
      })
    }
    // 无渲染 directoryFlow occupant：owner（WorkspacePickFlow）负责 createWorkspace 与导航。
    const TetherHostDirectoryFlow = (props) => {
      const open = props.open
      const armed = React.useRef(false)
      const outcome = React.useRef(props)
      outcome.current = props
      const alive = React.useRef(true)
      React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
      React.useEffect(() => {
        if (!open) { armed.current = false; return }
        if (armed.current) return
        armed.current = true
        requestTetherHostPick({ kind: 'folder' }).then((paths) => {
          if (!alive.current) return
          const path = paths && paths.length ? paths[0] : null
          if (path === null) outcome.current.onCancel()
          else outcome.current.onPicked(path)
        }, (reason) => {
          if (!alive.current) return
          outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
        })
      }, [open])
      return null
    }
    // hero occupant：替换 WorkspacePicker（DSH 的工作区列表 Menu 外壳不再渲染）。
    // open 升起 → 宿主资源管理器 → createWorkspace 回填 → onPick 导航；取消/失败仅关闭。
    const TetherHostWorkspacePicker = (props) => {
      const open = props.open
      const armed = React.useRef(false)
      const outcome = React.useRef(props)
      outcome.current = props
      const alive = React.useRef(true)
      React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
      React.useEffect(() => {
        if (!open) { armed.current = false; return }
        if (armed.current) return
        armed.current = true
        requestTetherHostPick({ kind: 'folder' }).then((paths) => {
          if (!alive.current) return
          const path = paths && paths.length ? paths[0] : null
          if (path === null) { outcome.current.onClose(); return }
          const ui = ctx.uiWorkspace
          if (!ui || !ui.workspaces || typeof ui.workspaces.create !== 'function') {
            outcome.current.onClose()
            return
          }
          return ui.workspaces.create({ path }).then((workspace) => {
            if (alive.current) outcome.current.onPick(workspace.workspaceId)
          }, (reason) => {
            console.warn('tether host workspace create failed:', reason)
            if (alive.current) outcome.current.onClose()
          })
        }, () => { if (alive.current) outcome.current.onClose() })
      }, [open])
      return null
    }
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', priority: -1000, inject: () => ({}) }, TetherHostDirectoryFlow)
      yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', priority: -1000, inject: () => ({}) }, TetherHostDirectoryFlow)
    }))
    ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
      name: 'conversation.hero.workspace', priority: -1000, inject: () => ({})
    }, TetherHostWorkspacePicker))
    // 兜底：原生 pickDirectory 改道宿主，OS 原生对话框在 tether_native 内绝不弹出。
    try {
      const ui = ctx.uiWorkspace
      if (ui && typeof ui.pickDirectory === 'function') {
        ui.pickDirectory = async () => {
          const paths = await requestTetherHostPick({ kind: 'folder' })
          return paths && paths.length ? paths[0] : null
        }
      }
    } catch (_) { /* 服务缺席时槽位 occupant 仍生效 */ }
  }
} catch (_) { /* 桥接失败时保留 DSH 原生目录选择器 */ }