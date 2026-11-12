import { createTerminalDock } from './terminal-dock.js'
import { readCatalog, writeCatalog, readHarnesses, writeHarnesses } from './agent-cache.js'
import { writeAccount } from './agent-account-cache.js'

const HERDR_SUPPORTED_CODEG_TYPES = new Set([
  'codex', 'claude_code', 'gemini', 'open_code', 'cursor',
  'kimi_code', 'qwen_code', 'qoder'
])

export function createAgentsPage(props) {
  const { React, devices = [], localDevice = '', activeDevice = '' } = props
  const online = devices.filter((item) => item && item.online)
  const initial = activeDevice
    || (localDevice && online.some((item) => item.device_id === localDevice) ? localDevice : '')
    || (online[0] && online[0].device_id) || ''
  const [targets, setTargets] = React.useState(() => initial ? [initial] : [])
  React.useEffect(() => {
    if (activeDevice) setTargets((current) => current.includes(activeDevice) ? current : [...current, activeDevice])
  }, [activeDevice])
  const h = React.createElement
  const onTargetChange = (target) => {
    if (target) setTargets((current) => current.includes(target) ? current : [...current, target])
    if (props.onDeviceChange) props.onDeviceChange(target)
  }
  return h('div', { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0, position: 'relative' } },
    ...targets.map((target) => h('div', { key: target, style: { position: 'absolute', inset: 0, display: target === activeDevice || (!activeDevice && target === initial) ? 'flex' : 'none', minWidth: 0, minHeight: 0 } },
      h(AgentTargetPage, { ...props, initialDevice: target, activeDevice: target, onDeviceChange: onTargetChange }))))
}

function AgentTargetPage({ React, Glyph, post, C, host, devices = [], localDevice = '', activeDevice = '', initialDevice = '', onDeviceChange, onOpenWorkbench, onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const initial = initialDevice || activeDevice
    || (localDevice && online.some((item) => item.device_id === localDevice) ? localDevice : '')
    || (online[0] && online[0].device_id) || ''
  const device = initial
  const [harnesses, setHarnesses] = React.useState(() => readHarnesses(initial) || [])
  const [detecting, setDetecting] = React.useState(false)
  const [session, setSession] = React.useState('')
  const [items, setItems] = React.useState([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [agent, setAgent] = React.useState(null)
  const [models, setModels] = React.useState([])
  const [model, setModel] = React.useState('')
  const [commands, setCommands] = React.useState([])
  const [pending, setPending] = React.useState([])
  const [tabs, setTabs] = React.useState([])
  const [picking, setPicking] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [catalogOpen, setCatalogOpen] = React.useState(false)
  const [catalog, setCatalog] = React.useState(() => readCatalog(initial))
  const [catalogBusy, setCatalogBusy] = React.useState(false)
  const [catalogError, setCatalogError] = React.useState('')
  const [installing, setInstalling] = React.useState('')
  const [herdrAvailable, setHerdrAvailable] = React.useState(true)
  const [panes, setPanes] = React.useState([])
  const [activePane, setActivePane] = React.useState('')
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false)
  const [homeOpen, setHomeOpen] = React.useState(false)
  const [homeError, setHomeError] = React.useState('')
  const [homeRetry, setHomeRetry] = React.useState(0)
  const [serviceCatalog, setServiceCatalog] = React.useState(null)
  const [serviceCatalogBusy, setServiceCatalogBusy] = React.useState(false)
  const [serviceOpening, setServiceOpening] = React.useState(false)
  const [serviceView, setServiceView] = React.useState(null)
  const [serviceFrameState, setServiceFrameState] = React.useState('loading')
  const serviceWebviewRef = React.useRef(null)
  const handledAgentLaunchRequests = React.useRef(new Set())
  const [workbenchLoginRequired, setWorkbenchLoginRequired] = React.useState(false)
  const [workbenchLoginBusy, setWorkbenchLoginBusy] = React.useState(false)
  const [cwd, setCwd] = React.useState('')
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const tabCache = React.useRef({})
  const transcriptRef = React.useRef(null)
  const modelRef = React.useRef(null)
  const prefetchedAccounts = React.useRef('')

  const updateTab = (id, patch) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  const saveTab = () => {
    const id = sessionRef.current
    if (!id) return
    tabCache.current[id] = { items, ready, agent, models, model, commands, pending, cwd, since: since.current }
  }
  const loadTab = (id) => {
    const cached = tabCache.current[id] || {}
    sessionRef.current = id
    setSession(id)
    setItems(cached.items || [])
    setReady(!!cached.ready)
    setAgent(cached.agent || null)
    setModels(cached.models || [])
    setModel(cached.model || '')
    setCommands(cached.commands || [])
    setPending(cached.pending || [])
    setCwd(cached.cwd || '')
    setInput('')
    setModelOpen(false)
    since.current = Number(cached.since) || 0
    setPicking(false)
  }
  const clearSession = () => {
    sessionRef.current = ''
    setSession('')
    setReady(false)
    setAgent(null)
    setModels([])
    setModel('')
    setCommands([])
    setPending([])
    setItems([])
    setCwd('')
    setInput('')
    setModelOpen(false)
    since.current = 0
  }
  const addItem = (item) => setItems((current) => [...current, { at: Date.now(), ...item }])
  const appendAssistant = (text) => setItems((current) => {
    const last = current[current.length - 1]
    if (last && last.kind === 'assistant' && last.streaming) {
      return [...current.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...current, { kind: 'assistant', text, streaming: true, at: Date.now() }]
  })
  const appendThought = (text) => setItems((current) => {
    const last = current[current.length - 1]
    if (last && last.kind === 'thought' && last.streaming) {
      return [...current.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...current, { kind: 'thought', text, streaming: true, at: Date.now() }]
  })
  const finishStreaming = () => setItems((current) => {
    let next = current
    const last = next[next.length - 1]
    if (last && last.kind === 'assistant' && last.streaming) {
      next = [...next.slice(0, -1), { ...last, streaming: false }]
    }
    const tail = next[next.length - 1]
    if (tail && tail.kind === 'thought' && tail.streaming) {
      next = [...next.slice(0, -1), { ...tail, streaming: false }]
    }
    return next
  })

  const fail = (error) => {
    const message = String((error && error.message) || error || 'Agents 操作失败')
    finishStreaming()
    addItem({ kind: 'error', text: message })
    if (onError) onError(error)
  }

  const detect = async (id) => {
    if (!id) return
    const cached = readHarnesses(id)
    if (cached) setHarnesses(cached)
    else setDetecting(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(id) + '/fs/acp_detect', {})
      const list = Array.isArray(result && result.harnesses) ? result.harnesses : []
      setHarnesses(list)
      writeHarnesses(id, list)
    } catch (error) {
      if (!cached) setHarnesses([])
      fail(error)
    } finally {
      setDetecting(false)
    }
  }

  const loadCatalog = async (force) => {
    if (!device) return
    const cached = readCatalog(device)
    if (cached) setCatalog(cached)
    else setCatalogBusy(true)
    setCatalogError('')
    try {
      let result = null
      try {
        result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog',
          { fresh: force === true })
      } catch (_) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog',
          { fresh: false })
      }
      if (result) {
        setCatalog(result)
        writeCatalog(device, result)
      }
    } catch (error) {
      if (!cached) setCatalogError(String((error && (error.message || error.code)) || '读取失败'))
    } finally {
      setCatalogBusy(false)
    }
  }

  React.useEffect(() => { void detect(device) }, [device])
  React.useEffect(() => { void loadCatalog(false) }, [device])
  React.useEffect(() => {
    let cancelled = false
    if (!device) return undefined
    void post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_shells', {})
      .then((result) => {
        if (cancelled) return
        const list = (result && Array.isArray(result.shells) ? result.shells : [])
        setHerdrAvailable(list.some((item) => item.id === 'herdr' && item.available))
      })
      .catch(() => { if (!cancelled) setHerdrAvailable(false) })
    return () => { cancelled = true }
  }, [device])

  React.useEffect(() => {
    if (!modelOpen) return undefined
    const close = (event) => {
      if (modelRef.current && !modelRef.current.contains(event.target)) setModelOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [modelOpen])

  React.useEffect(() => {
    if (!device || !catalog) return
    const agents = (catalog.agents || []).filter((item) => item && item.available && item.accounts)
    if (!agents.length) return
    const key = device + ':' + agents.map((item) => item.id).join(',')
    if (prefetchedAccounts.current === key) return
    prefetchedAccounts.current = key
    for (const item of agents.slice(0, 8)) {
      void post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_accounts', { id: item.id, fresh: false })
        .then((result) => { if (result) writeAccount(device, item.id, result) })
        .catch(() => {})
    }
  }, [device, catalog])

  const closeTab = async (id) => {
    if (!id) return
    const remaining = tabs.filter((tab) => tab.id !== id)
    delete tabCache.current[id]
    setTabs(remaining)
    if (sessionRef.current === id) {
      if (remaining.length) loadTab(remaining[remaining.length - 1].id)
      else { clearSession(); setHomeOpen(true) }
    }
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id })
    } catch (_) { /* node may have already closed the session */ }
  }

  const stop = async () => { await closeTab(sessionRef.current) }

  const selectTab = (id) => {
    if (!id) return
    setHomeOpen(false)
    if (id === sessionRef.current) return
    saveTab()
    loadTab(id)
  }

  const start = async (item) => {
    if (!item || busy) return
    saveTab()
    setBusy(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_start',
        { harness: item.id })
      if (!result || typeof result.session_id !== 'string') throw new Error('Agent 没有返回会话标识')
      const name = item.name || item.id
      sessionRef.current = result.session_id
      since.current = 0
      setPending([])
      setReady(false)
      setAgent(null)
      setModels([])
      setModel('')
      setCommands([])
      setSession(result.session_id)
      setCwd(result.cwd || '')
      setHomeOpen(false)
      setInput('')
      setPicking(false)
      setModelOpen(false)
      setItems([
        { kind: 'system', text: '正在启动 ' + name + '…' },
        ...(result.cwd ? [{ kind: 'system', text: result.cwd }] : [])
      ])
      setTabs((current) => [...current, { id: result.session_id, name, harness: item.id, status: 'starting' }])
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const send = async (event) => {
    if (event) event.preventDefault()
    const text = input
    if (!session || !text.trim()) return
    setInput('')
    finishStreaming()
    addItem({ kind: 'user', text })
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_prompt', {
        session_id: session, text
      })
    } catch (error) {
      fail(error)
    }
  }

  const reply = async (requestId, optionId) => {
    if (!session) return
    setPending((current) => current.filter((item) => item.requestId !== requestId))
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_reply', {
        session_id: session, request_id: requestId,
        outcome: { outcome: 'selected', optionId }
      })
    } catch (error) {
      fail(error)
    }
  }

  const changeModel = async (modelId) => {
    if (!session || !modelId) return
    setModel(modelId)
    setModelOpen(false)
    finishStreaming()
    const label = (models.find((item) => item.modelId === modelId) || {}).name || modelId
    addItem({ kind: 'system', text: '模型切换为 ' + label })
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_set_model', {
        session_id: session, model: modelId
      })
    } catch (error) {
      fail(error)
    }
  }

  React.useEffect(() => {
    if (!session) return undefined
    let disposed = false
    let inFlight = false
    const tick = async () => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_poll',
          { session_id: session, since: since.current })
        if (disposed || !result) return
        since.current = Number(result.next) || since.current
        for (const item of result.events || []) {
          const event = item.event || {}
          if (event.type === 'notification' && event.method === 'session/update') {
            const update = (event.params && event.params.update) || {}
            const content = update.content || {}
            if (update.sessionUpdate === 'agent_message_chunk' && content.type === 'text') {
              appendAssistant(content.text)
            } else if (update.sessionUpdate === 'agent_thought_chunk' && content.type === 'text') {
              appendThought(content.text)
            } else if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
              setCommands(update.availableCommands.filter((entry) => entry && entry.name).slice(0, 12))
            } else if (update.sessionUpdate === 'tool_call') {
              finishStreaming()
              addItem({ kind: 'tool', id: update.toolCallId, title: update.title || '工具调用',
                status: update.status || 'running', detail: toolDetail(update) })
            } else if (update.sessionUpdate === 'tool_call_update') {
              setItems((current) => current.map((item) => item.kind === 'tool' && item.id === update.toolCallId
                ? { ...item, status: update.status || item.status, title: update.title || item.title,
                    detail: toolDetail(update) || item.detail }
                : item))
            } else if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
              finishStreaming()
              addItem({ kind: 'plan', entries: update.entries.map((entry) => entry.content || entry.title || '').filter(Boolean) })
            }
          } else if (event.type === 'request' && event.method === 'session/request_permission') {
            finishStreaming()
            const params = event.params || {}
            const title = (params.toolCall && params.toolCall.title) || '工具调用'
            const options = Array.isArray(params.options) ? params.options : []
            setPending((current) => current.some((entry) => entry.requestId === event.id) ? current
              : [...current, { requestId: event.id, title, options }])
          } else if (event.type === 'ready') {
            finishStreaming()
            setReady(true)
            setAgent(event.agent || null)
            const available = (event.models && event.models.availableModels) || []
            setModels(available)
            setModel((event.models && (event.models.currentModelId || event.models.currentModel)) || (available[0] && available[0].modelId) || '')
            const label = event.agent && (event.agent.title || event.agent.name)
            updateTab(session, label ? { status: 'ready', name: label } : { status: 'ready' })
            const readyText = '已连接' + (label ? ' · ' + label : '')
            setItems((current) => {
              const index = current.findIndex((item) => item.kind === 'system' && String(item.text || '').startsWith('正在启动'))
              if (index < 0) return [...current, { kind: 'system', text: readyText }]
              const next = current.slice()
              next[index] = { ...next[index], text: readyText }
              return next
            })
          } else if (event.type === 'result') {
            finishStreaming()
            addItem({ kind: 'system', text: '本轮完成 · ' + ((event.result && event.result.stopReason) || 'done') })
          } else if (event.type === 'error') {
            finishStreaming()
            setReady(false)
            updateTab(session, { status: 'error' })
            addItem({ kind: 'error', text: String(event.error || 'ACP error') })
          } else if (event.type === 'closed') {
            finishStreaming()
            updateTab(session, { status: 'ended' })
            setReady(false)
            addItem({ kind: 'system', text: '会话结束' })
          }
        }
        if (result.closed && sessionRef.current === session) {
          setReady(false)
          updateTab(session, { status: 'ended' })
        }
      } catch (error) {
        if (!disposed) fail(error)
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, 250)
    void tick()
    return () => { disposed = true; clearInterval(timer) }
  }, [session, device])

  React.useEffect(() => {
    if (session) tabCache.current[session] = { items, ready, agent, models, model, commands, pending, since: since.current }
  }, [session, items, ready, agent, models, model, commands, pending])

  React.useEffect(() => {
    const node = transcriptRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [items])

  const selectDevice = async (value) => {
    if (onDeviceChange) onDeviceChange(value)
  }

  const addPane = (pane) => {
    setPanes((current) => current.some((item) => item.key === pane.key) ? current : [...current, pane])
    setActivePane(pane.key)
    setWorkspaceOpen(true)
  }

  const closePane = (key) => {
    if (key === 'codeg:home') return
    setPanes((current) => {
      const next = current.filter((item) => item.key !== key)
      setActivePane((active) => active === key ? ((next[next.length - 1] || {}).key || '') : active)
      if (!next.length) setWorkspaceOpen(false)
      return next
    })
  }

  const openTerminal = (agent) => {
    addPane({ key: 'term:' + agent.id, kind: 'terminal', agentId: agent.id,
      title: agent.name, icon: agent.icon, color: agent.color, dark: true })
  }

  const openLogin = (agent, command, argv) => {
    if (!agent || (!command && !(Array.isArray(argv) && argv.length))) return
    addPane({ key: 'login:' + agent.id, kind: 'terminal', title: '登录 ' + agent.name,
      icon: agent.icon, dark: true, initialCommand: command, initialArgv: argv })
  }

  const openHerdr = (projectCwd = '', codegAgentType = '') => {
    if (!herdrAvailable) { setHomeError('此节点没有 Herdr'); return }
    if (!HERDR_SUPPORTED_CODEG_TYPES.has(codegAgentType)) {
      setHomeError('Herdr 暂不支持所选 Agent 类型'); return
    }
    const cwd = typeof projectCwd === 'string' && projectCwd.length <= 4096 && !projectCwd.includes('\0')
      ? projectCwd.trim() : ''
    if (!cwd) { setHomeError('打开 Herdr 前请先选择项目'); return }
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    const key = 'herdr:' + normalizedCwd + ':' + codegAgentType
    setHomeError('')
    addPane({ key, kind: 'terminal', shell: 'herdr', cwd, herdrProject: true,
      herdrAgentType: codegAgentType, targetId: device,
      title: 'Herdr · ' + codegAgentType, icon: 'bot', dark: true })
  }

  const openRuntimeCli = (projectCwd = '', codegAgentType = '') => {
    const cwd = typeof projectCwd === 'string' && projectCwd.length <= 4096 && !projectCwd.includes('\0')
      ? projectCwd.trim() : ''
    if (!cwd || !codegAgentType) { setHomeError('打开终端前请先选择项目和 Agent'); return }
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    const key = 'cli:' + device + ':' + normalizedCwd + ':' + codegAgentType
    setHomeError('')
    addPane({ key, kind: 'terminal', cwd, runtimeAgentType: codegAgentType,
      targetId: device, title: codegAgentType + ' CLI', icon: 'bot', dark: true })
  }

  React.useEffect(() => {
    const onMessage = (event) => {
      const data = event && event.data
      const frame = runtimeFrame.current
      const pane = panes.find((item) => item.key === 'codeg:home')
      let origin = ''
      try { origin = new URL(pane && pane.url).origin } catch (_) { /* no active Codeg frame */ }
      if (!event || !frame || event.source !== frame.contentWindow || !origin || event.origin !== origin) return
      if (data && data.type === 'tether:open-herdr') openHerdr(data.cwd, data.agent_type)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [herdrAvailable, device, panes])

  const openWeb = async (agent) => {
    const key = 'web:' + agent.id
    addPane({ key, kind: 'web', url: '', title: agent.name + ' Web', icon: agent.icon, color: agent.color })
    const base = '/api/devices/' + encodeURIComponent(device) + '/fs/'
    try {
      let result = null
      try { result = await post(base + 'opencode_status', {}) } catch (_) { /* node without the op */ }
      if (!result || !result.running || !result.url) result = await post(base + 'opencode_start', {})
      if (!result || !result.running || !result.url) throw new Error('OpenCode 没有返回可嵌入地址')
      const url = String(result.url)
      setPanes((current) => current.map((pane) => pane.key === key ? { ...pane, url } : pane))
    } catch (error) {
      setPanes((current) => current.filter((pane) => pane.key !== key))
      setActivePane((current) => current === key ? '' : current)
      fail(error)
    }
  }

  const homeOpenedRef = React.useRef('')
  const runtimeRequests = React.useRef(new Map())
  const runtimeFrame = React.useRef(null)
  const getAgentsRuntime = (target, allowRetry = false, statusOnly = false) => {
    const requestKey = target + (statusOnly ? ':status' : ':init')
    if (runtimeRequests.current.has(requestKey)) return runtimeRequests.current.get(requestKey)
    const request = (async () => {
      const base = '/api/devices/' + encodeURIComponent(target) + '/fs/'
      let result = null
      try { result = await post(base + 'agents_runtime_status', {}) } catch (_) { /* node may need a start */ }
      if (result && result.running && result.url) return result
      if (result && result.running && !result.url) {
        if (statusOnly) return result
        throw new Error('设备网络或应用连接尚未就绪，请恢复后重试。')
      }
      if (statusOnly) return result
      if (result && result.install_error && !allowRetry) throw new Error('Agents runtime 安装失败：' + result.install_error + '。重新打开 Agents 可重试。')
      if (!result || result.install_error || !result.installing) result = await post(base + 'agents_runtime_start', {})
      const deadline = Date.now() + 5 * 60 * 1000
      while (Date.now() < deadline) {
        if (result && result.running && result.url) return result
        if (result && result.running && !result.url) throw new Error('设备网络或应用连接尚未就绪，请恢复后重试。')
        if (result && result.install_error) throw new Error('Agents runtime 安装失败：' + result.install_error + '。重新打开 Agents 可重试。')
        await new Promise((resolve) => setTimeout(resolve, 2500))
        result = await post(base + 'agents_runtime_status', {})
      }
      throw new Error('Agents runtime 下载或启动超时（5 分钟）。重新打开 Agents 可重试。')
    })()
    runtimeRequests.current.set(requestKey, request)
    request.finally(() => {
      if (runtimeRequests.current.get(requestKey) === request) runtimeRequests.current.delete(requestKey)
    }).catch(() => {})
    return request
  }
  React.useEffect(() => {
    if (!device || catalogOpen) return undefined
    if (homeOpenedRef.current === device) return undefined
    homeOpenedRef.current = device
    let alive = true
    if (host && host.kind === 'app' && host.workbench) {
      setServiceCatalogBusy(true)
      void host.workbench.catalog(device).then((result) => {
        if (!alive) return
        setServiceCatalog(result)
        setHomeError('')
      }).catch((error) => {
        if (alive) {
          if (error && (error.status === 401 || error.status === 403 || error.code === 'auth_required'
            || error.code === 'oidc_identity_unbound')) setWorkbenchLoginRequired(true)
          setHomeError(String((error && error.message) || error || '服务目录暂不可用。'))
        }
      }).finally(() => {
        if (alive) setServiceCatalogBusy(false)
      })
      return () => { alive = false }
    }
    const openHome = async () => {
      try {
        const result = await getAgentsRuntime(device, true)
        if (!result || !result.running || !result.url) throw new Error('设备网络或应用连接尚未就绪，请恢复后重试。')
        const url = String(result.url)
        if (!alive) return
        setHomeError('')
        setPanes((current) => current.some((pane) => pane.key === 'codeg:home')
          ? current
          : [...current, { key: 'codeg:home', kind: 'web', title: '主页', url: url + (url.includes('?') ? '&' : '?') + 'next=' + encodeURIComponent('/workspace?tether_home=1') }])
        setActivePane((current) => current || 'codeg:home')
        setWorkspaceOpen(true)
      } catch (error) {
        if (alive) {
          homeOpenedRef.current = ''
          setHomeError(String((error && error.message) || error || 'Agent 主页暂不可用。'))
        }
      }
    }
    void openHome()
    return () => { alive = false }
  }, [device, catalogOpen, homeRetry])

  React.useEffect(() => {
    if (!device || catalogOpen || (host && host.kind === 'app' && host.workbench)) return undefined
    let alive = true
    let timer = null
    const check = async () => {
      try {
        const result = await getAgentsRuntime(device, false, true)
        if (result && result.running && result.url && alive) {
          const nextUrl = String(result.url)
          setHomeError('')
          setPanes((current) => {
            const pane = current.find((item) => item.key === 'codeg:home')
            const homeUrl = nextUrl + (nextUrl.includes('?') ? '&' : '?') + 'next=' + encodeURIComponent('/workspace?tether_home=1')
            if (!pane) return [...current, { key: 'codeg:home', kind: 'web', title: '主页', url: homeUrl }]
            if (!pane.url) return current.map((item) => item.key === 'codeg:home' ? { ...item, url: homeUrl } : item)
            const withoutNext = (value) => {
              try { const parsed = new URL(value); parsed.searchParams.delete('next'); return parsed.href }
              catch (_) { return '' }
            }
            if (!withoutNext(nextUrl) || withoutNext(pane.url) === withoutNext(nextUrl)) return current
            return current.map((item) => item.key === 'codeg:home'
              ? { ...item, url: homeUrl }
              : item)
          })
          setActivePane((current) => current || 'codeg:home')
          setWorkspaceOpen(true)
        }
      } catch (_) { /* node is restarting; the next tick retries */ }
      if (alive) timer = setTimeout(check, 5000)
    }
    timer = setTimeout(check, 5000)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [device, catalogOpen])

  const retryAgentsHome = () => {
    homeOpenedRef.current = ''
    setHomeError('')
    setServiceCatalog(null)
    setHomeRetry((current) => current + 1)
  }

  const openNativeCodeg = async () => {
    if (!device || serviceOpening || !host || !host.workbench) return
    const legacyCodeg = serviceCatalog && serviceCatalog.legacy === true
    const catalogCodeg = serviceCatalog && serviceCatalog.services
      ? serviceCatalog.services.find((service) => service.id === 'codeg') : null
    if (legacyCodeg && (!catalogCodeg || !['ready', 'stopped'].includes(catalogCodeg.state)
        || (catalogCodeg.state === 'ready' && catalogCodeg.open_mode !== 'legacy-codeg')
        || typeof host.workbench.openLegacyCodeg !== 'function')) return
    setServiceOpening(true)
    setHomeError('')
    try {
      if (legacyCodeg) {
        const runtime = await getAgentsRuntime(device, true)
        if (!runtime || runtime.running !== true || !runtime.url) throw new Error('Codeg 未能启动并通过就绪检查。')
      }
      const service = legacyCodeg
        ? await host.workbench.openLegacyCodeg(device)
        : await host.workbench.open(device, 'codeg')
      if (!service || service.targetId !== device || service.serviceId !== 'codeg' || !service.endpoint || !service.partition) {
        throw new Error('主进程没有返回有效的 Codeg 工作台会话。')
      }
      const homeService = { ...service, endpoint: new URL('/workspace?tether_home=1', service.endpoint).href }
      setServiceView(homeService)
      setPanes((current) => current.some((pane) => pane.key === 'codeg:home')
        ? current.map((pane) => pane.key === 'codeg:home' ? { ...pane, kind: 'native-service', service: homeService } : pane)
        : [...current, { key: 'codeg:home', kind: 'native-service', title: 'Codeg', service: homeService }])
      setActivePane('codeg:home')
      setWorkspaceOpen(true)
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403 || error.code === 'auth_required'
        || error.code === 'oidc_identity_unbound')) setWorkbenchLoginRequired(true)
      setHomeError(String((error && error.message) || error || 'Codeg 工作台无法打开。'))
      homeOpenedRef.current = ''
      setServiceCatalog(null)
    } finally {
      setServiceOpening(false)
    }
  }

  const openNativeDesktop = async () => {
    if (!device || serviceOpening || !host || !host.workbench || !desktopService
        || !['ready', 'stopped'].includes(desktopService.state)) return
    setServiceOpening(true)
    setHomeError('')
    try {
      const service = await host.workbench.open(device, 'desktop')
      if (!service || service.targetId !== device || service.serviceId !== 'desktop'
          || !service.endpoint || !service.partition) {
        throw new Error('主进程没有返回有效的目标远程桌面会话。')
      }
      setServiceView({ ...service, paneKey: 'remote-desktop' })
      setPanes((current) => current.some((pane) => pane.key === 'remote-desktop')
        ? current.map((pane) => pane.key === 'remote-desktop' ? { ...pane, kind: 'native-service', service } : pane)
        : [...current, { key: 'remote-desktop', kind: 'native-service', title: '远程桌面', service }])
      setActivePane('remote-desktop')
      setWorkspaceOpen(true)
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403 || error.code === 'auth_required'
        || error.code === 'oidc_identity_unbound')) setWorkbenchLoginRequired(true)
      setHomeError(String((error && error.message) || error || '目标远程桌面无法打开。'))
      setServiceCatalog(null)
    } finally {
      setServiceOpening(false)
    }
  }

  const startWorkbenchLogin = async () => {
    if (!host || !host.workbench || !host.workbench.login || workbenchLoginBusy) return
    setWorkbenchLoginBusy(true)
    setHomeError('')
    try {
      const result = await host.workbench.login()
      if (result && result.ok === false) throw new Error(result.error || '无法打开主进程登录窗口。')
    } catch (error) {
      setWorkbenchLoginBusy(false)
      setHomeError(String((error && error.message) || error || '无法打开主进程登录窗口。'))
    }
  }

  React.useEffect(() => {
    if (!host || !host.workbench || !host.workbench.onLoginResult) return undefined
    return host.workbench.onLoginResult((result) => {
      setWorkbenchLoginBusy(false)
      if (result && result.state === 'authenticated') {
        setWorkbenchLoginRequired(false)
        setServiceCatalog(null)
        setHomeError('')
        homeOpenedRef.current = ''
        setHomeRetry((current) => current + 1)
      }
    })
  }, [host])

  const closeNativeDesktop = async () => {
    if (!serviceView || serviceView.serviceId !== 'desktop' || !host || !host.workbench) return
    try {
      await host.workbench.close(device, 'desktop', serviceView.grantId)
      setPanes((current) => current.filter((pane) => pane.key !== 'remote-desktop'))
      setServiceView(null)
      setActivePane('')
      setWorkspaceOpen(false)
      setServiceCatalog(null)
    } catch (error) {
      setHomeError(String((error && error.message) || error || '远程桌面授权撤销失败。'))
    }
  }

  React.useEffect(() => {
    if (!serviceView || !host || !host.workbench) return undefined
    void host.workbench.view(device, serviceView.serviceId, true).catch((error) => {
      setHomeError(String((error && error.message) || error || '原生目标视图连接失败。'))
    })
  }, [serviceView, device, host])

  React.useEffect(() => {
    const guest = serviceWebviewRef.current
    if (!serviceView || !guest || typeof guest.addEventListener !== 'function') return undefined
    setServiceFrameState('loading')
    const onStart = (event) => { if (event.isMainFrame && !event.isInPlace) setServiceFrameState('loading') }
    const onFinish = () => setServiceFrameState('ready')
    const onFail = (event) => {
      if (event.isMainFrame && event.errorCode !== -3) setServiceFrameState('error')
    }
    guest.addEventListener('did-start-navigation', onStart)
    guest.addEventListener('did-finish-load', onFinish)
    guest.addEventListener('did-fail-load', onFail)
    try {
      const currentOrigin = new URL(guest.getURL()).origin
      const endpointOrigin = new URL(serviceView.endpoint).origin
      if (currentOrigin === endpointOrigin
          && typeof guest.isLoadingMainFrame === 'function' && !guest.isLoadingMainFrame()) {
        setServiceFrameState('ready')
      }
    } catch (_) { /* guest may not be attached yet */ }
    return () => {
      guest.removeEventListener('did-start-navigation', onStart)
      guest.removeEventListener('did-finish-load', onFinish)
      guest.removeEventListener('did-fail-load', onFail)
    }
  }, [serviceView && serviceView.endpoint])

  React.useEffect(() => {
    const guest = serviceWebviewRef.current
    if (!serviceView || serviceView.serviceId !== 'codeg'
        || serviceView.targetId !== device || !guest
        || typeof guest.addEventListener !== 'function') return undefined
    const onInPageNavigation = (event) => {
      if (!event || event.isMainFrame !== true || typeof event.url !== 'string') return
      let actionUrl
      try {
        actionUrl = new URL(event.url)
        if (actionUrl.origin !== new URL(serviceView.endpoint).origin) return
      } catch (_) { return }
      const params = new URLSearchParams(actionUrl.hash.slice(1))
      const action = params.get('tether_action')
      if (action !== 'open_herdr' && action !== 'open_cli') return
      const requestIds = params.getAll('request_id')
      const agentTypes = params.getAll('agent_type')
      const cwds = params.getAll('cwd')
      const requestId = requestIds[0] || ''
      const codegAgentType = agentTypes[0] || ''
      const cwd = cwds[0] || ''
      const actionKeys = Array.from(params.keys()).sort().join(',')
      const fixedAction = requestIds.length === 1 && agentTypes.length === 1
        && cwds.length === 1 && actionKeys === 'agent_type,cwd,request_id,tether_action'
        && params.getAll('tether_action').length === 1
        && /^[0-9a-f-]{36}$/i.test(requestId)
        && cwd.length > 0 && cwd.length <= 4096 && !cwd.includes('\0')
      if (fixedAction && !handledAgentLaunchRequests.current.has(requestId)) {
        handledAgentLaunchRequests.current.add(requestId)
        if (handledAgentLaunchRequests.current.size > 128) {
          handledAgentLaunchRequests.current.delete(handledAgentLaunchRequests.current.values().next().value)
        }
        if (action === 'open_herdr') openHerdr(cwd, codegAgentType)
        else openRuntimeCli(cwd, codegAgentType)
      }
      // The action is a same-document hash only. Clear it with a fixed script;
      // never interpolate the path or Agent value into guest JavaScript.
      if (typeof guest.executeJavaScript === 'function') {
        void guest.executeJavaScript(
          "history.replaceState(history.state, '', location.pathname + location.search)"
        ).catch(() => {})
      }
    }
    guest.addEventListener('did-navigate-in-page', onInPageNavigation)
    return () => guest.removeEventListener('did-navigate-in-page', onInPageNavigation)
  }, [serviceView && serviceView.endpoint, serviceView && serviceView.targetId,
    serviceView && serviceView.serviceId, device, herdrAvailable])

  const installAgent = async (agent) => {
    if (!device || installing) return
    setInstalling(agent.id)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_install', { id: agent.id })
      if (result && result.catalog) setCatalog(result.catalog)
      if (result && result.action === 'manual') {
        throw new Error((result.message || '需要官方安装器') + (result.url ? '：' + result.url : ''))
      }
    } catch (error) {
      fail(error)
    } finally {
      setInstalling('')
    }
  }

  const openAgent = (agent, surface, harness) => {
    if (surface === 'workbench') { if (onOpenWorkbench) onOpenWorkbench(); return }
    if (surface === 'web') { void openWeb(agent); return }
    if (surface === 'acp' && harness) { setHomeOpen(false); void start(harness); setWorkspaceOpen(false); return }
    openTerminal(agent)
  }

  const field = {
    height: 28, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const toolDetail = (update) => {
    const parts = []
    const content = update && update.content
    if (Array.isArray(content)) {
      for (const entry of content) {
        if (!entry || typeof entry !== 'object') continue
        if (entry.type === 'text' && entry.text) parts.push(entry.text)
        else if (entry.type === 'content' && entry.content && entry.content.text) parts.push(entry.content.text)
      }
    } else if (content && typeof content === 'object' && content.text) {
      parts.push(content.text)
    }
    if (update && update.rawInput) {
      try { parts.push(JSON.stringify(update.rawInput, null, 2)) } catch (_) {}
    }
    return parts.join(String.fromCharCode(10)).slice(0, 4000)
  }

  const button = {
    height: 28, padding: '0 14px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const nativeWorkbench = host && host.kind === 'app' && host.workbench
  const codegService = serviceCatalog && serviceCatalog.services
    ? serviceCatalog.services.find((service) => service.id === 'codeg') : null
  const desktopService = serviceCatalog && serviceCatalog.services
    ? serviceCatalog.services.find((service) => service.id === 'desktop') : null
  const serviceStateLabel = { missing: '未安装', stopped: '已停止', starting: '启动中', ready: '已就绪', failed: '启动失败' }
  const codegUnavailableLabel = codegService && codegService.reason_code === 'bad_op'
    ? '升级节点后可用'
    : codegService && codegService.reason_code === 'device_not_found' ? '目标节点未连接' : '服务不可用'
  const legacyCodegBlocked = !!(serviceCatalog && serviceCatalog.legacy === true
    && (!codegService || !['ready', 'stopped'].includes(codegService.state)
      || (codegService.state === 'ready' && codegService.open_mode !== 'legacy-codeg')))
  const legacyCodegLabel = codegService && codegService.state === 'missing' ? 'Codeg 未安装'
    : codegService && codegService.state === 'stopped' ? 'Codeg 未运行'
      : 'Codeg 状态异常'

  const paneBody = (pane) => pane.kind === 'web'
    ? (pane.url ? h('iframe', {
      key: pane.key, title: pane.title, src: pane.url,
      ref: pane.key === 'codeg:home' ? runtimeFrame : undefined,
      style: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' },
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads'
    }) : h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12, background: C.bg } },
      '正在启动 ' + pane.title + '…'))
    : pane.kind === 'native-service'
      ? h('div', { style: { flex: '1 1 auto', minHeight: 0, minWidth: 0, position: 'relative', display: 'flex' } },
        h('webview', { key: pane.key, ref: serviceWebviewRef, title: pane.title, src: pane.service.endpoint, partition: pane.service.partition,
          style: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' } }),
        serviceFrameState === 'loading' ? h('div', { role: 'status', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,.94)', color: C.sub, fontSize: 13, pointerEvents: 'none' } }, '正在连接目标 ' + pane.title + '…') : null,
        serviceFrameState === 'error' ? h('div', { role: 'alert', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          alignContent: 'center', gap: 10, padding: 24, background: C.bg, color: C.sub, fontSize: 13, textAlign: 'center' } },
          h('span', null, '目标 ' + pane.title + ' 页面连接失败。请检查设备连接后重试。'),
          h('button', { type: 'button', onClick: () => { setServiceFrameState('loading'); serviceWebviewRef.current?.reload?.() }, style: button }, '重试')) : null)
    : h(createTerminalDock, {
      key: pane.key, React, Glyph, post, C, device: pane.targetId || device, cwd: pane.cwd || '',
      initialAgent: pane.agentId || '', initialShell: pane.shell || '', initialHerdrProject: pane.herdrProject || false,
      initialHerdrAgentType: pane.herdrAgentType || '',
      initialRuntimeAgentType: pane.runtimeAgentType || '',
      initialCommand: pane.initialCommand || '', initialArgv: pane.initialArgv || null, label: pane.title,
      themeMode: 'dark', fill: true,
      height: Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 900) - 168),
      onClose: () => closePane(pane.key)
    })
  const showWorkspaceHeader = !!activePane && (activePane !== 'codeg:home' || serviceView && serviceView.serviceId === 'desktop')
  const workspace = panes.length ? h('div', {
    key: 'workspace',
    style: { flex: '1 1 auto', minHeight: 0, display: workspaceOpen ? 'flex' : 'none', flexDirection: 'column', background: C.bg }
  },
    showWorkspaceHeader ? h('div', { style: { display: 'flex', alignItems: 'center', height: 42, flex: '0 0 42px', padding: '0 12px', borderBottom: '1px solid ' + C.line } },
      activePane && activePane !== 'codeg:home' ? h('button', {
        key: 'back-to-codeg', type: 'button',
        onClick: () => {
          if (panes.some((pane) => pane.key === 'codeg:home')) setActivePane('codeg:home')
          else { setWorkspaceOpen(false); setActivePane('') }
        },
        style: { height: 28, padding: '0 10px', border: '1px solid ' + C.line, borderRadius: 8, background: C.bg,
          color: C.ink, fontSize: 11.5, cursor: 'pointer' }
      }, panes.some((pane) => pane.key === 'codeg:home') ? '← 返回 Codeg' : '← 返回 Agent 主页') : null,
      serviceView && serviceView.serviceId === 'desktop' && activePane === (serviceView.paneKey || 'codeg:home')
        ? h('div', { role: 'status', style: { marginLeft: 'auto', color: C.sub, fontSize: 11.5 } },
          serviceView.viewOnly ? '只读视图' + (serviceView.viewOnlyReason ? ' · ' + serviceView.viewOnlyReason : '')
            : serviceView.consent === 'none' ? '已启用无人值守授权' : '等待目标用户确认',
          Number.isFinite(serviceView.nativeSessionExpiresAt) ? ' · 会话最晚 ' + new Date(serviceView.nativeSessionExpiresAt).toLocaleString() + ' 结束' : '') : null,
      serviceView && serviceView.serviceId === 'desktop' && activePane === (serviceView.paneKey || 'codeg:home') ? h('button', { type: 'button', onClick: () => void closeNativeDesktop(),
        style: { marginLeft: serviceView.serviceId === 'desktop' ? 10 : 'auto', height: 28, padding: '0 10px', border: '1px solid ' + C.line, borderRadius: 8,
          background: C.bg, color: C.sub, fontSize: 11.5, cursor: 'pointer' }
      }, '结束远程桌面并撤销授权') : null) : null,
    h('div', { style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: 'flex' } },
      ...panes.map((pane) => h('div', {
        key: pane.key,
        style: { position: 'absolute', inset: 0, display: pane.key === activePane ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0 }
      }, paneBody(pane)))))
    : null
  return h('div', {
    style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg }
  },
    workspace,
    !panes.length && nativeWorkbench ? h('div', { style: { display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, flex: '1 1 auto', padding: 24, color: C.mute, fontSize: 12 } },
      h('div', { style: { fontSize: 16, fontWeight: 600, color: C.ink } }, '目标设备工作台'),
      serviceCatalogBusy ? h('div', null, '正在读取目标服务状态…')
        : codegService ? h('div', { style: { textAlign: 'center', lineHeight: 1.6 } },
          h('div', { style: { color: C.sub } }, '目标设备：' + (devices.find((item) => item.device_id === device)?.name || device)),
          h('div', { style: { color: C.sub } }, '服务状态：' + (serviceStateLabel[codegService.state] || codegService.state || '未知')),
          codegService.reason ? h('div', { style: { maxWidth: 520, color: C.sub } }, codegService.reason) : null)
          : h('div', { style: { color: homeError ? C.danger : C.sub, textAlign: 'center' } }, homeError || 'Controller 服务目录未返回 Codeg 状态。'),
      homeError && codegService ? h('div', { role: 'alert', style: { maxWidth: 520, color: C.danger, textAlign: 'center' } }, homeError) : null,
      h('button', { type: 'button', disabled: serviceCatalogBusy || serviceOpening || workbenchLoginBusy
          || legacyCodegBlocked || (codegService && codegService.state === 'missing'),
        onClick: workbenchLoginRequired ? () => void startWorkbenchLogin() : (codegService ? () => void openNativeCodeg() : retryAgentsHome),
        style: { ...button, opacity: serviceCatalogBusy || serviceOpening || workbenchLoginBusy
          || legacyCodegBlocked || (codegService && codegService.state === 'missing') ? 0.55 : 1 } },
      workbenchLoginBusy ? '等待登录完成…' : workbenchLoginRequired ? '通过主进程登录' : serviceOpening ? '正在打开…'
        : codegService ? (legacyCodegBlocked ? legacyCodegLabel : codegService.state === 'ready' ? '打开 Codeg'
          : codegService.state === 'missing' ? codegUnavailableLabel : '启动并打开 Codeg') : '重试服务目录'),
      desktopService ? h('div', { style: { marginTop: 4, textAlign: 'center', lineHeight: 1.55 } },
        h('div', { style: { color: C.sub } }, '远程桌面：' + (serviceStateLabel[desktopService.state] || desktopService.state || '未知')),
        desktopService.reason ? h('div', { style: { maxWidth: 520, color: C.sub } }, desktopService.reason) : null,
        desktopService.agent_busy ? h('div', { style: { maxWidth: 520, color: C.sub } }, '目标 Agent 正在处理任务，连接将以只读方式打开。') : null,
        h('button', { type: 'button', disabled: serviceCatalogBusy || serviceOpening || workbenchLoginBusy
          || !['ready', 'stopped'].includes(desktopService.state),
        onClick: workbenchLoginRequired ? () => void startWorkbenchLogin() : () => void openNativeDesktop(),
        style: { ...button, marginTop: 8, opacity: serviceCatalogBusy || serviceOpening || workbenchLoginBusy
          || !['ready', 'stopped'].includes(desktopService.state) ? 0.55 : 1 } },
        serviceOpening ? '正在授权并连接…' : desktopService.state === 'ready' ? '打开远程桌面（目标同意后连接）' : '启动并打开远程桌面')) : null) : null,
    !panes.length && !nativeWorkbench && homeError ? h('div', { role: 'alert', style: { display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, flex: '1 1 auto', color: C.mute, fontSize: 12 } },
      h('div', { style: { color: C.ink, textAlign: 'center' } }, homeError),
      h('button', { type: 'button', onClick: retryAgentsHome, style: button }, '重试')) : null,
    !panes.length && !nativeWorkbench && !homeError ? h('div', { style: { display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, flex: '1 1 auto', color: C.mute, fontSize: 12 } },
      h('span', { className: 'tether-spin', style: { display: 'grid', placeItems: 'center' } }, h(Glyph, { name: 'refresh', size: 18 })),
      '正在打开 Agent 主页…') : null)
}
