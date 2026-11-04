import { AGENT_ICONS } from './agent-icons.js'
import { AgentAccountsPanel } from './agent-accounts-panel.js'

export function AgentHome({ React, Glyph, C, post, device, catalog, harnesses = [], panes = [], loading = false, error = '',
  installing = '', onInstall, onOpen, onOpenCatalog, onOpenPane, onClosePane, onLoginTerminal }) {
  const h = React.createElement
  const agents = (catalog && catalog.agents) || []
  const installed = agents.filter((agent) => agent.available)
  const first = (installed[0] || agents[0] || {}).id || ''
  const [selectedId, setSelectedId] = React.useState(first)
  const selected = agents.find((agent) => agent.id === selectedId) || agents[0] || null
  React.useEffect(() => {
    if (!agents.length) return
    if (!agents.some((agent) => agent.id === selectedId)) setSelectedId(first)
  }, [catalog])
  const icon = (agent, size) => {
    const src = AGENT_ICONS[agent.icon]
    return src
      ? h('img', { src, alt: '', draggable: false, style: { width: size, height: size, objectFit: 'contain' } })
      : h('span', { style: { width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: Math.round(size / 3),
        background: agent.color || C.soft, color: '#fff' } }, h(Glyph, { name: 'bot', size: Math.round(size * 0.55) }))
  }
  const harnessFor = (agent) => (harnesses || []).find((item) => {
    const hay = (String(item.id || '') + ' ' + String(item.name || '') + ' ' + String(item.command || '')).toLowerCase()
    return hay.includes(String(agent.id || '').toLowerCase()) || hay.includes(String(agent.name || '').toLowerCase())
  })
  const actions = (agent) => {
    if (!agent) return []
    if (!agent.available) {
      return agent.install && agent.install.kind === 'npm'
        ? [{ id: 'install', label: '安装', icon: 'plus', primary: true }] : []
    }
    const list = []
    if ((agent.transports || []).includes('workbench')) list.push({ id: 'workbench', label: '工作台', icon: 'monitor', primary: true })
    if ((agent.transports || []).includes('terminal')) list.push({ id: 'terminal', label: '终端', icon: 'terminal', primary: list.length === 0 })
    if ((agent.transports || []).includes('web')) list.push({ id: 'web', label: 'Web', icon: 'apps', primary: list.length === 0 })
    const harness = harnessFor(agent)
    if (harness) list.push({ id: 'acp', label: '结构化', icon: 'bot', harness, primary: list.length === 0 })
    return list
  }
  const line = '1px solid rgba(9,30,66,.12)'
  const card = { border: line, borderRadius: 12, background: C.panel || C.bg, minWidth: 0, minHeight: 0 }
  const primary = { height: 34, padding: '0 16px', border: 0, borderRadius: 8, fontSize: 12.5, cursor: 'pointer', color: '#fff', background: C.blue }
  const ghost = { height: 34, padding: '0 14px', border: '1px solid rgba(9,30,66,.14)', borderRadius: 8, fontSize: 12.5,
    cursor: 'pointer', color: C.ink, background: C.bg }
  const listRow = (agent) => {
    const active = selected && agent.id === selected.id
    return h('button', {
      key: agent.id, type: 'button', onClick: () => setSelectedId(agent.id),
      className: 'tether-hover', title: agent.name,
      style: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', minHeight: 40, padding: '5px 8px',
        border: 0, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        background: active ? C.soft : 'transparent', color: C.ink, opacity: agent.available ? 1 : 0.6 }
    },
      h('span', { style: { width: 24, height: 24, flex: '0 0 auto', display: 'grid', placeItems: 'center', position: 'relative' } },
        icon(agent, 22),
        h('span', { style: { position: 'absolute', right: -1, bottom: -1, width: 7, height: 7, borderRadius: 4,
          background: agent.available ? (C.blue || '#1570ef') : '#d97706', boxShadow: '0 0 0 1.5px ' + C.bg } })),
      h('span', { style: { minWidth: 0, display: 'grid', gap: 1, flex: '1 1 auto' } },
        h('span', { style: { fontSize: 12.5, fontWeight: active ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
        agent.version ? h('span', { style: { fontSize: 10, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.version) : null),
      agent.available ? null : h('span', { style: { fontSize: 10, color: '#d97706', flex: '0 0 auto' } }, '未装'))
  }
  const actionTile = (agent, action) => h('button', {
    key: action.id, type: 'button',
    disabled: action.id === 'install' && installing === agent.id,
    onClick: () => {
      if (action.id === 'install') { if (onInstall) onInstall(agent) }
      else if (onOpen) onOpen(agent, action.id, action.harness)
    },
    className: 'tether-hover tether-press',
    style: { display: 'flex', alignItems: 'center', gap: 9, minHeight: 42, padding: '0 13px', borderRadius: 10,
      border: '1px solid ' + (action.primary ? 'transparent' : 'rgba(9,30,66,.14)'),
      background: action.primary ? C.blue : C.bg, color: action.primary ? '#fff' : C.ink,
      fontSize: 12.5, fontWeight: 500, cursor: 'pointer', opacity: action.id === 'install' && installing === agent.id ? 0.5 : 1 }
  }, h(Glyph, { name: action.icon, size: 15 }), action.label)
  const info = (label, value, mono) => h('div', { style: { border: '1px solid rgba(9,30,66,.10)', borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 3, minWidth: 0 } },
    h('span', { style: { fontSize: 10.5, color: C.mute } }, label),
    h('span', { style: { fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontFamily: mono ? 'Consolas, monospace' : undefined } }, value))
  const running = panes.length ? h('div', { style: { ...card, gridColumn: '1 / -1', padding: 12, display: 'grid', gap: 8, minHeight: 0 } },
    h('div', { style: { fontSize: 10.5, color: C.mute } }, '运行中'),
    h('div', { className: 'tether-scroll', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6, overflow: 'auto', maxHeight: 160, minHeight: 0 } },
      ...panes.map((pane) => h('div', { key: pane.key, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        borderRadius: 8, background: C.soft } },
        h('span', { style: { width: 6, height: 6, borderRadius: 3, background: pane.kind === 'web' ? C.blue : '#d97706' } }),
        h('span', { style: { minWidth: 0, flex: '1 1 auto', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, pane.title),
        h('button', { type: 'button', onClick: () => onOpenPane && onOpenPane(pane.key),
          style: { ...ghost, height: 24, padding: '0 8px', cursor: 'pointer' } }, '打开'),
        h('button', { type: 'button', title: '关闭', onClick: () => onClosePane && onClosePane(pane.key),
          style: { width: 22, height: 22, border: 0, borderRadius: 5, background: 'transparent', color: C.mute, cursor: 'pointer' } }, '×'))))
  ) : null
  const hero = selected ? h('div', { style: { ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 } },
      h('span', { style: { width: 48, height: 48, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 12,
        background: C.bg, boxShadow: '0 1px 4px rgba(16,24,40,.12)' } }, icon(selected, 32)),
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontSize: 19, fontWeight: 600 } }, selected.name),
        h('div', { style: { fontSize: 11, color: C.mute } }, selected.version || '—')),
      h('button', { type: 'button', title: 'Agent 目录', 'aria-label': 'Agent 设置', onClick: onOpenCatalog,
        style: { ...ghost, height: 30, width: 30, padding: 0, marginLeft: 'auto', display: 'grid', placeItems: 'center', flex: '0 0 auto' } },
        h(Glyph, { name: 'gear', size: 14 }))),
    h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' } },
      ...actions(selected).map((action) => actionTile(selected, action))),
    h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
      info('版本', selected.version || '—'),
      info('工作目录', selected.cwd || '默认工作区', true),
      info('来源', selected.source === 'detected' ? '已检测' : selected.source === 'builtin' ? '内置' : (selected.source || '—')),
      info('账号', selected.accounts ? '多账号' : '—'),
      h('div', { style: { gridColumn: '1 / -1' } }, info('命令', selected.command || '—', true)))) : h('div', { style: { ...card, display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12 } },
    loading ? '…' : '')
  const accounts = selected && selected.accounts
    ? h('div', { style: { ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 } },
      h(AgentAccountsPanel, { key: selected.id, React, Glyph, post, C, device, agent: selected,
        onLoginTerminal: (target, command, argv) => onLoginTerminal && onLoginTerminal(target, command, argv) }))
    : null
  const quickAction = (agent, action) => h('button', {
    key: action.id, type: 'button', title: action.label, 'aria-label': action.label,
    disabled: action.id === 'install' && installing === agent.id,
    onClick: () => {
      if (action.id === 'install') { if (onInstall) onInstall(agent) }
      else if (onOpen) onOpen(agent, action.id, action.harness)
    },
    className: 'tether-hover', style: { width: 26, height: 26, flex: '0 0 auto', display: 'grid', placeItems: 'center',
      border: 0, borderRadius: 6, background: C.bg, color: action.primary ? C.blue : C.sub, cursor: 'pointer', padding: 0 }
  }, h(Glyph, { name: action.icon, size: 14 }))
  const quickRow = (agent) => h('div', { key: agent.id, style: { display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', borderRadius: 9, background: C.soft, minWidth: 0 } },
    icon(agent, 18),
    h('span', { style: { minWidth: 0, flex: '1 1 auto', display: 'grid', gap: 1 } },
      h('span', { style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
      agent.version ? h('span', { style: { fontSize: 9.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.version) : null),
    ...actions(agent).slice(0, 3).map((action) => quickAction(agent, action)))
  const quick = installed.length ? h('div', { style: { ...card, gridColumn: '1 / -1', padding: 12, display: 'grid', gap: 8 } },
    h('div', { style: { fontSize: 10.5, color: C.mute } }, '快速启动'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 } },
      ...installed.map(quickRow))) : null
  const overview = agents.length ? h('div', { style: { ...card, gridColumn: '1 / -1', padding: 12, display: 'grid', gap: 8 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h('span', { style: { fontSize: 10.5, color: C.mute } }, '总览'),
      h('span', { style: { fontSize: 10.5, color: C.mute } }, installed.length + ' / ' + agents.length + ' 可用'),
      h('span', { style: { fontSize: 10.5, color: C.mute } }, panes.length + ' 运行中')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(126px, 1fr))', gap: 6 } },
      ...agents.map((agent) => h('button', {
        key: agent.id, type: 'button', title: agent.name, onClick: () => setSelectedId(agent.id),
        className: 'tether-hover', style: { display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
          border: 0, borderRadius: 8, background: selected && agent.id === selected.id ? C.soft : 'transparent',
          opacity: agent.available ? 1 : 0.5, cursor: 'pointer', minWidth: 0, textAlign: 'left' }
      },
        icon(agent, 22),
        h('span', { style: { minWidth: 0, display: 'grid', gap: 1 } },
          h('span', { style: { fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
          h('span', { style: { fontSize: 9.5, color: C.mute } }, agent.available ? '可用' : '未装')))))) : null
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', gap: 12 } },
    h('div', { style: { width: 240, flex: '0 0 auto', border: line, borderRadius: 12, background: C.panel || C.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', overflow: 'auto', padding: '7px 7px 14px', display: 'flex', flexDirection: 'column', gap: 2 } },
        agents.map(listRow))),
    h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 12, alignContent: 'start', alignItems: 'start',
      gridTemplateColumns: accounts ? 'minmax(0, 1.25fr) minmax(270px, .75fr)' : '1fr' } },
      hero, accounts, running, quick, overview),
    error ? h('div', { style: { position: 'absolute', left: 260, bottom: 20, color: C.red, fontSize: 11.5 } }, error) : null)
}