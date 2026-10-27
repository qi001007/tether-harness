export function createConnectionPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const safeAddress = (value) => {
    try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/, '') } catch (_) { return '未配置' }
  }
  function ConnectionPanel({ open, onClose, info, busy, error, onProbe }) {
    const status = info && info.status || 'unknown'
    if (!open) return null
    const checkedAt = info && info.checkedAt ? new Date(info.checkedAt) : null
    const checked = checkedAt && [checkedAt.getHours(), checkedAt.getMinutes(), checkedAt.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')
    const row = (label, value) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 32, fontSize: 12.5 } },
      h('span', { style: { color: mute } }, label),
      h('span', { style: { color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))
    return h('div', { onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() }, style: { position: 'absolute', inset: 0, zIndex: 31, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end' } },
      h('section', { className: 'tether-drawer', style: { height: '100%', background: bg, display: 'flex', flexDirection: 'column', boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16,24,40,0.12))' } },
        h('header', { style: { padding: '12px 16px', background: panel, display: 'flex', alignItems: 'center' } },
          h('strong', { style: { fontSize: 14, color: ink } }, '服务器连接'),
          h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭', style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute } }, '×')),
        h('div', { className: 'tether-drawer-body', style: { padding: '14px 16px 24px', overflowY: 'auto' } },
          h('div', { style: { borderRadius: 8, background: panel, padding: '4px 12px', marginBottom: 14 } },
            row('服务器地址', safeAddress(info && info.address)),
            row('连接状态', status === 'online' ? '已连接' : status === 'offline' ? '不可达' : '未知'),
            row('最近检测', busy ? '检测中…' : checked ? checked + ' · ' + (status === 'online' ? '成功' : status === 'offline' ? '失败' : '未知') : '尚未检测'),
            row('服务响应耗时', info && Number.isFinite(info.durationMs) ? info.durationMs + ' ms' : '—')),
          error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12, marginBottom: 12 } }, error) : null,
          h('button', { onClick: onProbe, disabled: busy, className: 'tether-press', style: { height: 28, padding: '0 10px', border: 0, borderRadius: 6, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 } }, busy ? '检测中…' : '重新检测'),
          null))
    )
  }
  function ConnectionTrigger({ onClick, status = 'unknown' }) {
    const color = status === 'online' ? 'var(--dsw-alias-state-success-primary, #16a34a)' : status === 'offline' ? 'var(--dsw-alias-state-error-primary, #b42318)' : mute
    return h('button', { onClick, title: '服务器连接', className: 'tether-press tether-hover', style: { marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 999, border: 0, background: bg, color: sub, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', flex: '0 0 auto', boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' } }), '连接')
  }
  return { Panel: ConnectionPanel, Trigger: ConnectionTrigger }
}
