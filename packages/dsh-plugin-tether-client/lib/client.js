window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'tether'
    const BASE = 'http://127.0.0.1:18890'

    const C = {
      ink: '#101828', sub: '#475467', mute: '#667085', line: '#d0d5dd', soft: '#f2f4f7',
      bg: '#ffffff', panel: '#f8fafc', green: '#16a34a', red: '#b42318', blue: '#1570ef',
      amber: '#b54708', dark: '#101828', bubble: '#f2f4f7'
    }

    async function api(path, options) {
      const init = { ...(options || {}) }
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
      const res = await fetch(BASE + path, init)
      let data = {}
      try { data = await res.json() } catch (_) { /* empty body */ }
      if (!res.ok) {
        const detail = data && data.detail
        const message = (detail && detail.error) || (typeof detail === 'string' && detail) || data.error || ('HTTP ' + res.status)
        const err = new Error(message)
        err.code = detail && detail.code
        throw err
      }
      return data
    }
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })

    function pill(text, color) {
      return h('span', {
        style: {
          fontSize: 11, lineHeight: '18px', padding: '0 7px', borderRadius: 999,
          color: color || C.sub, border: '1px solid ' + (color || C.line),
          background: color ? 'transparent' : C.soft, whiteSpace: 'nowrap'
        }
      }, text)
    }
    function dot(on, color) {
      return h('span', { style: { width: 7, height: 7, borderRadius: 4, display: 'inline-block', background: color || (on ? C.green : '#98a2b3'), marginRight: 7, flex: '0 0 auto' } })
    }
    function btn(label, onClick, opts) {
      const o = opts || {}
      return h('button', {
        onClick, disabled: o.disabled, title: o.title || label,
        style: {
          height: 28, padding: '0 10px', borderRadius: 6, fontSize: 12,
          border: '1px solid ' + (o.primary ? C.dark : C.line),
          background: o.primary ? C.dark : '#fff',
          color: o.primary ? '#fff' : (o.danger ? C.red : C.ink),
          cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.5 : 1,
          whiteSpace: 'nowrap'
        }
      }, label)
    }
    function formatBytes(n) {
      if (n == null) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }
    function normPath(p) {
      return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }
    function samePath(a, b) {
      const na = normPath(a), nb = normPath(b)
      if (!na || !nb) return false
      return na === nb || (!na.includes('/') && nb.endsWith('/' + na))
    }
    function timeText(ms) {
      if (!ms) return ''
      const d = new Date(ms)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    function shortText(text, n) {
      const line = String(text || '').replace(/\s+/g, ' ').trim()
      return line.length > n ? line.slice(0, n) + '…' : line
    }

    function inline(text) {
      const out = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
      let last = 0, match, key = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) out.push(h('strong', { key: 'b' + key++ }, token.slice(2, -2)))
        else out.push(h('code', { key: 'c' + key++, style: { background: C.soft, borderRadius: 4, padding: '1px 4px', fontFamily: 'Consolas, monospace', fontSize: '0.92em' } }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    function Markdown({ text }) {
      const source = String(text || '')
      if (!source) return null
      const parts = source.split(/```/)
      const nodes = []
      let key = 0
      parts.forEach((part, index) => {
        if (index % 2 === 1) {
          const lines = part.replace(/^\n+|\n+$/g, '').split('\n')
          let lang = ''
          if (lines.length && /^[a-zA-Z0-9_+-]+$/.test(lines[0].trim()) && lines.length > 1) { lang = lines.shift().trim() }
          nodes.push(h('pre', { key: 'p' + key++, style: { margin: '10px 0', padding: '10px 12px', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', overflow: 'auto', fontSize: 12.5, lineHeight: 1.55, fontFamily: 'Consolas, monospace' } },
            h('code', null, lines.join('\n'))))
          return
        }
        const blocks = part.split(/\n\s*\n/)
        blocks.forEach((block) => {
          const trimmed = block.trim()
          if (!trimmed) return
          const lines = trimmed.split('\n')
          if (lines.every((line) => /^\s*\|.*\|\s*$/.test(line))) {
            const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
            const body = rows.filter((row, i) => i !== 1 || !row.every((cell) => /^:?-{3,}:?$/.test(cell)))
            nodes.push(h('div', { key: 't' + key++, style: { overflowX: 'auto', margin: '10px 0' } },
              h('table', { style: { borderCollapse: 'collapse', fontSize: 13, minWidth: '60%' } },
                h('tbody', null, body.map((row, ri) => h('tr', { key: ri },
                  row.map((cell, ci) => h(ri === 0 ? 'th' : 'td', {
                    key: ci, style: { border: '1px solid ' + C.line, padding: '4px 8px', textAlign: 'left', fontSize: 12.5, whiteSpace: (ri === 0 || String(cell).length <= 12) ? 'nowrap' : 'normal', wordBreak: 'break-word', fontWeight: ri === 0 ? 600 : 400, background: ri === 0 ? C.panel : '#fff' }
                  }, inline(cell)))))))))
            return
          }
          if (/^#{1,4}\s/.test(lines[0])) {
            const level = lines[0].match(/^#+/)[0].length
            nodes.push(h('div', { key: 'h' + key++, style: { fontWeight: 650, fontSize: level <= 2 ? 17 : 15, margin: '14px 0 6px' } }, inline(lines[0].replace(/^#+\s*/, ''))))
            if (lines.length > 1) nodes.push(h('div', { key: 'hx' + key++, style: { whiteSpace: 'pre-wrap', margin: '4px 0' } }, inline(lines.slice(1).join('\n'))))
            return
          }
          if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
            nodes.push(h('ul', { key: 'u' + key++, style: { margin: '6px 0', paddingLeft: 20 } },
              lines.map((line, i) => h('li', { key: i, style: { margin: '2px 0', whiteSpace: 'pre-wrap' } }, inline(line.replace(/^\s*[-*]\s+/, ''))))))
            return
          }
          if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
            nodes.push(h('ol', { key: 'o' + key++, style: { margin: '6px 0', paddingLeft: 22 } },
              lines.map((line, i) => h('li', { key: i, style: { margin: '2px 0', whiteSpace: 'pre-wrap' } }, inline(line.replace(/^\s*\d+[.)]\s+/, ''))))))
            return
          }
          nodes.push(h('div', { key: 'd' + key++, style: { whiteSpace: 'pre-wrap', margin: '6px 0' } }, inline(trimmed)))
        })
      })
      return h('div', { style: { fontSize: 14, lineHeight: '24px', color: C.ink } }, nodes)
    }

    function Reasoning({ text, running }) {
      const [open, setOpen] = React.useState(false)
      const summary = String(text || '').replace(/\*\*/g, '').split('\n').find((line) => line.trim()) || ''
      if (!text) return null
      return h('div', { style: { margin: '4px 0 8px' } },
        h('button', {
          onClick: () => setOpen(!open),
          style: { display: 'flex', alignItems: 'center', gap: 7, width: '100%', border: 0, background: 'transparent', padding: '3px 0', cursor: 'pointer', textAlign: 'left', color: C.mute, fontSize: 13 }
        },
          h('span', { style: { fontSize: 13, width: 14 } }, open ? '▾' : '▸'),
          h('span', { style: { fontWeight: 400, color: C.sub, whiteSpace: 'nowrap', flex: '0 0 auto' } }, running ? '思考中' : '思考'),
          !open && summary ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', color: C.mute } }, '· ' + summary) : null
        ),
        open ? h('div', { style: { padding: '4px 0 4px 22px', color: C.sub, fontSize: 13, lineHeight: '21px', whiteSpace: 'pre-wrap' } }, text) : null
      )
    }

    function ToolCard({ block }) {
      const [open, setOpen] = React.useState(false)
      const status = block.status || (block.is_error ? 'error' : 'done')
      const color = status === 'error' ? C.red : (status === 'running' ? C.blue : C.green)
      const args = block.arguments || ''
      const result = block.result || ''
      return h('div', { style: { border: '1px solid ' + C.line, borderRadius: 8, margin: '8px 0', background: '#fff', overflow: 'hidden' } },
        h('button', {
          onClick: () => setOpen(!open),
          style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', border: 0, background: C.panel, cursor: 'pointer', textAlign: 'left', color: C.ink }
        },
          dot(false, color),
          h('span', { style: { fontFamily: 'Consolas, monospace', fontSize: 12.5, fontWeight: 600 } }, block.name || 'tool'),
          block.command ? h('span', { style: { color: C.mute, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' } }, block.command) : h('span', { style: { flex: '1 1 auto' } }),
          h('span', { style: { color: C.mute, fontSize: 11, whiteSpace: 'nowrap', flex: '0 0 auto' } }, status === 'running' ? '运行中' : (status === 'error' ? '失败' : '完成')),
          h('span', { style: { color: C.mute } }, open ? '▾' : '▸')
        ),
        open ? h('div', { style: { padding: '8px 10px', fontSize: 12 } },
          args && args !== '{}' ? h('div', { style: { marginBottom: 6 } },
            h('div', { style: { color: C.mute, fontSize: 10.5, marginBottom: 3 } }, '参数'),
            h('pre', { style: { margin: 0, padding: 8, background: C.panel, borderRadius: 6, overflow: 'auto', maxHeight: 180, fontFamily: 'Consolas, monospace', fontSize: 11.5 } }, args)
          ) : null,
          result ? h('div', null,
            h('div', { style: { color: C.mute, fontSize: 10.5, marginBottom: 3 } }, '结果'),
            h('pre', { style: { margin: 0, padding: 8, background: status === 'error' ? '#fef3f2' : C.panel, color: status === 'error' ? C.red : C.sub, borderRadius: 6, overflow: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: 11.5 } }, result)
          ) : h('div', { style: { color: C.mute, fontSize: 11.5 } }, '等待结果…')
        ) : null
      )
    }

    function UserBubble({ text }) {
      return h('div', { style: { display: 'flex', justifyContent: 'flex-end', margin: '14px 0 16px' } },
        h('div', { style: { maxWidth: '82%', background: C.bubble, borderRadius: 12, padding: '9px 13px', fontSize: 14, lineHeight: '22px', whiteSpace: 'pre-wrap', color: C.ink } }, text)
      )
    }

    function Turn({ turn, index, live }) {
      const blocks = turn.blocks || []
      const usage = turn.usage || {}
      const steps = turn.steps || 0
      return h('div', { style: { marginBottom: 22 } },
        turn.user ? h(UserBubble, { text: turn.user.text }) : null,
        blocks.map((block, i) => {
          if (block.type === 'reasoning') return h(Reasoning, { key: i, text: block.text, running: !!block.live && live })
          if (block.type === 'tool') return h(ToolCard, { key: i, block })
          if (block.type === 'text') return h('div', { key: i, style: { margin: '6px 0' } }, h(Markdown, { text: block.text }))
          return null
        }),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', color: C.mute, fontSize: 11.5, marginTop: 4 } },
          h('span', { style: { width: 7, height: 7, borderRadius: 4, background: turn.state === 'completed' ? C.green : (turn.state === 'running' ? C.blue : (turn.state === 'failed' ? C.red : C.mute)) } }),
          h('span', null, turn.state === 'running' ? '运行中' : (turn.state === 'failed' ? '失败' : '已完成')),
          steps ? h('span', null, steps + ' 步') : null,
          usage.outputTokens ? h('span', null, usage.outputTokens + ' tok') : null
        )
      )
    }

    function Conversation({ data, loading, emptyText, live }) {
      const box = React.useRef(null)
      const lastLen = React.useRef(0)
      React.useEffect(() => {
        const el = box.current
        if (!el) return
        const size = JSON.stringify(data && data.turns || []).length
        if (size !== lastLen.current) {
          lastLen.current = size
          el.scrollTop = el.scrollHeight
        }
      }, [data])
      const turns = (data && data.turns) || []
      if (!turns.length) {
        return h('div', { style: { display: 'grid', placeItems: 'center', flex: '1 1 auto', color: C.mute, fontSize: 13, padding: 30 } }, loading ? '加载中…' : emptyText)
      }
      return h('div', { ref: box, className: 'tether-scroll', style: { flex: '1 1 auto', overflow: 'auto', padding: '4px 0 24px' } },
        h('div', { style: { maxWidth: 780, margin: '0 auto', padding: '0 8px' } },
          turns.map((turn, i) => h(Turn, { key: i, turn, index: i, live }))
        )
      )
    }

    function Composer({ value, onChange, onSend, busy, disabled, note }) {
      return h('div', { style: { borderTop: '1px solid ' + C.line, padding: '8px 12px 10px', flex: '0 0 auto', background: '#fff' } },
        note ? h('div', { style: { color: C.mute, fontSize: 10.5, margin: '0 2px 5px' } }, note) : null,
        h('div', { style: { maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end', border: '1px solid ' + C.line, borderRadius: 12, padding: 7, boxShadow: '0 1px 2px rgba(16,24,40,0.04)' } },
          h('textarea', {
            value, onChange: (ev) => onChange(ev.target.value), disabled,
            onKeyDown: (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); onSend() } },
            placeholder: disabled ? '选择项目后可发起任务' : '发消息或发起任务…',
            style: { flex: '1 1 auto', minHeight: 38, maxHeight: 160, resize: 'none', border: 0, outline: 'none', padding: '6px 8px', fontSize: 13.5, lineHeight: '20px', fontFamily: 'inherit', background: 'transparent' }
          }),
          h('button', {
            onClick: onSend, disabled: disabled || busy || !value.trim(),
            title: '发送',
            style: { width: 34, height: 34, borderRadius: 17, border: 0, background: disabled || busy || !value.trim() ? '#d0d5dd' : C.dark, color: '#fff', cursor: disabled || busy || !value.trim() ? 'not-allowed' : 'pointer', fontSize: 16, flex: '0 0 auto' }
          }, '↑')
        )
      )
    }


    const SCROLL_CSS = `
      .tether-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; overscroll-behavior: contain; }
      .tether-scroll:hover { scrollbar-color: #cbd5e1 transparent; }
      .tether-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .tether-scroll::-webkit-scrollbar-track { background: transparent; }
      .tether-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
      .tether-scroll:hover::-webkit-scrollbar-thumb { background: #cbd5e1; }
      .tether-scroll::-webkit-scrollbar-corner { background: transparent; }
    `

    const UI = {
      activity: 44,
      row: 32,
      pad: 8,
      radius: 6,
      radiusCard: 8,
      icon: 12,
      font: 12.5,
      header: 11,
      gapRow: 1,
      gapGroup: 10,
      minSide: 190,
      maxSide: 380,
      defaultSide: 248,
      minFiles: 170,
      maxFiles: 360,
      defaultFiles: 240
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    function usePersisted(key, initial) {
      const [value, setValue] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(key)
          return raw === null ? initial : JSON.parse(raw)
        } catch (_) { return initial }
      })
      React.useEffect(() => {
        try { window.localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* private mode */ }
      }, [key, value])
      return [value, setValue]
    }

    const GLYPHS = {
      chat: ['M5 5h14v10H9l-4 4V5z', 'M8 9h8', 'M8 12h5'],
      devices: ['M4 5h16v6H4z', 'M4 15h16v4H4z', 'M7 8h.01', 'M7 17h.01'],
      projects: ['M3 7h7l2 2h9v10H3z', 'M3 7V5h7l2 2'],
      settings: ['M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z', 'M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6L7 7', 'M17 17l1.4 1.4', 'M18.4 5.6L17 7', 'M7 17l-1.4 1.4'],
      plus: ['M12 5v14', 'M5 12h14'],
      file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4']
    }

    function Glyph({ name, size = 18, stroke = 1.7 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
      }, (GLYPHS[name] || []).map((d, i) => h('path', { key: i, d })))
    }

    function ActivityBar({ active, collapsed, onSelect, onSettings, settingsOpen }) {
      const items = [
        { id: 'conversations', label: '对话', icon: 'chat' },
        { id: 'devices', label: '设备', icon: 'devices' },
        { id: 'projects', label: '项目', icon: 'projects' }
      ]
      const button = (id, label, icon, onClick, selected) => h('button', {
        key: id, title: label, 'aria-label': label, onClick,
        style: {
          width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0,
          borderRadius: UI.radius, cursor: 'pointer', position: 'relative',
          background: selected ? '#fff' : 'transparent', color: selected ? C.ink : C.mute,
          boxShadow: selected ? '0 1px 2px rgba(16,24,40,0.08)' : 'none'
        }
      }, h(Glyph, { name: icon, size: 18 }))
      return h('nav', {
        'aria-label': 'Tether 面板',
        style: { width: UI.activity, flex: '0 0 auto', borderRight: '1px solid ' + C.line, background: C.soft, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 2 }
      },
        items.map((item) => button(item.id, item.label, item.icon, () => onSelect(item.id), active === item.id)),
        h('div', { style: { marginTop: 'auto' } }, button('settings', '文件权限', 'settings', onSettings, settingsOpen))
      )
    }

    function SidePanelHeader({ title, action, onCollapse }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', height: UI.row, flex: '0 0 auto', padding: '0 ' + UI.pad + 'px', gap: 2 } },
        h('span', { style: { fontSize: UI.header, fontWeight: 600, color: C.mute, letterSpacing: 0.4 } }, title),
        h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 } },
          action,
          h('button', {
            title: '收起侧栏', 'aria-label': '收起侧栏', onClick: onCollapse,
            style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: UI.radius, background: 'transparent', color: C.mute, cursor: 'pointer', fontSize: 16, lineHeight: 1 }
          }, '‹')
        )
      )
    }

    function SideRow({ selected, title, hint, icon, iconColor, onClick, right }) {
      return h('div', {
        role: 'button', tabIndex: 0, title, onClick,
        onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick() } },
        style: {
          display: 'flex', alignItems: 'center', gap: 7, minHeight: UI.row, boxSizing: 'border-box',
          padding: '5px ' + UI.pad + 'px', borderRadius: UI.radius, cursor: 'pointer', minWidth: 0, width: '100%', boxSizing: 'border-box',
          background: selected ? C.soft : 'transparent', fontSize: UI.font, color: C.ink
        }
      },
        icon ? h('span', { style: { width: UI.icon, height: UI.icon, display: 'grid', placeItems: 'center', color: iconColor || C.mute, flex: '0 0 auto' } }, typeof icon === 'string' ? h(Glyph, { name: icon, size: UI.icon, stroke: 1.8 }) : icon) : null,
        h('span', { style: { minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '18px' } }, title),
        right ? h('span', { style: { flex: '0 0 auto', fontSize: 10, color: C.mute, whiteSpace: 'nowrap' } }, right) : null,
        hint ? h('span', { style: { flex: '0 0 auto', fontSize: 9.5, color: C.mute, border: '1px solid ' + C.line, borderRadius: 999, padding: '0 5px', lineHeight: '15px' } }, hint) : null
      )
    }

    function SidePanel(props) {
      const {
        panel, width, hidden, onResizeStart, onResetWidth, onCollapse, devices, localDevice, deviceId, onSelectDevice,
        projects, project, onSelectProject, onNewProject, newProjectDisabled,
        nativeSessions, runs, sessionId, runId, onSelectSession, onSelectRun
      } = props
      const title = panel === 'devices' ? '设备' : (panel === 'projects' ? '项目' : '对话')
      const action = panel === 'projects' ? h('button', {
        title: newProjectDisabled ? '当前节点不支持新建项目' : '新建项目', 'aria-label': '新建项目',
        onClick: onNewProject, disabled: newProjectDisabled,
        style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: UI.radius, background: 'transparent', color: newProjectDisabled ? C.line : C.mute, cursor: newProjectDisabled ? 'not-allowed' : 'pointer' }
      }, h(Glyph, { name: 'plus', size: 14 })) : null

      const section = (id, content) => h('div', {
        className: 'tether-scroll',
        style: { display: panel === id ? 'block' : 'none', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px ' + UI.pad + 'px ' + UI.pad + 'px' }
      }, content)

      const deviceRows = devices.map((d) => h(SideRow, {
        key: d.device_id, selected: d.device_id === deviceId, title: d.name || d.device_id,
        onClick: () => onSelectDevice(d.device_id),
        icon: 'devices', iconColor: d.online ? C.green : C.mute,
        hint: d.device_id === localDevice ? 'local' : null,
        right: d.online ? null : 'offline'
      }))
      const projectRows = ((projects && projects.workspaces) || []).map((w) => h(SideRow, {
        key: w.path, selected: project && project.path === w.path, title: w.name, onClick: () => onSelectProject(w),
        icon: w.kind === 'dsh' ? 'projects' : 'devices', iconColor: C.mute
      }))
      const nativeRows = nativeSessions.map((s) => h(SideRow, {
        key: s.session_id, selected: s.session_id === sessionId, title: s.title || s.session_id,
        onClick: () => onSelectSession(s.session_id),
        icon: 'chat', iconColor: s.status === 'running' ? C.blue : C.green,
        right: s.status === 'running' ? '运行中' : timeText((s.updated_at || 0) * 1000)
      }))
      const runRows = runs.map((r) => h(SideRow, {
        key: r.run_id, selected: r.run_id === runId, title: shortText(r.prompt, 42),
        onClick: () => onSelectRun(r.run_id),
        icon: 'chat', iconColor: r.state === 'completed' ? C.green : (['failed', 'unknown'].includes(r.state) ? C.red : C.blue),
        right: r.state
      }))
      const groupLabel = (text, first) => h('div', {
        style: { fontSize: UI.header, fontWeight: 600, color: C.mute, letterSpacing: 0.4, margin: (first ? 2 : UI.gapGroup) + 'px ' + UI.pad + 'px 4px' }
      }, text)

      return h('aside', {
        'aria-label': title,
        style: { display: hidden ? 'none' : 'flex', width, flex: '0 0 auto', minHeight: 0, borderRight: '1px solid ' + C.line, background: C.panel, flexDirection: 'column', position: 'relative' }
      },
        h(SidePanelHeader, { title, action, onCollapse }),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          section('devices', h('div', { style: { display: 'grid', gap: UI.gapRow } }, deviceRows, !deviceRows.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '6px ' + UI.pad + 'px' } }, '暂无设备') : null)),
          section('projects', h('div', { style: { display: 'grid', gap: UI.gapRow } }, projectRows, !projectRows.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '6px ' + UI.pad + 'px' } }, '暂无项目') : null)),
          section('conversations', h('div', null,
            groupLabel('DSH 会话', true),
            h('div', { style: { display: 'grid', gap: UI.gapRow } }, nativeRows, !nativeRows.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '2px ' + UI.pad + 'px 4px' } }, '无原生会话') : null),
            groupLabel('Tether 任务', false),
            h('div', { style: { display: 'grid', gap: UI.gapRow } }, runRows, !runRows.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '2px ' + UI.pad + 'px 4px' } }, '无任务') : null)
          ))
        ),
        h('div', {
          onPointerDown: onResizeStart, onDoubleClick: onResetWidth, title: '拖动调整宽度，双击复位',
          style: { position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }
        })
      )
    }

    function App() {
      const [state, setState] = React.useState(null)
      const stateRef = React.useRef(null)
      stateRef.current = state
      const [deviceId, setDeviceId] = React.useState('')
      const [projects, setProjects] = React.useState(null)
      const [project, setProject] = React.useState(null)
      const [view, setView] = usePersisted('tether.ui.view', 'chat')
      const [activePanel, setActivePanel] = usePersisted('tether.ui.panel', 'conversations')
      const [sidebarCollapsed, setSidebarCollapsed] = usePersisted('tether.ui.panelCollapsed', false)
      const [sidebarWidth, setSidebarWidth] = usePersisted('tether.ui.panelWidth', UI.defaultSide)
      const [fileListWidth, setFileListWidth] = usePersisted('tether.ui.fileListWidth', UI.defaultFiles)
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [native, setNative] = React.useState([])
      const [nativeError, setNativeError] = React.useState('')
      const [nativeLoaded, setNativeLoaded] = React.useState(false)
      const [sessionId, setSessionId] = React.useState('')
      const [sessionData, setSessionData] = React.useState(null)
      const [sessionLoading, setSessionLoading] = React.useState(false)
      const [runId, setRunId] = React.useState('')
      const [runEvents, setRunEvents] = React.useState([])
      const [task, setTask] = React.useState('')
      const [showSettings, setShowSettings] = React.useState(false)
      const [policy, setPolicy] = React.useState(null)
      const [audit, setAudit] = React.useState([])
      const [mode, setMode] = React.useState('readonly')
      const [rootsText, setRootsText] = React.useState('')
      const [ask, setAsk] = React.useState(null)
      const [path, setPath] = React.useState('')
      const [pathDraft, setPathDraft] = React.useState('')
      const [listing, setListing] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [file, setFile] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [dirty, setDirty] = React.useState(false)

      const fail = (e) => setNotice(String((e && e.message) || e))
      React.useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(t) }, [notice])

      const loadState = React.useCallback(async () => {
        try {
          const data = await api('/api/state')
          setState(data)
          setDeviceId((current) => {
            if (current && data.devices.some((d) => d.device_id === current)) return current
            const local = data.local_device
            if (local && data.devices.some((d) => d.device_id === local)) return local
            const online = data.devices.find((d) => d.online)
            return (online && online.device_id) || ((data.devices[0] || {}).device_id || '')
          })
        } catch (e) { fail(e) }
      }, [])

      React.useEffect(() => {
        loadState()
        const t = setInterval(loadState, 2500)
        return () => clearInterval(t)
      }, [loadState])

      const device = state && state.devices.find((d) => d.device_id === deviceId)
      const deviceOnline = !!(device && device.online)
      const safeSidebarWidth = clamp(sidebarWidth, UI.minSide, UI.maxSide)
      const safeFileListWidth = clamp(fileListWidth, UI.minFiles, UI.maxFiles)

      React.useEffect(() => {
        if (!deviceId) { setPolicy(null); return }
        api('/api/devices/' + encodeURIComponent(deviceId) + '/policy')
          .then(setPolicy)
          .catch(() => setPolicy(null))
      }, [deviceId])

      const loadProjects = React.useCallback(async () => {
        if (!deviceId) return
        try {
          const data = await api('/api/devices/' + encodeURIComponent(deviceId) + '/workspaces')
          setProjects(data)
          setProject((current) => {
            if (current && data.workspaces.some((w) => w.path === current.path)) return current
            return data.workspaces[0] || null
          })
        } catch (e) {
          const dev = ((stateRef.current && stateRef.current.devices) || []).find((d) => d.device_id === deviceId)
          const fallback = dev && dev.capabilities && dev.capabilities.workspace
          if (fallback) {
            const synthetic = { name: 'Tether 工作目录', path: fallback, kind: 'node', writable: true, synthetic: true }
            setProjects({ root: fallback, node_workspace: fallback, workspaces: [synthetic], synthetic: true })
            setProject((current) => current && samePath(current.path, fallback) ? current : synthetic)
            setNativeError('节点未升级，原生会话不可用')
          } else {
            setProjects(null)
            fail(e)
          }
        }
      }, [deviceId])

      React.useEffect(() => { setProject(null); setPath(''); setPathDraft(''); setListing(null); setFile(null); setSelected(null); setSessionId(''); setSessionData(null); setRunId(''); setNativeLoaded(false); loadProjects() }, [deviceId, loadProjects])

      const loadNative = React.useCallback(async () => {
        if (!deviceId) return
        try {
          const data = await api('/api/devices/' + encodeURIComponent(deviceId) + '/dsh/sessions')
          setNative(data.sessions || [])
          setNativeError('')
          setNativeLoaded(true)
        } catch (e) { setNative([]); setNativeError(String(e.message || e)); setNativeLoaded(true) }
      }, [deviceId])

      React.useEffect(() => { loadNative(); const t = setInterval(loadNative, 8000); return () => clearInterval(t) }, [loadNative])

      const lastProject = React.useRef('')
      React.useEffect(() => {
        const currentPath = project ? project.path : ''
        if (currentPath === lastProject.current) return
        lastProject.current = currentPath
        setSessionId('')
        setRunId('')
        setPath(currentPath)
        setPathDraft(currentPath)
        setFile(null)
        setListing(null)
      }, [project])

      const nativeForProject = project ? native.filter((s) => samePath(s.cwd, project.path)) : []
      const nativeKey = nativeForProject.map((s) => s.session_id).join(',')
      const runKey = ((state && state.runs) || []).map((r) => r.run_id).join(',')

      React.useEffect(() => {
        if (!sessionId || !deviceId) { setSessionData(null); setSessionLoading(false); return }
        let live = true
        const load = async () => {
          setSessionLoading(true)
          try {
            const data = await api('/api/devices/' + encodeURIComponent(deviceId) + '/dsh/sessions/' + encodeURIComponent(sessionId))
            if (live) { setSessionData(data); setSessionLoading(false) }
          } catch (e) { if (live) { setSessionLoading(false); fail(e) } }
        }
        load()
        const t = setInterval(load, 1500)
        return () => { live = false; clearInterval(t) }
      }, [sessionId, deviceId])

      const sessions = (state && state.sessions) || []
      const workspaceOf = (run) => {
        const s = sessions.find((x) => x.session_id === run.session_id)
        return s ? s.workspace : ''
      }
      const runs = ((state && state.runs) || []).filter((r) =>
        (!deviceId || r.device_id === deviceId) && (!project || samePath(workspaceOf(r), project.path))
      ).slice(0, 40)
      const currentRun = runs.find((r) => r.run_id === runId)

      React.useEffect(() => {
        if (sessionId) { setSessionLoading(false); return }
        if (!nativeLoaded) return
        if (runId || sessionId) return
        if (nativeForProject.length) setSessionId(nativeForProject[0].session_id)
        else if (runs.length) setRunId(runs[0].run_id)
      }, [project, nativeLoaded, nativeKey, runKey, sessionId, runId])

      React.useEffect(() => {
        if (!sessionId || !nativeLoaded) return
        if (!native.some((s) => s.session_id === sessionId)) { setSessionId(''); setSessionData(null); setSessionLoading(false) }
      }, [nativeKey, nativeLoaded, sessionId])

      React.useEffect(() => {
        if (!runId) { setRunEvents([]); return }
        let live = true
        const load = async () => {
          try {
            const data = await api('/api/runs/' + encodeURIComponent(runId) + '/events?after_seq=0')
            if (live) setRunEvents(data.events || [])
          } catch (_) { /* keep previous */ }
        }
        load()
        const t = setInterval(load, 1000)
        return () => { live = false; clearInterval(t) }
      }, [runId])

      const runConversation = (run, events) => {
        const blocks = []
        let state = run ? run.state : 'queued'
        let call = null
        for (const ev of events) {
          const p = ev.payload || {}
          if (ev.kind === 'thought') blocks.push({ type: 'reasoning', text: String(p.text || '') })
          else if (ev.kind === 'assistant') blocks.push({ type: 'text', text: String(p.text || '') })
          else if (ev.kind === 'tool' && p.type === 'tool/call') {
            let parsed = {}
            try { parsed = JSON.parse(p.data || '{}') } catch (_) {}
            const args = parsed.arguments || ''
            let command = ''
            try { const a = JSON.parse(args); command = a.command || a.file_path || a.path || '' } catch (_) { command = String(args || '') }
            call = { type: 'tool', id: parsed.callId || '', name: parsed.name || p.name || 'tool', arguments: String(args || ''), command: String(command || ''), result: '', status: 'running' }
            blocks.push(call)
          } else if (ev.kind === 'tool' && p.type === 'tool/result') {
            let data = {}
            try { data = JSON.parse(p.data || '{}') } catch (_) {}
            const id = (data.message && data.message.toolCallId) || data.toolCallId || ''
            const target = (id && blocks.find((b) => b.type === 'tool' && b.id === id)) || call
            if (target) { target.result = String(p.text || ''); target.status = 'done'; call = null }
          } else if (ev.kind === 'log' && p.type === 'turn/end') {
            state = p.reason === 'completed' ? 'completed' : (p.reason === 'cancelled' ? 'cancelled' : (p.reason === 'error' ? 'failed' : state))
          }
        }
        if (!blocks.length && run && run.final_response) blocks.push({ type: 'text', text: run.final_response })
        return { title: run ? shortText(run.prompt, 50) : '', status: state,
                 turns: run ? [{ turn: 1, user: { text: run.prompt }, blocks, state: run.state === 'completed' ? 'completed' : (run.state === 'failed' ? 'failed' : 'running'), steps: 0, usage: {} }] : [] }
      }

      const conversation = sessionId ? sessionData : (currentRun ? runConversation(currentRun, runEvents) : null)
      const conversationTitle = sessionId
        ? ((sessionData && sessionData.title) || (native.find((s) => s.session_id === sessionId) || {}).title || 'DSH 会话')
        : (currentRun ? shortText(currentRun.prompt, 50) : '')
      const conversationStatus = sessionId
        ? ((sessionData && sessionData.status) || 'idle')
        : (currentRun ? currentRun.state : 'idle')

      const startTask = async () => {
        if (!task.trim() || !deviceId || !project) return
        setBusy(true)
        try {
          let session = currentRun || null
          let sid = session ? session.session_id : ''
          if (!sid) {
            const existing = sessions.filter((s) => s.device_id === deviceId && samePath(s.workspace, project.path))
            sid = existing.length ? existing[existing.length - 1].session_id : ''
          }
          if (!sid) {
            const created = await post('/api/sessions', { device_id: deviceId, workspace: project.path })
            sid = created.session_id
          }
          const run = await post('/api/sessions/' + encodeURIComponent(sid) + '/runs', {
            request_id: 'ui-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            prompt: task.trim()
          })
          setTask('')
          setSessionId('')
          setSessionData(null)
          setRunId(run.run_id)
          setView('chat')
          loadState()
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const send = () => { if (task.trim() && deviceOnline) startTask() }

      const openSettings = async () => {
        setShowSettings(true)
        try {
          const p = await api('/api/devices/' + encodeURIComponent(deviceId) + '/policy')
          setPolicy(p); setMode(p.mode); setRootsText((p.allowed_roots || []).join('\n'))
          const a = await api('/api/devices/' + encodeURIComponent(deviceId) + '/audit?limit=80')
          setAudit(a.entries || [])
        } catch (e) { fail(e) }
      }
      const savePolicy = async () => {
        if (mode === 'full' && !window.confirm('Full-disk mode lets this Tether plugin write and delete files anywhere the node user can, except protected system directories and credential stores.\n\nEnable it?')) return
        setBusy(true)
        try {
          const roots = rootsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          const p = await post('/api/devices/' + encodeURIComponent(deviceId) + '/policy', { mode, allowed_roots: roots })
          setPolicy(p); setNotice('Policy updated: ' + p.mode)
          const a = await api('/api/devices/' + encodeURIComponent(deviceId) + '/audit?limit=80')
          setAudit(a.entries || [])
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const loadDir = React.useCallback(async (target) => {
        if (!deviceId || !target) return
        setBusy(true)
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path: target })
          setListing(data); setPath(data.path); setPathDraft(data.path); setSelected(null)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }, [deviceId])
      React.useEffect(() => { if (view === 'files' && path) loadDir(path) }, [view, path, loadDir])

      const openFile = async (entry) => {
        if (entry.dir) { setPath(entry.path); setPathDraft(entry.path); return }
        setBusy(true)
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/read', { path: entry.path })
          const stat = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/stat', { path: entry.path })
          setFile({ ...data, writable: stat.writable }); setDraft(data.binary ? '' : data.text); setDirty(false); setSelected(entry)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }
      const saveFile = async () => {
        if (!file || file.binary) return
        setBusy(true)
        try {
          await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: file.path, text: draft })
          setDirty(false); setNotice('Saved ' + file.path); loadDir(path)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }
      const askValue = (title, value, onOk) => setAsk({ title, value: value || '', onOk })
      const newFolder = () => askValue('新建文件夹', '', async (name) => { try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: path + '\\' + name }); loadDir(path) } catch (e) { fail(e) } })
      const newFile = () => askValue('新建文件', '', async (name) => { const target = path + '\\' + name; try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: target, text: '' }); loadDir(path); openFile({ path: target, dir: false, name }) } catch (e) { fail(e) } })
      const renameEntry = () => { if (selected) askValue('重命名', selected.name, async (name) => { try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/rename', { path: selected.path, dest: path + '\\' + name }); setSelected(null); if (file && file.path === selected.path) setFile(null); loadDir(path) } catch (e) { fail(e) } }) }
      const deleteEntry = async () => {
        if (!selected) return
        if (!window.confirm('Move "' + selected.name + '" to .tether-trash?')) return
        try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/delete', { path: selected.path }); setSelected(null); if (file && file.path === selected.path) setFile(null); loadDir(path) } catch (e) { fail(e) }
      }
      const newProject = () => {
        if (!projects) return
        askValue('新建项目（' + projects.root + '）', '', async (name) => {
          try {
            const target = projects.root + '\\' + name
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: target })
            await loadProjects()
            setProject({ name, path: target, kind: 'tether' }); setView('files'); setPath(target); setPathDraft(target); loadDir(target)
          } catch (e) { fail(e) }
        })
      }
      const submitAsk = () => {
        if (!ask) return
        const value = ask.value.trim()
        if (!value) return
        const cb = ask.onOk; setAsk(null); cb(value)
      }

      const selectPanel = (id) => {
        if (id === activePanel && !sidebarCollapsed) setSidebarCollapsed(true)
        else { setActivePanel(id); setSidebarCollapsed(false) }
      }

      const dragWidth = (event, start, setter, min, max) => {
        event.preventDefault()
        const startX = event.clientX
        const move = (ev) => setter(clamp(start + ev.clientX - startX, min, max))
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
      }

      const startSidebarResize = (event) => dragWidth(event, safeSidebarWidth, setSidebarWidth, UI.minSide, UI.maxSide)
      const startFileResize = (event) => dragWidth(event, safeFileListWidth, setFileListWidth, UI.minFiles, UI.maxFiles)

      const rowStyle = (active) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: active ? C.soft : 'transparent', fontSize: 12.5 })
      const modelText = sessionId && sessionData ? [sessionData.model, sessionData.agent_preset].filter(Boolean).join(' · ') : ''

      return h('div', { style: { position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.ink, fontSize: 13, overflow: 'hidden' } },
        h('style', null, SCROLL_CSS),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 15 } }, 'Tether'),
          device ? h('span', { style: { display: 'flex', alignItems: 'center', fontSize: 12, color: C.sub } }, dot(device.online), device.name) : h('span', { style: { color: C.mute } }, 'no device'),
          device && device.capabilities && !device.capabilities.fs ? pill('节点待更新', C.amber) : null,
          h('div', { style: { display: 'flex', gap: 2, marginLeft: 10, padding: 2, background: C.soft, borderRadius: 8 } },
            h('button', { onClick: () => setView('chat'), style: { border: 0, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: view === 'chat' ? '#fff' : 'transparent', color: view === 'chat' ? C.ink : C.mute, boxShadow: view === 'chat' ? '0 1px 2px rgba(16,24,40,0.08)' : 'none' } }, '对话'),
            h('button', { onClick: () => setView('files'), style: { border: 0, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: view === 'files' ? '#fff' : 'transparent', color: view === 'files' ? C.ink : C.mute, boxShadow: view === 'files' ? '0 1px 2px rgba(16,24,40,0.08)' : 'none' } }, '文件')
          ),
          h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
            policy ? pill(policy.mode === 'full' ? 'full-disk' : (policy.mode === 'locked' ? 'locked' : 'readonly'), policy.mode === 'full' ? C.red : (policy.mode === 'locked' ? C.amber : C.mute)) : null,
            btn('权限设置', openSettings)
          )
        ),
        notice ? h('div', { style: { padding: '6px 14px', background: /^Saved |^Policy updated/.test(notice) ? '#ecfdf3' : '#fef3f2', color: /^Saved |^Policy updated/.test(notice) ? '#067647' : C.red, borderBottom: '1px solid ' + (/^Saved |^Policy updated/.test(notice) ? '#abefc6' : '#fecdca'), fontSize: 12 } }, notice) : null,
        h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0 } },
          h(ActivityBar, {
            active: activePanel,
            collapsed: sidebarCollapsed,
            onSelect: selectPanel,
            onSettings: openSettings,
            settingsOpen: showSettings
          }),
          h(SidePanel, {
            panel: activePanel,
            width: safeSidebarWidth,
            hidden: sidebarCollapsed,
            onResizeStart: startSidebarResize,
            onResetWidth: () => setSidebarWidth(UI.defaultSide),
            onCollapse: () => setSidebarCollapsed(true),
            devices: (state && state.devices) || [],
            localDevice: state && state.local_device,
            deviceId,
            onSelectDevice: setDeviceId,
            projects,
            project,
            onSelectProject: (w) => { setProject(w); setView('chat') },
            onNewProject: newProject,
            newProjectDisabled: !deviceOnline || !projects || !!projects.synthetic,
            nativeSessions: nativeForProject,
            runs,
            sessionId,
            runId,
            onSelectSession: (id) => { setSessionId(id); setRunId(''); setView('chat') },
            onSelectRun: (id) => { setRunId(id); setSessionId(''); setView('chat') }
          }),
          h('main', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
            view === 'chat' ? h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
                h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
                  h('div', { style: { fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, conversationTitle || '对话'),
                  h('div', { style: { fontSize: 11, color: C.mute, marginTop: 1 } }, [
                    sessionId ? '原生 DSH 会话 · 只读' : (runId ? 'Tether 任务 · 目标机执行' : '选择左侧会话或发起任务'),
                    modelText ? ' · ' + modelText : ''
                  ].join(''))
                ),
                pill(conversationStatus || 'idle', conversationStatus === 'running' ? C.blue : (conversationStatus === 'failed' ? C.red : C.mute))
              ),
              h(Conversation, {
                data: conversation, loading: sessionLoading && !sessionData,
                live: (sessionData && sessionData.status === 'running') || (currentRun && ['queued', 'dispatching', 'running', 'cancelling'].includes(currentRun.state)),
                emptyText: nativeError && !runId ? '目标节点未提供原生会话；可以直接在下方发起 Tether 任务' : (nativeForProject.length ? '选择一个会话' : '还没有对话，直接发一条任务开始')
              }),
              h(Composer, {
                value: task, onChange: setTask, onSend: send, busy,
                disabled: !deviceOnline || !project,
                note: sessionId ? '原生 DSH 会话只读；发送会在同一工作区新建 Tether 任务，不写入上面的原生会话' : (runId ? '继续当前 Tether 会话' : '发送到目标机的工作区')
              })
            ) : h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
              h('div', { style: { borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px 4px' } },
                  btn('↑', () => { if (!path) return; const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, ''); if (parent && parent !== path) { setPath(parent); setPathDraft(parent) } }, { title: '上级目录' }),
                  h('input', { value: pathDraft, onChange: (ev) => setPathDraft(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') loadDir(pathDraft) }, spellCheck: false, style: { flex: '1 1 auto', minWidth: 0, height: 28, border: '1px solid ' + C.line, borderRadius: 6, padding: '0 8px', fontFamily: 'Consolas, monospace', fontSize: 12 } }),
                  btn('刷新', () => loadDir(path), { disabled: !path }),
                  listing && !listing.writable ? pill('read-only', C.amber) : null
                ),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 7px' } },
                  btn('新建文件夹', newFolder, { disabled: !listing || !listing.writable }),
                  btn('新建文件', newFile, { disabled: !listing || !listing.writable }),
                  btn('重命名', renameEntry, { disabled: !selected }),
                  btn('删除', deleteEntry, { disabled: !selected, danger: true }),
                  selected ? h('span', { style: { marginLeft: 6, fontSize: 11.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected.name) : null
                )
              ),
              h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0 } },
                h('div', { className: 'tether-scroll', style: { width: safeFileListWidth, flex: '0 0 auto', borderRight: '1px solid ' + C.line, overflow: 'auto', background: C.bg } },
                  listing ? h('div', null,
                    listing.entries.map((entry) => h('div', { key: entry.path, onClick: () => setSelected(entry), onDoubleClick: () => openFile(entry), style: { ...rowStyle(selected && selected.path === entry.path), padding: '5px 10px', borderRadius: 0 } },
                      h('span', { style: { width: 16, color: C.mute, fontSize: 12 } }, entry.dir ? '▸' : '·'),
                      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: entry.hidden ? C.mute : C.ink } }, entry.name),
                      h('span', { style: { marginLeft: 'auto', fontSize: 10, color: C.mute, whiteSpace: 'nowrap' } }, entry.dir ? '' : formatBytes(entry.size))
                    )),
                    !listing.entries.length ? h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, '空目录') : null
                  ) : h('div', { style: { padding: 16, color: C.mute, fontSize: 12 } }, path ? (busy ? '加载中…' : '无法读取') : '选择项目')
                ),
                h('div', {
                  onPointerDown: startFileResize, onDoubleClick: () => setFileListWidth(UI.defaultFiles),
                  title: '拖动调整文件栏宽度，双击复位',
                  style: { width: 5, flex: '0 0 auto', cursor: 'col-resize', background: 'transparent' }
                }),
                h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' } },
                  file ? h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
                      h('span', { style: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.path),
                      file.binary ? pill('binary') : pill(formatBytes(file.size)),
                      file.writable ? null : pill('read-only', C.amber),
                      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } }, file.writable && !file.binary ? btn(dirty ? 'Save *' : 'Save', saveFile, { primary: true, disabled: !dirty || busy }) : null)
                    ),
                    file.binary ? h('div', { style: { padding: 20, color: C.mute, fontSize: 12 } }, 'Binary file. Preview is not supported.')
                      : h('textarea', { value: draft, onChange: (ev) => { setDraft(ev.target.value); setDirty(true) }, readOnly: !file.writable, spellCheck: false, style: { flex: '1 1 auto', width: '100%', boxSizing: 'border-box', resize: 'none', border: 0, outline: 'none', padding: '10px 12px', fontFamily: 'Consolas, monospace', fontSize: 12.5, lineHeight: 1.55, background: file.writable ? '#fff' : C.panel, color: C.ink } })
                  ) : h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', color: C.mute, fontSize: 12 } }, path ? '双击文件查看内容' : '先从左侧选择项目')
                )
              )
            )
        ),
        ),
        showSettings ? h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 20 } },
          h('div', { style: { width: 480, height: '100%', background: '#fff', borderLeft: '1px solid ' + C.line, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(16,24,40,0.12)' } },
            h('div', { style: { padding: '12px 16px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'center' } },
              h('strong', null, '文件权限'), device ? h('span', { style: { marginLeft: 8, fontSize: 12, color: C.mute } }, device.name) : null,
              h('button', { onClick: () => setShowSettings(false), style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.mute } }, '×')
            ),
            h('div', { style: { padding: 16, overflow: 'auto', flex: '1 1 auto' } },
              h('div', { style: { display: 'grid', gap: 6, marginBottom: 12 } },
                [['readonly', '默认：全盘只读 + 项目可写', '全盘可读；仅项目根、已有 DSH 工作区、节点工作目录可写。', C.dark],
                 ['locked', '锁定：全部只读', '任何写入、新建、重命名、删除都被拒绝。', C.amber],
                 ['full', '全盘读写', '目标机主机权限。系统目录、凭据与 AppData 仍拒写；需二次确认。', C.red]].map(([value, title, desc, color]) =>
                  h('label', { key: value, style: { border: '1px solid ' + (mode === value ? color : C.line), borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: mode === value ? (value === 'full' ? '#fef3f2' : (value === 'locked' ? '#fffaeb' : C.panel)) : '#fff' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, h('input', { type: 'radio', checked: mode === value, onChange: () => setMode(value) }), h('strong', { style: { fontSize: 13 } }, title)),
                    h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 3 } }, desc)
                  ))
              ),
              h('div', { style: { fontSize: 11, fontWeight: 600, color: C.mute, marginBottom: 6, letterSpacing: 0.4 } }, '可写根目录'),
              h('textarea', { value: rootsText, onChange: (ev) => setRootsText(ev.target.value), spellCheck: false, style: { width: '100%', height: 88, boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 6, padding: 8, fontFamily: 'Consolas, monospace', fontSize: 12, resize: 'vertical' } }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } }, btn('保存权限', savePolicy, { primary: true, disabled: busy || !device || !device.online }), h('span', { style: { fontSize: 11, color: C.mute, alignSelf: 'center' } }, policy ? ('更新于 ' + (policy.updated_by || 'default')) : '')),
              h('div', { style: { fontSize: 11, fontWeight: 600, color: C.mute, margin: '18px 0 6px', letterSpacing: 0.4 } }, '审计（最近 80 条）'),
              h('div', { style: { border: '1px solid ' + C.line, borderRadius: 6, overflow: 'hidden' } },
                h('div', { style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '5px 8px', background: C.panel, fontSize: 10, color: C.mute, borderBottom: '1px solid ' + C.line } }, h('span', null, '操作'), h('span', null, '路径'), h('span', null, '结果')),
                h('div', { style: { maxHeight: 220, overflow: 'auto' } },
                  audit.map((a, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '4px 8px', fontSize: 10.5, borderBottom: '1px solid ' + C.soft, color: a.result === 'denied' ? C.red : C.sub } },
                    h('span', null, a.op), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.path }, a.path),
                    h('span', null, a.phase === 'intent' ? (a.result === 'denied' ? 'denied' : 'intent') : a.result)
                  )),
                  !audit.length ? h('div', { style: { padding: 10, fontSize: 11, color: C.mute } }, '暂无审计') : null
                )
              )
            )
          )
        ) : null,
        ask ? h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'grid', placeItems: 'center', zIndex: 30 } },
          h('div', { style: { width: 380, background: '#fff', borderRadius: 10, boxShadow: '0 20px 48px rgba(16,24,40,0.24)', padding: 18 } },
            h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 10 } }, ask.title),
            h('input', { autoFocus: true, value: ask.value, spellCheck: false, onChange: (ev) => setAsk({ ...ask, value: ev.target.value }), onKeyDown: (ev) => { if (ev.key === 'Enter') submitAsk(); if (ev.key === 'Escape') setAsk(null) }, style: { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 6, padding: '0 8px', fontSize: 13 } }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } }, btn('取消', () => setAsk(null)), btn('确定', submitAsk, { primary: true, disabled: !ask.value.trim() }))
          )
        ) : null
      )
    }

    function TetherIcon() {
      return h('span', { title: 'Tether', style: { display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6, background: '#101828', color: '#fff', fontSize: 12, fontWeight: 700 } }, 'T')
    }

    return {
      name: 'tether',
      inject: ['slots', 'layout'],
      apply(ctx) {
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({ name: 'main', key: PANEL_ID }, App)
        })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => 'Tether'
        }, TetherIcon))
      }
    }
  }
})
