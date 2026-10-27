const EXT_LABEL = {
  md: 'MD', markdown: 'MD', txt: 'TXT', log: 'LOG', json: 'JSON', yml: 'YML', yaml: 'YML',
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', ppt: 'PPT', pptx: 'PPT', xls: 'XLS', xlsx: 'XLS',
  png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', webp: 'IMG', svg: 'SVG',
  js: 'JS', mjs: 'JS', ts: 'TS', tsx: 'TS', jsx: 'JS', py: 'PY', ps1: 'PS1', sh: 'SH',
  zip: 'ZIP', rar: 'ZIP', exe: 'EXE'
}

export function createWebFileTypeIcon(React) {
  const h = React.createElement
  return function WebFileTypeIcon({ path, kind, size = 16 }) {
    if (kind === 'folder') {
      return h('svg', {
        'aria-hidden': true, width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary, #667085)' }
      }, h('path', {
        d: 'M2 4.6A1.6 1.6 0 0 1 3.6 3h2.5l1.3 1.4h5A1.6 1.6 0 0 1 14 6v5.4A1.6 1.6 0 0 1 12.4 13H3.6A1.6 1.6 0 0 1 2 11.4v-6.8Z',
        stroke: 'currentColor', strokeWidth: 1.2
      }))
    }
    const suffix = String(path || '').split('.').pop().toLowerCase()
    const label = String(path || '').includes('.') ? (EXT_LABEL[suffix] || suffix.slice(0, 3).toUpperCase()) : 'FILE'
    return h('span', {
      'aria-hidden': true,
      style: {
        width: size, height: size, flex: '0 0 auto', display: 'grid', placeItems: 'center',
        borderRadius: 3, background: 'var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,0.06))',
        color: 'var(--dsw-alias-label-tertiary, #667085)', fontSize: Math.max(6, Math.round(size * 0.42)),
        fontWeight: 600, letterSpacing: 0, overflow: 'hidden'
      }
    }, label)
  }
}

export function createWebFileEntryRow(React) {
  const h = React.createElement
  const FileTypeIcon = createWebFileTypeIcon(React)
  return function WebFileEntryRow({ entry, tree, expanded }) {
    const isDir = entry.type === 'directory'
    const activate = () => {
      if (isDir) { if (tree && tree.onToggle) tree.onToggle() }
      else if (tree && tree.onOpen) tree.onOpen()
    }
    const icon = h(FileTypeIcon, { path: entry.name, kind: isDir ? 'folder' : 'file', size: 16 })
    return h('button', {
      type: 'button',
      className: 'tether-web-file-row',
      onClick: activate,
      style: {
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, height: 30,
        padding: '0 6px', border: 0, borderRadius: 6, background: 'transparent',
        color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer'
      }
    },
      h('span', {
        style: { width: 9, flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary, #667085)', fontSize: 8 }
      }, isDir ? (expanded ? '▼' : '▶') : ''),
      icon,
      h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name)
    )
  }
}

function inline(React, text, keyBase) {
  const h = React.createElement
  const nodes = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) nodes.push(h('strong', { key: keyBase + '-' + index }, token.slice(2, -2)))
    else if (token.startsWith('`')) nodes.push(h('code', { key: keyBase + '-' + index, style: { padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-block, #f8fafc)', fontSize: '0.92em' } }, token.slice(1, -1)))
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      nodes.push(h('a', { key: keyBase + '-' + index, href: link[2], target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-state-business-primary, #1570ef)' } }, link[1]))
    }
    last = match.index + token.length
    index += 1
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function createWebMarkdownText(React) {
  const h = React.createElement
  return function WebMarkdownText({ text }) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
    const blocks = []
    let fence = null
    let buffer = []
    const flush = () => {
      if (!buffer.length) return
      blocks.push(h('p', { key: 'p' + blocks.length, style: { margin: '0 0 12px', lineHeight: '24px' } }, inline(React, buffer.join(' '), 'i' + blocks.length)))
      buffer = []
    }
    lines.forEach((line) => {
      if (line.startsWith('```')) {
        if (fence === null) { flush(); fence = [] }
        else {
          blocks.push(h('pre', { key: 'c' + blocks.length, style: { margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-markdown-code-block, #f8fafc)', overflow: 'auto', fontSize: 12.5, lineHeight: '20px' } }, h('code', null, fence.join('\n'))))
          fence = null
        }
        return
      }
      if (fence !== null) { fence.push(line); return }
      if (!line.trim()) { flush(); return }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line)
      if (heading) {
        flush()
        const level = heading[1].length
        blocks.push(h('div', { key: 'h' + blocks.length, style: { fontSize: 26 - level * 3, fontWeight: 650, lineHeight: '36px', margin: '4px 0 10px' } }, inline(React, heading[2], 'h' + blocks.length)))
        return
      }
      const listItem = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line)
      if (listItem) {
        flush()
        blocks.push(h('div', { key: 'l' + blocks.length, style: { display: 'flex', gap: 8, margin: '0 0 6px' } },
          h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #667085)' } }, /\d/.test(listItem[1]) ? listItem[1] : '·'),
          h('span', null, inline(React, listItem[2], 'l' + blocks.length + '-'))
        ))
        return
      }
      buffer.push(line)
    })
    flush()
    if (fence !== null) blocks.push(h('pre', { key: 'c' + blocks.length, style: { margin: '0 0 14px', padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-markdown-code-block, #f8fafc)', overflow: 'auto', fontSize: 12.5 } }, h('code', null, fence.join('\n'))))
    return h('div', { className: 'tether-web-markdown' }, blocks)
  }
}

export function createWebNative(React) {
  return {
    FileEntryRow: createWebFileEntryRow(React),
    FileTypeIcon: createWebFileTypeIcon(React),
    MarkdownText: createWebMarkdownText(React),
    chatZh: {},
    workspaceZh: {},
    toolZh: {},
    markdownLabels: () => ({})
  }
}

export function createWebHost({ apiBase = '' } = {}) {
  return {
    kind: 'web',
    apiBase: () => apiBase
  }
}