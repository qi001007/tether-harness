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

export function createTerminalDock({ React, Glyph, post, C, device, cwd, height = 220, onHeight, onClose }) {
  const h = React.createElement
  const [shells, setShells] = React.useState([])
  const [shell, setShell] = React.useState('')
  const [session, setSession] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const since = React.useRef(0)
  const sessionRef = React.useRef('')
  const outputRef = React.useRef(null)
  const deviceRef = React.useRef(device)
  deviceRef.current = device

  const stop = async () => {
    const current = sessionRef.current
    sessionRef.current = ''
    setSession('')
    if (!current) return
    try {
      await post('/api/devices/' + encodeURIComponent(deviceRef.current) + '/fs/terminal_stop', { session_id: current })
    } catch (_) { /* node may already have closed it */ }
  }

  const start = async (targetCwd, shellId) => {
    if (!device) return
    setBusy(true)
    setError('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_start',
        { cwd: targetCwd || cwd, shell: shellId || shell || undefined })
      if (!result || typeof result.session_id !== 'string') throw new Error('终端没有返回会话标识')
      sessionRef.current = result.session_id
      since.current = 0
      setSession(result.session_id)
      setShell(result.shell || shellId || shell)
      setOutput('')
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || '终端启动失败'))
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    let cancelled = false
    post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_shells', {}).then((result) => {
      if (cancelled) return
      const list = (result && Array.isArray(result.shells)) ? result.shells.filter((item) => item.available) : []
      setShells(list)
      const preferred = (list.find((item) => item.default) || list[0] || {}).id || ''
      setShell(preferred)
      void start(cwd, preferred)
    }).catch((cause) => {
      if (!cancelled) setError(String((cause && (cause.message || cause.code)) || '无法读取终端类型'))
    })
    return () => { cancelled = true; void stop() }
  }, [device, cwd])

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
        if (chunk) setOutput((current) => result.reset ? chunk : current + chunk)
        if (result.closed) {
          if (sessionRef.current === session) {
            sessionRef.current = ''
            setSession('')
          }
        }
      } catch (cause) {
        if (!disposed) setError(String((cause && (cause.message || cause.code)) || '终端输出读取失败'))
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

  const send = async (event) => {
    event.preventDefault()
    if (!session || !input.trim()) return
    const command = input
    setInput('')
    try {
      await post('/api/devices/' + encodeURIComponent(device) + '/fs/terminal_write', {
        session_id: session, data: terminalBase64(command + '\n')
      })
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || '命令发送失败'))
    }
  }

  const beginResize = (event) => {
    if (!onHeight) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (ev) => onHeight(Math.max(140, Math.min(window.innerHeight * 0.7, startHeight + (startY - ev.clientY))))
    const done = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
  }

  const field = {
    height: 24, boxSizing: 'border-box', border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 6, padding: '0 7px', background: 'rgba(255,255,255,.06)', color: '#e2e8f0', fontSize: 11
  }
  return h('div', { style: { flex: '0 0 auto', height, minHeight: 140, display: 'flex', flexDirection: 'column', borderTop: '1px solid ' + C.line, background: '#0b1220', position: 'relative' } },
    h('div', { onPointerDown: beginResize, title: '拖动调整高度', style: { height: 5, flex: '0 0 auto', cursor: 'row-resize', background: 'transparent' } }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, padding: '3px 9px 5px', flex: '0 0 auto', color: '#cbd5e1' } },
      h(Glyph, { name: 'terminal', size: 13 }),
      h('span', { title: cwd, style: { fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' } }, cwd || ''),
      h('select', {
        value: shell, 'aria-label': '终端类型', title: '目标机可用的终端类型',
        disabled: !shells.length || busy,
        onChange: (event) => { const next = event.target.value; setShell(next); void stop().then(() => start(cwd, next)) },
        style: { ...field, maxWidth: 150 }
      }, shells.map((item) => h('option', { key: item.id, value: item.id }, item.name))),
      h('button', { type: 'button', onClick: () => { void stop().then(() => start(cwd, shell)) }, disabled: busy,
        title: '在此目录重启终端', 'aria-label': '在此目录重启终端',
        style: { ...field, cursor: 'pointer' } }, '重启'),
      h('button', { type: 'button', onClick: () => { void stop(); if (onClose) onClose() },
        title: '关闭终端', 'aria-label': '关闭终端', style: { ...field, cursor: 'pointer' } }, '×')
    ),
    h('pre', {
      ref: outputRef,
      style: { flex: '1 1 auto', minHeight: 0, margin: 0, padding: '0 12px 6px', overflow: 'auto', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', color: '#e2e8f0', fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 12, lineHeight: 1.5 }
    }, output || (busy ? '正在启动…' : (error ? '' : '终端就绪'))),
    error ? h('div', { style: { padding: '0 12px 4px', color: '#fca5a5', fontSize: 11, flex: '0 0 auto' } }, error) : null,
    h('form', { onSubmit: send, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 7px', flex: '0 0 auto' } },
      h('span', { style: { color: '#7dd3fc', fontFamily: 'Consolas, monospace', fontSize: 12 } }, '$'),
      h('input', {
        value: input, disabled: !session, spellCheck: false, 'aria-label': '终端命令', placeholder: session ? '输入命令，Enter 执行' : '终端未连接',
        onChange: (event) => setInput(event.target.value),
        style: { flex: '1 1 auto', minWidth: 0, height: 26, border: 0, outline: 'none', background: 'transparent', color: '#e2e8f0', fontFamily: 'Consolas, monospace', fontSize: 12 }
      }),
      h('button', { type: 'submit', disabled: !session || !input.trim(),
        style: { height: 24, padding: '0 10px', border: 0, borderRadius: 6, background: C.blue, color: '#fff', fontSize: 11,
          cursor: 'pointer', opacity: !session || !input.trim() ? 0.4 : 1 } }, '发送')
    )
  )
}