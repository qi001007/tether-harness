export function createSettingsPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const line = 'var(--dsw-alias-border-secondary, #e4e7ec)'
  const blue = 'var(--dsw-alias-state-business-primary, #1570ef)'
  const danger = 'var(--dsw-alias-state-error-primary, #b42318)'
  const success = 'var(--dsw-alias-state-success-primary, #16a34a)'
  const field = { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + line, borderRadius: 7, padding: '0 9px', background: bg, color: ink, fontSize: 12.5, font: 'inherit', outline: 'none' }
  const primary = { height: 30, padding: '0 12px', border: 0, borderRadius: 7, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: 'pointer', fontSize: 12, font: 'inherit' }
  const secondary = { height: 30, padding: '0 12px', border: '1px solid ' + line, borderRadius: 7, color: sub, background: 'transparent', cursor: 'pointer', fontSize: 12, font: 'inherit' }
  const timeText = (value) => {
    if (!value) return '—'
    try { const date = new Date(value); return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':') } catch (_) { return '—' }
  }
  const card = (rows) => h('div', { style: { border: '1px solid ' + line, borderRadius: 10, overflow: 'hidden', background: bg } },
    rows.filter(Boolean).map((row, index) => h('div', {
      key: index,
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, minHeight: 40, padding: '0 14px', borderTop: index ? '1px solid ' + line : 0, fontSize: 12.5 }
    },
      h('span', { style: { color: mute, flex: '0 0 auto' } }, row[0]),
      h('span', { style: { color: ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' } }, row[1] || '—'))))
  const toggle = (checked, onChange, label) => h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, onClick: () => onChange(!checked),
    style: {
      width: 36, height: 20, flex: '0 0 auto', border: 0, borderRadius: 999, padding: 2,
      background: checked ? blue : 'var(--dsw-alias-border-secondary, #d0d5dd)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background 140ms ease'
    }
  }, h('span', {
    'aria-hidden': true,
    style: { width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.24)', transition: 'transform 140ms ease' }
  }))

  function SettingsPanel({ open, onClose, Glyph, accountEmail = '', accountRole = '', accountName = '',
    accountAvatar = '', onAvatarChange, onAccountNameChange, initialSection = 'account',
    server = '', connection = {}, device = {}, versions = {}, extraSections = [],
    onRefreshConnection, onRestartNode, onLogout, onPasswordChanged }) {
    const [section, setSection] = React.useState(initialSection)
    const [currentPassword, setCurrentPassword] = React.useState('')
    const [newPassword, setNewPassword] = React.useState('')
    const [busy, setBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [avatar, setAvatar] = React.useState(accountAvatar || '')
    const [refreshing, setRefreshing] = React.useState(false)
    const avatarInputRef = React.useRef(null)
    const [keepSurfaces, setKeepSurfaces] = React.useState(() => {
      try { return localStorage.getItem('tether.keepSurfaces') !== '0' } catch (_) { return true }
    })
    React.useEffect(() => { if (open) { setSection(initialSection); setMessage('') } }, [open, initialSection])
    React.useEffect(() => { setAvatar(accountAvatar || '') }, [accountAvatar])
    if (!open) return null
    const status = connection.status || 'unknown'
    const roleLabel = accountRole === 'owner' ? '所有者' : accountRole === 'member' ? '成员' : accountRole === 'admin' ? '管理员' : accountRole || ''
    const dotColor = status === 'online' ? success : status === 'offline' ? danger : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    const statusLabel = status === 'online' ? '已连接' : status === 'offline' ? '不可达' : status === 'checking' ? '检测中' : '未知'
    const changePassword = async () => {
      if (!server) { setMessage('未配置服务器地址'); return }
      if (!currentPassword || !newPassword) return
      setMessage('')
      setBusy('password')
      try {
        const response = await fetch(server.replace(/\/+$/, '') + '/api/auth/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (connection.token || '') },
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error((data.detail && (data.detail.error || data.detail.code)) || data.error || ('HTTP ' + response.status))
        setCurrentPassword('')
        setNewPassword('')
        if (typeof onPasswordChanged === 'function') onPasswordChanged(data)
        setMessage('密码已修改')
      } catch (error) {
        setMessage(String(error && error.message || error))
      } finally {
        setBusy('')
      }
    }
    const refreshConnection = async () => {
      if (refreshing || typeof onRefreshConnection !== 'function') return
      setRefreshing(true)
      try { await onRefreshConnection() } finally { setRefreshing(false) }
    }
    const chooseAvatar = () => { try { if (avatarInputRef.current) avatarInputRef.current.click() } catch (_) { /* input unavailable */ } }
    const loadAvatar = (event) => {
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      if (!file || !/^image\//.test(file.type) || file.size > 2 * 1024 * 1024) {
        if (file) setMessage('请选择 2 MB 以内的图片')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const image = new Image()
        image.onload = () => {
          const size = 128
          const canvas = document.createElement('canvas')
          canvas.width = size; canvas.height = size
          const context = canvas.getContext('2d')
          const scale = Math.max(size / image.width, size / image.height)
          const width = image.width * scale
          const height = image.height * scale
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
          setAvatar(dataUrl)
          if (typeof onAvatarChange === 'function') onAvatarChange(dataUrl)
        }
        image.onerror = () => setMessage('无法读取这张图片')
        image.src = String(reader.result || '')
      }
      reader.onerror = () => setMessage('无法读取这张图片')
      reader.readAsDataURL(file)
    }
    const avatarView = h('button', {
      type: 'button', onClick: chooseAvatar, title: '更换头像', 'aria-label': '更换头像',
      style: {
        position: 'relative', width: 56, height: 56, flex: '0 0 auto', padding: 0, border: 0,
        borderRadius: 999, overflow: 'hidden', cursor: 'pointer',
        background: 'color-mix(in srgb, ' + blue + ' 14%, transparent)', color: blue
      }
    },
      avatar
        ? h('img', { src: avatar, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
        : h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: '100%', height: '100%', fontSize: 19, fontWeight: 600 } },
          String(accountName || accountEmail || '?').trim().charAt(0).toUpperCase()),
      h('span', {
        'aria-hidden': true,
        style: {
          position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, borderRadius: 999,
          display: 'grid', placeItems: 'center', background: bg, color: sub,
          boxShadow: '0 0 0 1px ' + line
        }
      }, Glyph ? h(Glyph, { name: 'pencil', size: 11 }) : '✎'))
    const accountSection = h('div', { style: { display: 'grid', gap: 18 } },
      h('input', { ref: avatarInputRef, type: 'file', accept: 'image/*', onChange: loadAvatar, style: { display: 'none' } }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
        avatarView,
        h('div', { style: { minWidth: 0, display: 'grid', gap: 3 } },
          h('div', { style: { fontSize: 13.5, fontWeight: 600, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, accountEmail || '未登录'),
          roleLabel ? h('div', { style: { fontSize: 12, color: mute } }, roleLabel) : null)),
      h('label', { style: { display: 'grid', gap: 6, fontSize: 12, color: sub, maxWidth: 320 } },
        '显示名称',
        h('input', {
          value: accountName, placeholder: '未设置', maxLength: 32,
          onChange: (event) => { if (typeof onAccountNameChange === 'function') onAccountNameChange(event.target.value) },
          style: field
        })),
      h('div', { style: { height: 1, background: line } }),
      h('div', { style: { display: 'grid', gap: 10, maxWidth: 320 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: ink } }, '密码'),
        h('input', { value: currentPassword, onChange: (event) => setCurrentPassword(event.target.value), type: 'password', autoComplete: 'current-password', placeholder: '当前密码', 'aria-label': '当前密码', style: field }),
        h('input', { value: newPassword, onChange: (event) => setNewPassword(event.target.value), type: 'password', autoComplete: 'new-password', placeholder: '新密码（至少 10 位）', 'aria-label': '新密码', style: field }),
        h('button', {
          type: 'button', onClick: changePassword, disabled: !!busy || !currentPassword || !newPassword,
          style: { ...secondary, justifySelf: 'start', opacity: busy || !currentPassword || !newPassword ? 0.5 : 1 }
        }, busy === 'password' ? '修改中…' : '修改密码'),
        message ? h('div', { role: 'status', style: { color: message === '密码已修改' ? success : danger, fontSize: 12 } }, message) : null),
      h('div', { style: { height: 1, background: line } }),
      h('button', {
        type: 'button', onClick: onLogout,
        className: 'tether-hover',
        style: { justifySelf: 'start', border: 0, background: 'transparent', padding: 0, color: danger, fontSize: 12.5, cursor: 'pointer' }
      }, '退出登录'))
    const connectionSection = h('div', { style: { display: 'grid', gap: 10 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 } },
        h('span', { style: { flex: '1 1 auto', fontSize: 12, color: mute } }, '服务器'),
        h('button', {
          type: 'button', onClick: refreshConnection, disabled: refreshing, title: '重新检测', 'aria-label': '重新检测',
          className: 'tether-hover',
          style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: sub, cursor: refreshing ? 'default' : 'pointer' }
        }, Glyph ? h('span', { className: refreshing ? 'tether-spin' : '', style: { display: 'grid', placeItems: 'center' } }, h(Glyph, { name: 'refresh', size: 15 })) : '↻')),
      card([
        ['地址', server || '未配置'],
        ['状态', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dotColor } }), statusLabel)],
        ['最近检测', timeText(connection.checkedAt)],
        ['响应', Number.isFinite(connection.durationMs) ? connection.durationMs + ' ms' : '—']
      ]))
    const workspaceSection = h('div', { style: { display: 'grid', gap: 12 } },
      h('div', {
        title: '切换设备时保留最近三个原生工作区；关闭后释放后台页面',
        style: { display: 'flex', alignItems: 'center', gap: 16, minHeight: 44 }
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { fontSize: 13, color: ink } }, '保留最近设备工作区'),
          h('div', { style: { marginTop: 2, fontSize: 11.5, color: mute } }, '最多 3 台')),
        toggle(keepSurfaces, (next) => {
          setKeepSurfaces(next)
          try { localStorage.setItem('tether.keepSurfaces', next ? '1' : '0') } catch (_) { /* storage unavailable */ }
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('tether-surfaces-pref'))
        }, '保留最近设备工作区')))
    const deviceSection = h('div', { style: { display: 'grid', gap: 12 } },
      card([
        ['设备名', device.name || device.device_id || '—'],
        ['设备 ID', device.device_id || '—'],
        ['平台', (device.capabilities && device.capabilities.os_label) || device.platform || '—'],
        ['Node', device.online ? '在线' : '离线']
      ]),
      h('div', null,
        h('button', {
          type: 'button', onClick: onRestartNode, disabled: !device.online,
          style: { ...secondary, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: device.online ? 1 : 0.5, cursor: device.online ? 'pointer' : 'default' }
        }, Glyph ? h(Glyph, { name: 'refresh', size: 14 }) : null, '重启 Node')))
    const versionRows = [
      ['客户端', versions.app || '—'],
      ['Node', versions.node || '—'],
      ['DSH 插件', versions.plugin || '—']
    ]
    const aboutSection = h('div', { style: { display: 'grid', gap: 14 } },
      h('div', { style: { fontSize: 17, fontWeight: 600, color: ink } }, 'Tether'),
      card(versionRows))
    const builtIn = [
      { id: 'account', label: '账号', render: () => accountSection },
      { id: 'connection', label: '连接', render: () => connectionSection },
      { id: 'workspace', label: '工作区', render: () => workspaceSection },
      { id: 'device', label: '本机设备', render: () => deviceSection },
      { id: 'about', label: '关于', render: () => aboutSection }
    ]
    const sections = builtIn.concat((Array.isArray(extraSections) ? extraSections : [])
      .filter((item) => item && item.id && item.label && typeof item.render === 'function'))
    const current = sections.find((item) => item.id === section) || sections[0]
    const nav = h('div', {
      style: { width: 150, flex: '0 0 auto', padding: '12px 8px', background: panel, borderRight: '1px solid ' + line, display: 'flex', flexDirection: 'column', gap: 2 }
    },
      sections.map((item) => h('button', {
        key: item.id, type: 'button', onClick: () => { setMessage(''); setSection(item.id) },
        className: 'tether-hover', 'aria-current': current.id === item.id ? 'page' : undefined,
        style: {
          height: 30, padding: '0 10px', border: 0, borderRadius: 6, textAlign: 'left',
          background: current.id === item.id ? 'var(--dsw-alias-interactive-bg-active, rgba(38,49,72,.10))' : 'transparent',
          color: current.id === item.id ? ink : sub, fontSize: 12.5, cursor: 'pointer', font: 'inherit'
        }
      }, item.label)))
    return h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() },
      style: { position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(16,24,40,0.35)', display: 'grid', placeItems: 'center', padding: 24 }
    },
      h('section', {
        role: 'dialog', 'aria-label': '设置',
        style: { width: 'min(760px, 100%)', height: 'min(560px, 100%)', background: bg, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,0.18))', display: 'flex', flexDirection: 'column' }
      },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', background: panel, borderBottom: '1px solid ' + line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 14 } }, '设置'),
          h('button', {
            type: 'button', onClick: onClose, title: '关闭', 'aria-label': '关闭', className: 'tether-hover',
            style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute }
          }, '×')),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex' } },
          nav,
          h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: '20px 24px' } }, current.render()))))
  }
  return { SettingsPanel }
}