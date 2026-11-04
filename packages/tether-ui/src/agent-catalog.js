import { AGENT_ICONS } from './agent-icons.js'
import { readCatalog, writeCatalog } from './agent-cache.js'

export function AgentCatalogView({ React, Glyph, post, C, device, onClose }) {
  const h = React.createElement
  const [catalog, setCatalog] = React.useState(() => readCatalog(device))
  const [busy, setBusy] = React.useState(false)
  const [installing, setInstalling] = React.useState('')
  const [testing, setTesting] = React.useState(false)
  const [testOutput, setTestOutput] = React.useState('')
  const [error, setError] = React.useState('')
  const [selectedId, setSelectedId] = React.useState('')
  const [draft, setDraft] = React.useState(null)
  const [editor, setEditor] = React.useState(null)
  const agents = (catalog && catalog.agents) || []
  const selected = agents.find((item) => item.id === selectedId) || null

  const toDraft = (agent) => ({
    name: agent.name, command: agent.command, argsText: (agent.args || []).join(' '),
    cwd: agent.cwd || '', envRows: Object.entries(agent.env || {}).map(([k, v]) => ({ k, v })),
    enabled: agent.enabled !== false
  })
  const applyCatalog = (data, keepSelected) => {
    setCatalog(data)
    writeCatalog(device, data)
    const list = (data && data.agents) || []
    const next = list.find((item) => item.id === keepSelected) || list.find((item) => item.available) || list[0]
    if (next) {
      setSelectedId(next.id)
      setDraft(toDraft(next))
    } else {
      setSelectedId('')
      setDraft(null)
    }
    setTestOutput('')
  }

  const load = async (fresh, keepSelected) => {
    const cached = readCatalog(device)
    if (cached) setCatalog(cached)
    else setBusy(true)
    setError('')
    try {
      let data = null
      try {
        data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog', { fresh: fresh === true })
      } catch (_) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_catalog', { fresh: false })
      }
      applyCatalog(data, keepSelected || selectedId)
    } catch (cause) {
      if (!cached) setError(String((cause && cause.message) || cause || '读取失败'))
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
    setDraft(toDraft(agent))
    setTestOutput('')
    setError('')
  }

  const install = async (agent) => {
    if (!agent || installing) return
    setInstalling(agent.id)
    setError('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_install', { id: agent.id })
      if (result && result.catalog) applyCatalog(result.catalog, agent.id)
      else await load(true, agent.id)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '安装失败'))
    } finally {
      setInstalling('')
    }
  }

  const envObject = (rows) => {
    const out = {}
    for (const row of rows || []) {
      const key = String(row.k || '').trim()
      if (key) out[key] = String(row.v || '')
    }
    return out
  }

  const saveDraft = async () => {
    if (!selected || !draft) return
    setBusy(true)
    setError('')
    try {
      const data = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_save', {
        id: selected.id, name: draft.name, command: draft.command,
        args: draft.argsText.split(/\s+/).filter(Boolean), kind: selected.kind,
        color: selected.color, enabled: draft.enabled,
        cwd: draft.cwd, env: envObject(draft.envRows)
      })
      applyCatalog(data, selected.id)
    } catch (cause) {
      setError(String((cause && cause.message) || cause || '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    if (!selected || testing) return
    setTesting(true)
    setTestOutput('')
    try {
      const result = await post('/api/devices/' + encodeURIComponent(device) + '/fs/agents_test', { id: selected.id })
      setTestOutput(String((result && result.output) || '').trim() || '(no output)')
    } catch (cause) {
      setTestOutput(String((cause && cause.message) || cause || '测试失败'))
    } finally {
      setTesting(false)
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
    setEditor({ name: '', command: '', argsText: '' })
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
        args: editor.argsText.split(/\s+/).filter(Boolean), kind: 'cli', enabled: true
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
    height: 30, boxSizing: 'border-box', border: '1px solid rgba(9,30,66,.14)',
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12, outline: 'none'
  }
  const primary = {
    height: 30, padding: '0 12px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const iconFor = (agent) => AGENT_ICONS[agent.icon]
    ? h('img', { src: AGENT_ICONS[agent.icon], alt: '', 'aria-hidden': true, style: { width: 18, height: 18, flex: '0 0 auto', objectFit: 'contain' } })
    : h('span', { style: { width: 18, height: 18, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 5, background: C.soft, color: C.sub } }, h(Glyph, { name: 'bot', size: 12 }))
  const badge = (agent) => h('span', { style: { display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 6,
    fontSize: 10.5, whiteSpace: 'nowrap',
    color: agent.available ? (C.blue || '#1570ef') : '#d97706',
    background: agent.available ? 'rgba(21,112,239,.08)' : 'rgba(217,119,6,.10)' } },
    agent.available ? '可用' : '未安装')
  const toggle = (checked, onChange, label) => h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, title: label,
    onClick: () => onChange(!checked),
    style: { width: 30, height: 18, flex: '0 0 auto', border: 0, borderRadius: 999, padding: 2,
      background: checked ? C.blue : 'rgba(9,30,66,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background 140ms ease' }
  }, h('span', { style: { width: 14, height: 14, borderRadius: 7, background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.2)' } }))

  const row = (agent) => h('button', {
    key: agent.id, type: 'button', onClick: () => selectAgent(agent),
    className: 'tether-hover',
    style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 40, padding: '4px 8px',
      borderRadius: 8, border: 0, cursor: 'pointer', textAlign: 'left',
      background: selectedId === agent.id ? C.soft : 'transparent', color: C.ink }
  },
    h('span', { style: { width: 22, flex: '0 0 auto', display: 'grid', placeItems: 'center' } }, iconFor(agent)),
    h('span', { style: { minWidth: 0, display: 'grid', gap: 1 } },
      h('span', { style: { fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
      agent.version ? h('span', { style: { fontSize: 10, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.version) : null),
    h('span', { style: { marginLeft: 'auto', flex: '0 0 auto' } }, badge(agent)))

  const group = (title, children) => h('div', { style: { display: 'grid', gap: 8 } },
    h('div', { style: { fontSize: 11, fontWeight: 600, color: C.sub, letterSpacing: '.4px' } }, title),
    h('div', { style: { border: '1px solid rgba(9,30,66,.12)', borderRadius: 10, background: C.panel || C.bg, overflow: 'hidden' } }, children))
  const settingRow = (title, control) => h('div', {
    style: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 46, padding: '8px 12px', borderBottom: '1px solid rgba(9,30,66,.07)' }
  },
    h('div', { style: { width: 120, flex: '0 0 auto', fontSize: 12, color: C.sub } }, title),
    h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'flex-end' } }, control))

  const installable = selected && !selected.available && selected.install && selected.install.kind === 'npm'
  const envRows = (draft && draft.envRows) || []
  const detail = selected && draft ? h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(9,30,66,.10)' } },
      h('span', { style: { width: 44, height: 44, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 12,
        background: C.bg, boxShadow: '0 1px 4px rgba(16,24,40,.12)' } }, AGENT_ICONS[selected.icon]
        ? h('img', { src: AGENT_ICONS[selected.icon], alt: '', style: { width: 28, height: 28 } })
        : h(Glyph, { name: 'bot', size: 24 })),
      h('div', { style: { minWidth: 0, display: 'grid', gap: 2 } },
        h('div', { style: { fontSize: 16, fontWeight: 600 } }, selected.name),
        selected.version ? h('div', { style: { fontSize: 10.5, color: C.mute } }, selected.version) : null),
      h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 } },
        installable ? h('button', { type: 'button', disabled: installing === selected.id, onClick: () => void install(selected),
          style: { ...primary, opacity: installing === selected.id ? 0.5 : 1 } }, installing === selected.id ? '安装中…' : '安装') : null,
        badge(selected),
        selected.available ? toggle(draft.enabled, (value) => setDraft({ ...draft, enabled: value }), '启用 ' + selected.name) : null)),
    h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '14px 14px 18px', display: 'grid', gap: 16, alignContent: 'start' } },
      group('启动', h('div', null,
        settingRow('命令', h('input', { value: draft.command, onChange: (event) => setDraft({ ...draft, command: event.target.value }),
          style: { ...field, width: '100%', fontFamily: 'Consolas, monospace' } })),
        settingRow('参数', h('input', { value: draft.argsText, onChange: (event) => setDraft({ ...draft, argsText: event.target.value }),
          style: { ...field, width: '100%', fontFamily: 'Consolas, monospace' } })),
        settingRow('工作目录', h('input', { value: draft.cwd, placeholder: '', onChange: (event) => setDraft({ ...draft, cwd: event.target.value }),
          style: { ...field, width: '100%', fontFamily: 'Consolas, monospace' } })))),
      group('环境变量', h('div', { style: { padding: '10px 12px', display: 'grid', gap: 8 } },
        ...envRows.map((entry, index) => h('div', { key: index, style: { display: 'flex', gap: 8 } },
          h('input', { value: entry.k, placeholder: 'KEY', onChange: (event) => {
            const next = envRows.slice(); next[index] = { ...entry, k: event.target.value }; setDraft({ ...draft, envRows: next })
          }, style: { ...field, width: 160, fontFamily: 'Consolas, monospace' } }),
          h('input', { value: entry.v, placeholder: 'value', onChange: (event) => {
            const next = envRows.slice(); next[index] = { ...entry, v: event.target.value }; setDraft({ ...draft, envRows: next })
          }, style: { ...field, flex: '1 1 auto', fontFamily: 'Consolas, monospace' } }),
          h('button', { type: 'button', title: '删除', onClick: () => {
            setDraft({ ...draft, envRows: envRows.filter((_, i) => i !== index) })
          }, style: { ...field, width: 30, padding: 0, cursor: 'pointer', background: 'transparent', color: C.mute } }, '×'))),
        h('button', { type: 'button', onClick: () => setDraft({ ...draft, envRows: [...envRows, { k: '', v: '' }] }),
          style: { ...field, width: 'fit-content', padding: '0 10px', cursor: 'pointer', background: 'transparent' } }, '+ 变量'))),
      group('诊断', h('div', { style: { padding: '10px 12px', display: 'grid', gap: 8 } },
        h('button', { type: 'button', disabled: testing || !selected.available, onClick: () => void test(),
          style: { ...field, width: 'fit-content', padding: '0 10px', cursor: testing || !selected.available ? 'default' : 'pointer',
            background: 'transparent', opacity: testing || !selected.available ? 0.5 : 1 } }, testing ? '测试中…' : '测试启动'),
        testOutput ? h('pre', { style: { margin: 0, padding: 10, borderRadius: 8, background: 'rgba(9,30,66,.04)',
          color: C.sub, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' } }, testOutput) : null)),
      error ? h('div', { style: { color: C.red, fontSize: 11.5 } }, error) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid rgba(9,30,66,.10)' } },
      selected.source === 'manual' || selected.source === 'overridden'
        ? h('button', { type: 'button', onClick: () => void remove(selected),
          style: { ...field, border: 0, background: 'transparent', color: C.red, cursor: 'pointer' } }, '删除 Agent')
        : null,
      h('button', { type: 'button', onClick: () => void saveDraft(), disabled: busy || !draft.name.trim() || !draft.command.trim(),
        style: { ...primary, marginLeft: 'auto', opacity: busy || !draft.name.trim() || !draft.command.trim() ? 0.5 : 1 } },
        busy ? '保存中…' : '保存'))) : h('div', { style: { margin: 'auto', color: C.mute, fontSize: 12 } }, '')

  const modal = editor ? h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', background: 'rgba(16,24,40,.35)' },
    onPointerDown: (event) => { if (event.target === event.currentTarget) setEditor(null) }
  },
    h('form', { onSubmit: saveAdd, style: { width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 80px)', overflow: 'auto',
      background: C.layer1 || C.bg, borderRadius: 14, boxShadow: C.shadow, padding: 18, display: 'grid', gap: 12 } },
      h('div', { style: { fontSize: 15, fontWeight: 600 } }, '添加 Agent'),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '名称',
        h('input', { value: editor.name, autoFocus: true, onChange: (event) => setEditor({ ...editor, name: event.target.value }),
          style: { ...field, height: 32, fontSize: 13 } })),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '命令',
        h('input', { value: editor.command, onChange: (event) => setEditor({ ...editor, command: event.target.value }),
          style: { ...field, height: 32, fontSize: 13, fontFamily: 'Consolas, monospace' } })),
      h('label', { style: { display: 'grid', gap: 4, fontSize: 11.5, color: C.sub } }, '参数',
        h('input', { value: editor.argsText, onChange: (event) => setEditor({ ...editor, argsText: event.target.value }),
          style: { ...field, height: 32, fontSize: 12, fontFamily: 'Consolas, monospace' } })),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', { type: 'button', onClick: () => setEditor(null), style: { ...field, cursor: 'pointer' } }, '取消'),
        h('button', { type: 'submit', disabled: busy || !editor.name.trim() || !editor.command.trim(),
          style: { ...primary, opacity: busy || !editor.name.trim() || !editor.command.trim() ? 0.5 : 1 } }, busy ? '保存中…' : '保存')))) : null

  return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' } },
      h('button', { type: 'button', title: '返回', 'aria-label': '返回', onClick: onClose,
        style: { ...field, width: 28, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer' } }, h(Glyph, { name: 'chevronLeft', size: 14 })),
      h('div', { style: { fontSize: 16, fontWeight: 600 } }, 'Agent 目录'),
      h('span', { style: { marginLeft: 'auto' } }),
      h('button', { type: 'button', title: '刷新', 'aria-label': '刷新', onClick: () => void load(true, selectedId), disabled: busy,
        style: { ...field, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: busy ? 0.5 : 1 } },
        h(Glyph, { name: 'refresh', size: 12 }), busy ? '刷新中…' : '刷新'),
      h('button', { type: 'button', onClick: openAdd,
        style: { ...primary, display: 'flex', alignItems: 'center', gap: 5 } }, h(Glyph, { name: 'plus', size: 13 }), '添加 Agent')),
    error && !editor ? h('div', { style: { padding: '0 2px', color: C.red, fontSize: 11.5 } }, error) : null,
    h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'grid', gap: 10, gridTemplateColumns: 'minmax(210px, 250px) 1fr' } },
      h('div', { style: { minHeight: 0, minWidth: 0, border: '1px solid rgba(9,30,66,.12)', borderRadius: 10, background: C.panel || C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 7, display: 'flex', flexDirection: 'column', gap: 2 } },
          agents.map(row))),
      h('div', { style: { minHeight: 0, minWidth: 0, border: '1px solid rgba(9,30,66,.12)', borderRadius: 10, background: C.panel || C.bg, overflow: 'hidden' } }, detail)),
    modal)
}
