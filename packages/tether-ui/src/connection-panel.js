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

  function LoginScreen({ defaultUrl = '', defaultEmail = '', onLogin }) {
    const [server, setServer] = React.useState(defaultUrl || '')
    const [email, setEmail] = React.useState(defaultEmail || '')
    const [password, setPassword] = React.useState('')
    const [totp, setTotp] = React.useState('')
    const [inviteOpen, setInviteOpen] = React.useState(false)
    const [inviteCode, setInviteCode] = React.useState('')
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [invitePassword, setInvitePassword] = React.useState('')
    const [busy, setBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    React.useEffect(() => { if (defaultUrl) setServer(defaultUrl) }, [defaultUrl])
    const post = async (path, body) => {
      const base = cleanUrl(server)
      if (!/^https?:\/\/[^/]+/.test(base)) throw new Error('请先填写服务器地址')
      const response = await fetch(base + path, {
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
        await onLogin({ url: cleanUrl(server), token: data.token, user: data.user || null })
      } catch (error) {
        setMessage(String(error && error.message || error))
      } finally {
        setBusy('')
      }
    }
    const login = () => run('login', () => post('/api/auth/login', { email: email.trim(), password, totp: totp.trim() }))
    const acceptInvite = () => run('invite', () => post('/api/auth/accept-invite', { code: inviteCode.trim(), email: inviteEmail.trim(), password: invitePassword }))
    const fieldRow = (label, input) => h('label', { style: { display: 'grid', gap: 5, fontSize: 12, color: sub } }, label, input)
    return h('div', { style: { position: 'fixed', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center', background: 'var(--tether-workbench-bg, #ffffff)', color: ink } },
      h('div', { style: { width: 'min(392px, calc(100vw - 40px))', display: 'grid', gap: 14, padding: '28px 26px 24px', borderRadius: 14, background: bg, boxShadow: '0 18px 50px rgba(16,24,40,0.14)' } },
        h('div', { style: { display: 'grid', gap: 6, marginBottom: 4 } },
          h('strong', { style: { fontSize: 22, letterSpacing: '.01em' } }, 'Tether'),
          h('span', { style: { color: mute, fontSize: 12.5 } }, '登录后，这台设备会自动加入你的私有设备网。')),
        defaultUrl ? null : fieldRow('服务器地址', h('input', { value: server, onChange: (event) => setServer(event.target.value), placeholder: 'https://hub.example.com', spellCheck: false, style: field })),
        fieldRow('邮箱', h('input', { value: email, onChange: (event) => setEmail(event.target.value), type: 'email', autoComplete: 'username', autoFocus: true, style: field })),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 108px', gap: 8 } },
          fieldRow('密码', h('input', { value: password, onChange: (event) => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
          fieldRow('两步验证码', h('input', { value: totp, onChange: (event) => setTotp(event.target.value), inputMode: 'numeric', maxLength: 6, style: field }))),
        h('button', { onClick: login, disabled: !!busy, style: { ...primary, width: '100%', opacity: busy ? 0.5 : 1 } }, busy === 'login' ? '登录中…' : '登录'),
        message ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12 } }, message) : null,
        h('button', { onClick: () => setInviteOpen((value) => !value), style: { border: 0, background: 'transparent', color: mute, fontSize: 11.5, cursor: 'pointer', padding: 0, justifySelf: 'center' } }, inviteOpen ? '收起邀请码注册' : '首次使用？用邀请码注册'),
        inviteOpen ? h('div', { style: { display: 'grid', gap: 8, borderTop: '1px solid ' + line, paddingTop: 12 } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
            fieldRow('邀请码', h('input', { value: inviteCode, onChange: (event) => setInviteCode(event.target.value), spellCheck: false, maxLength: 12, style: field })),
            fieldRow('邮箱', h('input', { value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), type: 'email', style: field }))),
          fieldRow('密码（至少 10 位）', h('input', { value: invitePassword, onChange: (event) => setInvitePassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
          h('button', { onClick: acceptInvite, disabled: !!busy, style: { ...secondary, justifySelf: 'start' } }, busy === 'invite' ? '创建中…' : '创建账号并登录')) : null)
    )
  }

  function ConnectionTrigger({ onClick, status = 'unknown' }) {
    const color = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    return h('button', { onClick, title: '连接', className: 'tether-press tether-hover', style: { marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 999, border: 0, background: bg, color: sub, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', flex: '0 0 auto', boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' } }), '连接')
  }
  return { Panel: ConnectionPanel, Trigger: ConnectionTrigger, LoginScreen }
}
