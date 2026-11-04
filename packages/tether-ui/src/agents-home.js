import { AGENT_ICONS } from './agent-icons.js'

export function AgentHome({ React, Glyph, C, catalog, harnesses = [], loading = false, error = '',
  installing = '', onInstall, onOpen }) {
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
  const dot = (agent) => h('span', { style: { position: 'absolute', right: -1, bottom: -1, width: 7, height: 7, borderRadius: 4,
    background: agent.available ? (C.blue || '#1570ef') : '#d97706', boxShadow: '0 0 0 1.5px ' + C.bg } })
  const railItem = (agent) => {
    const active = selected && agent.id === selected.id
    return h('button', {
      key: agent.id, type: 'button', title: agent.name, onClick: () => setSelectedId(agent.id),
      className: 'tether-hover tether-press',
      style: { display: 'flex', alignItems: 'center', gap: 7, height: 34, flex: '0 0 auto',
        padding: active ? '0 12px 0 8px' : '0 8px', border: 0, borderRadius: 999,
        background: active ? (C.panel || C.bg) : 'transparent', color: C.ink, cursor: 'pointer',
        opacity: agent.available ? 1 : 0.55,
        boxShadow: active ? '0 1px 3px rgba(16,24,40,.14)' : 'none' }
    },
      h('span', { style: { width: 22, height: 22, position: 'relative', display: 'grid', placeItems: 'center' } }, icon(agent, 20), dot(agent)),
      active ? h('span', { style: { fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' } }, agent.name) : null)
  }
  const harnessFor = (agent) => (harnesses || []).find((item) => {
    const hay = (String(item.id || '') + ' ' + String(item.name || '') + ' ' + String(item.command || '')).toLowerCase()
    return hay.includes(String(agent.id || '').toLowerCase()) || hay.includes(String(agent.name || '').toLowerCase())
  })
  const actions = (agent) => {
    if (!agent) return []
    if (!agent.available) {
      return agent.install && agent.install.kind === 'npm'
        ? [{ id: 'install', label: installing === agent.id ? '安装中…' : '安装', primary: true }]
        : []
    }
    const list = []
    if ((agent.transports || []).includes('workbench')) list.push({ id: 'workbench', label: '工作台', primary: true })
    if ((agent.transports || []).includes('terminal')) list.push({ id: 'terminal', label: '终端', primary: list.length === 0 })
    if ((agent.transports || []).includes('web')) list.push({ id: 'web', label: 'Web', primary: list.length === 0 })
    const harness = harnessFor(agent)
    if (harness) list.push({ id: 'acp', label: '结构化', harness, primary: list.length === 0 })
    return list
  }
  const fieldPrimary = { height: 32, padding: '0 16px', border: 0, borderRadius: 8, fontSize: 12.5, cursor: 'pointer', color: '#fff', background: C.blue }
  const fieldGhost = { height: 32, padding: '0 14px', border: '1px solid rgba(9,30,66,.14)', borderRadius: 8, fontSize: 12.5,
    cursor: 'pointer', color: C.ink, background: C.bg }
  const hero = selected ? h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '6px 2px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 } },
      h('span', { style: { width: 54, height: 54, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 13,
        background: C.panel || C.bg, boxShadow: '0 1px 4px rgba(16,24,40,.12)' } }, icon(selected, 34)),
      h('div', { style: { minWidth: 0, display: 'grid', gap: 3 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
          h('span', { style: { fontSize: 20, fontWeight: 600, letterSpacing: '-.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected.name),
          h('span', { style: { height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: 6, fontSize: 10.5,
            color: selected.available ? (C.blue || '#1570ef') : '#d97706',
            background: selected.available ? 'rgba(21,112,239,.08)' : 'rgba(217,119,6,.10)' } },
            selected.available ? '可用' : '未安装')),
        selected.version ? h('span', { style: { fontSize: 11.5, color: C.mute } }, selected.version) : null),
      h('span', { style: { marginLeft: 'auto' } })),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      ...actions(selected).map((action) => h('button', {
        key: action.id, type: 'button',
        disabled: action.id === 'install' && installing === selected.id,
        onClick: () => {
          if (action.id === 'install') { if (onInstall) onInstall(selected) }
          else if (onOpen) onOpen(selected, action.id, action.harness)
        },
        style: { ...(action.primary ? fieldPrimary : fieldGhost), opacity: action.id === 'install' && installing === selected.id ? 0.5 : 1 }
      }, action.label))),
    selected.command ? h('div', { style: { fontFamily: 'Consolas, monospace', fontSize: 10.5, color: C.mute,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected.command) : null,
    h('div', { style: { flex: '1 1 auto', minHeight: 0 } })
  ) : h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12 } },
    loading ? '…' : '')

  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 } },
    h('div', { className: 'tether-scroll', style: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto',
      overflowX: 'auto', padding: '2px 0 6px', borderBottom: '1px solid rgba(9,30,66,.10)' } },
      agents.map(railItem)),
    error ? h('div', { style: { color: C.red, fontSize: 11.5 } }, error) : null,
    hero)
}
