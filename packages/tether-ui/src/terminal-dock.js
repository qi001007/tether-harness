function terminalBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ''))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function terminalBytes(data) {
  const binary = atob(String(data || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const TERM_FONT = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'

const LIGHT_THEME = {
  background: '#ffffff', foreground: '#333333', cursor: '#333333',
  selectionBackground: 'rgba(0, 120, 212, 0.18)',
  black: '#000000', red: '#cd3131', green: '#107c10', yellow: '#949800',
  blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14',
  brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc',
  brightCyan: '#0598bc', brightWhite: '#a5a5a5'
}

const DARK_THEME = {
  background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
  brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
  brightCyan: '#29b8db', brightWhite: '#e5e5e5'
}

function isDarkTheme() {
  return !!(typeof document !== 'undefined' && document.body && document.body.hasAttribute('data-ds-dark-theme'))
}

export function createTerminalDock({ React, Glyph, post, C, device, cwd, height = 240, onHeight, onClose }) {
  const h = React.createElement
  const runtime = typeof window !== 'undefined' ? window.TetherTerminalRuntime : null
  const [shells, setShells] = React.useState([])
  const [shell, setShell] = React.useState('')
  const [shellMenu, setShellMenu] = React.useState(null)
  const [status, setStatus] = React.useState('starting')
  const [ptyMode, setPtyMode] = React.useState(true)
  const [error, setError] = React.useState('')
  const [legacyOutput, setLegacyOutput] = React.useState('')
  const [legacyInput, setLegacyInput] = React.useState('')
  const [dark, setDark] = React.useState(isDarkTheme)
  const hostRef = React.useRef(null)
  const termRef = React.useRef(null)
  const sessionRef = React.useRef('')
  const shellRef = React.useRef('')
  const ptyRef = React.useRef(true)
  const deviceRef = React.useRef(device)
  const postRef = React.useRef(post)
  const actionsRef = React.useRef({ restart: () => {}, changeShell: () => {}, stop: () => {} })
  deviceRef.current = device
  shellRef.current = shell
  postRef.current = post

  React.useEffect(() => {
    if (typeof MutationObserver === 'undefined' || !document.body) return undefined
    const read = () => setDark(isDarkTheme())
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (termRef.current) termRef.current.options.theme = dark ? DARK_THEME : LIGHT_THEME
  }, [dark])

  React.useEffect(() => {
    if (!shellMenu) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setShellMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shellMenu])

  React.useEffect(() => {
    if (!runtime || !hostRef.current) {
      setStatus('error')
      setError('当前宿主不支持交互终端')
      return undefined
    }
    let disposed = false
    let since = 0
    let inFlight = false
    let failures = 0
    let pending = []
    let sending = false
    let writeTimer = null
    let resizeTimer = null
    let timer = null
    const decoder = new TextDecoder()

    const term = new runtime.Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: TERM_FONT,
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5000,
      allowTransparency: false,
      theme: dark ? DARK_THEME : LIGHT_THEME
    })
    const fit = runtime.FitAddon ? new runtime.FitAddon() : null
    if (fit) term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    if (fit) {
      try { fit.fit() } catch (_) { /* the dock may still be laying out */ }
    }

    const url = (suffix) => '/api/devices/' + encodeURIComponent(device) + '/fs/' + suffix
    const fitNow = () => {
      if (!fit || !hostRef.current || disposed) return
      if (!hostRef.current.clientWidth || !hostRef.current.clientHeight) return
      try { fit.fit() } catch (_) { /* keep the last good size */ }
    }
    const stopSession = async () => {
      const current = sessionRef.current
      sessionRef.current = ''
      pending = []
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null }
      if (!current) return
      try {
        await postRef.current(url('terminal_stop'), { session_id: current })
      } catch (_) { /* node may already have closed it */ }
    }
    const startSession = async (shellId) => {
      fitNow()
      setStatus('starting')
      setError('')
      try {
        const result = await postRef.current(url('terminal_start'), {
          cwd, shell: shellId || undefined, cols: term.cols || 120, rows: term.rows || 30
        })
        if (disposed) {
          if (result && result.session_id) void postRef.current(url('terminal_stop'), { session_id: result.session_id }).catch(() => {})
          return
        }
        if (!result || typeof result.session_id !== 'string') throw new Error('终端没有返回会话标识')
        sessionRef.current = result.session_id
        since = 0
        failures = 0
        const interactive = result.pty === true
        ptyRef.current = interactive
        setPtyMode(interactive)
        setLegacyOutput('')
        setStatus('ready')
        try { term.reset() } catch (_) { /* first open */ }
        term.focus()
        if (fit) {
          try { fit.fit() } catch (_) {}
          void postRef.current(url('terminal_resize'), {
            session_id: result.session_id, cols: term.cols, rows: term.rows
          }).catch(() => {})
        }
      } catch (cause) {
        if (disposed) return
        setStatus('error')
        setError(String((cause && (cause.message || cause.code)) || '终端启动失败'))
      }
    }
    const pump = async () => {
      if (sending || disposed) return
      sending = true
      while (pending.length && !disposed) {
        const current = sessionRef.current
        if (!current) { pending = []; break }
        const data = pending.join('')
        pending = []
        try {
          await postRef.current(url('terminal_write'), { session_id: current, data: terminalBase64(data) })
        } catch (cause) {
          if (!disposed) {
            setStatus('error')
            setError(String((cause && (cause.message || cause.code)) || '命令发送失败'))
          }
          pending = []
          break
        }
      }
      sending = false
    }
    const queueInput = (data) => {
      if (!ptyRef.current || !sessionRef.current || !data) return
      pending.push(data)
      if (!writeTimer) writeTimer = setTimeout(() => { writeTimer = null; void pump() }, 15)
    }
    const tick = async () => {
      if (disposed || document.hidden || inFlight) return
      const current = sessionRef.current
      if (!current) return
      inFlight = true
      try {
        const result = await postRef.current(url('terminal_poll'), { session_id: current, since })
        if (disposed || !result) return
        failures = 0
        since = Number(result.next) || since
        const chunk = terminalBytes(result.data)
        if (chunk.length) {
          if (ptyRef.current) term.write(chunk)
          else setLegacyOutput((text) => (result.reset ? '' : text) + decoder.decode(chunk, { stream: true }))
        }
        if (result.closed) {
          if (sessionRef.current === current) {
            sessionRef.current = ''
            setStatus('ended')
            if (ptyRef.current) term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n')
          }
        }
      } catch (cause) {
        failures += 1
        if (failures >= 3 && !disposed) {
          sessionRef.current = ''
          setStatus('error')
          setError(String((cause && (cause.message || cause.code)) || '终端输出读取失败'))
        }
      } finally {
        inFlight = false
      }
    }
    const applyResize = () => {
      fitNow()
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const current = sessionRef.current
        if (!current || disposed) return
        void postRef.current(url('terminal_resize'), {
          session_id: current, cols: term.cols, rows: term.rows
        }).catch(() => {})
      }, 120)
    }
    const dataSub = term.onData(queueInput)
    const clickFocus = () => term.focus()
    const host = hostRef.current
    host.addEventListener('pointerdown', clickFocus)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.code === 'KeyC') {
        const selection = term.getSelection()
        if (selection && navigator.clipboard) void navigator.clipboard.writeText(selection).catch(() => {})
        return false
      }
      if (event.code === 'KeyV' && navigator.clipboard) {
        void navigator.clipboard.readText().then((text) => { if (text) term.paste(text) }).catch(() => {})
        return false
      }
      return true
    })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyResize) : null
    if (observer) observer.observe(host)

    actionsRef.current = {
      restart: () => { const current = shellRef.current; void stopSession().then(() => startSession(current)) },
      changeShell: (next) => {
        setShell(next)
        shellRef.current = next
        void stopSession().then(() => startSession(next))
      },
      stop: () => { void stopSession() }
    }

    const boot = async () => {
      try {
        const catalog = await postRef.current(url('terminal_shells'), {})
        if (disposed) return
        const list = (catalog && Array.isArray(catalog.shells) ? catalog.shells : [])
          .filter((item) => item && item.available)
        setShells(list)
        const preferred = (list.find((item) => item.default) || list[0] || {}).id || ''
        setShell(preferred)
        shellRef.current = preferred
        await startSession(preferred)
      } catch (cause) {
        if (!disposed) {
          setStatus('error')
          setError(String((cause && (cause.message || cause.code)) || '无法读取终端类型'))
        }
      }
    }
    void boot()
    timer = setInterval(tick, 60)
    void tick()

    return () => {
      disposed = true
      if (timer) clearInterval(timer)
      if (writeTimer) clearTimeout(writeTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (observer) observer.disconnect()
      dataSub.dispose()
      host.removeEventListener('pointerdown', clickFocus)
      const current = sessionRef.current
      sessionRef.current = ''
      if (current) void postRef.current(url('terminal_stop'), { session_id: current }).catch(() => {})
      termRef.current = null
      try { term.dispose() } catch (_) {}
    }
  }, [device, cwd])

  const sendLegacy = async (event) => {
    event.preventDefault()
    const current = sessionRef.current
    const command = legacyInput
    if (!current || !command.trim()) return
    setLegacyInput('')
    const name = (shells.find((item) => item.id === shell) || {}).name || shell || 'shell'
    setLegacyOutput((text) => text + name + '> ' + command + '\n')
    try {
      await post('/api/devices/' + encodeURIComponent(deviceRef.current) + '/fs/terminal_write', {
        session_id: current, data: terminalBase64(command + '\n')
      })
    } catch (cause) {
      setStatus('error')
      setError(String((cause && (cause.message || cause.code)) || '命令发送失败'))
    }
  }

  const beginResize = (event) => {
    if (!onHeight) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (ev) => onHeight(Math.max(160, Math.min(window.innerHeight * 0.7, startHeight + (startY - ev.clientY))))
    const done = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
  }

  const shellLabel = (shells.find((item) => item.id === shell) || {}).name || shell || '终端'
  const openShellMenu = (event) => {
    if (!shells.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    const width = Math.max(176, Math.ceil(rect.width))
    const height = shells.length * 30 + 8
    const openUp = window.innerHeight - rect.bottom < height + 8
    setShellMenu({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, openUp ? rect.top - height - 4 : rect.bottom + 4),
      width
    })
  }

  const palette = dark
    ? { term: '#1e1e1e', chrome: '#252526', ink: '#d4d4d4', mute: '#9da0a6', line: 'rgba(255,255,255,.07)', hover: 'rgba(255,255,255,.08)' }
    : { term: '#ffffff', chrome: '#f4f4f5', ink: '#2f3033', mute: '#77787c', line: 'rgba(0,0,0,.07)', hover: 'rgba(0,0,0,.06)' }
  const menuBg = dark ? '#2b2b2e' : '#ffffff'
  const menuShadow = dark ? '0 10px 28px rgba(0, 0, 0, 0.5)' : (C.shadow || '0 8px 24px rgba(16, 24, 40, 0.12)')
  const dot = status === 'ready' ? (C.green || '#16a34a')
    : status === 'starting' ? (C.amber || '#b54708')
      : (status === 'ended' ? (C.mute || '#667085') : (C.red || '#b42318'))
  const statusLabel = status === 'ready' ? '已连接' : status === 'starting' ? '正在启动' : status === 'ended' ? '已退出' : '连接失败'
  const iconButton = {
    width: 22, height: 22, display: 'grid', placeItems: 'center', border: 0, borderRadius: 5,
    background: 'transparent', color: palette.mute, cursor: 'pointer', padding: 0, flex: '0 0 auto'
  }

  return h('div', {
    style: {
      flex: '0 0 auto', height, minHeight: 160, display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden', borderRadius: '8px 8px 0 0',
      background: palette.term, boxShadow: 'inset 0 1px 0 ' + palette.line
    }
  },
    h('div', {
      onPointerDown: beginResize, title: '拖动调整高度',
      style: { height: 6, flex: '0 0 auto', cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', background: palette.chrome }
    }, h('div', { style: { width: 36, height: 2, borderRadius: 2, background: palette.line } })),
    h('div', {
      style: { display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 6px 0 8px', flex: '0 0 auto', background: palette.chrome, color: palette.ink }
    },
      h('span', { style: { display: 'grid', placeItems: 'center', color: palette.mute, flex: '0 0 auto' } },
        h(Glyph, { name: 'terminal', size: 13 })),
      h('button', {
        type: 'button', 'aria-label': '终端类型', 'aria-haspopup': 'listbox', 'aria-expanded': !!shellMenu,
        title: '目标机可用的终端类型', disabled: !shells.length,
        onClick: openShellMenu, className: 'tether-hover',
        style: {
          height: 20, maxWidth: 160, border: 0, borderRadius: 4, padding: '0 3px',
          background: 'transparent', color: palette.ink, fontSize: 11.5,
          cursor: shells.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 2, flex: '0 0 auto'
        }
      },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, shellLabel),
        h(Glyph, { name: 'chevronDown', size: 10 })),
      ptyMode === false ? h('span', { style: { fontSize: 10, color: C.amber || '#b54708', flex: '0 0 auto' } }, '兼容模式') : null,
      h('span', {
        title: cwd,
        style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: palette.mute }
      }, cwd || ''),
      h('span', { title: statusLabel, 'aria-label': statusLabel, style: { width: 6, height: 6, borderRadius: 99, background: dot, flex: '0 0 auto' } }),
      h('button', {
        type: 'button', title: '在此目录重启终端', 'aria-label': '在此目录重启终端',
        onClick: () => actionsRef.current.restart(),
        style: iconButton
      }, h(Glyph, { name: 'refresh', size: 13 })),
      h('button', {
        type: 'button', title: '关闭终端', 'aria-label': '关闭终端',
        onClick: () => { actionsRef.current.stop(); if (onClose) onClose() },
        style: { ...iconButton, color: palette.ink, fontSize: 16, lineHeight: 1 }
      }, '×')
    ),
    shellMenu ? h('div', {
      onPointerDown: () => setShellMenu(null),
      style: { position: 'fixed', inset: 0, zIndex: 129 }
    }) : null,
    shellMenu ? h('div', {
      role: 'listbox', 'aria-label': '终端类型',
      onPointerDown: (event) => event.stopPropagation(),
      style: {
        position: 'fixed', left: shellMenu.left, top: shellMenu.top, width: shellMenu.width, zIndex: 130,
        padding: 4, borderRadius: 8, background: menuBg, boxShadow: menuShadow,
        border: '1px solid ' + palette.line
      }
    }, shells.map((item) => h('button', {
      key: item.id, type: 'button', role: 'option', 'aria-selected': item.id === shell,
      className: 'tether-hover',
      onClick: () => { setShellMenu(null); if (item.id !== shell) actionsRef.current.changeShell(item.id) },
      style: {
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: 30,
        padding: '0 8px', border: 0, borderRadius: 5, fontSize: 12.5, textAlign: 'left', cursor: 'pointer',
        background: item.id === shell ? (dark ? 'rgba(255,255,255,.06)' : 'rgba(21,112,239,.08)') : 'transparent',
        color: item.id === shell ? (C.blue || '#1570ef') : palette.ink
      }
    },
      h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
      item.id === shell ? h('span', { style: { fontSize: 11, color: C.blue || '#1570ef' } }, '✓') : null
    ))) : null,
    error ? h('div', {
      style: { flex: '0 0 auto', padding: '3px 10px', fontSize: 11, color: C.red || '#b42318', background: dark ? 'rgba(244,63,94,.10)' : 'rgba(180,35,24,.06)' }
    }, error) : null,
    h('div', { className: 'tether-term-body', style: { flex: '1 1 auto', minHeight: 0, padding: '4px 6px 4px', background: palette.term } },
      h('div', { ref: hostRef, className: 'tether-term', style: { width: '100%', height: '100%' } })
    ),
    ptyMode === false ? h('div', { style: { flex: '0 0 auto', background: palette.term, color: dark ? '#cccccc' : '#333333' } },
      h('pre', {
        style: {
          margin: 0, padding: '0 10px 4px', maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: TERM_FONT, fontSize: 12, lineHeight: 1.5
        }
      }, legacyOutput || '兼容模式：节点尚未提供交互式伪终端。'),
      h('form', { onSubmit: sendLegacy, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 6px' } },
        h('span', { style: { color: palette.mute, fontFamily: TERM_FONT, fontSize: 12 } }, '>'),
        h('input', {
          value: legacyInput, spellCheck: false, 'aria-label': '终端命令', placeholder: '输入命令，Enter 执行',
          onChange: (event) => setLegacyInput(event.target.value),
          style: {
            flex: '1 1 auto', minWidth: 0, height: 26, border: 0, outline: 'none', padding: '0 4px',
            background: 'transparent', color: 'inherit', fontFamily: TERM_FONT, fontSize: 12
          }
        })
      )
    ) : null
  )
}