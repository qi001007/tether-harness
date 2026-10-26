window.__ModuleLoader__.load({
  id: 'tether-dsh-client',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'tether'
    const BASE = 'http://127.0.0.1:18890'

    const C = {
      ink: 'var(--dsw-alias-label-primary, #101828)',
      sub: 'var(--dsw-alias-label-secondary, #475467)',
      mute: 'var(--dsw-alias-label-tertiary, #667085)',
      line: 'var(--dsw-alias-border-l1, rgba(9, 30, 66, 0.04))',
      soft: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
      hover: 'var(--dsw-alias-interactive-bg-hover-solid, #f2f4f7)',
      active: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10))',
      bg: 'var(--dsw-alias-bg-base, #ffffff)',
      panel: 'var(--dsw-specific-sidebar-fill, #f9fafb)',
      layer1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      layer2: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      layer3: 'var(--dsw-alias-bg-layer-3, #ffffff)',
      input: 'var(--dsw-specific-input-major, #ffffff)',
      green: 'var(--dsw-alias-state-success-primary, #16a34a)',
      red: 'var(--dsw-alias-state-error-primary, #b42318)',
      blue: 'var(--dsw-alias-state-business-primary, #1570ef)',
      amber: 'var(--dsw-alias-state-warn-primary, #b54708)',
      primary: 'var(--dsw-alias-button-primary-fill, #101828)',
      onPrimary: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
      bubble: 'var(--dsw-specific-bubble, #f2f4f7)',
      block: 'var(--dsw-alias-markdown-code-block, #f8fafc)',
      shadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16, 24, 40, 0.12))'
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
          color: color || C.sub, border: 0,
          background: C.soft, whiteSpace: 'nowrap'
        }
      }, text)
    }
    function dot(on, color) {
      return h('span', { style: { width: 7, height: 7, borderRadius: 4, display: 'inline-block', background: color || (on ? C.green : C.mute), marginRight: 7, flex: '0 0 auto' } })
    }
    function btn(label, onClick, opts) {
      const o = opts || {}
      return h('button', {
        onClick, disabled: o.disabled, title: o.title || label, className: 'tether-press',
        style: {
          height: 28, padding: '0 10px', borderRadius: 6, fontSize: 12, border: 0,
          background: o.primary ? C.primary : C.soft,
          color: o.primary ? C.onPrimary : (o.danger ? C.red : C.ink),
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
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
      let last = 0, match, key = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('**')) out.push(h('strong', { key: 'b' + key++ }, token.slice(2, -2)))
        else if (token.startsWith('`')) out.push(h('code', { key: 'c' + key++ }, token.slice(1, -1)))
        else if (token.startsWith('[')) {
          const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
          const href = link && /^(https?:\/\/|mailto:)/i.test(link[2]) ? link[2] : null
          out.push(href
            ? h('a', { key: 'a' + key++, href, target: '_blank', rel: 'noreferrer' }, link[1])
            : h('span', { key: 'a' + key++ }, link ? link[1] + ' (' + link[2] + ')' : token))
        } else out.push(h('em', { key: 'e' + key++ }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    // Mirrors DSH's markdown token ladder (paragraph 16px rhythm, 600 strong,
    // inline code chip, 21/30 → 16/24 headings) inside the plugin bundle.
    function Markdown({ text, secondary }) {
      const source = String(text || '')
      if (!source) return null
      const nodes = []
      let key = 0
      source.split(/```/).forEach((part, index) => {
        if (index % 2 === 1) {
          const lines = part.replace(/^\n+|\n+$/g, '').split('\n')
          let lang = ''
          if (lines.length && /^[a-zA-Z0-9_+-]+$/.test(lines[0].trim()) && lines.length > 1) lang = lines.shift().trim()
          nodes.push(h('div', { key: 'p' + key++, className: 'tether-code' },
            lang ? h('div', { className: 'tether-code-banner' }, lang) : null,
            h('pre', null, h('code', null, lines.join('\n')))))
          return
        }
        part.split(/\n\s*\n/).forEach((raw) => {
          const block = raw.replace(/^\n+|\n+$/g, '')
          if (!block.trim()) return
          const lines = block.split('\n')
          const tableRow = (line) => /^\s*\|.*\|\s*$/.test(line)
          if (lines.length >= 2 && lines.every(tableRow)) {
            const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
            const body = rows.filter((row, i) => i !== 1 || !row.every((cell) => /^:?-{3,}:?$/.test(cell)))
            nodes.push(h('div', { key: 't' + key++, className: 'tether-table' },
              h('table', null, h('tbody', null, body.map((row, ri) => h('tr', { key: ri },
                row.map((cell, ci) => h(ri === 0 ? 'th' : 'td', { key: ci }, inline(cell)))))))))
            return
          }
          const heading = lines[0].match(/^(#{1,6})\s+(.*)$/)
          if (heading) {
            const level = Math.min(4, heading[1].length)
            nodes.push(h('h' + level, { key: 'h' + key++ }, inline(heading[2])))
            if (lines.length > 1) nodes.push(h('p', { key: 'hp' + key++ }, inline(lines.slice(1).join('\n'))))
            return
          }
          if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
            nodes.push(h('ul', { key: 'u' + key++ },
              lines.map((line, i) => h('li', { key: i }, inline(line.replace(/^\s*[-*]\s+/, ''))))))
            return
          }
          if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
            nodes.push(h('ol', { key: 'o' + key++ },
              lines.map((line, i) => h('li', { key: i }, inline(line.replace(/^\s*\d+[.)]\s+/, ''))))))
            return
          }
          if (lines.every((line) => /^\s*>\s?/.test(line))) {
            nodes.push(h('blockquote', { key: 'q' + key++ }, h('p', null, inline(lines.map((line) => line.replace(/^\s*>\s?/, '')).join('\n')))))
            return
          }
          if (lines.every((line) => /^\s*(---|\*\*\*)\s*$/.test(line))) {
            nodes.push(h('hr', { key: 'r' + key++ }))
            return
          }
          nodes.push(h('p', { key: 'd' + key++ }, inline(lines.join('\n'))))
        })
      })
      return h('div', { className: 'tether-md' + (secondary ? ' tether-md-secondary' : '') }, nodes)
    }

    function Shimmer({ text, active, className }) {
      if (!active) return h('span', { className }, text)
      return h('span', { className: 'tether-shimmer' + (className ? ' ' + className : '') },
        h('span', { className: 'tether-shimmer-content' }, text),
        h('span', { className: 'tether-shimmer-cover', 'aria-hidden': true },
          h('span', { className: 'tether-shimmer-sweep' },
            h('span', { className: 'tether-shimmer-hi' }, text))))
    }

    function firstLine(text) {
      const line = String(text || '')
      const cut = line.indexOf('\n')
      return (cut === -1 ? line : line.slice(0, cut)).replaceAll('**', '').trim()
    }

    function ProcessRow({ block, streaming }) {
      const [open, setOpen] = React.useState(false)
      const isThink = block.type === 'reasoning'
      const running = block.status === 'running'
      const title = isThink ? '思考' : (block.name || '工具调用')
      const text = isThink ? firstLine(block.text) : shortText(block.command || block.arguments || block.result || '', 160)
      return h('div', { className: 'tether-proc' },
        h('div', {
          role: 'button', tabIndex: 0, className: 'tether-proc-row',
          'aria-expanded': open, onClick: () => setOpen(!open),
          onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(!open) } }
        },
          h('span', { className: 'tether-proc-leading', 'data-open': open || undefined },
            h('span', { className: 'tether-proc-idle' }, h(Glyph, { name: isThink ? 'think' : 'tool', size: 14 })),
            h('span', { className: 'tether-proc-chev' }, h(Glyph, { name: 'chevronDown', size: 14 }))),
          h('span', { className: 'tether-proc-title' }, title),
          text ? h('span', { className: 'tether-proc-sep', 'aria-hidden': true }) : null,
          text ? h('span', { className: 'tether-proc-summary' },
            isThink ? h(Shimmer, { text, active: running || streaming }) : text) : null),
        open ? (isThink
          ? h('div', { className: 'tether-proc-think' }, h(Markdown, { text: String(block.text || ''), secondary: true }))
          : h('pre', { className: 'tether-proc-output' }, block.arguments || block.result || '')) : null
      )
    }

    function durationParts(seconds) {
      const total = Math.max(0, Math.floor(seconds))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor(total / 60) % 60
      const parts = []
      if (hours > 0) parts.push({ text: String(hours), numeric: true }, { text: '小时', numeric: false })
      if (total >= 60) parts.push({ text: String(minutes), numeric: true }, { text: '分', numeric: false })
      parts.push({ text: String(total % 60), numeric: true }, { text: '秒', numeric: false })
      return parts
    }

    function turnRunning(turn, live) {
      if (turn.state === 'running') return true
      if (turn.ended_at) return false
      return !!live
    }

    function ProcessGroup({ blocks, turn, live, latest }) {
      const running = turnRunning(turn, live)
      const [open, setOpen] = React.useState(false)
      const list = blocks || []
      if (running) {
        if (!list.length) return null
        return h('div', { className: 'tether-process' },
          h('div', { className: 'tether-proc-list' }, list.map((block, i) => h(ProcessRow, { key: i, block, streaming: true }))))
      }
      const stopped = turn.state === 'cancelled' || turn.state === 'aborted' || turn.state === 'interrupted'
      const failed = turn.state === 'failed' || turn.state === 'error'
      const elapsed = turn.started_at && turn.ended_at ? Math.max(1, Math.round(turn.ended_at - turn.started_at)) : null
      const parts = !stopped && !failed && elapsed ? durationParts(elapsed) : []
      const label = stopped ? '已停止' : (failed ? '处理失败' : '已完成')
      return h('div', { className: 'tether-process tether-ink' },
        h('button', {
          type: 'button', className: 'tether-turn-head', 'data-open': open || undefined,
          'aria-expanded': list.length ? open : undefined, disabled: !list.length,
          'data-turn-process': turn.turn, 'data-turn-process-tool-calls': list.filter((b) => b.type === 'tool').length,
          onClick: () => { if (list.length) setOpen(!open) }
        },
          h('span', { className: 'tether-turn-label' },
            label,
            parts.length ? '，用时 ' : null,
            parts.map((part, index) => part.numeric
              ? h('span', { key: index, className: 'tether-turn-number' }, part.text)
              : part.text)),
          list.length ? h('span', { className: 'tether-turn-chev' }, h(Glyph, { name: 'chevronDown', size: 14 })) : null),
        list.length && open ? h('div', { className: 'tether-proc-list' }, list.map((block, i) => h(ProcessRow, { key: i, block }))) : null
      )
    }

    function UserBubble({ text }) {
      return h('div', { className: 'tether-user-row' },
        h('div', { className: 'tether-user-bubble' }, text))
    }

    const WHALE_PATH = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742'

    function durationText(parts) {
      return parts.map((part) => part.text).join('')
    }

    function RunningStatus({ startTime, paused, hasOutput }) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (startTime == null || paused) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [startTime, paused])
      const label = startTime == null ? '深度求索中'
        : '深度求索中，用时 ' + durationText(durationParts(Math.max(1, Math.floor(now / 1000 - startTime)))) + ' ···'
      return h('div', { className: 'tether-running', 'data-chat-running': true },
        h('span', { className: 'tether-running-divider', 'data-visible': hasOutput ? 'true' : undefined, 'aria-hidden': true }),
        h('span', { className: 'tether-running-content' },
          h('span', { className: 'tether-running-icon', 'aria-hidden': true },
            h('svg', { width: '100%', height: '100%', viewBox: '0 0 16 16', fill: 'none' },
              h('path', { d: WHALE_PATH, stroke: 'currentColor', strokeWidth: 1 }))),
          h(Shimmer, { text: label, active: true, className: 'tether-running-text' })))
    }

    function Turn({ turn, index, live, latest }) {
      const blocks = turn.blocks || []
      const processBlocks = blocks.filter((block) => block.type === 'reasoning' || block.type === 'tool')
      const texts = blocks.filter((block) => block.type === 'text')
      const running = turnRunning(turn, live)
      return h('div', { className: 'tether-turn' },
        turn.user ? h(UserBubble, { text: turn.user.text }) : null,
        h(ProcessGroup, { blocks: processBlocks, turn, live, latest }),
        texts.length ? h('div', { className: 'tether-body' },
          texts.map((block, i) => h('div', { key: i, className: 'tether-answer tether-ink' }, h(Markdown, { text: block.text })))) : null,
        running ? h(RunningStatus, { startTime: turn.started_at, paused: false, hasOutput: blocks.length > 0 }) : null
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
      return h('div', { ref: box, className: 'tether-scroll', style: { flex: '1 1 auto', overflow: 'auto', padding: '16px 0 24px' } },
        h('div', { className: 'tether-flow' },
          turns.map((turn, i) => h(Turn, { key: i, turn, index: i, live, latest: i === turns.length - 1 }))
        )
      )
    }

    function Composer({ value, onChange, onSend, busy, disabled, note }) {
      return h('div', { style: { border: 0, padding: '8px 12px 10px', flex: '0 0 auto', background: C.bg } },
        note ? h('div', { style: { color: C.mute, fontSize: 10.5, margin: '0 2px 5px' } }, note) : null,
        h('div', { style: { maxWidth: 780, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end', border: 0, borderRadius: 12, padding: 7, background: C.panel } },
          h('textarea', {
            value, onChange: (ev) => onChange(ev.target.value), disabled,
            onKeyDown: (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); onSend() } },
            placeholder: disabled ? '选择项目后可发起任务' : '发消息或发起任务…',
            style: { flex: '1 1 auto', minHeight: 38, maxHeight: 160, resize: 'none', border: 0, outline: 'none', padding: '6px 8px', fontSize: 13.5, lineHeight: '20px', fontFamily: 'inherit', background: 'transparent' }
          }),
          h('button', {
            onClick: onSend, disabled: disabled || busy || !value.trim(),
            title: '发送',
            className: 'tether-press',
            style: { width: 34, height: 34, borderRadius: 17, border: 0, background: disabled || busy || !value.trim() ? C.soft : C.primary, color: disabled || busy || !value.trim() ? C.mute : C.onPrimary, cursor: disabled || busy || !value.trim() ? 'not-allowed' : 'pointer', fontSize: 16, flex: '0 0 auto' }
          }, '↑')
        )
      )
    }


    const SCROLL_CSS = `
      .tether-root { --tether-strong: 600; --tether-strong-2: 650; --tether-body: 400; }
      body[data-ds-dark-theme] .tether-root { --tether-strong: 500; --tether-strong-2: 520; --tether-body: 350; }
      .tether-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; overscroll-behavior: contain; }
      .tether-scroll:hover { scrollbar-color: var(--dsw-alias-scrollbar-hover-l1, #cbd5e1) transparent; }
      .tether-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .tether-scroll::-webkit-scrollbar-track { background: transparent; }
      .tether-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
      .tether-scroll:hover::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-hover-l1, #cbd5e1); }
      .tether-scroll::-webkit-scrollbar-corner { background: transparent; }
      .tether-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
      .tether-flow { display: flex; flex-direction: column; max-width: calc(var(--dsh-chat-content-width, 748px) + 32px); width: 100%; margin: 0 auto; padding: 0 16px; box-sizing: border-box; }
      .tether-turn { display: flex; flex-direction: column; min-width: 0; }
      .tether-turn + .tether-turn { margin-top: 24px; }
      .tether-user-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; margin-bottom: 16px; }
      .tether-user-bubble { max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%); background: var(--dsw-specific-bubble, #f2f4f7); border-radius: var(--dsw-radius-xl, 20px); padding: 10px 16px; font-size: var(--dsh-content-font-size, 14px); line-height: calc(22px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-primary, #101828); white-space: pre-wrap; word-break: break-word; }
      .tether-process { display: flex; flex-direction: column; min-width: 0; }
      .tether-turn-head { box-sizing: border-box; display: flex; align-items: center; width: 100%; min-width: 0; height: calc(33px + var(--dsh-content-font-delta, 0px)); margin: 0 0 16px; padding: 0 0 8px; border: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: var(--dsh-content-font-size, 14px); cursor: pointer; text-align: left; transition: color 100ms ease; }
      .tether-turn-head[data-open] { margin-bottom: 8px; }
      .tether-turn-head:disabled { cursor: default; }
      @media (hover: hover) { .tether-turn-head:hover { color: var(--dsw-alias-label-secondary); } }
      .tether-turn-label { min-width: 0; overflow: hidden; font-size: inherit; line-height: calc(24px + var(--dsh-content-font-delta, 0px)); text-overflow: ellipsis; white-space: nowrap; }
      .tether-turn-number { font-family: var(--ds-font-family-code, monospace); font-variant-numeric: tabular-nums; }
      .tether-turn-chev { flex: none; width: 14px; height: 14px; margin-left: 4px; display: grid; place-items: center; color: inherit; transition: transform 100ms ease; }
      .tether-turn-head[data-open] .tether-turn-chev { transform: rotate(180deg); }
      .tether-proc-list { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
      .tether-proc { display: flex; flex-direction: column; min-width: 0; }
      .tether-proc-row { display: flex; align-items: center; min-width: 0; height: calc(24px + var(--dsh-content-font-delta, 0px)); border-radius: var(--dsw-radius-sm, 8px); color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary, 13px); cursor: pointer; transition: color 100ms ease; }
      @media (hover: hover) { .tether-proc-row:hover { color: var(--dsw-alias-label-secondary); } }
      .tether-proc-leading { position: relative; flex: none; width: calc(16px + var(--dsh-content-font-delta, 0px)); height: calc(16px + var(--dsh-content-font-delta, 0px)); margin-right: 6px; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
      .tether-proc-idle { display: inline-flex; opacity: 1; transition: opacity 100ms ease; }
      .tether-proc-chev { position: absolute; inset: 0; margin: auto; display: grid; place-items: center; opacity: 0; transition: opacity 100ms ease; }
      @media (hover: hover) { .tether-proc-row:hover .tether-proc-idle { opacity: 0; } .tether-proc-row:hover .tether-proc-chev { opacity: 1; } }
      .tether-proc-leading[data-open] .tether-proc-idle { opacity: 0; }
      .tether-proc-leading[data-open] .tether-proc-chev { opacity: 1; transform: rotate(180deg); }
      .tether-proc-title { flex: none; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); color: inherit; font-weight: 400; }
      .tether-proc-sep { flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: var(--dsw-alias-label-caption); }
      .tether-proc-summary { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); }
      .tether-proc-think { padding: 4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); }
      .tether-proc-think .tether-md { font-size: inherit; line-height: inherit; color: inherit; }
      .tether-proc-think p { margin: 8px 0; }
      .tether-proc-output { margin: 4px 0 6px calc(22px + var(--dsh-content-font-delta, 0px)); padding: 8px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-markdown-code-block, #f8fafc); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-markdown-code-block-small, 12px/20px var(--ds-font-family-code, monospace)); white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
      .tether-body { display: flex; flex-direction: column; gap: 16px; }
      .tether-process + .tether-body { margin-top: 12px; }
      .tether-answer { min-width: 0; }
      .tether-md { min-width: 0; overflow-wrap: anywhere; font-family: inherit; font-size: var(--dsh-content-font-size, 14px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-primary, #101828); }
      .tether-md > :first-child { margin-top: 0 !important; }
      .tether-md > :last-child { margin-bottom: 0 !important; }
      .tether-md p { margin: 16px 0; }
      .tether-md strong { font-weight: 600; }
      .tether-md h1 { margin: 32px 0 16px; font-size: calc(21px + var(--dsh-content-font-delta, 0px)); line-height: calc(30px + var(--dsh-content-font-delta, 0px)); font-weight: 700; }
      .tether-md h2 { margin: 32px 0 16px; font-size: calc(19px + var(--dsh-content-font-delta, 0px)); line-height: calc(28px + var(--dsh-content-font-delta, 0px)); font-weight: 700; }
      .tether-md h3 { margin: 32px 0 16px; font-size: calc(18px + var(--dsh-content-font-delta, 0px)); line-height: calc(26px + var(--dsh-content-font-delta, 0px)); font-weight: 700; }
      .tether-md h4 { margin: 16px 0; font-size: var(--dsh-content-font-size, 14px); line-height: calc(24px + var(--dsh-content-font-delta, 0px)); font-weight: 600; }
      .tether-md ul, .tether-md ol { margin: 16px 0; padding-left: 18px; }
      .tether-md li:not(:first-child) { margin-top: 6px; }
      .tether-md li::marker { line-height: 24px; color: var(--dsw-alias-label-secondary); }
      .tether-md :not(pre) > code { display: inline-flex; align-items: center; box-sizing: border-box; padding: 0 5px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 8px); background-color: var(--dsw-alias-markdown-inline-code, #f7f7f8); font-family: var(--ds-font-family-code, monospace); font-size: 0.875em; }
      .tether-md a { color: var(--dsw-alias-link, #344054); font-weight: 500; text-decoration: none; }
      .tether-md a:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
      .tether-md blockquote { margin: 16px 0; padding-left: 14px; border-left: 2px solid var(--dsw-alias-label-caption); }
      .tether-md hr { height: 0.5px; margin: 32px 0; border: 0; background: var(--dsw-alias-border-l2); }
      .tether-code { margin: 16px 0; background: var(--dsw-alias-markdown-code-block, #f8fafc); border-radius: var(--dsw-radius-lg, 12px); overflow: hidden; }
      .tether-code-banner { padding: 9px 14px; background: var(--dsw-alias-markdown-code-block-banner, #f2f4f7); color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code, monospace); font-size: 11px; line-height: 18px; }
      .tether-code pre { margin: 0; padding: 12px 14px; overflow: auto; color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code, monospace); font-size: calc(var(--dsh-content-font-size, 14px) - 2px); line-height: calc(20px + var(--dsh-content-font-delta, 0px)); }
      .tether-code code { padding: 0; border: 0; background: none; font: inherit; }
      .tether-table { margin: 16px 0; overflow-x: auto; }
      .tether-table table { width: 100%; border-collapse: collapse; }
      .tether-table th, .tether-table td { min-width: 100px; padding: 10px 16px; text-align: start; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(22px + var(--dsh-content-font-delta-secondary, 0px)); }
      .tether-table th { border-bottom: 0.5px solid var(--dsw-alias-border-l3); font-weight: 500; }
      .tether-table td { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .tether-table th:first-child, .tether-table td:first-child { padding-left: 0; }
      .tether-table td:last-child { padding-right: 0; }
      .tether-running { --dsw-alias-label-shimmer: var(--dsw-alias-label-deep-diving-shimmer, rgba(16, 24, 40, 0.3)); position: relative; display: flex; flex-direction: column; align-items: flex-start; margin-top: 12px; color: var(--dsw-alias-label-deep-diving, #4b6bfb); font-size: calc(var(--dsh-content-font-size, 14px) - 2px); line-height: calc(22px + var(--dsh-content-font-delta, 0px)); }
      .tether-process + .tether-running { margin-top: 12px; }
      .tether-running-divider { position: absolute; top: -4px; left: 0; right: 0; height: 0.5px; background: color-mix(in srgb, var(--dsw-alias-border-l1) 75%, var(--dsw-alias-border-l2)); opacity: 0; pointer-events: none; transition: opacity 160ms ease; }
      .tether-running-divider[data-visible] { opacity: 1; }
      .tether-running-content { display: inline-flex; align-items: center; min-width: 0; gap: 6px; margin-top: 4px; height: calc(28px + var(--dsh-content-font-delta, 0px)); }
      .tether-running-icon { position: relative; display: inline-flex; flex: none; width: calc(14px + var(--dsh-content-font-delta, 0px)); height: calc(14px + var(--dsh-content-font-delta, 0px)); contain: strict; overflow: hidden; }
      .tether-running-text { min-width: 0; font-variant-numeric: tabular-nums; }
      .tether-proc-summary .tether-shimmer { display: block; width: 100%; }
      .tether-proc-summary .tether-shimmer-content { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tether-proc-summary .tether-shimmer-cover { overflow: hidden; }
      .tether-proc-summary .tether-shimmer-hi { justify-content: flex-start; white-space: nowrap; }
      .tether-shimmer { position: relative; display: inline-grid; width: max-content; max-width: 100%; min-width: 0; vertical-align: top; color: inherit; }
      .tether-shimmer-content { display: flex; align-items: center; min-width: 0; }
      .tether-shimmer-cover { position: absolute; inset: 0; overflow: clip; pointer-events: none; user-select: none; }
      .tether-shimmer-sweep { position: absolute; inset: 0; overflow: hidden; color: var(--dsw-alias-label-shimmer, rgba(16, 24, 40, 0.3)); mask-image: linear-gradient(105deg, transparent 0%, black 40% 60%, transparent 100%); transform: translateX(-100%); animation: tether-shimmer-sweep 1.5s steps(48, end) 0.3s infinite; }
      .tether-shimmer-hi { display: flex; align-items: center; width: 100%; height: 100%; transform: translateX(100%); animation: tether-shimmer-hi 1.5s steps(48, end) 0.3s infinite; }
      @keyframes tether-shimmer-sweep { 0% { transform: translateX(-100%); } 66.6667%, 100% { transform: translateX(100%); } }
      @keyframes tether-shimmer-hi { 0% { transform: translateX(100%); } 66.6667%, 100% { transform: translateX(-100%); } }
      .tether-ink { animation: tether-ink 300ms cubic-bezier(.2,.7,.2,1) both; }
      @keyframes tether-ink {
        from { opacity: 0; filter: blur(3px); transform: translateY(4px); }
        to { opacity: 1; filter: blur(0); transform: translateY(0); }
      }
      .tether-press { transition: transform 120ms cubic-bezier(.2,.8,.2,1.2), background-color 120ms ease; }
      .tether-press:active { transform: scale(.97); }
      .tether-press:hover { filter: brightness(.97); }
      body[data-ds-dark-theme] .tether-press:hover { filter: brightness(1.08); }
      .tether-root button:focus-visible, .tether-root [role=button]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #1570ef); outline-offset: 2px; }
      .tether-hover:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)) !important; }
      .tether-resizer { position: relative; }
      .tether-resizer::after { content: ''; position: absolute; top: 0; right: 2px; width: 1px; height: 100%; background: transparent; transition: background 120ms ease; }
      .tether-resizer:hover::after, .tether-resizer:active::after, .tether-resizer[data-active="true"]::after { background: var(--dsw-alias-state-business-primary, #1570ef); }
      @media (prefers-reduced-motion: reduce) { .tether-ink { animation: none; } .tether-press { transition: none; } .tether-shimmer-cover { display: none; } .tether-shimmer-sweep, .tether-shimmer-hi { animation: none; } }
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
      minSide: 210,
      maxSide: 420,
      defaultSide: 280,
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
      workspace: { cap: 'round', join: 'round', parts: [
        { d: 'M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z' },
        { d: 'M8.7 8.1v3M11.2 8.1v3' }
      ] },
      files: { parts: [
        { d: 'M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991' },
        { d: 'M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z' }
      ] },
      devices: { parts: [
        { d: 'M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z' },
        { d: 'M2.34619 8H13.6538', cap: 'square' },
        { d: 'M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138' },
        { d: 'M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138' }
      ] },
      settings: { join: 'round', parts: [
        { d: 'M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z' }
      ] },
      plus: { parts: [
        { d: 'M8 2V14' },
        { d: 'M2 8H14' }
      ] },
      chevronDown: { parts: [
        { d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6' }
      ] },
      chevronRight: { parts: [
        { d: 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4' }
      ] },
      chevronLeft: { parts: [
        { d: 'M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12' }
      ] },
      think: { parts: [
        { d: 'M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z' },
        { d: 'M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z' },
        { d: 'M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z', fill: 'currentColor', stroke: false }
      ] },
      tool: { parts: [
        { d: 'M6.27612 1.5L4.52612 14.5' },
        { d: 'M11.4739 1.5L9.72388 14.5' },
        { d: 'M2.39868 5.5H14.0681' },
        { d: 'M1.93188 10.5H13.6013' }
      ] },
      file: { parts: [
        { d: 'M4.9375 5.90295H11.0625' },
        { d: 'M4.9375 9.02991H8.27841' },
        { d: 'M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z', fill: 'currentColor', stroke: false }
      ] },
      folderOpen: { parts: [
        { d: 'M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z', fill: 'currentColor', opacity: 0.16, stroke: false },
        { d: 'M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z', fill: 'currentColor', stroke: false },
        { d: 'M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z', fill: 'currentColor', stroke: false }
      ] },
      folderClose: { parts: [
        { d: 'M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z' },
        { d: 'M3.63501 7.66614H12.3647' }
      ] }
    }

    function Glyph({ name, size = 16, stroke }) {
      const glyph = GLYPHS[name] || { parts: [] }
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: stroke == null ? 1 : stroke, strokeLinecap: glyph.cap || 'butt', strokeLinejoin: glyph.join || 'miter', 'aria-hidden': true
      }, glyph.parts.map((part, index) => h('path', {
        key: index, d: part.d, fill: part.fill || 'none', stroke: part.stroke === false ? 'none' : undefined,
        opacity: part.opacity, strokeLinecap: part.cap || glyph.cap || 'butt'
      })))
    }

    function ActivityBar({ active, collapsed, onSelect, onSettings, settingsOpen }) {
      const items = [
        { id: 'workspaces', label: '工作区', icon: 'workspace' },
        { id: 'files', label: '文件', icon: 'files' },
        { id: 'devices', label: '设备', icon: 'devices' }
      ]
      const button = (id, label, icon, onClick, selected) => h('button', {
        key: id, title: label, 'aria-label': label, onClick, className: 'tether-press tether-hover',
        style: {
          width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0,
          borderRadius: UI.radius, cursor: 'pointer', position: 'relative',
          background: selected ? C.layer1 : 'transparent', color: selected ? C.ink : C.mute,
          boxShadow: selected ? '0 1px 2px rgba(16,24,40,0.08)' : 'none'
        }
      }, h(Glyph, { name: icon, size: 18 }))
      return h('nav', {
        'aria-label': 'Tether 面板',
        style: { width: UI.activity, flex: '0 0 auto', borderRight: 0, background: C.soft, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 2 }
      },
        items.map((item) => button(item.id, item.label, item.icon, () => onSelect(item.id), active === item.id)),
        h('div', { style: { marginTop: 'auto' } }, button('settings', '文件权限', 'settings', onSettings, settingsOpen))
      )
    }

    function SidePanelHeader({ title, action, onCollapse }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', height: UI.row, flex: '0 0 auto', padding: '0 ' + UI.pad + 'px', gap: 2 } },
        h('span', { style: { fontSize: UI.header, fontWeight: 'var(--tether-strong, 600)', color: C.mute, letterSpacing: 0.4 } }, title),
        h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 } },
          action,
          h('button', {
            title: '收起侧栏', 'aria-label': '收起侧栏', onClick: onCollapse, className: 'tether-hover',
            style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: UI.radius, background: 'transparent', color: C.mute, cursor: 'pointer' }
          }, h(Glyph, { name: 'chevronLeft', size: 14 }))
        )
      )
    }

    function SideRow({ selected, title, hint, icon, iconColor, onClick, right, indent = 0, action, actionTitle, onAction, toggle, onToggle }) {
      return h('div', {
        role: 'button', tabIndex: 0, title, onClick, className: 'tether-press tether-hover',
        onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick() } },
        style: {
          display: 'flex', alignItems: 'center', gap: 6, minHeight: UI.row, boxSizing: 'border-box',
          padding: '5px ' + UI.pad + 'px 5px ' + (UI.pad + indent * 14) + 'px', borderRadius: UI.radius, cursor: 'pointer', minWidth: 0, width: '100%',
          background: selected ? C.active : 'transparent', fontSize: UI.font, color: C.ink
        }
      },
        toggle ? h('button', {
          title: toggle ? '展开/收起' : '', 'aria-label': '展开/收起',
          onClick: (ev) => { ev.stopPropagation(); onToggle() },
          className: 'tether-hover',
          style: { width: 18, height: 18, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, background: 'transparent', color: C.mute, cursor: 'pointer' }
        }, h(Glyph, { name: toggle, size: 14 })) : null,
        icon ? h('span', { style: { width: UI.icon, height: UI.icon, display: 'grid', placeItems: 'center', color: iconColor || C.mute, flex: '0 0 auto' } }, typeof icon === 'string' ? h(Glyph, { name: icon, size: 14 }) : icon) : null,
        h('span', { style: { minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '18px' } }, title),
        right ? h('span', { className: 'tether-num', style: { flex: '0 0 auto', fontSize: 10, color: C.mute, whiteSpace: 'nowrap' } }, right) : null,
        action ? h('button', {
          title: actionTitle || action, 'aria-label': actionTitle || action,
          onClick: (ev) => { ev.stopPropagation(); if (onAction) onAction() },
          className: 'tether-hover',
          style: { width: 24, height: 24, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 5, background: 'transparent', color: C.mute, cursor: 'pointer' }
        }, typeof action === 'string' ? h(Glyph, { name: action, size: 16, stroke: 1.8 }) : action) : null,
        hint ? h('span', { style: { flex: '0 0 auto', fontSize: 9.5, color: C.mute, border: 0, borderRadius: 999, padding: '0 5px', lineHeight: '15px', background: C.bg } }, hint) : null
      )
    }

    function FileTree({ roots, children, open, onToggle, onOpenFile, selected }) {
      const rows = []
      const walk = (node, depth) => {
        const isDir = node.dir !== false
        const expanded = !!open[node.path]
        const kids = children[node.path]
        const color = selected === node.path ? C.ink : C.ink
        rows.push(h('div', {
          key: node.path, role: 'button', tabIndex: 0, title: node.path,
          onClick: () => isDir ? onToggle(node) : onOpenFile(node),
          onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (isDir) onToggle(node); else onOpenFile(node) } },
          className: 'tether-press tether-hover',
          style: {
            display: 'flex', alignItems: 'center', gap: 6, minHeight: 28, boxSizing: 'border-box',
            padding: '4px ' + UI.pad + 'px 4px ' + (UI.pad + (depth + 1) * 12) + 'px', borderRadius: 5,
            background: selected === node.path ? C.active : 'transparent', color, fontSize: 12.5, cursor: 'pointer', minWidth: 0
          }
        },
          h('span', { style: { width: 12, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: C.mute } },
            isDir ? h(Glyph, { name: expanded ? 'chevronDown' : 'chevronRight', size: 14 }) : null),
          h('span', { style: { width: 12, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: C.mute } },
            h(Glyph, { name: isDir ? (expanded ? 'folderOpen' : 'folderClose') : 'file', size: 16 })),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 } }, node.name || node.path),
          !isDir && node.size != null ? h('span', { className: 'tether-num', style: { flex: '0 0 auto', fontSize: 10, color: C.mute } }, formatBytes(node.size)) : null
        ))
        if (isDir && expanded) {
          if (kids === undefined) rows.push(h('div', { key: node.path + ':loading', style: { padding: '3px ' + UI.pad + 'px 3px ' + (UI.pad + (depth + 2) * 12) + 'px', fontSize: 11.5, color: C.mute } }, '加载中…'))
          else kids.forEach((child) => walk(child, depth + 1))
        }
      }
      roots.forEach((group) => {
        rows.push(h('div', { key: 'g:' + group.id, style: { fontSize: UI.header, fontWeight: 'var(--tether-strong, 600)', color: C.mute, letterSpacing: 0.4, margin: (group.first ? 2 : UI.gapGroup) + 'px ' + UI.pad + 'px 4px' } }, group.label))
        group.nodes.forEach((node) => walk(node, 0))
      })
      return h('div', null, rows)
    }

    function SidePanel(props) {
      const {
        panel, width, hidden, resizing, onResizeStart, onResetWidth, onCollapse,
        devices, localDevice, deviceId, onSelectDevice,
        workspaces, openWorkspaces, onToggleWorkspace, onSelectWorkspace, selectedWorkspacePath,
        onNewWorkspace, newWorkspaceDisabled, onNewSession, ungrouped, freshSession,
        sessionId, runId, onSelectSession, onSelectRun,
        treeRoots, treeChildren, treeOpen, onToggleTree, onOpenFile, treeSelected
      } = props
      const title = panel === 'devices' ? '设备' : (panel === 'files' ? '文件' : '工作区')
      const action = panel === 'workspaces' ? h('button', {
        title: newWorkspaceDisabled ? '当前节点不支持新建工作区' : '新建工作区', 'aria-label': '新建工作区',
        onClick: onNewWorkspace, disabled: newWorkspaceDisabled, className: 'tether-hover',
        style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: UI.radius, background: 'transparent', color: newWorkspaceDisabled ? C.mute : C.mute, cursor: newWorkspaceDisabled ? 'not-allowed' : 'pointer' }
      }, h(Glyph, { name: 'plus', size: 16 })) : null

      const section = (id, content) => h('div', {
        className: 'tether-scroll', 'data-panel': id,
        style: { display: panel === id ? 'block' : 'none', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px ' + UI.pad + 'px ' + UI.pad + 'px' }
      }, content)

      const deviceRows = devices.map((d) => h(SideRow, {
        key: d.device_id, selected: d.device_id === deviceId, title: d.name || d.device_id,
        onClick: () => onSelectDevice(d.device_id),
        icon: 'devices', iconColor: d.online ? C.green : C.mute,
        hint: d.device_id === localDevice ? 'local' : null,
        right: d.online ? null : 'offline'
      }))

      const sessionRow = (s, indent) => h(SideRow, {
        key: s.key, selected: s.type === 'fresh' ? freshSession : (s.key === (s.type === 'run' ? 'run:' + runId : 'session:' + sessionId)),
        title: s.title || s.session_id || s.run_id,
        onClick: () => s.type === 'run' ? onSelectRun(s) : (s.type === 'fresh' ? null : onSelectSession(s)),
        indent, icon: 'chat',
        iconColor: s.status === 'running' || s.state === 'running' || s.type === 'fresh' ? C.blue : (s.state === 'failed' || s.status === 'failed' ? C.red : C.green),
        hint: s.source === 'Tether' ? 'Tether' : 'DSH',
        right: s.type === 'run' ? s.state : (s.type === 'fresh' ? '新会话' : (s.status === 'running' ? '运行中' : timeText((s.updated_at || 0) * 1000)))
      })

      const workspaceRows = workspaces.map((w) => {
        const open = openWorkspaces[w.path] !== false
        return h(React.Fragment, { key: w.path },
          h(SideRow, {
            selected: selectedWorkspacePath === w.path, title: w.name, onClick: () => onSelectWorkspace(w),
            icon: 'workspace', iconColor: C.mute, hint: w.source,
            toggle: open ? 'chevronDown' : 'chevronRight', onToggle: () => onToggleWorkspace(w.path),
            action: 'plus', actionTitle: '新建会话', onAction: () => onNewSession(w)
          }),
          open ? (w.sessions || []).map((s) => sessionRow(s, 1)) : null
        )
      })
      const ungroupedRows = (ungrouped || []).map((s) => sessionRow(s, 0))

      const fileRoots = treeRoots || []
      return h('aside', {
        'aria-label': title,
        style: { display: hidden ? 'none' : 'flex', width, flex: '0 0 auto', minHeight: 0, borderRight: 0, background: C.panel, flexDirection: 'column', position: 'relative', transition: resizing ? 'none' : 'width 180ms cubic-bezier(.2,.85,.2,1.15)', willChange: 'width' }
      },
        h(SidePanelHeader, { title, action, onCollapse }),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          section('devices', h('div', { style: { display: 'grid', gap: UI.gapRow } }, deviceRows, !deviceRows.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '6px ' + UI.pad + 'px' } }, '暂无设备') : null)),
          section('workspaces', h('div', null,
            workspaceRows,
            !workspaces.length ? h('div', { style: { color: C.mute, fontSize: 11.5, padding: '6px ' + UI.pad + 'px' } }, '暂无工作区') : null,
            ungroupedRows.length ? h('div', { style: { fontSize: UI.header, fontWeight: 'var(--tether-strong, 600)', color: C.mute, letterSpacing: 0.4, margin: UI.gapGroup + 'px ' + UI.pad + 'px 4px' } }, '未分组') : null,
            ungroupedRows.length ? h('div', { style: { display: 'grid', gap: UI.gapRow } }, ungroupedRows) : null
          )),
          section('files', h(FileTree, {
            roots: fileRoots, children: treeChildren, open: treeOpen, selected: treeSelected,
            onToggle: onToggleTree, onOpenFile
          }))
        ),
        h('div', {
          className: 'tether-resizer', 'data-active': resizing ? 'true' : undefined,
          onPointerDown: onResizeStart, onDoubleClick: onResetWidth, title: '拖动调整宽度，双击复位',
          style: { position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 2 }
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
      const [activePanel, setActivePanel] = usePersisted('tether.ui.panel.v2', 'workspaces')
      const [sidebarCollapsed, setSidebarCollapsed] = usePersisted('tether.ui.panelCollapsed', false)
      const [sidebarWidth, setSidebarWidth] = usePersisted('tether.ui.panelWidth.v2', UI.defaultSide)
      const [resizing, setResizing] = React.useState(false)
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
      const [selected, setSelected] = React.useState(null)
      const [file, setFile] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [workspaceOpen, setWorkspaceOpen] = React.useState({})
      const [treeChildren, setTreeChildren] = React.useState({})
      const [treeOpen, setTreeOpen] = React.useState({})
      const [treeSelected, setTreeSelected] = React.useState('')
      const [drives, setDrives] = React.useState([])
      const [freshSession, setFreshSession] = React.useState(false)

      const fail = (e) => {
        if (e && e.code === 'node_update_required') { setNativeError('节点待更新'); return }
        setNotice(String((e && e.message) || e))
      }
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

      React.useEffect(() => { setProject(null); setPath(''); setPathDraft(''); setFile(null); setSelected(null); setSessionId(''); setSessionData(null); setRunId(''); setNativeLoaded(false); setWorkspaceOpen({}); setTreeChildren({}); setTreeOpen({}); setTreeSelected(''); setDrives([]); loadProjects() }, [deviceId, loadProjects])

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

      React.useEffect(() => {
        if (!deviceId) { setDrives([]); return }
        let live = true
        api('/api/devices/' + encodeURIComponent(deviceId) + '/drives')
          .then((data) => { if (live) setDrives(data.drives || []) })
          .catch(() => { if (live) setDrives([]) })
        return () => { live = false }
      }, [deviceId])

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
      }, [project])

      const nativeKey = native.map((s) => s.session_id).sort().join(',')
      const sessions = (state && state.sessions) || []
      const workspaceOf = (run) => {
        const s = sessions.find((x) => x.session_id === run.session_id)
        return s ? s.workspace : ''
      }
      const runs = ((state && state.runs) || []).filter((r) => !deviceId || r.device_id === deviceId).slice(0, 80)
      const currentRun = runs.find((r) => r.run_id === runId)

      const nativeIds = new Set(native.map((s) => s.session_id))
      const nativeItems = native.map((s) => ({
        type: 'native', key: 'session:' + s.session_id, session_id: s.session_id,
        title: s.title || s.session_id, status: s.status, updated_at: s.updated_at,
        workspace: s.cwd, cwd: s.cwd,
        source: s.session_id.startsWith('tether-') ? 'Tether' : 'DSH'
      }))
      const virtualRuns = runs.filter((r) => {
        const expected = 'tether-' + r.session_id
        const ds = (r.outcome || {}).dsh_session
        const fresh = r.created_at && (Date.now() / 1000 - r.created_at) < 900
        return !nativeIds.has(expected) && !(ds && nativeIds.has(ds))
          && (['queued', 'dispatching', 'running', 'cancelling'].includes(r.state) || fresh)
      }).map((r) => ({
        type: 'run', key: 'run:' + r.run_id, run_id: r.run_id,
        title: shortText(r.prompt, 54), state: r.state, updated_at: r.created_at,
        workspace: workspaceOf(r), source: 'Tether'
      }))
      const freshItem = freshSession && project ? {
        type: 'fresh', key: 'fresh', title: '新会话', state: 'queued',
        updated_at: Date.now() / 1000, workspace: project.path, source: 'Tether'
      } : null
      const allSessions = [...nativeItems, ...virtualRuns, ...(freshItem ? [freshItem] : [])]
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      const projectPaths = ((projects && projects.workspaces) || []).filter((w) => w.kind !== 'node').map((w) => w.path)
      const workspaceNodes = ((projects && projects.workspaces) || []).filter((w) => w.kind !== 'node').map((w) => ({
        ...w,
        name: w.name === 'default-workspace' ? '默认工作区' : w.name,
        source: (w.kind === 'dsh' && !(projects && projects.root && normPath(w.path).startsWith(normPath(projects.root)))) ? 'DSH' : 'Tether',
        sessions: allSessions.filter((s) => samePath(s.workspace, w.path))
      }))
      const ungrouped = allSessions.filter((s) => !projectPaths.some((p) => samePath(s.workspace, p)))
      const workspaceKey = workspaceNodes.map((w) => w.path + ':' + w.sessions.map((s) => s.key).join('|')).join(';')

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

      React.useEffect(() => {
        if (!project) { setSessionId(''); setRunId(''); return }
        if (freshSession) return
        // An explicit selection wins even before the fresh run shows up in state.
        if (sessionId || runId) return
        const node = workspaceNodes.find((w) => w.path === project.path)
        if (!node) return
        const hasSession = sessionId && node.sessions.some((s) => s.type === 'native' && s.session_id === sessionId)
        const hasRun = runId && node.sessions.some((s) => s.type === 'run' && s.run_id === runId)
        if (hasSession || hasRun) return
        const first = node.sessions.find((s) => s.type !== 'fresh')
        if (first) {
          if (first.type === 'native') { setSessionId(first.session_id); setRunId('') }
          else { setRunId(first.run_id); setSessionId('') }
        }
      }, [project, workspaceKey, sessionId, runId, freshSession])

      React.useEffect(() => {
        if (!sessionId || !nativeLoaded) return
        if (!native.some((s) => s.session_id === sessionId)) { setSessionId(''); setSessionData(null); setSessionLoading(false) }
      }, [nativeKey, nativeLoaded, sessionId])

      React.useEffect(() => {
        if (!runId) return
        const run = runs.find((r) => r.run_id === runId)
        if (!run) return
        const expected = 'tether-' + run.session_id
        const target = native.find((s) => s.session_id === expected)
          || (((run.outcome || {}).dsh_session) ? native.find((s) => s.session_id === run.outcome.dsh_session) : null)
        if (target) { setSessionId(target.session_id); setRunId('') }
      }, [nativeKey, runId])

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
        const turnState = !run ? 'running'
          : run.state === 'completed' ? 'completed'
            : run.state === 'failed' ? 'failed'
              : run.state === 'cancelled' ? 'cancelled' : 'running'
        return { title: run ? shortText(run.prompt, 50) : '', status: state,
                 turns: run ? [{ turn: 1, user: { text: run.prompt }, blocks, state: turnState,
                   started_at: run.started_at || run.created_at || null,
                   ended_at: run.finished_at || null, steps: 0, usage: {} }] : [] }
      }

      const currentWorkspace = workspaceNodes.find((w) => w.path === (project && project.path))
      const currentSessions = currentWorkspace ? currentWorkspace.sessions : []
      const conversation = sessionId ? sessionData : (currentRun ? runConversation(currentRun, runEvents) : null)
      const conversationTitle = sessionId
        ? ((sessionData && sessionData.title) || (native.find((s) => s.session_id === sessionId) || {}).title || 'DSH 会话')
        : (currentRun ? shortText(currentRun.prompt, 50) : (freshSession ? '新会话' : ''))
      const conversationStatus = sessionId
        ? ((sessionData && sessionData.status) || 'idle')
        : (currentRun ? currentRun.state : 'idle')

      const startTask = async () => {
        if (!task.trim() || !deviceId || !project) return
        setBusy(true)
        try {
          let sid = ''
          if (!freshSession) {
            const session = currentRun
            sid = session ? session.session_id : ''
            if (!sid) {
              const existing = sessions.filter((s) => s.device_id === deviceId && samePath(s.workspace, project.path))
              sid = existing.length ? existing[existing.length - 1].session_id : ''
            }
          }
          if (!sid) {
            const created = await post('/api/sessions', { device_id: deviceId, workspace: project.path })
            sid = created.session_id
          }
          setFreshSession(false)
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
          setTimeout(loadNative, 1200)
          setTimeout(loadNative, 4000)
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

      const openFile = async (entry) => {
        if (entry.dir) { setPath(entry.path); setPathDraft(entry.path); setTreeSelected(entry.path); setSelected(entry); return }
        setBusy(true)
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/read', { path: entry.path })
          const stat = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/stat', { path: entry.path })
          const parent = String(entry.path).replace(/[\\/][^\\/]+$/, '')
          setFile({ ...data, writable: stat.writable }); setDraft(data.binary ? '' : data.text); setDirty(false); setSelected(entry)
          setPath(parent); setPathDraft(parent); setTreeSelected(entry.path); setView('files')
        } catch (e) { fail(e) } finally { setBusy(false) }
      }

      const loadTreeDir = async (target) => {
        if (!deviceId || !target) return
        try {
          const data = await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/list', { path: target })
          setTreeChildren((current) => ({ ...current, [target]: data.entries }))
        } catch (e) {
          setTreeChildren((current) => ({ ...current, [target]: [] }))
          fail(e)
        }
      }

      const toggleTree = (node) => {
        const target = node.path
        const next = !treeOpen[target]
        setTreeSelected(target); setPath(target); setPathDraft(target); setSelected(node.dir ? node : null)
        setTreeOpen((current) => ({ ...current, [target]: next }))
        if (next && treeChildren[target] === undefined) loadTreeDir(target)
      }
      const saveFile = async () => {
        if (!file || file.binary) return
        setBusy(true)
        try {
          await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: file.path, text: draft })
          setDirty(false); setNotice('Saved ' + file.path); loadTreeDir(path)
        } catch (e) { fail(e) } finally { setBusy(false) }
      }
      const askValue = (title, value, onOk) => setAsk({ title, value: value || '', onOk })
      const newFolder = () => askValue('新建文件夹', '', async (name) => { try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: path + '\\' + name }); loadTreeDir(path) } catch (e) { fail(e) } })
      const newFile = () => askValue('新建文件', '', async (name) => { const target = path + '\\' + name; try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/write', { path: target, text: '' }); loadTreeDir(path); openFile({ path: target, dir: false, name }) } catch (e) { fail(e) } })
      const renameEntry = () => { if (selected) askValue('重命名', selected.name, async (name) => { try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/rename', { path: selected.path, dest: path + '\\' + name }); setSelected(null); if (file && file.path === selected.path) setFile(null); loadTreeDir(path) } catch (e) { fail(e) } }) }
      const deleteEntry = async () => {
        if (!selected) return
        if (!window.confirm('Move "' + selected.name + '" to .tether-trash?')) return
        try { await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/delete', { path: selected.path }); setSelected(null); if (file && file.path === selected.path) setFile(null); loadTreeDir(path) } catch (e) { fail(e) }
      }
      const newProject = () => {
        if (!projects) return
        askValue('新建工作区（' + projects.root + '）', '', async (name) => {
          try {
            const target = projects.root + '\\' + name
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/fs/mkdir', { path: target })
            await post('/api/devices/' + encodeURIComponent(deviceId) + '/dsh/workspaces/register', { path: target, title: name }).catch(() => {})
            await loadProjects()
            setProject({ name, path: target, kind: 'tether', source: 'Tether' })
            setWorkspaceOpen((current) => ({ ...current, [target]: true }))
            setFreshSession(true); setSessionId(''); setRunId(''); setView('chat')
          } catch (e) { fail(e) }
        })
      }

      const newSessionFor = (workspace) => {
        setProject(workspace); setWorkspaceOpen((current) => ({ ...current, [workspace.path]: true }))
        setFreshSession(true); setSessionId(''); setRunId(''); setTask(''); setView('chat')
      }
      const submitAsk = () => {
        if (!ask) return
        const value = ask.value.trim()
        if (!value) return
        const cb = ask.onOk; setAsk(null); cb(value)
      }

      const selectPanel = (id) => {
        if (id === activePanel && !sidebarCollapsed) { setSidebarCollapsed(true); return }
        setActivePanel(id); setSidebarCollapsed(false)
        if (id === 'files') setView('files')
        if (id === 'workspaces') setView('chat')
      }

      const dragWidth = (event, start, setter, min, max) => {
        event.preventDefault()
        setResizing(true)
        const startX = event.clientX
        const move = (ev) => setter(clamp(start + ev.clientX - startX, min, max))
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          setResizing(false)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
      }

      const startSidebarResize = (event) => dragWidth(event, safeSidebarWidth, setSidebarWidth, UI.minSide, UI.maxSide)

      const modelText = sessionId && sessionData ? [sessionData.model, sessionData.agent_preset].filter(Boolean).join(' · ') : ''

      return h('div', { className: 'tether-root', style: { position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.ink, fontSize: 13, fontWeight: 'var(--tether-body, 400)', overflow: 'hidden' } },
        h('style', null, SCROLL_CSS),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: 0, background: C.panel, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 15 } }, 'Tether'),
          device ? h('span', { style: { display: 'flex', alignItems: 'center', fontSize: 12, color: C.sub } }, dot(device.online), device.name) : h('span', { style: { color: C.mute } }, 'no device'),
          device && device.capabilities && !device.capabilities.fs ? pill('节点待更新', C.amber) : null,
          h('div', { style: { display: 'flex', gap: 2, marginLeft: 10, padding: 2, background: C.soft, borderRadius: 8 } },
            h('button', { onClick: () => setView('chat'), className: 'tether-hover', style: { border: 0, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: view === 'chat' ? C.bg : 'transparent', color: view === 'chat' ? C.ink : C.mute, boxShadow: 'none' } }, '对话'),
            h('button', { onClick: () => setView('files'), className: 'tether-hover', style: { border: 0, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: view === 'files' ? C.bg : 'transparent', color: view === 'files' ? C.ink : C.mute, boxShadow: 'none' } }, '文件')
          ),
          h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
            policy ? pill(policy.mode === 'full' ? 'full-disk' : (policy.mode === 'locked' ? 'locked' : 'readonly'), policy.mode === 'full' ? C.red : (policy.mode === 'locked' ? C.amber : C.mute)) : null,
            btn('权限设置', openSettings)
          )
        ),
        notice ? h('div', { style: { padding: '6px 14px', background: C.soft, color: /^Saved |^Policy updated/.test(notice) ? C.green : C.red, borderBottom: 0, fontSize: 12 } }, notice) : null,
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
            resizing,
            onResizeStart: startSidebarResize,
            onResetWidth: () => setSidebarWidth(UI.defaultSide),
            onCollapse: () => setSidebarCollapsed(true),
            devices: (state && state.devices) || [],
            localDevice: state && state.local_device,
            deviceId,
            onSelectDevice: setDeviceId,
            workspaces: workspaceNodes,
            openWorkspaces: workspaceOpen,
            onToggleWorkspace: (path) => setWorkspaceOpen((current) => ({ ...current, [path]: current[path] === false ? true : false })),
            onSelectWorkspace: (w) => {
              setProject(w); setWorkspaceOpen((current) => ({ ...current, [w.path]: true })); setView('chat'); setFreshSession(false)
            },
            selectedWorkspacePath: project && project.path,
            onNewWorkspace: newProject,
            newWorkspaceDisabled: !deviceOnline || !projects || !!projects.synthetic,
            onNewSession: newSessionFor,
            ungrouped,
            freshSession,
            sessionId,
            runId,
            onSelectSession: (s) => {
              const w = workspaceNodes.find((item) => samePath(item.path, s.workspace))
              if (w) setProject(w)
              setSessionId(s.session_id); setRunId(''); setView('chat'); setFreshSession(false)
            },
            onSelectRun: (s) => {
              const w = workspaceNodes.find((item) => samePath(item.path, s.workspace))
              if (w) setProject(w)
              setRunId(s.run_id); setSessionId(''); setView('chat'); setFreshSession(false)
            },
            treeRoots: [
              { id: 'workspaces', label: '工作区', first: true, nodes: [
                ...(projects && projects.root ? [{ name: 'Tether 工作区', path: projects.root, dir: true }] : []),
                ...workspaceNodes.map((w) => ({ name: w.name, path: w.path, dir: true }))
              ] },
              { id: 'drives', label: '此电脑', nodes: drives.map((d) => ({ name: d.name, path: d.path, dir: true })) }
            ],
            treeChildren,
            treeOpen,
            onToggleTree: toggleTree,
            onOpenFile: openFile,
            treeSelected
          }),
          h('main', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
            view === 'chat' ? h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: 0, background: C.bg, flex: '0 0 auto' } },
                h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
                  h('div', { style: { fontSize: 14, fontWeight: 'var(--tether-strong, 600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, conversationTitle || '对话'),
                  h('div', { style: { fontSize: 11, color: C.mute, marginTop: 1 } }, [
                    sessionId ? '原生 DSH 会话 · 只读' : (runId ? '会话 · 目标机执行' : (freshSession ? '新会话 · 目标机工作区' : '选择左侧会话或发起任务')),
                    modelText ? ' · ' + modelText : ''
                  ].join(''))
                ),
                pill(conversationStatus || 'idle', conversationStatus === 'running' ? C.blue : (conversationStatus === 'failed' ? C.red : C.mute))
              ),
              h(Conversation, {
                data: conversation, loading: sessionLoading && !sessionData,
                live: (sessionData && sessionData.status === 'running') || (currentRun && ['queued', 'dispatching', 'running', 'cancelling'].includes(currentRun.state)),
                emptyText: freshSession ? '输入任务开始新会话' : (nativeError && !runId ? '目标节点未提供原生会话；可以直接在下方发起任务' : (currentSessions.length ? '选择一个会话' : '还没有对话，直接发一条任务开始'))
              }),
              h(Composer, {
                value: task, onChange: setTask, onSend: send, busy,
                disabled: !deviceOnline || !project,
                note: sessionId ? '原生 DSH 会话只读；发送会在同一工作区新建会话' : (runId ? '继续当前会话' : '发送到目标机的工作区')
              })
            ) : h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
              h('div', { style: { borderBottom: 0, background: C.panel, flex: '0 0 auto' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px 4px' } },
                  btn('↑', () => { if (!path) return; const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, ''); if (parent && parent !== path) { setPath(parent); setPathDraft(parent) } }, { title: '上级目录' }),
                  h('input', { value: pathDraft, onChange: (ev) => setPathDraft(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { setPath(pathDraft); setTreeOpen((current) => ({ ...current, [pathDraft]: true })); loadTreeDir(pathDraft) } }, spellCheck: false, style: { flex: '1 1 auto', minWidth: 0, height: 28, border: 0, borderRadius: 6, padding: '0 8px', background: C.bg, fontFamily: 'Consolas, monospace', fontSize: 12 } }),
                  btn('刷新', () => loadTreeDir(path), { disabled: !path })
                ),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 7px' } },
                  btn('新建文件夹', newFolder, { disabled: !path }),
                  btn('新建文件', newFile, { disabled: !path }),
                  btn('重命名', renameEntry, { disabled: !selected }),
                  btn('删除', deleteEntry, { disabled: !selected, danger: true }),
                  selected ? h('span', { style: { marginLeft: 6, fontSize: 11.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected.name) : null
                )
              ),
              h('div', { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                file ? h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: 0, background: C.panel, flex: '0 0 auto' } },
                    h('span', { style: { fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.path),
                    file.binary ? pill('binary') : pill(formatBytes(file.size)),
                    file.writable ? null : pill('read-only', C.amber),
                    h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } }, file.writable && !file.binary ? btn(dirty ? 'Save *' : 'Save', saveFile, { primary: true, disabled: !dirty || busy }) : null)
                  ),
                  file.binary ? h('div', { style: { padding: 20, color: C.mute, fontSize: 12 } }, 'Binary file. Preview is not supported.')
                    : h('textarea', { value: draft, onChange: (ev) => { setDraft(ev.target.value); setDirty(true) }, readOnly: !file.writable, spellCheck: false, style: { flex: '1 1 auto', width: '100%', boxSizing: 'border-box', resize: 'none', border: 0, outline: 'none', padding: '10px 12px', fontFamily: 'Consolas, monospace', fontSize: 12.5, lineHeight: 1.55, background: file.writable ? C.bg : C.panel, color: C.ink } })
                ) : h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', color: C.mute, fontSize: 12 } }, '从左侧文件树选择文件')
              )
            )
        ),
        ),
        showSettings ? h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 20 } },
          h('div', { style: { width: 480, height: '100%', background: C.bg, borderLeft: 0, display: 'flex', flexDirection: 'column', boxShadow: C.shadow } },
            h('div', { style: { padding: '12px 16px', borderBottom: 0, background: C.panel, display: 'flex', alignItems: 'center' } },
              h('strong', null, '文件权限'), device ? h('span', { style: { marginLeft: 8, fontSize: 12, color: C.mute } }, device.name) : null,
              h('button', { onClick: () => setShowSettings(false), style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.mute } }, '×')
            ),
            h('div', { style: { padding: 16, overflow: 'auto', flex: '1 1 auto' } },
              h('div', { style: { display: 'grid', gap: 6, marginBottom: 12 } },
                [['readonly', '默认：全盘只读 + 项目可写', '全盘可读；仅项目根、已有 DSH 工作区、节点工作目录可写。', C.dark],
                 ['locked', '锁定：全部只读', '任何写入、新建、重命名、删除都被拒绝。', C.amber],
                 ['full', '全盘读写', '目标机主机权限。系统目录、凭据与 AppData 仍拒写；需二次确认。', C.red]].map(([value, title, desc, color]) =>
                  h('label', { key: value, style: { border: 0, borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: mode === value ? C.soft : C.panel } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, h('input', { type: 'radio', checked: mode === value, onChange: () => setMode(value) }), h('strong', { style: { fontSize: 13 } }, title)),
                    h('div', { style: { fontSize: 11.5, color: C.mute, marginTop: 3 } }, desc)
                  ))
              ),
              h('div', { style: { fontSize: 11, fontWeight: 'var(--tether-strong, 600)', color: C.mute, marginBottom: 6, letterSpacing: 0.4 } }, '可写根目录'),
              h('textarea', { value: rootsText, onChange: (ev) => setRootsText(ev.target.value), spellCheck: false, style: { width: '100%', height: 88, boxSizing: 'border-box', border: 0, borderRadius: 6, padding: 8, background: C.panel, fontFamily: 'Consolas, monospace', fontSize: 12, resize: 'vertical' } }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } }, btn('保存权限', savePolicy, { primary: true, disabled: busy || !device || !device.online }), h('span', { style: { fontSize: 11, color: C.mute, alignSelf: 'center' } }, policy ? ('更新于 ' + (policy.updated_by || 'default')) : '')),
              h('div', { style: { fontSize: 11, fontWeight: 'var(--tether-strong, 600)', color: C.mute, margin: '18px 0 6px', letterSpacing: 0.4 } }, '审计（最近 80 条）'),
              h('div', { style: { border: 0, borderRadius: 6, overflow: 'hidden', background: C.panel } },
                h('div', { style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '5px 8px', background: C.soft, fontSize: 10, color: C.mute, borderBottom: 0 } }, h('span', null, '操作'), h('span', null, '路径'), h('span', null, '结果')),
                h('div', { style: { maxHeight: 220, overflow: 'auto' } },
                  audit.map((a, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: '58px 1fr 70px', gap: 6, padding: '4px 8px', fontSize: 10.5, borderBottom: 0, background: i % 2 ? C.bg : 'transparent', color: a.result === 'denied' ? C.red : C.sub } },
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
          h('div', { style: { width: 380, background: C.bg, borderRadius: 10, boxShadow: C.shadow, padding: 18 } },
            h('div', { style: { fontSize: 14, fontWeight: 'var(--tether-strong, 600)', marginBottom: 10 } }, ask.title),
            h('input', { autoFocus: true, value: ask.value, spellCheck: false, onChange: (ev) => setAsk({ ...ask, value: ev.target.value }), onKeyDown: (ev) => { if (ev.key === 'Enter') submitAsk(); if (ev.key === 'Escape') setAsk(null) }, style: { width: '100%', height: 32, boxSizing: 'border-box', border: 0, borderRadius: 6, padding: '0 8px', background: C.panel, fontSize: 13 } }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } }, btn('取消', () => setAsk(null)), btn('确定', submitAsk, { primary: true, disabled: !ask.value.trim() }))
          )
        ) : null
      )
    }

    function TetherIcon() {
      return h('span', { title: 'Tether', style: { display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6, background: C.primary, color: C.onPrimary, fontSize: 12, fontWeight: 'var(--tether-strong-2, 700)' } }, 'T')
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
