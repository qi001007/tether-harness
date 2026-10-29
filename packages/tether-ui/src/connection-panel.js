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
  function ConnectionPanel({ open, onClose, info, busy, error, onProbe, defaultUrl = '', onConfigured, defaultDeviceId = '', defaultDeviceName = '', platform = 'Windows' }) {
    const initialServer = defaultUrl || (info && /^https?:\/\//.test(info.address || '') ? info.address : '')
    const [server, setServer] = React.useState(initialServer)
    const [email, setEmail] = React.useState('')
    const [password, setPassword] = React.useState('')
    const [totp, setTotp] = React.useState('')
    const [inviteCode, setInviteCode] = React.useState('')
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [invitePassword, setInvitePassword] = React.useState('')
    const [pairCode, setPairCode] = React.useState('')
    const [pairDevice, setPairDevice] = React.useState(defaultDeviceId)
    const [pairName, setPairName] = React.useState(defaultDeviceName || defaultDeviceId)
    const [pairResult, setPairResult] = React.useState('')
    const [formBusy, setFormBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    if (!open) return null
    const status = info && info.status || 'unknown'
    const checkedAt = info && info.checkedAt ? new Date(info.checkedAt) : null
    const checked = checkedAt && [checkedAt.getHours(), checkedAt.getMinutes(), checkedAt.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')
    const row = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 32, fontSize: 12.5 } },
      h('span', { style: { color: mute } }, label),
      h('span', { style: { color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))
    const title = (text) => h('div', { style: { color: sub, fontSize: 12, fontWeight: 600, margin: '16px 0 8px' } }, text)
    const fieldRow = (label, input) => h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: mute } }, label, input)
    const post = async (path, body) => {
      const base = cleanUrl(server)
      if (!/^https?:\/\/[^/]+/.test(base)) throw new Error('先填写服务器地址')
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
      setFormBusy(kind)
      try { await work() } catch (error) { setMessage(String(error && error.message || error)) } finally { setFormBusy('') }
    }
    const saveLogin = (data, base, label) => {
      if (typeof onConfigured === 'function') onConfigured({ url: base, token: data.token, user: data.user })
      setMessage(label + '成功，已保存登录凭据')
    }
    const login = () => run('login', async () => {
      const data = await post('/api/auth/login', { email: email.trim(), password, totp: totp.trim() })
      saveLogin(data, cleanUrl(server), '登录')
    })
    const acceptInvite = () => run('invite', async () => {
      const data = await post('/api/auth/accept-invite', { code: inviteCode.trim(), email: inviteEmail.trim(), password: invitePassword })
      saveLogin(data, cleanUrl(server), '邀请码注册')
    })
    const pair = () => run('pair', async () => {
      const data = await post('/api/pairing/exchange', {
        code: pairCode.trim(), device_id: pairDevice.trim(), name: pairName.trim() || pairDevice.trim(),
        platform, capabilities: {}
      })
      setPairResult(data.token || '')
      setMessage('配对成功，设备令牌已生成')
    })
    const copyPairToken = () => {
      if (!pairResult) return
      try { navigator.clipboard.writeText(pairResult); setMessage('设备令牌已复制') } catch (_) { setMessage('复制失败，请手动选择令牌') }
    }
    return h('div', { onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() }, style: { position: 'absolute', inset: 0, zIndex: 31, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end' } },
      h('section', { className: 'tether-drawer', style: { height: '100%', background: bg, display: 'flex', flexDirection: 'column', boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16,24,40,0.12))' } },
        h('header', { style: { padding: '12px 16px', background: panel, display: 'flex', alignItems: 'center' } },
          h('strong', { style: { fontSize: 14, color: ink } }, '服务器连接'),
          h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭', style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute } }, '×')),
        h('div', { className: 'tether-drawer-body', style: { padding: '14px 16px 24px', overflowY: 'auto' } },
          h('div', { style: { borderRadius: 8, background: panel, padding: '4px 12px', marginBottom: 12 } },
            row('服务器地址', safeAddress(info && info.address)),
            row('连接状态', status === 'online' ? '已连接' : status === 'offline' ? '不可达' : '未知'),
            row('最近检测', busy ? '检测中…' : checked ? checked + ' · ' + (status === 'online' ? '成功' : status === 'offline' ? '失败' : '未知') : '尚未检测'),
            row('服务响应耗时', info && Number.isFinite(info.durationMs) ? info.durationMs + ' ms' : '—')),
          error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12, marginBottom: 10 } }, error) : null,
          h('button', { onClick: onProbe, disabled: busy, className: 'tether-press', style: { ...secondary, opacity: busy ? 0.5 : 1 } }, busy ? '检测中…' : '重新检测'),

          title('账号登录'),
          h('div', { style: { display: 'grid', gap: 7 } },
            fieldRow('服务器地址', h('input', { value: server, onChange: (event) => setServer(event.target.value), placeholder: 'https://hub.example.com', spellCheck: false, style: field })),
            fieldRow('邮箱', h('input', { value: email, onChange: (event) => setEmail(event.target.value), type: 'email', autoComplete: 'username', style: field })),
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 110px', gap: 7 } },
              fieldRow('密码', h('input', { value: password, onChange: (event) => setPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
              fieldRow('两步验证码', h('input', { value: totp, onChange: (event) => setTotp(event.target.value), inputMode: 'numeric', maxLength: 6, style: field }))),
            h('button', { onClick: login, disabled: !!formBusy, style: { ...primary, opacity: formBusy ? 0.5 : 1, justifySelf: 'start' } }, formBusy === 'login' ? '登录中…' : '登录')),

          title('使用邀请码注册'),
          h('div', { style: { display: 'grid', gap: 7 } },
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 } },
              fieldRow('邀请码', h('input', { value: inviteCode, onChange: (event) => setInviteCode(event.target.value), spellCheck: false, maxLength: 12, style: field })),
              fieldRow('邮箱', h('input', { value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), type: 'email', style: field }))),
            fieldRow('密码（至少 10 位）', h('input', { value: invitePassword, onChange: (event) => setInvitePassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
            h('button', { onClick: acceptInvite, disabled: !!formBusy, style: { ...secondary, justifySelf: 'start' } }, formBusy === 'invite' ? '创建中…' : '创建账号并登录')),

          title('本机设备配对'),
          h('div', { style: { display: 'grid', gap: 7 } },
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 } },
              fieldRow('配对码', h('input', { value: pairCode, onChange: (event) => setPairCode(event.target.value), spellCheck: false, maxLength: 12, style: field })),
              fieldRow('设备 ID', h('input', { value: pairDevice, onChange: (event) => setPairDevice(event.target.value), spellCheck: false, style: field }))),
            fieldRow('设备名称', h('input', { value: pairName, onChange: (event) => setPairName(event.target.value), style: field })),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('button', { onClick: pair, disabled: !!formBusy, style: { ...secondary, opacity: formBusy ? 0.5 : 1 } }, formBusy === 'pair' ? '兑换中…' : '兑换设备令牌'),
              pairResult ? h('button', { onClick: copyPairToken, style: secondary }, '复制令牌') : null),
            pairResult ? h('textarea', { readOnly: true, value: pairResult, rows: 2, style: { ...field, height: 'auto', padding: 8, resize: 'vertical', wordBreak: 'break-all' } }) : null,
            h('div', { style: { color: mute, fontSize: 11, lineHeight: '17px' } }, '设备令牌只显示一次。APP 的 Node 可使用这个令牌接入；不要把令牌发到群里。')),

          message ? h('div', { style: { marginTop: 12, color: message.includes('成功') || message.includes('已保存') || message.includes('已复制') ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12 } }, message) : null))
    )
  }
  function ConnectionTrigger({ onClick, status = 'unknown' }) {
    const color = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    return h('button', { onClick, title: '服务器连接', className: 'tether-press tether-hover', style: { marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 999, border: 0, background: bg, color: sub, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', flex: '0 0 auto', boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' } }), '连接')
  }
  return { Panel: ConnectionPanel, Trigger: ConnectionTrigger }
}
