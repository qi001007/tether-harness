import { createTerminalDock } from './terminal-dock.js'
import { AgentCatalogView } from './agent-catalog.js'
import { AgentHome } from './agents-home.js'
import { readCatalog, writeCatalog, readHarnesses, writeHarnesses } from './agent-cache.js'
import { writeAccount } from './agent-account-cache.js'
export function createAgentsPage({ React, Glyph, post, C, devices = [], localDevice = '', activeDevice = '', onDeviceChange, onOpenWorkbench, onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const preferred = activeDevice && online.some((item) => item.device_id === activeDevice)
    ? activeDevice
    : localDevice
  const initial = preferred && online.some((item) => item.device_id === preferred)
    ? preferred
    : (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
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
  const [thoughtOpen, setThoughtOpen] = React.useState({})
  const [toolOpen, setToolOpen] = React.useState({})
  const [catalogOpen, setCatalogOpen] = React.useState(false)
  const [deviceMenu, setDeviceMenu] = React.useState(false)
  const [catalog, setCatalog] = React.useState(() => readCatalog(initial))
  const [catalogBusy, setCatalogBusy] = React.useState(false)
  const [catalogError, setCatalogError] = React.useState('')
  const [installing, setInstalling] = React.useState('')
  const [herdrAvailable, setHerdrAvailable] = React.useState(true)
  const [panes, setPanes] = React.useState([])
  const [activePane, setActivePane] = React.useState('')
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false)
  const [homeOpen, setHomeOpen] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [stepOpen, setStepOpen] = React.useState({})
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
  const tabColor = (status) => status === 'ready' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
    : status === 'error' ? 'var(--dsw-alias-state-error-primary, #b42318)'
      : status === 'ended' ? C.mute : 'var(--dsw-alias-state-warn-primary, #b54708)'

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

  React.useEffect(() => () => {
    const ids = new Set(Object.keys(tabCache.current))
    if (sessionRef.current) ids.add(sessionRef.current)
    for (const id of ids) {
      void post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id }).catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    if (!activeDevice || activeDevice === device) return
    if (!online.some((item) => item.device_id === activeDevice)) return
    setTabs([])
    tabCache.current = {}
    clearSession()
    setPicking(false)
    setPanes([])
    setActivePane('')
    setWorkspaceOpen(false)
    setCatalog(null)
    setCatalogError('')
    setDevice(activeDevice)
  }, [activeDevice])

  const selectDevice = async (value) => {
    const ids = tabs.map((tab) => tab.id)
    setTabs([])
    tabCache.current = {}
    clearSession()
    setPicking(false)
    setPanes([])
    setActivePane('')
    setWorkspaceOpen(false)
    setCatalog(null)
    setCatalogError('')
    setDevice(value)
    if (onDeviceChange) onDeviceChange(value)
    for (const id of ids) {
      try { await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id }) } catch (_) { /* already closed */ }
    }
  }

  const addPane = (pane) => {
    setPanes((current) => current.some((item) => item.key === pane.key) ? current : [...current, pane])
    setActivePane(pane.key)
    setWorkspaceOpen(true)
  }

  const closePane = (key) => {
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

  const openHerdr = () => {
    if (!herdrAvailable) { fail(new Error('此节点没有 Herdr')); return }
    addPane({ key: 'herdr', kind: 'terminal', shell: 'herdr', title: 'Herdr', icon: 'bot', dark: true })
  }

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
  const button = {
    height: 28, padding: '0 14px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
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
  const inlineMarkdown = (text) => String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return h('strong', { key: index }, part.slice(2, -2))
    if (/^`[^`]+`$/.test(part)) return h('code', { key: index, style: { fontFamily: 'Consolas, monospace', fontSize: 12,
      padding: '1px 4px', borderRadius: 4, background: 'rgba(9,30,66,.06)' } }, part.slice(1, -1))
    return part
  })
  const NEWLINE = String.fromCharCode(10)
  const CRLF = new RegExp('[' + String.fromCharCode(13) + String.fromCharCode(10) + ']')
  const FENCE_LANG = new RegExp('^[a-zA-Z0-9_-]+[' + String.fromCharCode(13) + String.fromCharCode(10) + ']+')
  const renderMarkdown = (text) => String(text || '').split(/```/).map((block, index) => index % 2
    ? h('pre', { key: index, style: { margin: '6px 0', padding: 10, borderRadius: 8, background: 'rgba(9,30,66,.05)',
      fontFamily: 'Consolas, monospace', fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap',
      wordBreak: 'break-word' } }, block.replace(FENCE_LANG, ''))
    : h('div', { key: index, style: { display: 'grid', gap: 2 } },
      block.split(CRLF).map((line, lineIndex) => h('div', { key: lineIndex, style: { minHeight: line ? undefined : 7 } }, ...inlineMarkdown(line)))))
  const elapsedLabel = (ms) => {
    if (!ms || ms < 1200) return ''
    const seconds = Math.round(ms / 1000)
    if (seconds < 60) return seconds + 's'
    return Math.floor(seconds / 60) + 'm' + (seconds % 60 ? ' ' + (seconds % 60) + 's' : '')
  }
  const toolIconName = (title) => {
    const text = String(title || '').toLowerCase()
    if (/shell|command|bash|powershell|cmd|pty|terminal|^(get|set|new|remove|start|stop|invoke|test)-/.test(text)) return 'terminal'
    if (/read|write|edit|file|image|patch|diff/.test(text)) return 'files'
    if (/search|grep|glob|find|query/.test(text)) return 'tool'
    if (/agent|subagent|task|delegate/.test(text)) return 'bot'
    return 'tool'
  }
  const toolKindLabel = (title) => {
    const icon = toolIconName(title)
    if (icon === 'terminal') return '终端'
    if (icon === 'files') return '文件'
    if (icon === 'bot') return 'Agent'
    return '工具'
  }
  const buildTurns = (list) => {
    const turns = []
    let current = null
    const ensure = () => {
      if (current) return current
      current = { user: null, steps: [], answers: [], errors: [], notes: [], streaming: false }
      turns.push(current)
      return current
    }
    for (const item of list) {
      if (item.kind === 'user') {
        current = { user: item, steps: [], answers: [], errors: [], notes: [], streaming: false }
        turns.push(current)
        continue
      }
      if (item.kind === 'system') {
        const text = String(item.text || '')
        if (/^已连接|^正在启动|^[A-Za-z]:[\\/]|^\//.test(text)) continue
        ensure().errors.push(item)
        continue
      }
      const turn = ensure()
      if (item.kind === 'assistant') {
        if (/^Warning: Exceeded skills context budget/.test(String(item.text || '').trim())) {
          turn.notes.push(item)
          continue
        }
        turn.answers.push(item)
        if (item.streaming) turn.streaming = true
      } else if (item.kind === 'thought' || item.kind === 'tool' || item.kind === 'plan') {
        turn.steps.push(item)
        if (item.streaming) turn.streaming = true
      } else if (item.kind === 'error') {
        turn.errors.push(item)
      }
    }
    return turns
  }
  const renderStep = (step, turnIndex, stepIndex) => {
    const key = turnIndex + ':' + stepIndex
    const open = !!stepOpen[key]
    const detail = step.kind === 'plan' ? null : (step.kind === 'tool' ? (step.detail || '') : (step.text || ''))
    const label = step.kind === 'thought' ? '思考' : step.kind === 'plan' ? '计划' : toolKindLabel(step.title)
    const title = step.kind === 'thought'
      ? String(step.text || '').split(String.fromCharCode(10))[0].slice(0, 120)
      : step.kind === 'plan'
        ? (step.entries || []).length + ' 项'
        : (step.title || '工具调用')
    const icon = step.kind === 'thought' || step.kind === 'plan' ? 'think' : toolIconName(step.title)
    const status = step.kind === 'tool'
      ? (step.status === 'completed' ? '完成' : step.status === 'failed' ? '失败' : '运行中')
      : (step.streaming ? '进行中' : '')
    const expandable = step.kind === 'plan' ? !!((step.entries || []).length) : !!detail
    return h('div', { key, style: { position: 'relative', paddingLeft: 28, minWidth: 0 } },
      h('span', { style: { position: 'absolute', left: 0, top: 1, width: 18, height: 18, display: 'grid', placeItems: 'center',
        borderRadius: 9, background: C.bg, border: '1px solid ' + C.line, color: C.sub } }, h(Glyph, { name: icon, size: 10 })),
      h('button', {
        type: 'button', disabled: !expandable,
        onClick: () => expandable && setStepOpen((current) => ({ ...current, [key]: !open })),
        style: { display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 22, padding: 0,
          border: 0, background: 'transparent', textAlign: 'left', cursor: expandable ? 'pointer' : 'default', minWidth: 0 }
      },
        h('span', { style: { flex: '0 0 auto', fontSize: 12.5, fontWeight: 500, color: step.kind === 'thought' ? C.sub : C.ink } }, label),
        h('span', { style: { flex: '1 1 auto', minWidth: 0, fontSize: 12.5, color: C.sub, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
        status ? h('span', { style: { flex: '0 0 auto', fontSize: 10.5, color: step.kind === 'tool' && step.status === 'failed' ? C.red : C.mute } }, status) : null,
        expandable ? h('span', { style: { flex: '0 0 auto', color: C.mute, display: 'grid', placeItems: 'center',
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' } }, h(Glyph, { name: 'chevronDown', size: 10 })) : null),
      open && expandable ? (step.kind === 'plan'
        ? h('div', { style: { marginTop: 5, padding: '7px 9px', borderRadius: 8, background: C.soft, display: 'grid', gap: 3 } },
          ...(step.entries || []).map((entry, entryIndex) => h('div', { key: entryIndex, style: { fontSize: 12, color: C.sub, lineHeight: 1.55 } }, '· ' + entry)))
        : h('pre', { style: { margin: '5px 0 0', padding: '8px 10px', borderRadius: 8, background: C.soft, color: C.sub,
          fontFamily: step.kind === 'tool' ? 'Consolas, monospace' : 'inherit', fontSize: step.kind === 'tool' ? 11 : 12.5,
          lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' } }, detail)) : null)
  }
  const renderTurn = (turn, index) => {
    const answerText = turn.answers.map((item) => item.text || '').filter(Boolean)
      .join(String.fromCharCode(10, 10))
      .split(String.fromCharCode(10))
      .filter((line) => !/^Warning: Exceeded skills context budget/.test(line.trim()))
      .join(String.fromCharCode(10))
      .trim()
    const streaming = turn.streaming
    const times = [...turn.steps, ...turn.answers].map((item) => item.at).filter((value) => typeof value === 'number')
    const elapsed = times.length ? elapsedLabel((streaming ? Date.now() : Math.max(...times)) - Math.min(...times)) : ''
    const defaultOpen = streaming || !answerText
    const open = stepOpen['turn:' + index] != null ? stepOpen['turn:' + index] : defaultOpen
    const toggle = () => setStepOpen((current) => ({ ...current, ['turn:' + index]: !open }))
    return h('div', { key: index, style: { width: '100%', maxWidth: 860, margin: '0 auto', display: 'grid', gap: 9, padding: '5px 0' } },
      turn.user ? h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h('div', { style: { maxWidth: '78%', padding: '9px 13px', borderRadius: 16, background: C.soft, color: C.ink,
          fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, turn.user.text)) : null,
      turn.steps.length ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('button', { type: 'button', onClick: toggle, style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30,
          padding: '0 12px', border: 0, borderRadius: 999, background: C.soft, color: streaming ? C.blue : C.sub,
          fontSize: 11.5, cursor: 'pointer', width: 'fit-content' } },
          h(Glyph, { name: streaming ? 'refresh' : 'tool', size: 12 }),
          streaming ? '正在执行' : '执行过程',
          h('span', { style: { color: C.mute } }, ' · ' + turn.steps.length + ' 步'),
          elapsed ? h('span', { style: { color: C.mute } }, ' · ' + elapsed) : null,
          h('span', { style: { display: 'grid', placeItems: 'center', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' } },
            h(Glyph, { name: 'chevronDown', size: 10 })))) : null,
      turn.steps.length && open ? h('div', { style: { position: 'relative', display: 'grid', gap: 6, paddingLeft: 0 } },
        h('span', { style: { position: 'absolute', left: 9, top: 8, bottom: 8, width: 1, background: C.line } }),
        ...turn.steps.map((step, stepIndex) => renderStep(step, index, stepIndex))) : null,
      answerText ? h('div', { style: { fontSize: 13.5, lineHeight: 1.75, color: C.ink, wordBreak: 'break-word' } },
        ...renderMarkdown(answerText)) : null,
      streaming && !answerText ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, color: C.mute, fontSize: 11.5 } },
        h('span', { className: 'tether-spin', style: { width: 13, height: 13, borderRadius: '50%', border: '1.5px solid ' + C.line,
          borderTopColor: C.blue, display: 'inline-block' } }), 'Agent 正在工作…') : null,
      ...turn.errors.map((item, errorIndex) => h('div', { key: 'err' + errorIndex, style: { padding: '7px 10px', borderRadius: 8,
        background: 'rgba(180,35,24,.07)', color: C.red, fontSize: 12, lineHeight: 1.5 } }, item.text)),
      ...turn.notes.map((item, noteIndex) => h('div', { key: 'note' + noteIndex, style: { fontSize: 10.5, color: C.mute,
        lineHeight: 1.5, paddingLeft: 2 } }, item.text)))
  }
  const turns = buildTurns(items)
  const currentModel = models.find((item) => item.modelId === model) || models[0]
  const modelLabel = currentModel ? (currentModel.name || currentModel.modelId) : (model || '模型')

  const headerRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' } },
    h('div', { style: { position: 'relative' } },
      h('button', {
        type: 'button', title: '选择目标设备', 'aria-label': 'Agent 目标设备',
        'aria-haspopup': 'listbox', 'aria-expanded': deviceMenu,
        onClick: () => setDeviceMenu((value) => !value), className: 'tether-hover tether-press',
        style: { ...field, minWidth: 180, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left' }
      },
        h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (online.find((item) => item.device_id === device) || {}).name || device || '没有在线设备'),
        h(Glyph, { name: 'chevronDown', size: 12 })),
      deviceMenu ? h('div', {
        onPointerDown: (event) => { event.preventDefault(); setDeviceMenu(false) },
        style: { position: 'fixed', inset: 0, zIndex: 70, background: 'transparent' }
      }) : null,
      deviceMenu ? h('div', { role: 'listbox', style: { position: 'absolute', top: 32, left: 0, minWidth: 200, maxHeight: 300, overflow: 'auto', zIndex: 80,
        background: C.layer1, borderRadius: 9, boxShadow: C.shadow, padding: 4 } },
        online.length ? online.map((item) => h('button', {
          key: item.device_id, type: 'button', role: 'option', 'aria-selected': item.device_id === device,
          onClick: () => { setDeviceMenu(false); void selectDevice(item.device_id) }, className: 'tether-hover',
          style: { display: 'flex', width: '100%', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', border: 0, borderRadius: 6,
            background: item.device_id === device ? C.soft : 'transparent', color: C.ink, fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }
        }, item.name || item.device_id)) : h('div', { style: { padding: '8px 10px', fontSize: 12, color: C.mute } }, '没有在线设备')
      ) : null),
    h('button', { type: 'button', onClick: () => { void detect(device); void loadCatalog(true) }, disabled: detecting || !device,
      title: '刷新', 'aria-label': '刷新',
      style: { ...field, width: 30, padding: 0, display: 'grid', placeItems: 'center',
        opacity: detecting || !device ? 0.5 : 1 } }, h(Glyph, { name: 'refresh', size: 14 })),
    session ? h('button', { type: 'button', onClick: () => void stop(),
      style: { ...field, cursor: 'pointer', background: 'transparent' } }, '停止') : null,
    herdrAvailable ? h('button', {
      type: 'button', title: 'Herdr', 'aria-label': 'Herdr 工作区',
      onClick: openHerdr,
      style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }
    }, h(Glyph, { name: 'terminal', size: 13 }), 'Herdr') : null,
    h('button', {
      type: 'button', title: 'Agent 目录', 'aria-label': 'Agent 目录',
      onClick: () => setCatalogOpen(true),
      style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }
    }, h(Glyph, { name: 'apps', size: 13 }), '目录'))
  const baseContent = h('div', {
    key: 'base',
    style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: workspaceOpen ? 'none' : 'flex', flexDirection: 'column', gap: 8 }
  },
    tabs.length || picking ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto', overflowX: 'auto' } },
      h('button', { key: 'home', type: 'button', title: '主页', 'aria-label': '主页', onClick: () => setHomeOpen(true),
        style: { ...field, height: 26, padding: '0 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          background: homeOpen ? C.soft : 'transparent', color: homeOpen ? C.ink : C.sub,
          border: '1px solid ' + (homeOpen ? C.line : 'transparent') } },
        h(Glyph, { name: 'apps', size: 12 }), '主页'),
      tabs.map((tab) => h('div', {
        key: tab.id, role: 'tab', 'aria-selected': tab.id === session ? 'true' : 'false',
        onClick: () => selectTab(tab.id),
        style: { display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 5px 0 9px', borderRadius: 7,
          cursor: 'pointer', background: !homeOpen && tab.id === session ? C.soft : 'transparent', color: !homeOpen && tab.id === session ? C.ink : C.sub,
          border: '1px solid ' + (!homeOpen && tab.id === session ? C.line : 'transparent'), whiteSpace: 'nowrap' }
      },
        h('span', { style: { width: 6, height: 6, borderRadius: 3, background: tabColor(tab.status), flex: '0 0 auto' } }),
        h('span', { style: { fontSize: 11 } }, tab.name),
        h('button', {
          type: 'button', title: '关闭 ' + tab.name, 'aria-label': '关闭 ' + tab.name,
          onClick: (event) => { event.stopPropagation(); void closeTab(tab.id) },
          style: { width: 18, height: 18, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4,
            background: 'transparent', color: C.mute, fontSize: 12, cursor: 'pointer', padding: 0 }
        }, '×')
      )),
      h('button', { type: 'button', title: '再开一个 Agent', 'aria-label': '再开一个 Agent',
        onClick: () => { setHomeOpen(false); setPicking(true) },
        style: { ...field, height: 26, padding: '0 9px', cursor: 'pointer' } }, '+')
    ) : null,
    (homeOpen || (!session && !picking)) && !picking ? h(AgentHome, {
      key: 'home', React, Glyph, C, post, device, catalog, harnesses, panes,
      loading: catalogBusy, error: catalogError,
      installing, onInstall: (agent) => void installAgent(agent),
      onOpen: openAgent, onOpenCatalog: () => setCatalogOpen(true),
      onOpenPane: (key) => { setWorkspaceOpen(true); setActivePane(key) },
      onLoginTerminal: (agent, command, argv) => openLogin(agent, command, argv),
      onClosePane: closePane
    }) : null,
    picking ? h('div', {
      style: { flex: '0 0 auto', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }
    },
      harnesses.length ? harnesses.map((item) => h('button', {
        key: item.id, type: 'button', onClick: () => void start(item), disabled: busy,
        className: 'tether-press tether-hover',
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: 10, textAlign: 'left',
          border: '1px solid ' + C.line, borderRadius: 10, background: C.panel || C.bg, color: C.ink, cursor: 'pointer' }
      },
        h('span', { style: { width: 30, height: 30, flex: '0 0 auto', display: 'grid', placeItems: 'center',
          borderRadius: 8, background: C.soft, color: C.blue } }, h(Glyph, { name: 'bot', size: 16 })),
        h('span', { style: { minWidth: 0, display: 'grid', gap: 2 } },
          h('span', { style: { fontSize: 13, fontWeight: 500 } }, item.name || item.id),
          h('span', { style: { fontSize: 11, color: C.mute } }, item.command || item.id))
      )) : h('div', { style: { gridColumn: '1 / -1', padding: 16, color: C.mute, fontSize: 12 } },
        detecting ? '正在检测本机 Agent…' : '没有检测到 ACP Harness。先在目标电脑装好 Gemini CLI / OpenCode / Claude Code adapter / Codex adapter。')
    ) : null,
    !homeOpen && (session || picking) ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', padding: '2px 2px 0' } },
      h('button', { type: 'button', title: '返回主页', 'aria-label': '返回主页', onClick: () => setHomeOpen(true),
        className: 'tether-hover', style: { ...field, height: 30, padding: '0 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { fontSize: 16, lineHeight: 1 } }, '‹'), '主页'),
      h('div', { style: { minWidth: 0, flex: '1 1 auto', display: 'grid', gap: 1 } },
        h('div', { style: { fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (agent && (agent.title || agent.name)) || 'Agent'),
        h('div', { style: { fontSize: 11, color: C.mute } },
          (ready ? '已连接' : '正在启动') + (modelLabel ? ' · ' + modelLabel : ''))),
      h('button', { type: 'button', title: '会话详情', 'aria-label': '会话详情', onClick: () => setDetailsOpen((value) => !value),
        className: 'tether-hover', style: { ...field, width: 30, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer',
          background: detailsOpen ? C.soft : 'transparent' } }, h(Glyph, { name: 'files', size: 14 })),
      session ? h('button', { type: 'button', onClick: () => void stop(), className: 'tether-hover',
        style: { ...field, height: 30, padding: '0 10px', cursor: 'pointer' } }, '停止') : null) : null,
    !homeOpen && (session || picking) ? h('div', {
      key: 'transcript',
      ref: transcriptRef,
      className: 'tether-scroll',
      style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', padding: '0',
        paddingRight: detailsOpen ? 310 : 0 }
    },
      h('div', { style: { width: '100%', maxWidth: '100%', boxSizing: 'border-box', minWidth: 0, display: 'grid', gap: 2, padding: '10px 22px 16px' } },
        turns.length ? turns.map(renderTurn) : h('div', { style: { padding: '46px 0', textAlign: 'center', color: C.mute, fontSize: 12 } },
          session ? '等待 Agent 输出…' : '选择一台已安装 ACP Harness 的电脑，点击卡片开始会话。'))
    ) : null,
    !homeOpen ? pending.map((item) => h('div', { key: 'perm-' + item.requestId, style: { display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', flexWrap: 'wrap',
      padding: '8px 10px', borderRadius: 10, border: '1px solid ' + C.line, background: C.soft } },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.sub } },
        h(Glyph, { name: 'shield', size: 13 }), '需要授权 · ' + (item.title || ('#' + item.requestId))),
      item.options.map((option) => h('button', {
        key: option.optionId, type: 'button', onClick: () => { void reply(item.requestId, option.optionId) },
        style: { ...field, height: 24, cursor: 'pointer' }
      }, option.name || option.optionId))
    )) : null,
    !homeOpen && session && commands.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 0 auto' } },
      commands.map((command) => h('button', {
        key: command.name, type: 'button', title: command.description || command.name,
        onClick: () => setInput('/' + command.name + ' '),
        style: { ...field, height: 22, cursor: 'pointer', color: C.sub }
      }, '/' + command.name))
    ) : null,
    !homeOpen && (session || picking) ? h('form', {
      onSubmit: send,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 12,
        border: '1px solid ' + C.line, background: C.panel || C.bg, boxShadow: '0 1px 3px rgba(16,24,40,.06)', flex: '0 0 auto' }
    },
      models.length ? h('span', { ref: modelRef, style: { position: 'relative', flex: '0 0 auto' } },
        h('button', {
          type: 'button', title: '切换模型', 'aria-label': '切换模型',
          onClick: () => setModelOpen((value) => !value),
          style: { display: 'flex', alignItems: 'center', gap: 5, height: 26, maxWidth: 170, padding: '0 8px',
            border: '1px solid ' + C.line, borderRadius: 8, background: C.bg, color: C.sub, fontSize: 11.5, cursor: 'pointer' }
        },
          h(Glyph, { name: 'think', size: 13 }),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, modelLabel),
          h(Glyph, { name: 'chevronDown', size: 12 })),
        modelOpen ? h('div', {
          role: 'listbox', 'aria-label': '模型列表',
          style: { position: 'absolute', left: 0, bottom: 'calc(100% + 6px)', minWidth: 250, maxHeight: 280, overflow: 'auto',
            padding: 6, borderRadius: 10, border: '1px solid ' + C.line, background: C.panel || C.bg,
            boxShadow: '0 10px 30px rgba(16,24,40,.18)', zIndex: 60 }
        },
          models.map((item) => h('button', {
            key: item.modelId, type: 'button', role: 'option', 'aria-selected': item.modelId === model ? 'true' : 'false',
            onClick: () => void changeModel(item.modelId),
            style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 0, borderRadius: 7,
              background: item.modelId === model ? C.soft : 'transparent', color: C.ink, cursor: 'pointer', textAlign: 'left' }
          },
            h('span', { style: { minWidth: 0, display: 'grid', gap: 2 } },
              h('span', { style: { fontSize: 12.5 } }, item.name || item.modelId),
              item.description ? h('span', { style: { fontSize: 11, color: C.mute } }, item.description) : null),
            item.modelId === model ? h('span', { style: { marginLeft: 'auto', color: C.blue, fontSize: 12 } }, '✓') : null))
        ) : null
      ) : null,
      h('input', {
        value: input, disabled: !session || !ready, autoFocus: true, spellCheck: false,
        'aria-label': 'Agent 输入', placeholder: session ? (ready ? '给 Agent 发消息，Enter 发送' : '正在启动 Agent…') : '先选择 Harness',
        onChange: (event) => setInput(event.target.value),
        style: { flex: '1 1 auto', minWidth: 0, height: 28, border: 0, outline: 'none', background: 'transparent', color: C.ink, fontSize: 13 }
      }),
      h('button', {
        type: 'submit', disabled: !session || !ready || !input.trim(), title: '发送', 'aria-label': '发送',
        style: { width: 30, height: 30, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 9,
          background: C.blue, color: '#fff', cursor: !session || !ready || !input.trim() ? 'default' : 'pointer',
          opacity: !session || !ready || !input.trim() ? 0.4 : 1 }
      }, h(Glyph, { name: 'arrowUp', size: 15 }))
    ) : null,
    detailsOpen && !homeOpen && (session || picking) ? h('div', { style: { position: 'absolute', top: 76, right: 8, bottom: 88, width: 300,
      zIndex: 35, background: C.bg, border: '1px solid ' + C.line, borderRadius: 12, boxShadow: '0 12px 36px rgba(16,24,40,.16)',
      padding: 12, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('div', { style: { flex: '1 1 auto', fontSize: 12.5, fontWeight: 600 } }, '对话详情'),
        h('button', { type: 'button', title: '关闭详情', 'aria-label': '关闭详情', onClick: () => setDetailsOpen(false),
          style: { width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent', color: C.mute, cursor: 'pointer', fontSize: 15 } }, '×')),
      ...[['状态', ready ? '已连接' : '正在启动'], ['Agent', (agent && (agent.title || agent.name)) || '—'],
        ['模型', modelLabel || '—'], ['工作目录', cwd || '—'], ['会话', session ? session.slice(0, 8) : '—'],
        ['步骤', String(turns.reduce((sum, turn) => sum + turn.steps.length, 0))],
        ['消息', String(turns.reduce((sum, turn) => sum + turn.answers.length, 0))]].map((row) =>
        h('div', { key: row[0], style: { display: 'grid', gap: 2, paddingBottom: 7, borderBottom: '1px solid ' + C.line } },
          h('div', { style: { fontSize: 10.5, color: C.mute } }, row[0]),
          h('div', { style: { fontSize: 12, color: C.ink, wordBreak: 'break-all', lineHeight: 1.5 } }, row[1])))) : null
  )

  const paneBody = (pane) => pane.kind === 'web'
    ? (pane.url ? h('iframe', {
      key: pane.key, title: pane.title, src: pane.url,
      style: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' },
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads'
    }) : h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12, background: C.bg } },
      '正在启动 ' + pane.title + '…'))
    : h(createTerminalDock, {
      key: pane.key, React, Glyph, post, C, device, cwd: '',
      initialAgent: pane.agentId || '', initialShell: pane.shell || '', initialCommand: pane.initialCommand || '', initialArgv: pane.initialArgv || null, label: pane.title,
      themeMode: 'dark', fill: true,
      height: Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 900) - 168),
      onClose: () => closePane(pane.key)
    })
  const surfaceTabs = panes.length ? h('div', {
    key: 'tabs',
    className: 'tether-scroll tether-agent-tabs',
    onWheel: (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY
    },
    style: { display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 2, borderBottom: '1px solid rgba(9,30,66,.10)',
      flex: '0 0 auto', overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }
  },
    h('button', {
      type: 'button', title: '主页', 'aria-label': '主页', onClick: () => setWorkspaceOpen(false),
      style: { ...field, height: 26, padding: '0 10px', cursor: 'pointer', flex: '0 0 auto',
        background: workspaceOpen ? 'transparent' : C.soft,
        border: '1px solid ' + (workspaceOpen ? 'transparent' : C.line) }
    }, '主页'),
    ...panes.map((pane) => h('div', {
      key: pane.key, role: 'tab', 'aria-selected': workspaceOpen && pane.key === activePane ? 'true' : 'false',
      onClick: () => { setWorkspaceOpen(true); setActivePane(pane.key) },
      style: { display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 4px 0 8px', borderRadius: 7,
        cursor: 'pointer', flex: '0 0 auto', whiteSpace: 'nowrap',
        background: workspaceOpen && pane.key === activePane ? C.soft : 'transparent',
        color: workspaceOpen && pane.key === activePane ? C.ink : C.sub,
        border: '1px solid ' + (workspaceOpen && pane.key === activePane ? C.line : 'transparent') }
    },
      h('span', { style: { width: 6, height: 6, borderRadius: 3, background: pane.kind === 'web' ? C.blue : '#d97706', flex: '0 0 auto' } }),
      h('span', { style: { fontSize: 11.5 } }, pane.title),
      h('button', {
        type: 'button', title: '关闭 ' + pane.title, 'aria-label': '关闭 ' + pane.title,
        onClick: (event) => { event.stopPropagation(); closePane(pane.key) },
        style: { width: 18, height: 18, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4,
          background: 'transparent', color: C.mute, fontSize: 12, cursor: 'pointer', padding: 0 }
      }, '×'))),
    h('span', { style: { marginLeft: 'auto' } })) : null
  const workspace = panes.length ? h('div', {
    key: 'workspace',
    style: { flex: '1 1 auto', minHeight: 0, display: workspaceOpen ? 'flex' : 'none', flexDirection: 'column', background: C.bg }
  },
    h('div', { style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: 'flex' } },
      ...panes.map((pane) => h('div', {
        key: pane.key,
        style: { position: 'absolute', inset: 0, display: pane.key === activePane ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0 }
      }, paneBody(pane)))))
    : null
  return h('div', {
    style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: C.bg }
  },
    headerRow,
    catalogOpen ? h(AgentCatalogView, {
      React, Glyph, post, C, device,
      onLoginTerminal: (agent, command, argv) => openLogin(agent, command, argv),
      onClose: () => setCatalogOpen(false)
    }) : h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
      surfaceTabs,
      h('div', { style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' } },
        baseContent,
        workspace)))
}
