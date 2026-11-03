export function createAgentsPage({ React, Glyph, post, C, devices = [], localDevice = '', onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const initial = localDevice && online.some((item) => item.device_id === localDevice)
    ? localDevice
    : (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
  const [harnesses, setHarnesses] = React.useState([])
  const [detecting, setDetecting] = React.useState(false)
  const [session, setSession] = React.useState('')
  const [harness, setHarness] = React.useState(null)
  const [output, setOutput] = React.useState('')
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
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const tabCache = React.useRef({})
  const outputRef = React.useRef(null)

  const updateTab = (id, patch) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  const saveTab = () => {
    const id = sessionRef.current
    if (!id) return
    tabCache.current[id] = { output, ready, agent, models, model, commands, pending, since: since.current }
  }
  const loadTab = (id) => {
    const cached = tabCache.current[id] || {}
    sessionRef.current = id
    setSession(id)
    setOutput(cached.output || '')
    setReady(!!cached.ready)
    setAgent(cached.agent || null)
    setModels(cached.models || [])
    setModel(cached.model || '')
    setCommands(cached.commands || [])
    setPending(cached.pending || [])
    setInput('')
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
    setOutput('')
    setInput('')
    since.current = 0
  }
  const tabColor = (status) => status === 'ready' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
    : status === 'error' ? 'var(--dsw-alias-state-error-primary, #b42318)'
      : status === 'ended' ? C.mute : 'var(--dsw-alias-state-warn-primary, #b54708)'

  const fail = (error) => {
    const message = String((error && error.message) || error || 'Agents 操作失败')
    setOutput((current) => current + (current && !current.endsWith('\n') ? '\n' : '') + message + '\n')
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
      setHarness(item)
      setInput('')
      setPicking(false)
      setOutput('ACP · ' + name + '\n' + (result.cwd || '') + '\n\n')
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
    setOutput((current) => current + '> ' + text + '\n')
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
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_set_model', {
        session_id: session, model: modelId
      })
      setOutput((current) => current + '[模型] ' + modelId + '\n')
    } catch (error) {
      fail(error)
    }
  }

  React.useEffect(() => {
    if (!session) return undefined
    let disposed = false
    let inFlight = false
    const tick = async () => {
      if (disposed || document.hidden || inFlight) return
      inFlight = true
      try {
        const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_poll',
          { session_id: session, since: since.current })
        if (disposed || !result) return
        since.current = Number(result.next) || since.current
        const lines = []
        let chunk = ''
        const flush = () => { if (chunk) { lines.push(chunk); chunk = '' } }
        for (const item of result.events || []) {
          const event = item.event || {}
          if (event.type === 'notification' && event.method === 'session/update') {
            const update = (event.params && event.params.update) || {}
            const content = update.content || {}
            if (update.sessionUpdate === 'agent_message_chunk' && content.type === 'text') { chunk += content.text; continue }
            flush()
            if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
              setCommands(update.availableCommands.filter((item) => item && item.name).slice(0, 12))
            } else if (update.sessionUpdate === 'tool_call' && update.title) lines.push('[工具] ' + update.title)
            else if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
              lines.push('[计划]\n' + update.entries.map((entry) => '· ' + (entry.content || entry.title || '')).join('\n'))
            }
          } else if (event.type === 'request' && event.method === 'session/request_permission') {
            flush()
            const params = event.params || {}
            const title = (params.toolCall && params.toolCall.title) || '工具调用'
            const options = Array.isArray(params.options) ? params.options : []
            const choices = options.map((option) => option.name || option.optionId).join(' / ')
            lines.push('[需要授权] ' + title + '：' + (choices || '无选项') + ' #' + event.id)
            setPending((current) => current.some((item) => item.requestId === event.id) ? current
              : [...current, { requestId: event.id, options }])
          } else if (event.type === 'ready') {
            flush()
            setReady(true)
            setAgent(event.agent || null)
            const available = (event.models && event.models.availableModels) || []
            setModels(available)
            setModel((event.models && (event.models.currentModelId || event.models.currentModel)) || (available[0] && available[0].modelId) || '')
            const label = event.agent && (event.agent.title || event.agent.name)
            updateTab(session, label ? { status: 'ready', name: label } : { status: 'ready' })
            lines.push('[就绪]')
          } else if (event.type === 'result') {
            flush()
            const reason = (event.result && event.result.stopReason) || 'done'
            lines.push('[完成] ' + reason)
          } else if (event.type === 'error') {
            flush()
            setReady(false)
            updateTab(session, { status: 'error' })
            lines.push('[错误] ' + String(event.error || 'ACP error'))
          } else if (event.type === 'closed') {
            flush()
            updateTab(session, { status: 'ended' })
            setReady(false)
            lines.push('[会话结束]')
          }
        }
        flush()
        if (lines.length) setOutput((current) => current + lines.join('\n') + '\n')
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
    if (session) tabCache.current[session] = { output, ready, agent, models, model, commands, pending, since: since.current }
  }, [session, output, ready, agent, models, model, commands, pending])

  React.useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  React.useEffect(() => () => {
    const ids = new Set(Object.keys(tabCache.current))
    if (sessionRef.current) ids.add(sessionRef.current)
    for (const id of ids) {
      void post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: id }).catch(() => {})
    }
  }, [])

  const selectDevice = async (value) => {
    const ids = tabs.map((tab) => tab.id)
    setTabs([])
    tabCache.current = {}
    clearSession()
    setHarness(null)
    setPicking(false)
    setDevice(value)
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
      h('span', { style: { marginLeft: 'auto', fontSize: 11, color: session ? C.green : C.mute } },
        session ? '已连接' : '未连接'),
      session && agent ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', height: 24,
        borderRadius: 999, background: C.soft, color: C.ink, fontSize: 11 } },
        h(Glyph, { name: 'bot', size: 14 }),
        h('span', null, (agent.title || agent.name || 'Agent') + (agent.version ? ' ' + agent.version : ''))) : null,
      session && models.length ? h('select', {
        value: model, 'aria-label': '模型', title: '切换模型',
        onChange: (event) => void changeModel(event.target.value),
        style: { ...field, maxWidth: 230 }
      }, models.map((item) => h('option', { key: item.modelId, value: item.modelId, title: item.description || '' },
        item.name || item.modelId))) : null
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
    h('pre', {
      ref: outputRef,
      style: { flex: '1 1 auto', minHeight: 0, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', background: '#0b1220', color: '#e2e8f0', borderRadius: 8,
        padding: '10px 12px', fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 12, lineHeight: 1.55 }
    }, output || '选择一台已安装 ACP Harness 的电脑，点击卡片开始会话。'),
    pending.map((item) => h('div', { key: 'perm-' + item.requestId, style: { display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 11, color: C.mute } }, '授权请求 #' + item.requestId),
      item.options.map((option) => h('button', {
        key: option.optionId, type: 'button', onClick: () => { void reply(item.requestId, option.optionId) },
        style: { ...field, cursor: 'pointer' }
      }, option.name || option.optionId))
    )),
    session && commands.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 0 auto' } },
      commands.map((command) => h('button', {
        key: command.name, type: 'button', title: command.description || command.name,
        onClick: () => setInput('/' + command.name + ' '),
        style: { ...field, height: 22, cursor: 'pointer' }
      }, '/' + command.name))
    ) : null,
    h('form', {
      onSubmit: send,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#0b1220', flex: '0 0 auto' }
    },
      h('span', { style: { color: '#7dd3fc', fontFamily: 'Consolas, monospace', fontSize: 13 } }, '›'),
      h('input', {
        value: input, disabled: !session || !ready, autoFocus: true, spellCheck: false,
        'aria-label': 'Agent 输入', placeholder: session ? (ready ? '给 Agent 发消息，Enter 发送' : '正在启动 Agent…') : '先选择 Harness',
        onChange: (event) => setInput(event.target.value),
        style: { flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: '#e2e8f0', fontFamily: 'Consolas, monospace', fontSize: 13 }
      }),
      h('button', {
        type: 'submit', disabled: !session || !ready || !input.trim(),
        style: { ...button, height: 26, padding: '0 12px', opacity: !session || !ready || !input.trim() ? 0.4 : 1 }
      }, '发送')
    )
  )
}