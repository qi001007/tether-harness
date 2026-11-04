import { AGENT_ICONS } from './agent-icons.js'

export function AgentCatalogView({ React, Glyph, post, C, device, onClose }) {
  const h = React.createElement
  const [catalog, setCatalog] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [selectedId, setSelectedId] = React.useState('')
  const [draft, setDraft] = React.useState(null)
  const [editor, setEditor] = React.useState(null)
  const colors = (catalog && catalog.colors) || ['#2563eb', '#d97706', '#7c3aed', '#0f766e', '#c2410c', '#0891b2', '#be185d', '#111827']
  const kinds = [['app-server', 'App Server'], ['acp', 'ACP'], ['web', '原生 Web'], ['cli', '终端']]
  const agents = (catalog && catalog.agents) || []
  const selected = agents.find((item) => item.id === selectedId) || null
  const transportLabel = (value) => ({ web: '原生 Web', 'app-server': 'App Server', acp: 'ACP', terminal: '终端' }[value] || value)
  const sourceLabel = (value) => ({ detected: '自动发现', manual: '手动登记', overridden: '手动覆盖', service: '本机服务', builtin: '未发现' }[value] || value)

  const applyCatalog = (data, keepSelected) => {
    setCatalog(data)
    const list = (data && data.agents) || []
    const next = list.find((item) => item.id === keepSelected) || list.find((item) => item.available) || list[0]
    if (next) {
      setSelectedId(next.id)
      setDraft({
        name: next.name, command: next.command, argsText: (next.args || []).join(' '),
        kind: next.kind, color: next.color, enabled: next.enabled !== false
      })
    } else {
      setSelectedId('')
      setDraft(null)
    }
  }

  const load = async (fresh, keepSelected) => {
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog', { fresh: fresh === true })
      applyCatalog(data, keepSelected || selectedId)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '读取 Agent 目录失败'))
    } finally {
      setBusy(false)
    }
  }
  React.useEffect(() => {
    setSelectedId('')
    setDraft(null)
    void load(false, '')
  }, [device])

  const selectAgent = (agent) => {
    setSelectedId(agent.id)
    setDraft({
      name: agent.name, command: agent.command, argsText: (agent.args || []).join(' '),
      kind: agent.kind, color: agent.color, enabled: agent.enabled !== false
    })
    setError('')
  }

  const saveDraft = async () => {
    if (!selected || !draft) return
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_save', {
        id: selected.id, name: draft.name, command: draft.command,
        args: draft.argsText.split(/\s+/).filter(Boolean), kind: draft.kind,
        color: draft.color, enabled: draft.enabled
      })
      applyCatalog(data, selected.id)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (agent) => {
    if (!agent) return
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_delete', { id: agent.id })
      applyCatalog(data, '')
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '删除失败'))
    } finally {
      setBusy(false)
    }
  }

  const openAdd = () => {
    setEditor({ name: '', command: '', argsText: '', kind: 'acp', color: colors[0], enabled: true })
    setError('')
  }
  const saveAdd = async (event) => {
    if (event) event.preventDefault()
    if (!editor) return
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_save', {
        name: editor.name, command: editor.command,
        args: editor.argsText.split(/\s+/).filter(Boolean), kind: editor.kind,
        color: editor.color, enabled: editor.enabled
      })
      setEditor(null)
      applyCatalog(data, '')
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const field = {
    height: 30, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12, outline: 'none'
  }
  const primary = {
    height: 30, padding: '0 12px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const iconFor = (agent) => AGENT_ICONS[agent.id]
    ? h('img', { src: AGENT_ICONS[agent.id], alt: '', 'aria-hidden': true, style: { width: 18, height: 18, flex: '0 0 auto', objectFit: 'contain' } })
    : h('span', { style: { width: 18, height: 18, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 5, background: C.soft, color: C.sub } }, h(Glyph, { name: 'bot', size: 12 }))
  const statusBadge = (agent, compact) => {
    const tone = agent.available
      ? { border: 'rgba(22,163,74,.4)', bg: 'rgba(22,163,74,.08)', color: C.green }
      : { border: 'rgba(180,35,24,.35)', bg: 'rgba(180,35,24,.06)', color: C.red }
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: compact ? '0 6px' : '0 8px',
      borderRadius: 6, border: '1px solid ' + tone.border, background: tone.bg, color: tone.color, fontSize: 10.5, whiteSpace: 'nowrap' } },
      agent.available ? '可用' : '未安装',
      h('button', {
        type: 'button', title: '重新检查', 'aria-label': '重新检查 ' + agent.name,
        onClick: (event) => { event.stopPropagation(); void load(true, selectedId) },
        style: { width: 14, height: 14, display: 'grid', placeItems: 'center', border: 0, borderRadius: 3, padding: 0,
          background: 'transparent', color: 'inherit', cursor: 'pointer' }
      }, h(Glyph, { name: 'refresh', size: 10 })))
  }
  const switchControl = (checked, onChange, label) => h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, title: label,
    onClick: () => onChange(!checked),
    style: { width: 30, height: 18, flex: '0 0 auto', border: 0, borderRadius: 999, padding: 2,
      background: checked ? C.blue : C.line, cursor: 'pointer', display: 'flex', alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background 140ms ease' }
  }, h('span', { style: { width: 14, height: 14, borderRadius: 7, background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.2)' } }))
  const settingCard = (title, description, control) => h('div', {
    style: { border: '1px solid ' + C.line, borderRadius: 9, background: C.panel || C.bg, padding: 11, display: 'grid', gap: 7 }
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontSize: 12, fontWeight: 500 } }, title),
        description ? h('div', { style: { fontSize: 10.5, color: C.mute, marginTop: 1 } }, description) : null),
      control ? h('span', { style: { marginLeft: 'auto' } }, control) : null))

  const row = (agent) => h('button', {
    key: agent.id, type: 'button', onClick: () => selectAgent(agent),
    className: 'tether-hover',
    style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 42, padding: '5px 8px',
      borderRadius: 8, border: 0, cursor: 'pointer', textAlign: 'left',
      background: selectedId === agent.id ? C.soft : 'transparent', color: C.ink }
  },
    h('span', { style: { width: 22, flex: '0 0 auto', display: 'grid', placeItems: 'center' } }, iconFor(agent)),
    h('span', { style: { minWidth: 0, display: 'grid', gap: 1 } },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
        agent.enabled !== false && agent.available
          ? h('span', { style: { width: 6, height: 6, borderRadius: 3, background: C.green, flex: '0 0 auto' } })
          : null),
      h('span', { style: { fontSize: 10, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        (agent.version || '版本未知') + ' · ' + sourceLabel(agent.source))),
    h('span', { style: { marginLeft: 'auto', flex: '0 0 auto' } }, statusBadge(agent, true)))

  const rowCard = (title, description, control) => h('div', {
    style: { border: '1px solid ' + C.line, borderRadius: 9, background: C.panel || C.bg,
      padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }
  },
    h('div', { style: { minWidth: 140, flex: '1 1 auto' } },
      h('div', { style: { fontSize: 12.5, fontWeight: 500 } }, title),
      description ? h('div', { style: { fontSize: 10.5, color: C.mute, marginTop: 2, lineHeight: 1.45 } }, description) : null),
    h('div', { style: { flex: '0 0 52%', maxWidth: 440, minWidth: 0, display: 'flex', justifyContent: 'flex-end' } }, control))

  const detail = selected && draft ? h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid ' + C.line } },
      h('span', { style: { width: 26, display: 'grid', placeItems: 'center' } }, iconFor(selected)),
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontSize: 14, fontWeight: 600 } }, selected.name),
        h('div', { style: { fontSize: 10.5, color: C.mute, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (selected.version || '版本未知') + ' · ' + sourceLabel(selected.source) + ' · ' + (selected.transports || []).map(transportLabel).join(' / '))),
      h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 } },
        statusBadge(selected, false),
        switchControl(draft.enabled, (value) => setDraft({ ...draft, enabled: value }), '启用 ' + selected.name))),
    h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 14px 14px', display: 'grid', gap: 8, alignContent: 'start' } },
      rowCard('命令 / 可执行文件', '启动该 Agent 的程序；可写 PATH 中的命令或绝对路径',
        h('input', { value: draft.command, onChange: (event) => setDraft({ ...draft, command: event.target.value }),
          placeholder: 'codex 或 C:\path\agent.exe', style: { ...field, width: '100%', fontFamily: 'Consolas, monospace' } })),
      rowCard('启动参数', '空格分隔，例如 --acp',
        h('input', { value: draft.argsText, onChange: (event) => setDraft({ ...draft, argsText: event.target.value }),
          placeholder: '--acp', style: { ...field, width: '100%', fontFamily: 'Consolas, monospace' } })),
      rowCard('接入方式', '决定 Tether 使用哪条通道渲染这个 Agent',
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } },
          kinds.map(([value, label]) => h('button', {
            key: value, type: 'button', onClick: () => setDraft({ ...draft, kind: value }),
            style: { height: 27, padding: '0 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
              border: '1px solid ' + (draft.kind === value ? C.blue : C.line),
              background: draft.kind === value ? C.blue : C.bg, color: draft.kind === value ? '#fff' : C.sub }
          }, label)))),
      rowCard('图标颜色', '仅用于目录中的识别色',
        h('div', { style: { display: 'flex', gap: 7, justifyContent: 'flex-end' } },
          colors.map((color) => h('button', {
            key: color, type: 'button', onClick: () => setDraft({ ...draft, color }),
            style: { width: 24, height: 24, borderRadius: 7, cursor: 'pointer', background: color,
              border: draft.color === color ? '2px solid ' + C.ink : '2px solid transparent' }
          })))),
      error ? h('div', { style: { color: C.red, fontSize: 11.5 } }, error) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid ' + C.line } },
      selected.source === 'manual' || selected.source === 'overridden'
        ? h('button', { type: 'button', onClick: () => void remove(selected),
          style: { ...field, border: 0, background: 'transparent', color: C.red, cursor: 'pointer' } }, '删除 Agent')
        : null,
      h('button', { type: 'button', onClick: () => void saveDraft(), disabled: busy || !draft.name.trim() || !draft.command.trim(),
        style: { ...primary, marginLeft: 'auto', opacity: busy || !draft.name.trim() || !draft.command.trim() ? 0.5 : 1 } },
        busy ? '保存中…' : '保存'))) : h('div', { style: { margin: 'auto', color: C.mute, fontSize: 12 } }, '选择左侧的 Agent 查看配置')

  const modal = editor ? h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', background: 'rgba(16,24,40,.35)' },
    onPointerDown: (event) => { if (event.target === event.currentTarget) setEditor(null) }
  },
    h('form', { onSubmit: saveAdd, style: { width: 540, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 80px)', overflow: 'auto',
      background: C.layer1 || C.bg, borderRadius: 14, boxShadow: C.shadow, padding: 18, display: 'grid', gap: 12 } },
      h('div', null,
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, '添加自定义 Agent'),
        h('div', { style: { fontSize: 11, color: C.mute, marginTop: 2 } }, '登记未自动发现的 Agent；保存后会出现在左侧列表。')),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '名称',
        h('input', { value: editor.name, autoFocus: true, onChange: (event) => setEditor({ ...editor, name: event.target.value }),
          placeholder: '例如 Codex', style: { ...field, height: 32, fontSize: 13 } })),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '命令 / 可执行文件',
        h('input', { value: editor.command, onChange: (event) => setEditor({ ...editor, command: event.target.value }),
          placeholder: 'codex 或 C:\\path\\agent.exe', style: { ...field, height: 32, fontSize: 13, fontFamily: 'Consolas, monospace' } })),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '启动参数（空格分隔，可选）',
        h('input', { value: editor.argsText, onChange: (event) => setEditor({ ...editor, argsText: event.target.value }),
          placeholder: '--acp', style: { ...field, height: 32, fontSize: 12, fontFamily: 'Consolas, monospace' } })),
      h('div', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '接入方式',
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          kinds.map(([value, label]) => h('button', {
            key: value, type: 'button', onClick: () => setEditor({ ...editor, kind: value }),
            style: { height: 28, padding: '0 11px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer',
              border: '1px solid ' + (editor.kind === value ? C.blue : C.line),
              background: editor.kind === value ? C.blue : C.bg, color: editor.kind === value ? '#fff' : C.sub }
          }, label)))),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', { type: 'button', onClick: () => setEditor(null), style: { ...field, cursor: 'pointer' } }, '取消'),
        h('button', { type: 'submit', disabled: busy || !editor.name.trim() || !editor.command.trim(),
          style: { ...primary, opacity: busy || !editor.name.trim() || !editor.command.trim() ? 0.5 : 1 } }, busy ? '保存中…' : '保存')))) : null

  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, flex: '0 0 auto' } },
      h('button', { type: 'button', title: '返回', 'aria-label': '返回', onClick: onClose,
        style: { ...field, width: 28, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer' } }, h(Glyph, { name: 'chevronLeft', size: 14 })),
      h('div', null,
        h('div', { style: { fontSize: 16, fontWeight: 600 } }, 'Agents'),
        h('div', { style: { fontSize: 11, color: C.mute, marginTop: 2 } }, device + ' · 自动发现 + 手动登记；DSH 是默认工作台，其他 Agent 按需接入')),
      h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.mute } }, agents.filter((item) => item.available).length + ' 个可用'),
      h('button', { type: 'button', onClick: () => void load(true, selectedId), disabled: busy,
        style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: busy ? 0.5 : 1 } },
        h(Glyph, { name: 'refresh', size: 12 }), busy ? '刷新中…' : '刷新'),
      h('button', { type: 'button', onClick: openAdd,
        style: { ...primary, display: 'flex', alignItems: 'center', gap: 5 } }, h(Glyph, { name: 'plus', size: 13 }), '添加 Agent')),
    error && !editor ? h('div', { style: { padding: '0 2px', color: C.red, fontSize: 11.5 } }, error) : null,
    h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'grid', gap: 10, gridTemplateColumns: 'minmax(230px, 280px) 1fr' } },
      h('div', { style: { minHeight: 0, minWidth: 0, border: '1px solid ' + C.line, borderRadius: 10, background: C.panel || C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { style: { padding: '8px 11px', borderBottom: '1px solid ' + C.line, fontSize: 11.5, fontWeight: 500, color: C.sub } }, 'Agent 列表'),
        h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 7, display: 'flex', flexDirection: 'column', gap: 2 } },
          agents.map(row))),
      h('div', { style: { minHeight: 0, minWidth: 0, border: '1px solid ' + C.line, borderRadius: 10, background: C.panel || C.bg, overflow: 'hidden' } }, detail)),
    modal)
}