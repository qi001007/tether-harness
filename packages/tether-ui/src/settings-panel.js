export function createSettingsPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const line = 'var(--dsw-alias-border-secondary, #e4e7ec)'
  const field = { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + line, borderRadius: 7, padding: '0 9px', background: bg, color: ink, fontSize: 12.5, font: 'inherit' }
  const primary = { height: 30, padding: '0 12px', border: 0, borderRadius: 7, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: 'pointer', fontSize: 12 }
  const secondary = { height: 30, padding: '0 12px', border: '1px solid ' + line, borderRadius: 7, color: sub, background: 'transparent', cursor: 'pointer', fontSize: 12 }
  const sectionTitle = (text, hint) => h('div', { style: { marginBottom: 12 } },
    h('div', { style: { fontSize: 15, fontWeight: 600, color: ink } }, text),
    hint ? h('div', { style: { marginTop: 4, color: mute, fontSize: 12, lineHeight: '18px' } }, hint) : null)
  const row = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 34, fontSize: 12.5 } },
    h('span', { style: { color: mute } }, label),
    h('span', { style: { color: ink, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value || '—'))
  const fieldRow = (label, input) => h('label', { style: { display: 'grid', gap: 5, fontSize: 12, color: sub } }, label, input)
  const timeText = (value) => {
    if (!value) return '尚未检测'
    try { const date = new Date(value); return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':') } catch (_) { return '尚未检测' }
  }

  function SettingsPanel({ open, onClose, accountEmail = '', accountRole = '', server = '', connection = {}, device = {}, versions = {}, onRefreshConnection, onRestartNode, onOpenPermissions, onLogout, onPasswordChanged }) {
    const [section, setSection] = React.useState('account')
    const [currentPassword, setCurrentPassword] = React.useState('')
    const [newPassword, setNewPassword] = React.useState('')
    const [busy, setBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    if (!open) return null
    const status = connection.status || 'unknown'
    const dotColor = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)'
      : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    const changePassword = async () => {
      if (!server) { setMessage('未配置服务器地址'); return }
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
        setMessage('密码已修改，其他设备的旧登录已失效')
      } catch (error) {
        setMessage(String(error && error.message || error))
      } finally {
        setBusy('')
      }
    }
    const sections = [
      ['account', '账号'],
      ['connection', '连接'],
      ['device', '本机设备'],
      ['updates', '更新'],
      ['permissions', '文件权限'],
      ['about', '关于']
    ]
    const nav = h('div', { style: { width: 158, flex: '0 0 auto', padding: '14px 10px', background: panel, borderRight: '1px solid ' + line, display: 'flex', flexDirection: 'column', gap: 2 } },
      sections.map(([id, label]) => h('button', {
        key: id, type: 'button', onClick: () => { setMessage(''); setSection(id) },
        className: 'tether-hover',
        style: { height: 30, padding: '0 9px', border: 0, borderRadius: 6, textAlign: 'left', background: section === id ? 'var(--dsw-alias-interactive-bg-active, rgba(38,49,72,.10))' : 'transparent', color: section === id ? ink : sub, fontSize: 12.5, cursor: 'pointer' }
      }, label)))
    let body = null
    if (section === 'account') {
      body = h('div', { style: { display: 'grid', gap: 6 } },
        sectionTitle('账号', '账号信息只在这里出现；连接状态请看顶栏的“连接”。'),
        row('邮箱', accountEmail || '未登录'),
        row('角色', accountRole || '—'),
        h('div', { style: { height: 1, background: line, margin: '12px 0' } }),
        h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 8 } }, '修改密码'),
        h('div', { style: { display: 'grid', gap: 8, maxWidth: 320 } },
          fieldRow('当前密码', h('input', { value: currentPassword, onChange: (event) => setCurrentPassword(event.target.value), type: 'password', autoComplete: 'current-password', style: field })),
          fieldRow('新密码（至少 10 位）', h('input', { value: newPassword, onChange: (event) => setNewPassword(event.target.value), type: 'password', autoComplete: 'new-password', style: field })),
          h('button', { onClick: changePassword, disabled: !!busy, style: { ...secondary, justifySelf: 'start' } }, busy === 'password' ? '修改中…' : '修改密码')),
        message ? h('div', { style: { marginTop: 8, color: message.includes('已修改') ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12 } }, message) : null,
        h('div', { style: { marginTop: 18 } },
          h('button', { onClick: onLogout, style: { ...secondary, color: 'var(--dsw-alias-state-error-primary, #b42318)' } }, '退出登录')))
    } else if (section === 'connection') {
      body = h('div', null,
        sectionTitle('连接', '连接灯只表示 Hub 可达与 Node 在线，不代表账号状态。'),
        h('div', { style: { borderRadius: 8, background: panel, padding: '2px 12px' } },
          row('服务器地址', server || '未配置'),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 34, fontSize: 12.5 } },
            h('span', { style: { color: mute } }, '连接状态'),
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dotColor } }),
              status === 'online' ? '已连接' : status === 'offline' ? '不可达' : status === 'checking' ? '检测中' : '未知')),
          row('最近检测', timeText(connection.checkedAt)),
          row('服务响应耗时', Number.isFinite(connection.durationMs) ? connection.durationMs + ' ms' : '—')),
        h('div', { style: { marginTop: 12 } },
          h('button', { onClick: onRefreshConnection, style: secondary }, '刷新连接状态')))
    } else if (section === 'device') {
      body = h('div', null,
        sectionTitle('本机设备', '本机作为目标设备时的登记信息与 Node 控制。'),
        h('div', { style: { borderRadius: 8, background: panel, padding: '2px 12px' } },
          row('设备名', device.name || device.device_id || '—'),
          row('device_id', device.device_id || '—'),
          row('平台', device.platform || '—'),
          row('Node', device.online ? '在线' : '离线'),
          row('版本', [versions.node && ('Node ' + versions.node), versions.app && ('APP ' + versions.app), versions.plugin && ('插件 ' + versions.plugin)].filter(Boolean).join(' · ') || '—')),
        h('div', { style: { marginTop: 12 } },
          h('button', { onClick: onRestartNode, disabled: !device.online, style: { ...secondary, opacity: device.online ? 1 : 0.5 } }, '重启 Node')))
    } else if (section === 'updates') {
      body = h('div', null,
        sectionTitle('更新', '有新版本时，右上角会出现蓝色下载按钮。'),
        h('div', { style: { borderRadius: 8, background: panel, padding: '2px 12px' } },
          row('Node', versions.node || '—'),
          row('APP', versions.app || '—'),
          row('DSH 插件', versions.plugin || '—')))
    } else if (section === 'permissions') {
      body = h('div', null,
        sectionTitle('文件权限', '可写根目录与文件操作审计在独立面板中管理。'),
        h('button', { onClick: onOpenPermissions, style: primary }, '打开文件权限'))
    } else {
      body = h('div', null,
        sectionTitle('关于', 'Tether 客户端与服务端版本信息。'),
        h('div', { style: { borderRadius: 8, background: panel, padding: '2px 12px' } },
          row('客户端', versions.app || '—'),
          row('Node', versions.node || '—'),
          row('DSH 插件', versions.plugin || '—'),
          row('服务器', server || '—')))
    }
    return h('div', { onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() }, style: { position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(16,24,40,0.35)', display: 'grid', placeItems: 'center', padding: 24 } },
      h('section', { role: 'dialog', 'aria-label': '设置', style: { width: 'min(760px, 100%)', height: 'min(560px, 100%)', background: bg, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,0.18))', display: 'flex', flexDirection: 'column' } },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', background: panel, borderBottom: '1px solid ' + line } },
          h('strong', { style: { fontSize: 14 } }, '设置'),
          h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭', style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute } }, '×')),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex' } },
          nav,
          h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: '18px 22px' } }, body)))
    )
  }
  return { SettingsPanel }
}
