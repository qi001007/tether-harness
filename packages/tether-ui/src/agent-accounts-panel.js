import { AGENT_ICONS } from './agent-icons.js'
import { readAccount, writeAccount } from './agent-account-cache.js'

const PLAN_LABELS = { plus: 'Plus', pro: 'Pro', free: 'Free', team: 'Team', business: 'Business' }

function planLabel(plan) {
  const key = String(plan || '').toLowerCase()
  return PLAN_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '')
}

function resetText(resetsAt) {
  if (!resetsAt) return ''
  const seconds = Math.max(0, Number(resetsAt) - Math.floor(Date.now() / 1000))
  if (seconds < 60) return '即将重置'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + 'm 后重置'
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    return days + 'd' + (hours ? hours + 'h' : '') + ' 后重置'
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours + 'h' + (rest ? rest + 'm' : '') + ' 后重置'
}

function windowLabel(mins) {
  const value = Number(mins) || 0
  if (value === 300) return '5 小时'
  if (value === 10080) return '7 天'
  if (value >= 1440) return Math.round(value / 1440) + ' 天'
  return Math.round(value / 60) + ' 小时'
}

function quotaColor(percent) {
  if (percent >= 80) return 'var(--dsw-alias-state-error-primary, #dc2626)'
  if (percent >= 50) return 'var(--dsw-alias-state-warning-primary, #d97706)'
  return 'var(--dsw-alias-state-success-primary, #16a34a)'
}

export function AgentAccountsPanel({ React, Glyph, post, C, device, agent, onOpenTerminal, onLoginTerminal, compact = true }) {
  const h = React.createElement
  const [data, setData] = React.useState(() => agent && agent.accounts ? readAccount(device, agent.id) : null)
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [login, setLogin] = React.useState(null)
  const [deleteId, setDeleteId] = React.useState('')
  const enabled = !!(agent && agent.accounts)
  const iconSrc = agent ? AGENT_ICONS[agent.icon] : ''
  const field = {
    height: 30, boxSizing: 'border-box', border: '1px solid rgba(9,30,66,.14)',
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12, outline: 'none'
  }

  const load = React.useCallback(async (fresh) => {
    if (!enabled) { setData(null); return null }
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_accounts',
        { id: agent.id, fresh: fresh === true })
      setData(result || null)
      writeAccount(device, agent.id, result)
      setError('')
      return result
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || '读取失败'))
      return null
    }
  }, [device, agent && agent.id, enabled, post])

  React.useEffect(() => {
    const cached = agent && agent.accounts ? readAccount(device, agent.id) : null
    setData(cached || null)
    setError('')
    setNotice('')
    setOpen(false)
    setLogin(null)
    void load(false)
    const timer = setTimeout(() => { void load(true) }, 350)
    return () => clearTimeout(timer)
  }, [device, agent && agent.id, enabled])

  React.useEffect(() => {
    if (!login || login.status !== 'pending' || !login.loginId) return undefined
    const timer = setInterval(async () => {
      try {
        const status = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_account_login_status',
          { login_id: login.loginId })
        if (!status || !status.status) return
        if (status.status === 'success') {
          setLogin(null)
          setNotice('账号已添加')
          await load()
        } else if (status.status !== 'pending') {
          setLogin({ ...login, ...status })
        }
      } catch (cause) {
        setLogin({ ...login, status: 'error', error: String((cause && cause.message) || cause) })
      }
    }, 1200)
    return () => clearInterval(timer)
  }, [login && login.loginId, login && login.status, device, post, load])

  const call = async (op, body, tag) => {
    setBusy(tag)
    setError('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/' + op, { id: agent.id, ...body })
      if (result) { setData(result); writeAccount(device, agent.id, result) }
      return result
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || cause || '操作失败'))
      return null
    } finally {
      setBusy('')
    }
  }

  const startLogin = async (profileId) => {
    setBusy('login')
    setError('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_account_login_start',
        { id: agent.id, profile: profileId || '' })
      if (!result) return
      if (result.mode === 'device' || result.loginId) {
        setLogin({ ...result, status: 'pending' })
      } else if (result.mode === 'command') {
        setLogin({ ...result, status: 'command' })
        if (onLoginTerminal) onLoginTerminal(agent, result.command, result.argv)
        else if (onOpenTerminal) onOpenTerminal(agent)
      }
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || cause || '登录启动失败'))
    } finally {
      setBusy('')
    }
  }

  const cancelLogin = async () => {
    if (login && login.loginId) {
      try {
        await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_account_login_cancel',
          { login_id: login.loginId })
      } catch (_) { /* already cancelled */ }
    }
    setLogin(null)
  }

  const switchProfile = async (profile) => {
    const result = await call('agents_account_switch', { profile: profile.id }, 'switch')
    if (result) setNotice('已切换到 ' + (profile.email || profile.name) + '，重启当前 Agent 会话后生效')
  }

  const removeProfile = async (profile) => {
    if (deleteId !== profile.id) { setDeleteId(profile.id); return }
    setDeleteId('')
    await call('agents_account_delete', { profile: profile.id }, 'delete')
  }

  const logout = async () => {
    await call('agents_account_logout', {}, 'logout')
    setNotice('已退出当前登录，存档账号仍保留')
  }

  if (!enabled) return null
  const profiles = (data && data.profiles) || []
  const current = profiles.find((profile) => profile.current) || null
  const title = (data && data.title) || (agent.id === 'codex' ? 'ChatGPT (Codex OAuth)' : '账号')
  const count = profiles.length
  const loginMode = (data && data.loginMode) || 'snapshot'

  const avatar = (size) => iconSrc
    ? h('img', { src: iconSrc, alt: '', draggable: false, style: { width: size, height: size, objectFit: 'contain' } })
    : h('span', { style: { width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: Math.round(size / 3),
      background: agent.color || C.soft, color: '#fff', fontSize: Math.round(size * 0.45) } },
      h(Glyph, { name: 'bot', size: Math.round(size * 0.55) }))

  const quotaBar = (profile, key, label) => {
    const usage = profile.usage || {}
    const window = usage[key]
    if (!window || typeof window.usedPercent !== 'number') return null
    const percent = Math.max(0, Math.min(100, window.usedPercent))
    return h('div', { key, style: { display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) 132px', alignItems: 'center', gap: 8 } },
      h('span', { style: { fontSize: 10.5, color: C.mute } }, label || windowLabel(window.windowMins)),
      h('div', { style: { height: 5, borderRadius: 3, background: C.soft, overflow: 'hidden' } },
        h('div', { style: { height: '100%', width: Math.max(2, percent) + '%', borderRadius: 3, background: quotaColor(percent) } })),
      h('span', { style: { fontSize: 10.5, color: C.sub, textAlign: 'right', whiteSpace: 'nowrap' } },
        Math.round(percent) + '% · ' + resetText(window.resetsAt)))
  }

  const quotaLines = (profile) => {
    const usage = profile.usage || {}
    const primary = quotaBar(profile, 'primary')
    const secondary = quotaBar(profile, 'secondary')
    if (!primary && !secondary) return null
    return h('div', { style: { display: 'grid', gap: 6, padding: '8px 10px', border: '1px solid ' + C.line,
      borderRadius: 9, background: C.bg } },
      primary, secondary)
  }

  const badge = (text, color, bg) => h('span', { style: { fontSize: 10, padding: '1px 6px', borderRadius: 999,
    color, background: bg, whiteSpace: 'nowrap' } }, text)

  const accountRow = (profile) => h('div', { key: profile.id, style: { display: 'grid', gap: 9, padding: 12,
    borderRadius: 12, border: '1px solid ' + (profile.current ? 'rgba(21,112,239,.32)' : C.line),
    background: profile.current ? 'rgba(21,112,239,.045)' : C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 } },
      h('span', { style: { width: 30, height: 30, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 8,
        background: C.soft } }, avatar(22)),
      h('div', { style: { minWidth: 0, flex: '1 1 auto', display: 'grid', gap: 2 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
          h('span', { style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            profile.email || profile.name || profile.id),
          profile.current ? badge('当前', C.blue, 'rgba(21,112,239,.10)') : null,
          profile.plan ? badge(planLabel(profile.plan), C.sub, C.soft) : null),
        profile.email && profile.name && profile.name !== profile.email
          ? h('span', { style: { fontSize: 10.5, color: C.mute } }, profile.name) : null),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' } },
        !profile.current ? h('button', {
          type: 'button', disabled: !!busy, onClick: () => switchProfile(profile), className: 'tether-hover',
          style: { ...field, height: 26, padding: '0 9px', cursor: 'pointer', background: 'transparent', color: C.blue }
        }, busy === 'switch' ? '…' : '切换') : null,
        h('button', {
          type: 'button', disabled: !!busy, title: '重新登录', 'aria-label': '重新登录',
          onClick: () => startLogin(profile.id), className: 'tether-hover',
          style: { height: 26, padding: '0 8px', border: '1px solid ' + C.line, borderRadius: 7,
            background: 'transparent', color: C.sub, fontSize: 11, cursor: 'pointer' }
        }, busy === 'login' ? '…' : '重新登录'),
        h('button', {
          type: 'button', title: deleteId === profile.id ? '确认删除' : '删除账号', 'aria-label': '删除账号',
          disabled: !!busy, onClick: () => removeProfile(profile), className: 'tether-hover',
          style: { height: 26, minWidth: deleteId === profile.id ? 56 : 26, padding: '0 7px', border: 0, borderRadius: 6,
            background: deleteId === profile.id ? 'rgba(220,38,38,.08)' : 'transparent',
            color: deleteId === profile.id ? C.red : C.mute, fontSize: 11, cursor: 'pointer' }
        }, deleteId === profile.id ? '确认' : '×'))),
    quotaLines(profile))

  const modal = open ? h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,23,42,.28)',
      display: 'grid', placeItems: 'center', padding: 24 }, onMouseDown: (event) => { if (event.target === event.currentTarget) setOpen(false) }
  },
    h('div', { role: 'dialog', 'aria-label': '账号管理', style: { width: 'min(780px, 94vw)', maxHeight: 'min(84vh, 820px)',
      overflow: 'auto', background: C.bg, borderRadius: 16, boxShadow: C.shadow, padding: '18px 20px 16px',
      display: 'grid', gap: 12, alignContent: 'start' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', { style: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 9, background: C.soft } }, avatar(24)),
        h('div', { style: { minWidth: 0, flex: '1 1 auto', display: 'grid', gap: 1 } },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, title),
          h('div', { style: { fontSize: 11, color: C.mute } }, agent.id === 'codex' ? '管理 ChatGPT 账号' : '管理登录账号')),
        count ? badge(count + ' 个账号', '#15803d', 'rgba(22,163,74,.10)') : null,
        h('button', { type: 'button', title: '关闭', 'aria-label': '关闭账号管理', onClick: () => setOpen(false),
          style: { width: 30, height: 30, border: 0, borderRadius: 7, background: 'transparent', color: C.mute,
            cursor: 'pointer', fontSize: 18 } }, '×')),
      h('div', { style: { display: 'grid', gap: 8 } }, ...profiles.map(accountRow)),
      profiles.length ? null : h('div', { style: { padding: '26px 0', textAlign: 'center', color: C.mute, fontSize: 12 } },
        '还没有登录账号'),
      loginMode === 'snapshot' ? h('button', {
        type: 'button', disabled: !!busy, onClick: () => call('agents_account_save', {}, 'save'), className: 'tether-hover',
        style: { height: 38, border: '1px dashed rgba(21,112,239,.45)', borderRadius: 10, background: 'transparent',
          color: C.blue, fontSize: 12.5, cursor: 'pointer' }
      }, busy === 'save' ? '正在保存…' : '+ 保存当前账号') : h('button', {
        type: 'button', disabled: !!busy, onClick: () => startLogin(''), className: 'tether-hover',
        style: { height: 38, border: '1px dashed rgba(21,112,239,.45)', borderRadius: 10, background: 'transparent',
          color: C.blue, fontSize: 12.5, cursor: 'pointer' }
      }, busy === 'login' ? '正在启动登录…' : '+ 添加其他账号'),
      count && agent.id === 'codex' ? h('button', {
        type: 'button', disabled: !!busy, onClick: logout, className: 'tether-hover',
        style: { height: 32, border: 0, borderRadius: 8, background: 'transparent', color: C.red,
          fontSize: 11.5, cursor: 'pointer', justifySelf: 'start' }
      }, '退出当前登录') : null,
      error ? h('div', { style: { fontSize: 11, color: C.red } }, error) : null,
      notice ? h('div', { style: { fontSize: 11, color: C.sub } }, notice) : null,
      login ? loginOverlay() : null
    )) : null

  function loginOverlay() {
    if (!login) return null
    const device = login.status !== 'command'
    return h('div', { style: { position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.32)',
      display: 'grid', placeItems: 'center', padding: 24 } },
      h('div', { style: { width: 'min(430px, 92vw)', background: C.bg, borderRadius: 14, boxShadow: C.shadow,
        padding: 18, display: 'grid', gap: 12 } },
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, device ? '登录 ChatGPT 账号' : '在终端完成登录'),
        device ? h('div', { style: { fontSize: 11.5, color: C.sub, lineHeight: 1.6 } },
          '在浏览器打开下面的地址，输入设备码完成登录：') : null,
        device ? h('input', { readOnly: true, value: login.url || '', onFocus: (event) => event.target.select(),
          style: { ...field, height: 32, width: '100%', fontFamily: 'Consolas, monospace', fontSize: 11 } }) : null,
        device ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { flex: '1 1 auto', padding: '10px 12px', borderRadius: 9, background: C.soft,
            fontFamily: 'Consolas, monospace', fontSize: 20, letterSpacing: 3, textAlign: 'center' } }, login.code || ''),
          h('button', { type: 'button', onClick: () => copyText(login.code || ''), className: 'tether-hover',
            style: { ...field, height: 32, cursor: 'pointer', background: 'transparent' } }, '复制')) : null,
        device ? h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { type: 'button', onClick: () => openUrl(login.url || ''), className: 'tether-hover',
            style: { flex: '1 1 auto', height: 34, border: 0, borderRadius: 8, background: C.blue, color: '#fff',
              fontSize: 12, cursor: 'pointer' } }, '在浏览器打开'),
          h('button', { type: 'button', onClick: cancelLogin, className: 'tether-hover',
            style: { ...field, height: 34, cursor: 'pointer', background: 'transparent' } }, '取消')) : null,
        !device ? h('div', { style: { fontSize: 11.5, color: C.sub, lineHeight: 1.6 } },
          '在终端执行下面的命令，完成后回到这里点“保存当前账号”。') : null,
        !device ? h('div', { style: { ...field, height: 'auto', padding: '8px 10px', fontFamily: 'Consolas, monospace',
          fontSize: 11, wordBreak: 'break-all' } }, login.command || '') : null,
        device && login.status === 'pending' ? h('div', { style: { fontSize: 11, color: C.sub } }, '等待浏览器完成登录…') : null,
        login.status === 'error' ? h('div', { style: { fontSize: 11, color: C.red } }, login.error || '登录失败') : null,
        !device ? h('button', { type: 'button', onClick: () => setLogin(null), className: 'tether-hover',
          style: { ...field, height: 32, cursor: 'pointer', background: 'transparent' } }, '关闭') : null))
  }

  const compactCard = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('div', { style: { fontSize: 12, fontWeight: 600, color: C.sub, flex: '1 1 auto' } }, '账号'),
      count ? h('span', { style: { fontSize: 10.5, color: C.mute } }, count + ' 个') : null,
      h('button', { type: 'button', onClick: () => setOpen(true), className: 'tether-hover',
        style: { ...field, height: 26, padding: '0 9px', cursor: 'pointer', background: 'transparent', color: C.blue } }, '管理')),
    current ? h('div', { style: { display: 'grid', gap: 7, padding: '9px 10px', borderRadius: 9, background: C.soft } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
        h('span', { style: { width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 7, background: C.bg } }, avatar(17)),
        h('span', { style: { minWidth: 0, flex: '1 1 auto', fontSize: 12, fontWeight: 500, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current.email || current.name),
        current.plan ? badge(planLabel(current.plan), C.sub, C.bg) : null),
      (current.usage && (current.usage.primary || current.usage.secondary))
        ? h('div', { style: { display: 'flex', gap: 10, fontSize: 10.5, color: C.mute } },
          current.usage.primary ? h('span', null, '5h ' + Math.round(current.usage.primary.usedPercent) + '%') : null,
          current.usage.secondary ? h('span', null, '7d ' + Math.round(current.usage.secondary.usedPercent) + '%') : null) : null)
      : h('div', { style: { fontSize: 11.5, color: C.mute } }, '未登录'),
    h('div', { style: { display: 'flex', gap: 6 } },
      loginMode === 'snapshot'
        ? h('button', { type: 'button', disabled: !!busy, onClick: () => call('agents_account_save', {}, 'save'),
            className: 'tether-hover tether-press',
            style: { flex: '1 1 auto', height: 30, border: 0, borderRadius: 8, background: C.blue, color: '#fff',
              fontSize: 11.5, cursor: 'pointer' } }, busy === 'save' ? '…' : '保存当前')
        : h('button', { type: 'button', disabled: !!busy, onClick: () => startLogin(''), className: 'tether-hover tether-press',
            style: { flex: '1 1 auto', height: 30, border: 0, borderRadius: 8, background: C.blue, color: '#fff',
              fontSize: 11.5, cursor: 'pointer' } }, busy === 'login' ? '…' : '添加账号'),
      loginMode === 'command' ? h('button', { type: 'button', disabled: !!busy, onClick: () => call('agents_account_save', {}, 'save'),
        className: 'tether-hover', style: { ...field, height: 30, cursor: 'pointer', background: 'transparent' } },
        busy === 'save' ? '…' : '保存当前') : null),
    error ? h('div', { style: { fontSize: 10.5, color: C.red } }, error) : null,
    notice ? h('div', { style: { fontSize: 10.5, color: C.sub } }, notice) : null)

  return h(React.Fragment, null, compactCard(), modal)
}

function copyText(text) {
  try {
    if (navigator.clipboard && text) navigator.clipboard.writeText(text)
  } catch (_) { /* clipboard unavailable */ }
}

function openUrl(url) {
  if (!url) return
  try {
    if (window.tetherApp && typeof window.tetherApp.openExternal === 'function') {
      window.tetherApp.openExternal(url)
      return
    }
  } catch (_) { /* fall through */ }
  try { window.open(url, '_blank', 'noopener,noreferrer') } catch (_) { /* blocked */ }
}
