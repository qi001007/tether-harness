import { createTerminalDock } from './terminal-dock.js'
import { AgentCatalogView } from './agent-catalog.js'
export function createAgentsPage({ React, Glyph, post, C, devices = [], localDevice = '', activeDevice = '', onDeviceChange, onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const preferred = activeDevice && online.some((item) => item.device_id === activeDevice)
    ? activeDevice
    : localDevice
  const initial = preferred && online.some((item) => item.device_id === preferred)
    ? preferred
    : (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
  const [harnesses, setHarnesses] = React.useState([])
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
  const [herdrOpen, setHerdrOpen] = React.useState(false)
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const tabCache = React.useRef({})
  const transcriptRef = React.useRef(null)
  const modelRef = React.useRef(null)

  const updateTab = (id, patch) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  const saveTab = () => {
    const id = sessionRef.current
    if (!id) return
    tabCache.current[id] = { items, ready, agent, models, model, commands, pending, since: since.current }
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
    setInput('')
    setModelOpen(false)
    since.current = 0
  }
  const tabColor = (status) => status === 'ready' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
    : status === 'error' ? 'var(--dsw-alias-state-error-primary, #b42318)'
      : status === 'ended' ? C.mute : 'var(--dsw-alias-state-warn-primary, #b54708)'

  const addItem = (item) => setItems((current) => [...current, item])
  const appendAssistant = (text) => setItems((current) => {
    const last = current[current.length - 1]
    if (last && last.kind === 'assistant' && last.streaming) {
      return [...current.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...current, { kind: 'assistant', text, streaming: true }]
  })
  const finishStreaming = () => setItems((current) => {
    const last = current[current.length - 1]
    if (!last || last.kind !== 'assistant' || !last.streaming) return current
    return [...current.slice(0, -1), { ...last, streaming: false }]
  })

  const fail = (error) => {
    const message = String((error && error.message) || error || 'Agents 操作失败')
    finishStreaming()
    addItem({ kind: 'error', text: message })
    if (onError) onError(error)
  }

  const detect = async (id) => {
    if (!id) return
    setDetecting(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(id) + '/fs/acp_detect', {})
      setHarnesses(Array.isArray(result && result.harnesses) ? result.harnesses : [])
    } catch (error) {
      setHarnesses([])
      fail(error)
    } finally {
      setDetecting(false)
    }
  }

  React.useEffect(() => { void detect(device) }, [device])

  React.useEffect(() => {
    if (!modelOpen) return undefined
    const close = (event) => {
      if (modelRef.current && !modelRef.current.contains(event.target)) setModelOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [modelOpen])

  const closeTab = async (id) => {
    if (!id) return
    const remaining = tabs.filter((tab) => tab.id !== id)
    delete tabCache.current[id]
    setTabs(remaining)
    if (sessionRef.current === id) {
      if (remaining.length) loadTab(remaining[remaining.length - 1].id)
      else clearSession()
    }
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id })
    } catch (_) { /* node may have already closed the session */ }
  }

  const stop = async () => { await closeTab(sessionRef.current) }

  const selectTab = (id) => {
    if (!id || id === sessionRef.current) return
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
            } else if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
              setCommands(update.availableCommands.filter((entry) => entry && entry.name).slice(0, 12))
            } else if (update.sessionUpdate === 'tool_call') {
              finishStreaming()
              addItem({ kind: 'tool', title: update.title || '工具调用', status: update.status || 'running' })
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
            addItem({ kind: 'system', text: '已连接' + (label ? ' · ' + label : '') })
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
    setHerdrOpen(false)
    setDevice(activeDevice)
  }, [activeDevice])

  const selectDevice = async (value) => {
    const ids = tabs.map((tab) => tab.id)
    setTabs([])
    tabCache.current = {}
    clearSession()
    setPicking(false)
    setHerdrOpen(false)
    setDevice(value)
    if (onDeviceChange) onDeviceChange(value)
    for (const id of ids) {
      try { await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id }) } catch (_) { /* already closed */ }
    }
  }

  const field = {
    height: 28, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const button = {
    height: 28, padding: '0 14px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }

  const renderItem = (item, index) => {
    if (item.kind === 'user') return h('div', { key: index, style: { display: 'flex', justifyContent: 'flex-end' } },
      h('div', { style: { maxWidth: '78%', padding: '8px 12px', borderRadius: '12px 12px 4px 12px',
        background: C.soft, color: C.ink, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, item.text))
    if (item.kind === 'assistant') {
      return h('div', { key: index, style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
        h('span', { style: { width: 26, height: 26, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 8, background: C.soft, color: C.blue } },
          h(Glyph, { name: 'bot', size: 14 })),
        h('div', { style: { maxWidth: '82%', padding: '9px 12px', borderRadius: '12px 12px 12px 4px',
          background: C.panel || C.bg, border: '1px solid ' + C.line, color: C.ink,
          fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, item.text || (item.streaming ? '…' : '')))
    }
    if (item.kind === 'tool') {
      const color = item.status === 'completed' ? C.green : item.status === 'failed' ? C.red : C.sub
      return h('div', { key: index, style: { display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '82%',
        padding: '7px 10px', borderRadius: 10, background: C.soft, border: '1px solid ' + C.line } },
        h('span', { style: { width: 22, height: 22, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 6, background: C.bg, color: C.sub } },
          h(Glyph, { name: 'tool', size: 13 })),
        h('span', { style: { minWidth: 0, fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
        h('span', { style: { fontSize: 11, color, marginLeft: 'auto', whiteSpace: 'nowrap' } }, item.status === 'completed' ? '完成' : item.status === 'failed' ? '失败' : '运行中'))
    }
    if (item.kind === 'plan') {
      return h('div', { key: index, style: { alignSelf: 'flex-start', maxWidth: '82%', padding: '9px 12px', borderRadius: 10,
        background: C.soft, border: '1px solid ' + C.line, display: 'grid', gap: 5 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.sub } },
          h(Glyph, { name: 'think', size: 13 }), '执行计划'),
        ...item.entries.map((entry, entryIndex) => h('div', { key: entryIndex, style: { fontSize: 12.5, color: C.ink, lineHeight: 1.55 } }, '· ' + entry)))
    }
    if (item.kind === 'error') return h('div', { key: index, style: { alignSelf: 'center', maxWidth: '88%', padding: '6px 10px', borderRadius: 8,
      background: 'rgba(180,35,24,.08)', color: C.red, fontSize: 12, textAlign: 'center' } }, item.text)
    return h('div', { key: index, style: { alignSelf: 'center', color: C.mute, fontSize: 11.5, textAlign: 'center', padding: '1px 0' } }, item.text)
  }

  const currentModel = models.find((item) => item.modelId === model) || models[0]
  const modelLabel = currentModel ? (currentModel.name || currentModel.modelId) : (model || '模型')

  if (herdrOpen) {
    return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg } },
      h(createTerminalDock, {
        React, Glyph, post, C, device, cwd: '', initialShell: 'herdr',
        height: Math.max(420, (typeof window !== 'undefined' ? window.innerHeight : 900) - 120),
        onClose: () => setHerdrOpen(false)
      }))
  }
  if (catalogOpen) {
    return h(AgentCatalogView, {
      React, Glyph, post, C, device,
      onClose: () => setCatalogOpen(false)
    })
  }
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' } },
      h('select', {
        value: device, 'aria-label': 'Agent 目标设备', title: '选择要运行 Agent 的电脑',
        onChange: (event) => { void selectDevice(event.target.value); event.currentTarget.blur() },
        style: { ...field, minWidth: 180 }
      },
        !online.length ? h('option', { value: '' }, '没有在线设备') : null,
        online.map((item) => h('option', { key: item.device_id, value: item.device_id }, item.name || item.device_id))
      ),
      h('button', { type: 'button', onClick: () => void detect(device), disabled: detecting || !device,
        style: { ...button, padding: '0 10px', opacity: detecting || !device ? 0.5 : 1 } }, detecting ? '检测中…' : '刷新'),
      h('button', { type: 'button', disabled: !session, onClick: () => void stop(),
        style: { ...field, cursor: session ? 'pointer' : 'default', opacity: session ? 1 : 0.5, background: 'transparent' } }, '停止'),
      h('button', {
        type: 'button', title: 'Herdr 工作区', 'aria-label': 'Herdr 工作区',
        onClick: () => setHerdrOpen(true),
        style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }
      }, h(Glyph, { name: 'terminal', size: 13 }), 'Herdr'),
      h('button', {
        type: 'button', title: 'Agent 目录', 'aria-label': 'Agent 目录',
        onClick: () => setCatalogOpen(true),
        style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }
      }, h(Glyph, { name: 'apps', size: 13 }), '目录'),
      h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: session ? C.green : C.mute } },
        h('span', { style: { width: 7, height: 7, borderRadius: 4, background: session ? C.green : C.mute } }),
        session ? (ready ? '已就绪' : '启动中…') : '未连接'),
      session && agent ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', height: 24,
        borderRadius: 999, background: C.soft, color: C.ink, fontSize: 11 } },
        h(Glyph, { name: 'bot', size: 14 }),
        h('span', null, (agent.title || agent.name || 'Agent') + (agent.version ? ' ' + agent.version : ''))) : null
    ),
    tabs.length ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto', overflowX: 'auto' } },
      tabs.map((tab) => h('div', {
        key: tab.id, role: 'tab', 'aria-selected': tab.id === session ? 'true' : 'false',
        onClick: () => selectTab(tab.id),
        style: { display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 5px 0 9px', borderRadius: 7,
          cursor: 'pointer', background: tab.id === session ? C.soft : 'transparent', color: tab.id === session ? C.ink : C.sub,
          border: '1px solid ' + (tab.id === session ? C.line : 'transparent'), whiteSpace: 'nowrap' }
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
        onClick: () => setPicking(true),
        style: { ...field, height: 26, padding: '0 9px', cursor: 'pointer' } }, '+')
    ) : null,
    !session || picking ? h('div', {
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
    h('div', {
      ref: transcriptRef,
      className: 'tether-scroll',
      style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 4px 10px' }
    },
      items.length ? items.map(renderItem) : h('div', { style: { margin: 'auto', color: C.mute, fontSize: 12, textAlign: 'center' } },
        session ? '等待 Agent 输出…' : '选择一台已安装 ACP Harness 的电脑，点击卡片开始会话。')
    ),
    pending.map((item) => h('div', { key: 'perm-' + item.requestId, style: { display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', flexWrap: 'wrap',
      padding: '8px 10px', borderRadius: 10, border: '1px solid ' + C.line, background: C.soft } },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.sub } },
        h(Glyph, { name: 'shield', size: 13 }), '需要授权 · ' + (item.title || ('#' + item.requestId))),
      item.options.map((option) => h('button', {
        key: option.optionId, type: 'button', onClick: () => { void reply(item.requestId, option.optionId) },
        style: { ...field, height: 24, cursor: 'pointer' }
      }, option.name || option.optionId))
    )),
    session && commands.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 0 auto' } },
      commands.map((command) => h('button', {
        key: command.name, type: 'button', title: command.description || command.name,
        onClick: () => setInput('/' + command.name + ' '),
        style: { ...field, height: 22, cursor: 'pointer', color: C.sub }
      }, '/' + command.name))
    ) : null,
    h('form', {
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
    )
  )
}
