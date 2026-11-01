export function createConnectionPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const line = 'var(--dsw-alias-border-secondary, #e4e7ec)'
  const field = { width: '100%', height: 30, boxSizing: 'border-box', border: '1px solid ' + line, borderRadius: 6, padding: '0 8px', background: bg, color: ink, fontSize: 12, font: 'inherit' }
  const primary = { height: 28, padding: '0 10px', border: 0, borderRadius: 6, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: 'pointer', fontSize: 12 }
  const secondary = { height: 28, padding: '0 10px', border: '1px solid ' + line, borderRadius: 6, color: sub, background: 'transparent', cursor: 'pointer', fontSize: 12 }
  const safeAddress = (value) => {
    try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/, '') } catch (_) { return '未配置' }
  }
  const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '')
  function ConnectionPanel({ open, onClose, info, busy, error, defaultUrl = '', defaultToken = '', defaultEmail = '', onConfigured }) {
    const [server, setServer] = React.useState(defaultUrl || '')
    const [email, setEmail] = React.useState(defaultEmail || '')
    const [password, setPassword] = React.useState('')
    const [totp, setTotp] = React.useState('')
    const [inviteOpen, setInviteOpen] = React.useState(false)
    const [inviteCode, setInviteCode] = React.useState('')
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [invitePassword, setInvitePassword] = React.useState('')
    const [accessToken, setAccessToken] = React.useState(defaultToken || '')
    const [accountEmail, setAccountEmail] = React.useState(defaultEmail || '')
    const [currentPassword, setCurrentPassword] = React.useState('')
    const [newPassword, setNewPassword] = React.useState('')
    const [formBusy, setFormBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    React.useEffect(() => { setAccessToken(defaultToken || '') }, [defaultToken])
    React.useEffect(() => { if (defaultUrl) setServer(defaultUrl) }, [defaultUrl])
    if (!open) return null
    const status = info && info.status || 'unknown'
    const loggedIn = !!accessToken
    const row = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 30, fontSize: 12.5 } },
      h('span', { style: { color: mute } }, label),
      h('span', { style: { color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))
    const title = (text) => h('div', { style: { color: sub, fontSize: 12, fontWeight: 600, margin: '16px 0 8px' } }, text)
    const fieldRow = (label, input) => h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: mute } }, label, input)
    const post = async (path, body, headers = {}) => {
      const base = cleanUrl(server)
      if (!/^https?:\/\/[^/]+/.test(base)) throw new Error('先填写服务器地址')
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {})
      })
      let data = {}
      try { data = await response.json() } catch (_) { /* non-JSON error body */ }
      if (!response.ok) throw new Error((data.detail && (data.detail.error || data.detail.code)) || data.error || ('HTTP ' + response.status))
      return data
    }
    const run = async (kind, work) => {
      setMessage('')
      setFormBusy(kind)
      try { await work() } catch (error) { setMessage(String(error && error.message || error)) } finally { setFormBusy('') }
    }
    const saveLogin = async (data, base, label) => {
      const user = data.user || null
      if (typeof onConfigured === 'function') await onConfigured({ url: base, token: data.token, user })
      setAccessToken(data.token || '')
      setAccountEmail((user && user.email) || '')
      let enrolled = null
      try {
        if (typeof window !== 'undefined' && window.tetherApp && typeof window.tetherApp.enrollDevice === 'function') {
          enrolled = await window.tetherApp.enrollDevice(data.token)
        }
      } catch (_) { /* the account is still logged in if device enrollment is unavailable */ }
      const suffix = enrolled && enrolled.ok ? '，设备已加入账号'
        : enrolled && enrolled.error ? '（设备未登记：' + enrolled.error + '）' : ''
      setMessage(label + '成功' + suffix)
    }
    const login = () => run('login', async () => {
      const data = await post('/api/auth/login', { email: email.trim(), password, totp: totp.trim() })
      saveLogin(data, cleanUrl(server), '登录')
    })
    const acceptInvite = () => run('invite', async () => {
      const data = await post('/api/auth/accept-invite', { code: inviteCode.trim(), email: inviteEmail.trim(), password: invitePassword })
      saveLogin(data, cleanUrl(server), '邀请码注册')
    })
    const changePassword = () => run('password', async () => {
      if (!accessToken) throw new Error('先登录再修改密码')
      const data = await post('/api/auth/password', {
        current_password: currentPassword, new_password: newPassword
      }, { Authorization: 'Bearer ' + accessToken })
      setAccessToken(data.token || '')
      setCurrentPassword('')
      setNewPassword('')
      if (typeof onConfigured === 'function') onConfigured({ url: cleanUrl(server), token: data.token, user: data.user })
      setMessage('密码已修改，其他设备的旧登录已失效')
    })
    return h('div', { onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() }, style: { position: 'absolute', inset: 0, zIndex: 31, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end' } },
      h('section', { className: 'tether-drawer', style: { height: '100%', background: bg, display: 'flex', flexDirection: 'column', boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16,24,40,0.12))' } },
        h('header', { style: { padding: '12px 16px', background: panel, display: 'flex', alignItems: 'center' } },
          h('strong', { style: { fontSize: 14, color: ink } }, '账号'),
          h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭', style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute } }, '×')),
        h('div', { className: 'tether-drawer-body tether-scroll', style: { padding: '14px 16px 24px', overflowY: 'auto' } },
          h('div', { style: { borderRadius: 8, background: panel, padding: '4px 12px', marginBottom: 12 } },
            row('服务器', safeAddress(info && info.address)),
            row('连接状态', status === 'online' ? '已连接' : status === 'offline' ? '不可达' : '未知'),
            row('当前账号', loggedIn ? (accountEmail || '已登录') : '未登录')),
          error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12, marginBottom: 10 } }, error) : null,

          loggedIn ? h('div', null,
            title('修改密码'),
            h('div', { style: { display: 'grid', gap: 7 } },
              fieldRow('当前密码', h('input', { value: currentPassword, onChange: (event) => setCurrentPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
              fieldRow('新密码（至少 10 位）', h('input', { value: newPassword, onChange: (event) => setNewPassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
              h('button', { onClick: changePassword, disabled: !!formBusy, style: { ...secondary, justifySelf: 'start', opacity: formBusy ? 0.5 : 1 } }, formBusy === 'password' ? '修改中…' : '修改密码'),
              h('div', { style: { color: mute, fontSize: 11, lineHeight: '17px' } }, '修改后其他设备的旧登录和 API 令牌都会失效。')))
            : h('div', null,
              title('登录账号'),
              h('div', { style: { display: 'grid', gap: 7 } },
                defaultUrl ? null : fieldRow('服务器地址', h('input', { value: server, onChange: (event) => setServer(event.target.value), placeholder: 'https://hub.example.com', spellCheck: false, style: field })),
                fieldRow('邮箱', h('input', { value: email, onChange: (event) => setEmail(event.target.value), type: 'email', autoComplete: 'username', style: field })),
                h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 110px', gap: 7 } },
                  fieldRow('密码', h('input', { value: password, onChange: (event) => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
                  fieldRow('两步验证码', h('input', { value: totp, onChange: (event) => setTotp(event.target.value), inputMode: 'numeric', maxLength: 6, style: field }))),
                h('button', { onClick: login, disabled: !!formBusy, style: { ...primary, opacity: formBusy ? 0.5 : 1, justifySelf: 'start' } }, formBusy === 'login' ? '登录中…' : '登录')),
              h('button', { onClick: () => setInviteOpen((value) => !value), style: { marginTop: 12, border: 0, background: 'transparent', color: mute, fontSize: 11.5, cursor: 'pointer', padding: 0, justifySelf: 'start' } }, inviteOpen ? '收起邀请码注册' : '首次使用？用邀请码注册'),
              inviteOpen ? h('div', { style: { display: 'grid', gap: 7, marginTop: 8 } },
                h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 } },
                  fieldRow('邀请码', h('input', { value: inviteCode, onChange: (event) => setInviteCode(event.target.value), spellCheck: false, maxLength: 12, style: field })),
                  fieldRow('邮箱', h('input', { value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), type: 'email', style: field }))),
                fieldRow('密码（至少 10 位）', h('input', { value: invitePassword, onChange: (event) => setInvitePassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
                h('button', { onClick: acceptInvite, disabled: !!formBusy, style: { ...secondary, justifySelf: 'start' } }, formBusy === 'invite' ? '创建中…' : '创建账号并登录')) : null),

          message ? h('div', { style: { marginTop: 12, color: message.includes('成功') || message.includes('已修改') ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12 } }, message) : null))
    )
  }
  function ConnectionTrigger({ onClick, status = 'unknown' }) {
    const color = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    return h('button', { onClick, title: '账号', className: 'tether-press tether-hover', style: { marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 999, border: 0, background: bg, color: sub, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', flex: '0 0 auto', boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' } }), '账号')
  }
  return { Panel: ConnectionPanel, Trigger: ConnectionTrigger }
}
