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
  const [pending, setPending] = React.useState([])
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const outputRef = React.useRef(null)

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

  const stop = async () => {
    const current = sessionRef.current
    sessionRef.current = ''
    setSession('')
    setReady(false)
    if (!current) return
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: current })
    } catch (_) { /* node may have already closed the session */ }
  }

  const start = async (item) => {
    if (!item || busy) return
    setBusy(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_start',
        { harness: item.id })
      if (!result || typeof result.session_id !== 'string') throw new Error('Agent 没有返回会话标识')
      sessionRef.current = result.session_id
      since.current = 0
      setPending([])
      setReady(false)
      setSession(result.session_id)
      setHarness(item)
      setOutput('ACP · ' + (item.name || item.id) + '\n' + (result.cwd || '') + '\n\n')
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
            if (update.sessionUpdate === 'tool_call' && update.title) lines.push('[工具] ' + update.title)
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
            lines.push('[就绪]')
          } else if (event.type === 'result') {
            flush()
            const reason = (event.result && event.result.stopReason) || 'done'
            lines.push('[完成] ' + reason)
          } else if (event.type === 'error') {
            flush()
            setReady(false)
            lines.push('[错误] ' + String(event.error || 'ACP error'))
          } else if (event.type === 'closed') {
            flush()
            lines.push('[会话结束]')
            if (sessionRef.current === session) {
              sessionRef.current = ''
              setSession('')
            }
          }
        }
        flush()
        if (lines.length) setOutput((current) => current + lines.join('\n') + '\n')
        if (result.closed && sessionRef.current === session) {
          sessionRef.current = ''
          setSession('')
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
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  React.useEffect(() => () => {
    const current = sessionRef.current
    if (current) {
      void post('/api/devices/' + encodeURIComponent(device) + '/fs/acp_stop', { session_id: current }).catch(() => {})
    }
  }, [])

  const selectDevice = async (value) => {
    await stop()
    setOutput('')
    setHarness(null)
    setDevice(value)
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
        session ? '已连接' : '未连接')
    ),
    !session ? h('div', {
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