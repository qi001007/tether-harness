const EXT_KIND = {
  md: 'md', markdown: 'md', mdx: 'md',
  txt: 'text', log: 'text', ini: 'text', cfg: 'text',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc', wps: 'doc',
  ppt: 'ppt', pptx: 'ppt', odp: 'ppt', dps: 'ppt',
  xls: 'xls', xlsx: 'xls', csv: 'xls', ods: 'xls', et: 'xls',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', ico: 'image', tif: 'image', tiff: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code',
  ps1: 'code', sh: 'code', bat: 'code', json: 'code', yml: 'code', yaml: 'code', toml: 'code',
  html: 'code', css: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', go: 'code', rs: 'code',
  exe: 'binary', dll: 'binary', bin: 'binary', msi: 'binary'
}

const KIND_COLOR = {
  pdf: '#d64545', doc: '#2b6cb0', ppt: '#dd6b20', xls: '#2f855a',
  image: '#6b46c1', md: '#334155', text: '#64748b', code: '#0f766e',
  archive: '#b7791f', binary: '#475569', unknown: '#94a3b8'
}

const GLYPHS = {
  ppt: [['path', { d: 'M4.6 5.2h6.8v4.6H4.6z' }], ['path', { d: 'M6.2 11.8h3.6M8 9.8v2' }]],
  doc: [['path', { d: 'M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h4.2' }]],
  pdf: [['path', { d: 'M5.2 4.2h4.1l1.5 1.5v6.1H5.2z' }], ['path', { d: 'M6.6 7.2h2.8M6.6 9.2h2.8' }]],
  xls: [['path', { d: 'M4.6 5.2h6.8v5.6H4.6zM4.6 8h6.8M8 5.2v5.6' }]],
  image: [['circle', { cx: 6.4, cy: 6.6, r: 0.9 }], ['path', { d: 'M4.4 11.4 7 8.6l1.6 1.6 1.2-1.1 1.8 2.3z' }]],
  md: [['path', { d: 'M4.4 10.6V5.9l2 2.1 2-2.1v4.7' }], ['path', { d: 'M11.2 6v4.6M9.9 9.4l1.3 1.3 1.3-1.3' }]],
  text: [['path', { d: 'M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h3.4' }]],
  code: [['path', { d: 'M6.6 5.8 4.2 8l2.4 2.2M9.4 5.8 11.8 8l-2.4 2.2' }]],
  archive: [['path', { d: 'M8 3.9v1.1M8 6v1.1M8 8.1v1.1M8 10.2v1.1' }], ['path', { d: 'M6.8 5h2.4M6.8 9.2h2.4' }]],
  binary: [['path', { d: 'M5.2 6 6.7 8l-1.5 2M8.4 10h2.4' }]],
  unknown: [['path', { d: 'M5.2 4.4h4l1.6 1.6v5.6H5.2z' }], ['path', { d: 'M6.6 7.2h2.8M6.6 9.2h2.2' }]]
}

function fileKind(path) {
  const name = String(path || '').split(/[\\/]/).pop()
  if (!name || !name.includes('.')) return 'unknown'
  return EXT_KIND[name.split('.').pop().toLowerCase()] || 'unknown'
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
    const type = fileKind(path)
    const shapes = GLYPHS[type] || GLYPHS.unknown
    return h('svg', {
      'aria-hidden': true, width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      style: { flex: '0 0 auto' }
    },
      h('rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 3, fill: KIND_COLOR[type] || KIND_COLOR.unknown }),
      ...shapes.map((shape, index) => h(shape[0], {
        key: index,
        ...shape[1],
        stroke: '#ffffff', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round'
      }))
    )
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