function terminalBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ''))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function terminalText(data) {
  const binary = atob(String(data || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

export function createTerminalPage({ React, Glyph, post, C, devices = [], localDevice = '', onNotice, onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const initial = localDevice && online.some((item) => item.device_id === localDevice)
    ? localDevice
    : (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
  const [session, setSession] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const outputRef = React.useRef(null)

  const fail = (error) => {
    const message = String((error && error.message) || error || '终端操作失败')
    setOutput((current) => current + (current && !current.endsWith('\n') ? '\n' : '') + message + '\n')
    if (onError) onError(error)
  }

  const stop = async () => {
    const current = sessionRef.current
    sessionRef.current = ''
    setSession('')
    if (!current) return
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_stop', { session_id: current })
    } catch (_) { /* the node may already have closed the session */ }
  }

  const start = async () => {
    if (!device || busy) return
    setBusy(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_start', {})
      if (!result || typeof result.session_id !== 'string') throw new Error('终端没有返回会话标识')
      sessionRef.current = result.session_id
      since.current = 0
      setSession(result.session_id)
      setOutput('Tether 终端 · ' + device + '\n' + (result.cwd || '') + '\n\n')
      if (onNotice) onNotice('终端已连接：' + device)
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const send = async (event) => {
    if (event) event.preventDefault()
    const command = input
    if (!session || !command.trim()) return
    setInput('')
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_write', {
        session_id: session, data: terminalBase64(command + '\n')
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
        const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_poll',
          { session_id: session, since: since.current })
        if (disposed || !result) return
        const chunk = terminalText(result.data)
        since.current = Number(result.next) || since.current
        if (chunk) {
          setOutput((current) => result.reset ? chunk : current + chunk)
        }
        if (result.closed) {
          if (sessionRef.current === session) {
            sessionRef.current = ''
            setSession('')
          }
        }
      } catch (error) {
        if (!disposed) fail(error)
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, 200)
    void tick()
    return () => { disposed = true; clearInterval(timer) }
  }, [session, device])

  React.useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  React.useEffect(() => () => {
    const current = sessionRef.current
    if (current) {
      void post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_stop', { session_id: current }).catch(() => {})
    }
  }, [])

  const selectDevice = async (value) => {
    await stop()
    setDevice(value)
    setOutput('')
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
        value: device, 'aria-label': '终端目标设备', title: '选择要打开终端的电脑',
        onChange: (event) => { void selectDevice(event.target.value); event.currentTarget.blur() },
        style: { ...field, minWidth: 180 }
      },
        !online.length ? h('option', { value: '' }, '没有在线设备') : null,
        online.map((item) => h('option', { key: item.device_id, value: item.device_id }, item.name || item.device_id))
      ),
      h('button', {
        type: 'button', disabled: !device || busy, onClick: start, style: { ...button, opacity: !device || busy ? 0.5 : 1 }
      }, busy ? '启动中…' : '新建终端'),
      h('button', {
        type: 'button', disabled: !session, onClick: () => void stop(),
        style: { ...field, cursor: session ? 'pointer' : 'default', opacity: session ? 1 : 0.5, background: 'transparent' }
      }, '停止'),
      h('span', { style: { marginLeft: 'auto', fontSize: 11, color: session ? C.green : C.mute } },
        session ? '已连接' : '未连接')
    ),
    h('pre', {
      ref: outputRef,
      style: {
        flex: '1 1 auto', minHeight: 0, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', background: '#0b1220', color: '#e2e8f0', borderRadius: 8,
        padding: '10px 12px', fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 12, lineHeight: 1.55
      }
    }, output || '选择一台设备，点击“新建终端”。\n命令以目标节点当前用户身份执行，不会自动提权。'),
    h('form', {
      onSubmit: send,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#0b1220', flex: '0 0 auto' }
    },
      h('span', { style: { color: '#7dd3fc', fontFamily: 'Consolas, monospace', fontSize: 13 } }, '$'),
      h('input', {
        value: input, disabled: !session, autoFocus: true, spellCheck: false,
        'aria-label': '终端命令', placeholder: session ? '输入命令，Enter 执行' : '先新建终端',
        onChange: (event) => setInput(event.target.value),
        style: { flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: '#e2e8f0', fontFamily: 'Consolas, monospace', fontSize: 13 }
      }),
      h('button', {
        type: 'submit', disabled: !session || !input.trim(),
        style: { ...button, height: 26, padding: '0 12px', opacity: !session || !input.trim() ? 0.4 : 1 }
      }, '发送')
    )
  )
}