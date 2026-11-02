export function createConnectionPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const line = 'var(--dsw-alias-border-secondary, #e4e7ec)'
  const field = { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + line, borderRadius: 7, padding: '0 9px', background: bg, color: ink, fontSize: 12.5, font: 'inherit' }
  const primary = { height: 32, padding: '0 14px', border: 0, borderRadius: 7, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: 'pointer', fontSize: 12.5 }
  const secondary = { height: 30, padding: '0 12px', border: '1px solid ' + line, borderRadius: 7, color: sub, background: 'transparent', cursor: 'pointer', fontSize: 12 }
  const safeAddress = (value) => {
    try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/, '') } catch (_) { return '未配置' }
  }
  const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '')
  const timeText = (value) => {
    if (!value) return '尚未检测'
    try { const date = new Date(value); return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':') } catch (_) { return '尚未检测' }
  }
  function ConnectionPanel({ open, onClose, info, busy, error, onProbe }) {
    if (!open) return null
    const status = info && info.status || 'unknown'
    const dotColor = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    const row = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 32, fontSize: 12.5 } },
      h('span', { style: { color: mute } }, label),
      h('span', { style: { color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))
    return h('div', { onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() }, style: { position: 'absolute', inset: 0, zIndex: 31, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end' } },
      h('section', { className: 'tether-drawer', style: { height: '100%', background: bg, display: 'flex', flexDirection: 'column', boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16,24,40,0.12))' } },
        h('header', { style: { padding: '12px 16px', background: panel, display: 'flex', alignItems: 'center' } },
          h('strong', { style: { fontSize: 14, color: ink } }, '连接'),
          h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭', style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute } }, '×')),
        h('div', { className: 'tether-drawer-body tether-scroll', style: { padding: '14px 16px 24px', overflowY: 'auto' } },
          h('div', { style: { borderRadius: 8, background: panel, padding: '4px 12px', marginBottom: 12 } },
            row('服务器地址', safeAddress(info && info.address)),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 32, fontSize: 12.5 } },
              h('span', { style: { color: mute } }, '连接状态'),
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: ink } },
                h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dotColor, flex: '0 0 auto' } }),
                status === 'online' ? '已连接' : status === 'offline' ? '不可达' : status === 'checking' ? '检测中' : '未知')),
            row('最近检测', busy ? '检测中…' : timeText(info && info.checkedAt)),
            row('服务响应耗时', info && Number.isFinite(info.durationMs) ? info.durationMs + ' ms' : '—')),
          error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12, marginBottom: 10 } }, error) : null,
          h('button', { onClick: onProbe, disabled: busy, className: 'tether-press', style: { ...secondary, opacity: busy ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 } },
            busy ? '刷新中…' : '刷新连接状态')
        )
      )
    )
  }

  function LoginNetwork() {
    const svgRef = React.useRef(null)
    const lineRefs = React.useRef([])
    const nodeRefs = React.useRef([])
    const pointerRef = React.useRef({ x: 0, y: 0, active: false })
    React.useEffect(() => {
      const svg = svgRef.current
      if (!svg) return undefined
      const nodes = [
        { x: 160, y: 150, r: 10, phase: 0.2 },
        { x: 70, y: 208, r: 8.5, phase: 1.7 },
        { x: 252, y: 198, r: 8.5, phase: 3.1 },
        { x: 160, y: 74, r: 9.5, phase: 4.4 }
      ].map((node) => ({ ...node, ox: node.x, oy: node.y, vx: 0, vy: 0 }))
      const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]]
      const reduced = typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      let frame = 0
      let last = performance.now()
      let running = true
      const draw = () => {
        edges.forEach((edge, index) => {
          const line = lineRefs.current[index]
          if (!line) return
          const a = nodes[edge[0]]
          const b = nodes[edge[1]]
          line.setAttribute('x1', a.x.toFixed(2))
          line.setAttribute('y1', a.y.toFixed(2))
          line.setAttribute('x2', b.x.toFixed(2))
          line.setAttribute('y2', b.y.toFixed(2))
        })
        nodes.forEach((node, index) => {
          const circle = nodeRefs.current[index]
          if (!circle) return
          circle.setAttribute('cx', node.x.toFixed(2))
          circle.setAttribute('cy', node.y.toFixed(2))
        })
      }
      const step = (now) => {
        if (!running) return
        const dt = Math.min(34, now - last) / 16.667
        last = now
        const pointer = pointerRef.current
        nodes.forEach((node) => {
          let fx = (node.ox - node.x) * 0.014 + Math.sin(now * 0.0007 + node.phase) * 0.018
          let fy = (node.oy - node.y) * 0.014 + Math.cos(now * 0.0006 + node.phase) * 0.022
          if (pointer.active) {
            const dx = node.x - pointer.x
            const dy = node.y - pointer.y
            const distance = Math.hypot(dx, dy)
            if (distance > 0.1 && distance < 96) {
              const push = (1 - distance / 96) * 0.55
              fx += (dx / distance) * push
              fy += (dy / distance) * push
            }
          }
          node.vx = (node.vx + fx * dt) * 0.955
          node.vy = (node.vy + fy * dt) * 0.955
          node.x += node.vx * dt
          node.y += node.vy * dt
          if (node.x < node.r + 10) { node.x = node.r + 10; node.vx = Math.abs(node.vx) * 0.45 }
          if (node.x > 310 - node.r) { node.x = 310 - node.r; node.vx = -Math.abs(node.vx) * 0.45 }
          if (node.y < node.r + 10) { node.y = node.r + 10; node.vy = Math.abs(node.vy) * 0.45 }
          if (node.y > 250 - node.r) { node.y = 250 - node.r; node.vy = -Math.abs(node.vy) * 0.45 }
        })
        draw()
        frame = requestAnimationFrame(step)
      }
      const move = (event) => {
        const ctm = svg.getScreenCTM()
        if (!ctm) return
        const point = svg.createSVGPoint()
        point.x = event.clientX
        point.y = event.clientY
        const local = point.matrixTransform(ctm.inverse())
        pointerRef.current = { x: local.x, y: local.y, active: true }
      }
      const leave = () => { pointerRef.current = { x: 0, y: 0, active: false } }
      draw()
      if (!reduced) frame = requestAnimationFrame(step)
      svg.addEventListener('pointermove', move)
      svg.addEventListener('pointerleave', leave)
      return () => {
        running = false
        if (frame) cancelAnimationFrame(frame)
        svg.removeEventListener('pointermove', move)
        svg.removeEventListener('pointerleave', leave)
      }
    }, [])
    return h('svg', {
      ref: svgRef, viewBox: '0 0 320 260', 'aria-hidden': true,
      style: { width: '100%', height: 'auto', flex: '1 1 auto', position: 'relative', zIndex: 1, touchAction: 'none' }
    },
      h('defs', null,
        h('linearGradient', { id: 'tether-login-line', gradientUnits: 'userSpaceOnUse', x1: '40', y1: '50', x2: '280', y2: '230' },
          h('stop', { offset: '0%', stopColor: '#3b82f6', stopOpacity: 0.95 }),
          h('stop', { offset: '100%', stopColor: '#f59e0b', stopOpacity: 0.95 }))),
      h('g', { stroke: 'url(#tether-login-line)', strokeWidth: 1.2, fill: 'none' },
        [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]].map((edge, index) =>
          h('line', {
            key: 'edge-' + index,
            ref: (element) => { lineRefs.current[index] = element },
            opacity: index < 3 ? 0.72 : 0.34
          }))),
      h('g', { fill: '#0b1220', stroke: '#3b82f6', strokeWidth: 2 },
        h('circle', { ref: (element) => { nodeRefs.current[1] = element }, r: 8.5 }),
        h('circle', { ref: (element) => { nodeRefs.current[2] = element }, r: 8.5 })),
      h('circle', { ref: (element) => { nodeRefs.current[3] = element }, r: 9.5, fill: '#f59e0b', opacity: 0.95 }),
      h('circle', { ref: (element) => { nodeRefs.current[0] = element }, r: 10, fill: '#fff' }),
      h('g', { fill: 'rgba(255,255,255,.32)' },
        h('circle', { cx: 110, cy: 130, r: 2 }), h('circle', { cx: 210, cy: 120, r: 2 }),
        h('circle', { cx: 120, cy: 210, r: 2 }), h('circle', { cx: 230, cy: 215, r: 2 })))
  }

  function LoginScreen({ defaultUrl = '', defaultEmail = '', onLogin, onExit }) {
    const DEFAULT_SERVER = 'https://8-220-198-26.sslip.io'
    const server = cleanUrl(defaultUrl || DEFAULT_SERVER)
    const [email, setEmail] = React.useState(defaultEmail || '')
    const [password, setPassword] = React.useState('')
    const [totp, setTotp] = React.useState('')
    const [view, setView] = React.useState('login')
    const [inviteCode, setInviteCode] = React.useState('')
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [invitePassword, setInvitePassword] = React.useState('')
    const [busy, setBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    const post = async (path, body) => {
      if (!/^https?:\/\/[^/]+/.test(server)) throw new Error('默认服务器地址无效')
      const response = await fetch(server + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      })
      let data = {}
      try { data = await response.json() } catch (_) { /* non-JSON error body */ }
      if (!response.ok) throw new Error((data.detail && (data.detail.error || data.detail.code)) || data.error || ('HTTP ' + response.status))
      return data
    }
    const run = async (kind, work) => {
      setMessage('')
      setBusy(kind)
      try {
        const data = await work()
        await onLogin({ url: server, token: data.token, user: data.user || null })
      } catch (error) {
        setMessage(String(error && error.message || error))
      } finally {
        setBusy('')
      }
    }
    const login = () => run('login', () => post('/api/auth/login', { email: email.trim(), password, totp: totp.trim() }))
    const acceptInvite = () => run('invite', () => post('/api/auth/accept-invite', { code: inviteCode.trim(), email: inviteEmail.trim(), password: invitePassword }))
    const switchView = (next) => { setMessage(''); setView(next) }
    const fieldRow = (label, input) => h('label', { style: { display: 'grid', gap: 5, fontSize: 12, color: sub } }, label, input)
    const messageSlot = () => h('div', { key: 'message', role: message ? 'alert' : undefined, style: { minHeight: 16, lineHeight: '16px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #b42318)' } }, message)
    const pane = (name, active, offset, children) => h('div', {
      'data-pane': name,
      'aria-hidden': !active,
      inert: active ? undefined : '',
      style: {
        position: 'absolute', inset: 0, padding: '0 30px', display: 'grid', alignContent: 'center', gap: 14,
        opacity: active ? 1 : 0,
        transform: active ? 'translateX(0)' : 'translateX(' + offset + 'px)',
        transition: 'opacity 200ms ease, transform 280ms cubic-bezier(.22,.61,.36,1)',
        pointerEvents: active ? 'auto' : 'none'
      }
    }, children)
    const loginPane = [
      h('div', { key: 'title', style: { display: 'grid', gap: 6, marginBottom: 4 } },
        h('strong', { style: { fontSize: 24, letterSpacing: '.01em' } }, 'Tether'),
        h('span', { style: { color: mute, fontSize: 12.5 } }, '登录你的私有设备网')),
      fieldRow('邮箱', h('input', { key: 'email', value: email, onChange: (event) => setEmail(event.target.value), type: 'email', autoComplete: 'username', autoFocus: true, style: field })),
      h('div', { key: 'credentials', style: { display: 'grid', gridTemplateColumns: '1fr 108px', gap: 8 } },
        fieldRow('密码', h('input', { value: password, onChange: (event) => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
        fieldRow('两步验证码', h('input', { value: totp, onChange: (event) => setTotp(event.target.value), inputMode: 'numeric', maxLength: 6, style: field }))),
      h('button', { key: 'login', onClick: login, disabled: !!busy, style: { ...primary, width: '100%', opacity: busy ? 0.5 : 1 } }, busy === 'login' ? '登录中…' : '登录'),
      messageSlot(),
      h('button', { key: 'invite', onClick: () => switchView('invite'), className: 'tether-hover', style: { border: 0, background: 'transparent', color: mute, fontSize: 11.5, cursor: 'pointer', padding: 0, justifySelf: 'center' } }, '首次使用？用邀请码注册')
    ]
    const invitePane = [
      h('div', { key: 'title', style: { display: 'grid', gap: 6, marginBottom: 4 } },
        h('strong', { style: { fontSize: 24, letterSpacing: '.01em' } }, '邀请码注册'),
        h('span', { style: { color: mute, fontSize: 12.5 } }, '创建账号并加入私有设备网')),
      fieldRow('邀请码', h('input', { key: 'code', value: inviteCode, onChange: (event) => setInviteCode(event.target.value), spellCheck: false, maxLength: 12, style: field })),
      fieldRow('邮箱', h('input', { key: 'email', value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), type: 'email', autoComplete: 'username', style: field })),
      fieldRow('密码（至少 10 位）', h('input', { key: 'password', value: invitePassword, onChange: (event) => setInvitePassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
      h('button', { key: 'create', onClick: acceptInvite, disabled: !!busy, style: { ...primary, width: '100%', opacity: busy ? 0.5 : 1 } }, busy === 'invite' ? '创建中…' : '创建账号并登录'),
      messageSlot(),
      h('button', { key: 'back', onClick: () => switchView('login'), className: 'tether-hover', style: { border: 0, background: 'transparent', color: mute, fontSize: 11.5, cursor: 'pointer', padding: 0, justifySelf: 'center' } }, '已有账号？返回登录')
    ]
    const visual = h('div', { className: 'tether-login-visual', style: {
      position: 'relative', padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      background: 'linear-gradient(155deg, #0b1220 0%, #13233f 55%, #0b1220 100%)', overflow: 'hidden'
    } },
      h('div', { 'aria-hidden': true, style: { position: 'absolute', inset: 0, background: 'radial-gradient(circle at 52% 42%, rgba(59,130,246,.28), transparent 58%)', pointerEvents: 'none' } }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, color: '#fff', position: 'relative', zIndex: 1 } },
        h('span', { style: { width: 28, height: 28, borderRadius: 8, background: '#fff', display: 'grid', placeItems: 'center', color: '#101828', fontWeight: 700, fontSize: 15 } }, 'T'),
        h('span', { style: { fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.8 } }, 'Tether')),
      h(LoginNetwork),
      h('div', { style: { fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', position: 'relative', zIndex: 1 } }, '私有设备网'))
    return h('div', { style: {
      position: 'absolute', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center', padding: 24,
      background: 'radial-gradient(1200px 600px at 18% 8%, #eaf1ff 0%, transparent 60%), radial-gradient(900px 500px at 88% 92%, #fff4e5 0%, transparent 55%), #f7f8fb',
      color: ink, overflow: 'auto'
    } },
      h('style', null, '@media (max-width: 760px){.tether-login-card{grid-template-columns:1fr!important}.tether-login-visual{display:none!important}}'),
      h('div', { className: 'tether-login-card', style: {
        position: 'relative', width: 'min(820px, 100%)', display: 'grid',
        gridTemplateColumns: '320px minmax(0, 1fr)', borderRadius: 18, overflow: 'hidden', background: bg,
        boxShadow: '0 24px 70px rgba(16,24,40,.22)', border: '1px solid rgba(16,24,40,.06)'
      } },
        visual,
        h('div', { className: 'tether-login-stage', style: { position: 'relative', minHeight: 0, padding: '28px 0 26px', display: 'flex', flexDirection: 'column' } },
          onExit ? h('button', {
            type: 'button', onClick: onExit, title: '退出', 'aria-label': '退出', className: 'tether-hover',
            style: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: mute, fontSize: 18, cursor: 'pointer' }
          }, '×') : null,
          h('div', { style: { position: 'relative', height: 344, flex: '0 0 auto' } },
            pane('login', view === 'login', -16, loginPane),
            pane('invite', view === 'invite', 16, invitePane)))
      )
    )
  }

  function ConnectionTrigger({ onClick, status = 'unknown' }) {
    const color = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    return h('button', { onClick, title: '连接', className: 'tether-press tether-hover', style: { height: 26, padding: '0 10px', borderRadius: 999, border: 0, background: bg, color: sub, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', flex: '0 0 auto', boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' } }), '连接')
  }
  return { Panel: ConnectionPanel, Trigger: ConnectionTrigger, LoginScreen }
}
