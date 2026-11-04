import { AGENT_ICONS } from './agent-icons.js'

export function AgentHome({ React, Glyph, C, catalog, harnesses = [], loading = false, error = '',
  installing = '', onRefresh, onInstall, onOpen }) {
  const h = React.createElement
  const [menu, setMenu] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const agents = (catalog && catalog.agents) || []
  const installed = agents.filter((agent) => agent.available)
  const missing = agents.filter((agent) => !agent.available)
  const text = query.trim().toLowerCase()
  const match = (agent) => !text || String(agent.name || '').toLowerCase().includes(text)
    || String(agent.id || '').toLowerCase().includes(text)
  const harnessFor = (agent) => (harnesses || []).find((item) => {
    const hay = (String(item.id || '') + ' ' + String(item.name || '') + ' ' + String(item.command || '')).toLowerCase()
    return hay.includes(String(agent.id || '').toLowerCase())
      || hay.includes(String(agent.name || '').toLowerCase())
  })
  const icon = (agent, size = 34) => {
    const src = AGENT_ICONS[agent.icon]
    return h('span', { style: { width: size, height: size, flex: '0 0 auto', display: 'grid', placeItems: 'center' } },
      src
        ? h('img', { src, alt: '', draggable: false, style: { width: size, height: size, objectFit: 'contain' } })
        : h('span', { style: { width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 9,
          background: agent.color || C.soft, color: '#fff' } }, h(Glyph, { name: 'bot', size: Math.round(size * 0.5) })))
  }
  const field = {
    height: 28, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const openMenu = (event, agent) => {
    if (event) event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const actions = []
    if ((agent.transports || []).includes('workbench')) actions.push({ id: 'workbench', label: 'DSH 工作台', hint: '原生 Web' })
    if ((agent.transports || []).includes('terminal')) actions.push({ id: 'terminal', label: '终端', hint: '原生 TUI' })
    if ((agent.transports || []).includes('web')) actions.push({ id: 'web', label: '原生 Web', hint: '本机界面' })
    const harness = harnessFor(agent)
    if (harness) actions.push({ id: 'acp', label: '结构化会话', hint: harness.name || harness.id, harness })
    setMenu({
      agent, harness,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 210)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - actions.length * 34 - 16)),
      actions
    })
  }
  const card = (agent) => h('button', {
    key: agent.id, type: 'button', onClick: (event) => openMenu(event, agent),
    className: 'tether-hover tether-press',
    style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, textAlign: 'left',
      border: '1px solid ' + C.line, borderRadius: 11, background: C.panel || C.bg, color: C.ink, cursor: 'pointer', minWidth: 0 }
  },
    icon(agent),
    h('span', { style: { minWidth: 0, display: 'grid', gap: 3, flex: '1 1 auto' } },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
        h('span', { title: '可用', style: { width: 6, height: 6, borderRadius: 3, background: C.green || '#16a34a', flex: '0 0 auto' } })),
      h('span', { style: { fontSize: 10.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        (agent.version || '版本未知') + ' · ' + (agent.source === 'service' ? '本机服务' : agent.source === 'manual' ? '手动登记' : '自动发现')),
      h('span', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 } },
        ...(agent.transports || []).map((value) => h('span', {
          key: value, style: { padding: '1px 6px', borderRadius: 999, background: C.soft, color: C.sub, fontSize: 10 }
        }, ({ web: 'Web', workbench: '工作台', terminal: '终端', acp: 'ACP', 'app-server': 'App Server' })[value] || value)))))
  const missingRow = (agent) => h('div', {
    key: agent.id,
    style: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9,
      border: '1px solid ' + C.line, background: 'transparent', minWidth: 0 }
  },
    icon(agent, 24),
    h('span', { style: { minWidth: 0, flex: '1 1 auto', display: 'grid', gap: 1 } },
      h('span', { style: { fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
      h('span', { style: { fontSize: 10, color: C.mute } }, (agent.install && agent.install.kind === 'npm') ? 'npm 安装到 ' + ((catalog && catalog.home) || 'Agent Home') : '需官方安装器')),
    h('button', {
      type: 'button', disabled: installing === agent.id,
      onClick: () => onInstall && onInstall(agent),
      style: { ...field, height: 24, padding: '0 9px', cursor: installing === agent.id ? 'default' : 'pointer',
        opacity: installing === agent.id ? 0.5 : 1, flex: '0 0 auto', background: 'transparent' }
    }, installing === agent.id ? '安装中…' : '安装'))
  const closeMenu = () => setMenu(null)
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 14, fontWeight: 600, color: C.ink } }, '本机 Agent'),
      h('span', { style: { fontSize: 11, color: C.mute } }, installed.length + ' 可用 · ' + missing.length + ' 未安装'),
      h('input', {
        value: query, onChange: (event) => setQuery(event.target.value), placeholder: '搜索 Agent',
        style: { ...field, marginLeft: 'auto', width: 180 }
      })),
    error ? h('div', { style: { color: C.red, fontSize: 11.5 } }, error) : null,
    h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start' } },
      installed.length ? h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' } },
        ...installed.filter(match).map(card)) : h('div', { style: { color: C.mute, fontSize: 12, padding: 8 } },
        loading ? '正在读取 Agent 目录…' : '这台电脑还没有可用的 Agent'),
      missing.filter(match).length ? h('div', { style: { display: 'grid', gap: 8, marginTop: 4 } },
        h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 4 } }, '未安装'),
        h('div', { style: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } },
          ...missing.filter(match).map(missingRow))) : null),
    menu ? h('div', {
      onPointerDown: (event) => { event.preventDefault(); closeMenu() },
      style: { position: 'fixed', inset: 0, zIndex: 90, background: 'transparent' }
    }) : null,
    menu ? h('div', { role: 'menu', style: { position: 'fixed', left: menu.left, top: menu.top, width: 202, zIndex: 100,
      background: C.layer1, borderRadius: 9, boxShadow: C.shadow, padding: 4 } },
      menu.actions.map((action) => h('button', {
        key: action.id, type: 'button', className: 'tether-hover',
        onClick: () => {
          const current = menu
          closeMenu()
          if (onOpen) onOpen(current.agent, action.id, action.harness)
        },
        style: { display: 'flex', width: '100%', alignItems: 'center', gap: 8, height: 32, padding: '0 8px',
          border: 0, borderRadius: 6, background: 'transparent', color: C.ink, fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }
      },
        h('span', null, action.label),
        h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: C.mute } }, action.hint)))
    ) : null)
}
