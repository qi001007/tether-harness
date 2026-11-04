export function AgentAccountsPanel({ React, Glyph, post, C, device, agent, autoFocus = false }) {
  const h = React.createElement
  const [data, setData] = React.useState(null)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const enabled = !!(agent && agent.accounts)

  const call = async (op, body) => {
    setBusy(op)
    setError('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/' + op,
        { id: agent.id, ...body })
      setData(result || null)
    } catch (cause) {
      setError(String((cause && (cause.message || cause.code)) || cause || '操作失败'))
    } finally {
      setBusy('')
    }
  }
  React.useEffect(() => {
    if (!enabled) { setData(null); return }
    let cancelled = false
    setData(null)
    setError('')
    void post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_accounts', { id: agent.id })
      .then((result) => { if (!cancelled) setData(result || null) })
      .catch((cause) => { if (!cancelled) setError(String((cause && (cause.message || cause.code)) || '读取失败')) })
    return () => { cancelled = true }
  }, [device, agent && agent.id, enabled])

  if (!enabled) return null
  const profiles = (data && data.profiles) || []
  const field = {
    height: 30, boxSizing: 'border-box', border: '1px solid rgba(9,30,66,.14)',
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12, outline: 'none'
  }
  const save = async () => {
    const label = name.trim() || ('账号 ' + (profiles.length + 1))
    await call('agents_account_save', { name: label })
    setName('')
  }
  const live = (data && data.live) || []
  return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, gap: 8 } },
    live.length ? h('div', { style: { display: 'grid', gap: 3 } },
      live.map((rel) => h('div', { key: rel, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, color: C.mute } },
        h(Glyph, { name: 'shield', size: 11 }),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rel)))) : null,
    profiles.length
      ? h('div', { className: 'tether-scroll', style: { display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', minHeight: 0 } },
        profiles.map((profile) => h('div', {
          key: profile.id,
          style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 8px', borderRadius: 8,
            background: profile.current ? 'rgba(21,112,239,.07)' : 'transparent' }
        },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, flex: '0 0 auto',
            background: profile.current ? C.blue : 'rgba(9,30,66,.22)' } }),
          h('span', { style: { minWidth: 0, flex: '1 1 auto', fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, profile.name),
          profile.current
            ? h('span', { style: { fontSize: 10.5, color: C.blue } }, '当前')
            : h('button', { type: 'button', disabled: busy === 'agents_account_switch',
              onClick: () => void call('agents_account_switch', { profile: profile.id }),
              style: { ...field, height: 24, padding: '0 8px', cursor: 'pointer', background: 'transparent', flex: '0 0 auto' } }, '切换'),
          h('button', { type: 'button', title: '删除', disabled: !!busy,
            onClick: () => void call('agents_account_delete', { profile: profile.id }),
            style: { width: 22, height: 22, border: 0, borderRadius: 5, background: 'transparent', color: C.mute, cursor: 'pointer', flex: '0 0 auto' } }, '×'))))
      : h('div', { style: { fontSize: 11.5, color: C.mute, padding: '2px 0' } }, busy ? '…' : ''),
    h('div', { style: { display: 'flex', gap: 6, marginTop: 'auto' } },
      h('input', {
        value: name, autoFocus, placeholder: '账号名称', onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } },
        style: { ...field, flex: '1 1 auto', minWidth: 0 }
      }),
      h('button', { type: 'button', disabled: !!busy, onClick: () => void save(),
        style: { ...field, height: 30, padding: '0 10px', cursor: busy ? 'default' : 'pointer', background: 'transparent', flex: '0 0 auto' } },
        busy === 'agents_account_save' ? '…' : '保存当前')),
    error ? h('div', { style: { fontSize: 11, color: C.red } }, error) : null)
}