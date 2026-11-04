export function AgentCatalogView({ React, Glyph, post, C, device, onClose }) {
  const h = React.createElement
  const [catalog, setCatalog] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [editor, setEditor] = React.useState(null)
  const colors = (catalog && catalog.colors) || ['#2563eb', '#d97706', '#7c3aed', '#0f766e', '#c2410c', '#0891b2', '#be185d', '#111827']
  const kinds = [['app-server', 'App Server'], ['acp', 'ACP'], ['web', '原生 Web'], ['cli', '终端']]

  const load = async (fresh) => {
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog', { fresh: fresh === true })
      setCatalog(data)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '读取 Agent 目录失败'))
    } finally {
      setBusy(false)
    }
  }
  React.useEffect(() => { void load(false) }, [device])

  const openEditor = (record) => {
    setEditor({
      id: record && record.source !== 'builtin' && record.source !== 'detected' ? record.id : '',
      name: (record && record.name) || '',
      command: (record && record.command) || '',
      argsText: ((record && record.args) || []).join(' '),
      kind: (record && record.kind) || 'cli',
      color: (record && record.color) || colors[0],
      enabled: !record || record.enabled !== false
    })
    setError('')
  }

  const save = async (event) => {
    if (event) event.preventDefault()
    if (!editor) return
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_save', {
        id: editor.id || undefined,
        name: editor.name,
        command: editor.command,
        args: editor.argsText.split(/\s+/).filter(Boolean),
        kind: editor.kind,
        color: editor.color,
        enabled: editor.enabled
      })
      setCatalog(data)
      setEditor(null)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_delete', { id })
      setCatalog(data)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '删除失败'))
    } finally {
      setBusy(false)
    }
  }

  const field = {
    height: 30, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const primary = {
    height: 30, padding: '0 12px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const transportLabel = (value) => ({ web: '原生 Web', 'app-server': 'App Server', acp: 'ACP', terminal: '终端' }[value] || value)
  const sourceLabel = (value) => ({ detected: '自动发现', manual: '手动登记', overridden: '手动覆盖', service: '本机服务', builtin: '未发现' }[value] || value)
  const chip = (text) => h('span', { style: { padding: '1px 7px', borderRadius: 999, background: C.soft, color: C.sub, fontSize: 10.5, whiteSpace: 'nowrap' } }, text)
  const agents = (catalog && catalog.agents) || []

  const card = (agent) => h('div', {
    key: agent.id,
    style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12,
      border: '1px solid ' + C.line, background: C.panel || C.bg, minWidth: 0 }
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 } },
      h('span', { style: { width: 36, height: 36, flex: '0 0 auto', display: 'grid', placeItems: 'center',
        borderRadius: 10, background: agent.color || C.soft, color: '#fff' } }, h(Glyph, { name: 'bot', size: 18 })),
      h('div', { style: { minWidth: 0, display: 'grid', gap: 1 } },
        h('div', { style: { fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
        h('div', { style: { fontSize: 10.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          (agent.version || '版本未知') + ' · ' + sourceLabel(agent.source))),
      h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: agent.available ? C.green : C.mute, whiteSpace: 'nowrap' } },
        h('span', { style: { width: 6, height: 6, borderRadius: 3, background: agent.available ? C.green : C.mute } }),
        agent.available ? '可用' : '未安装')),
    h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
      ...(agent.transports || []).map((value) => chip(transportLabel(value)))),
    agent.command ? h('div', { title: agent.command, style: { fontFamily: 'Consolas, monospace', fontSize: 10.5, color: C.mute,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.command) : null,
    h('div', { style: { display: 'flex', gap: 6, marginTop: 'auto' } },
      h('button', { type: 'button', onClick: () => openEditor(agent),
        style: { height: 25, padding: '0 9px', border: '1px solid ' + C.line, borderRadius: 6, background: C.bg,
          color: C.sub, fontSize: 11.5, cursor: 'pointer' } }, '编辑'),
      agent.source === 'manual' || agent.source === 'overridden'
        ? h('button', { type: 'button', onClick: () => void remove(agent.id),
          style: { height: 25, padding: '0 9px', border: 0, borderRadius: 6, background: 'transparent',
            color: C.red, fontSize: 11.5, cursor: 'pointer' } }, '删除')
        : null))

  const addCard = h('button', {
    key: 'add-agent', type: 'button', onClick: () => openEditor(null), className: 'tether-hover',
    style: { minHeight: 150, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 7,
      border: '1px dashed ' + C.line, borderRadius: 12, background: 'transparent', color: C.mute, cursor: 'pointer' }
  },
    h('span', { style: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 10, background: C.soft, color: C.sub } }, h(Glyph, { name: 'plus', size: 17 })),
    h('span', { style: { fontSize: 12 } }, '手动添加 Agent'))

  const modal = editor ? h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', background: 'rgba(16,24,40,.35)' },
    onPointerDown: (event) => { if (event.target === event.currentTarget) setEditor(null) }
  },
    h('form', { onSubmit: save, style: { width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 80px)', overflow: 'auto',
      background: C.layer1 || C.bg, borderRadius: 14, boxShadow: C.shadow, padding: 18, display: 'grid', gap: 12 } },
      h('div', { style: { display: 'flex', alignItems: 'center' } },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, editor.id ? '编辑 Agent' : '添加 Agent'),
        h('button', { type: 'button', onClick: () => setEditor(null), style: { marginLeft: 'auto', width: 26, height: 26, border: 0, borderRadius: 6, background: C.soft, color: C.sub, cursor: 'pointer' } }, '×')),
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
      h('div', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '图标颜色',
        h('div', { style: { display: 'flex', gap: 7 } },
          colors.map((color) => h('button', {
            key: color, type: 'button', onClick: () => setEditor({ ...editor, color }),
            style: { width: 24, height: 24, borderRadius: 7, cursor: 'pointer', background: color,
              border: editor.color === color ? '2px solid ' + C.ink : '2px solid transparent' }
          })))),
      error ? h('div', { style: { color: C.red, fontSize: 11.5 } }, error) : null,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', { type: 'button', onClick: () => setEditor(null), style: { ...field, cursor: 'pointer' } }, '取消'),
        h('button', { type: 'submit', disabled: busy || !editor.name.trim() || !editor.command.trim(),
          style: { ...primary, opacity: busy || !editor.name.trim() || !editor.command.trim() ? 0.5 : 1 } }, busy ? '保存中…' : '保存')))) : null

  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', flex: '0 0 auto' } },
      h('button', { type: 'button', title: '返回', 'aria-label': '返回', onClick: onClose,
        style: { ...field, width: 28, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer' } }, h(Glyph, { name: 'chevronLeft', size: 14 })),
      h('div', null,
        h('div', { style: { fontSize: 16, fontWeight: 600 } }, 'Agent 目录'),
        h('div', { style: { fontSize: 11, color: C.mute } }, device + ' · 自动发现 + 手动登记；DSH 是默认工作台，其他 Agent 按需接入')),
      h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.mute } }, agents.filter((item) => item.available).length + ' 个可用'),
      h('button', { type: 'button', onClick: () => void load(true), disabled: busy,
        style: { ...field, cursor: 'pointer', opacity: busy ? 0.5 : 1 } }, busy ? '刷新中…' : '刷新'),
      h('button', { type: 'button', onClick: () => openEditor(null),
        style: { ...primary, display: 'flex', alignItems: 'center', gap: 5 } }, h(Glyph, { name: 'plus', size: 13 }), '添加')),
    error && !editor ? h('div', { style: { padding: '0 14px 8px', color: C.red, fontSize: 11.5 } }, error) : null,
    h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '2px 12px 16px' } },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 } },
        ...agents.map(card), addCard)),
    modal)
}
