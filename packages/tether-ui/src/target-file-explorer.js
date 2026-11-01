function parentOf(path) {
  const clean = String(path || '').replace(/[\\/]+$/, '')
  if (!clean) return ''
  if (/^[A-Za-z]:$/.test(clean)) return clean + '\\'
  const slash = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  if (slash < 0) return ''
  const parent = clean.slice(0, slash)
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
}

function crumbsFor(path, root) {
  const value = String(path || '').replace(/[\\/]+$/, '')
  if (!value) return []
  const base = String(root || '').replace(/[\\/]+$/, '')
  if (!base || !value.toLowerCase().startsWith(base.toLowerCase())) {
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
    return [{ label: index >= 0 ? value.slice(index + 1) || value : value, path: value }]
  }
  const separator = value.includes('\\') ? '\\' : '/'
  const baseLabelIndex = Math.max(base.lastIndexOf('\\'), base.lastIndexOf('/'))
  const out = [{ label: base.slice(baseLabelIndex + 1) || base, path: base }]
  let current = base
  for (const part of value.slice(base.length).replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean)) {
    current = current.replace(/[\\/]+$/, '') + separator + part
    out.push({ label: part, path: current })
  }
  return out
}

function sortEntries(entries, sort) {
  const key = sort && ['name', 'mtime', 'size'].includes(sort.key) ? sort.key : 'name'
  const direction = sort && sort.dir === 'desc' ? -1 : 1
  return [...(entries || [])].sort((left, right) => {
    if (left.dir !== right.dir) return left.dir ? -1 : 1
    let a
    let b
    if (key === 'size') { a = Number(left.size || 0); b = Number(right.size || 0) }
    else if (key === 'mtime') { a = Number(left.mtime || 0); b = Number(right.mtime || 0) }
    else { a = String(left.name || '').toLowerCase(); b = String(right.name || '').toLowerCase() }
    if (a < b) return -direction
    if (a > b) return direction
    return 0
  })
}

export function TargetFileExplorer({
  React, colors, roots = [], rootPath = '', path = '', entries = null,
  loading = false, error = '', selectedPath = '', disabled = false,
  onRoot, onPath, onSelect, onOpen, onRefresh,
  singleClickOpens = false, editablePath = false, pathLabel = '路径',
  fileIcon, formatTime = () => '', formatSize = () => '', limit = 10 * 1024 * 1024,
  emptyText = '空文件夹', placeholder = '从左侧选择工作区或磁盘',
  searchPlaceholder = '搜索当前目录',
  sort = { key: 'name', dir: 'asc' }, onSort, search = '', onSearch = () => {},
  treeChildren = null, expanded = {}, onToggleTree,
  compact = false, selectionMode = 'single', selectedPaths = [], onSelectionChange,
  onContextMenu, onDragItem, onRowPointerDown
}) {
  const ReactRuntime = React
  const h = ReactRuntime.createElement
  const C = colors || {}
  const workspaces = roots.filter((item) => (item.kind || 'workspace') === 'workspace')
  const drives = roots.filter((item) => item.kind === 'drive')
  const crumbs = crumbsFor(path, rootPath)
  const up = parentOf(path)
  const term = search.trim().toLowerCase()
  const visible = sortEntries(entries, sort)
    .filter((item) => !term || String(item.name || '').toLowerCase().includes(term))
  const sortHeader = (key, label, align) => h('button', {
    type: 'button', title: '按' + label + '排序', 'aria-label': '按' + label + '排序',
    'data-sort': sort.key === key ? sort.dir : undefined,
    onClick: () => {
      if (onSort) onSort(sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' })
    },
    className: 'tether-hover',
    style: {
      display: 'flex', alignItems: 'center', gap: 3,
      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      minWidth: 0, height: 22, padding: '0 4px', margin: '0 -4px', border: 0,
      borderRadius: 4, background: 'transparent',
      color: sort.key === key ? C.ink : C.mute, fontSize: 11, cursor: 'pointer'
    }
  }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
    sort.key === key ? h('span', { 'aria-hidden': true, style: { fontSize: 9 } }, sort.dir === 'asc' ? '▲' : '▼') : null)
  const chevron = (open) => h('svg', {
    width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
  }, h('path', { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' }))
  const treeRow = (item, group, depth = 0) => {
    const key = group + ':' + item.path
    const children = treeChildren && treeChildren[item.path]
    const isOpen = !!(expanded && expanded[item.path])
    const openRow = () => {
      if (disabled) return
      if (!item.dir) { if (onOpen) onOpen(item); return }
      if (depth === 0 && onRoot) onRoot(item.path)
      else if (onPath) onPath(item.path)
    }
    return h(ReactRuntime.Fragment, { key },
      h('div', { style: { display: 'flex', alignItems: 'center', minWidth: 0, paddingLeft: depth * 14 } },
        onToggleTree && item.dir
          ? h('button', {
            type: 'button', title: isOpen ? '收起' : '展开', 'aria-label': isOpen ? '收起' : '展开',
            onClick: (event) => { event.stopPropagation(); onToggleTree(item) },
            className: 'tether-hover',
            style: {
              width: 18, height: 24, flex: '0 0 auto', display: 'grid', placeItems: 'center',
              border: 0, borderRadius: 4, background: 'transparent', color: C.mute, cursor: 'pointer'
            }
          }, chevron(isOpen))
          : h('span', { 'aria-hidden': true, style: { width: 18, flex: '0 0 auto' } }),
        h('button', {
          type: 'button', title: item.path, disabled,
          onClick: openRow,
          className: 'tether-hover',
          style: {
            display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: '1 1 auto',
            height: 26, padding: '0 6px', border: 0, borderRadius: 5,
            background: path === item.path ? (C.hover || C.soft) : 'transparent', color: C.ink,
            font: 'inherit', fontSize: 13, textAlign: 'left', cursor: disabled ? 'default' : 'pointer'
          }
        }, fileIcon ? fileIcon(item) : null,
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name))),
      isOpen && children ? children.map((child) => treeRow(child, group, depth + 1)) : null)
  }
  const rootGroup = (label, items, empty) => h('div', { key: label, style: { marginBottom: 10 } },
    h('div', { style: { padding: '8px 8px 4px', color: C.mute, fontSize: 11, fontWeight: 600, letterSpacing: 0.2 } }, label),
    items.length ? items.map((item) => treeRow(item, label))
      : h('div', { style: { padding: '2px 8px 6px', color: C.mute, fontSize: 11.5 } }, empty))
  const iconButton = (icon, label, onClick, disabled) => h('button', {
    type: 'button', title: label, 'aria-label': label, disabled,
    onClick: () => { if (!disabled && onClick) onClick() },
    className: 'tether-hover',
    style: {
      width: 26, height: 26, flex: '0 0 auto', display: 'grid', placeItems: 'center',
      border: 0, borderRadius: 6, background: 'transparent', color: C.sub,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1
    }
  }, h('svg', {
    width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
  }, icon === 'up'
    ? h('path', { d: 'M8 12.5V3.5M4.2 7.3 8 3.5l3.8 3.8' })
    : [h('path', { key: 'a', d: 'M12.6 7.2A4.7 4.7 0 1 0 11.2 11.6' }),
      h('path', { key: 'b', d: 'M12.8 3.2v3.7h-3.7' })]))
  const activate = (item, double) => {
    if (disabled || !item) return
    if (double) { if (!singleClickOpens && onOpen) onOpen(item); return }
    if (onSelect) onSelect(item)
    if (singleClickOpens && onOpen) onOpen(item)
  }
  const row = (item) => {
    const oversized = !item.dir && Number(item.size) > limit
    const selected = selectionMode === 'multiple'
      ? (selectedPaths || []).includes(item.path)
      : selectedPath === item.path
    return h('button', {
      key: item.path, type: 'button', title: item.path, disabled: disabled || oversized,
      draggable: !!onDragItem,
      onDragStart: (event) => { if (onDragItem) onDragItem(event, item) },
      onPointerDown: (event) => { if (onRowPointerDown) onRowPointerDown(event, item) },
      onContextMenu: (event) => { if (onContextMenu) { event.preventDefault(); onContextMenu(item, event) } },
      onClick: (event) => {
        if (selectionMode === 'multiple' && onSelectionChange) {
          const current = selectedPaths || []
          if (event && (event.ctrlKey || event.metaKey)) {
            onSelectionChange(current.includes(item.path)
              ? current.filter((path) => path !== item.path)
              : [...current, item.path])
          } else {
            onSelectionChange([item.path])
          }
          if (onSelect) onSelect(item)
          return
        }
        activate(item, false)
      },
      onDoubleClick: () => activate(item, true),
      className: 'tether-hover',
      style: {
        display: 'grid', gridTemplateColumns: compact ? 'minmax(0,1fr) 84px' : 'minmax(0,1fr) 132px 84px', gap: 8,
        alignItems: 'center', width: '100%', height: compact ? 28 : 32, padding: '0 12px',
        border: 0, borderRadius: 6,
        background: selected ? (C.soft || 'transparent') : 'transparent',
        color: C.ink, font: 'inherit', fontSize: compact ? 12.5 : 13, textAlign: 'left',
        cursor: disabled || oversized ? 'default' : 'pointer', opacity: oversized ? 0.55 : 1
      }
    },
      h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
        h('span', { style: { width: 16, height: 16, display: 'grid', placeItems: 'center', flex: '0 0 auto' } },
          fileIcon ? fileIcon(item) : null),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          item.name + (oversized ? ' · 超过 10 MiB' : ''))),
      compact ? null : h('span', { style: { color: C.mute, fontSize: 11, whiteSpace: 'nowrap' } }, formatTime(item.mtime)),
      h('span', { style: { color: C.mute, fontSize: 11, textAlign: 'right' } }, item.dir ? '' : formatSize(Number(item.size))))
  }
  let body
  if (!path) {
    body = h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12, padding: 24, textAlign: 'center' } },
      error ? h('span', { role: 'alert', style: { color: C.red || C.danger } }, error) : placeholder)
  } else if (entries === null) {
    body = h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12, padding: 24, textAlign: 'center' } },
      error ? h('span', { role: 'alert', style: { color: C.red || C.danger } }, error)
        : loading ? '正在读取目录…' : '目录暂不可用')
  } else if (!visible.length) {
    body = h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 8, color: C.mute, fontSize: 12, padding: 24, textAlign: 'center' } },
      h('span', null, term ? '未找到匹配 “' + search.trim() + '” 的项目' : emptyText),
      term ? h('button', {
        type: 'button', onClick: () => onSearch(''), className: 'tether-hover',
        style: { border: 0, borderRadius: 6, padding: '4px 10px', background: C.soft, color: C.ink, fontSize: 12, cursor: 'pointer' }
      }, '清除搜索') : null)
  } else {
    body = h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px 18px' } },
      h('div', {
        style: {
          display: 'grid', gridTemplateColumns: compact ? 'minmax(0,1fr) 84px' : 'minmax(0,1fr) 132px 84px', gap: 8,
          alignItems: 'center', height: 28, padding: '0 12px', color: C.mute, fontSize: 11, flex: '0 0 auto'
        }
      }, sortHeader('name', '名称'), compact ? null : sortHeader('mtime', '修改日期'),
        sortHeader('size', '大小', 'right')),
      visible.map((item) => row(item)))
  }
  return h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0 } },
    h('div', {
      style: {
        width: compact ? 148 : 224, flex: '0 0 auto', overflow: 'auto', padding: '6px 8px',
        background: C.soft, borderRight: C.line ? '1px solid ' + C.line : 0
      }
    }, rootGroup('工作区', workspaces, '未发现工作区'), rootGroup('此电脑', drives, '未发现磁盘')),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0, background: C.bg } },
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 14px',
          borderBottom: C.line ? '1px solid ' + C.line : 0, flex: '0 0 auto', minWidth: 0
        }
      },
        iconButton('up', '上一级', () => { if (up && onPath) onPath(up) }, disabled || !up),
        h('div', {
          className: 'tether-breadcrumbs',
          style: { display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', height: 28 }
        },
          crumbs.length ? crumbs.map((segment, index) => h(ReactRuntime.Fragment, { key: segment.path },
            index ? h('span', { style: { color: C.mute, fontSize: 10, flex: '0 0 auto' } }, '›') : null,
            h('button', {
              type: 'button', title: segment.path, disabled,
              onClick: () => { if (!disabled && onPath) onPath(segment.path) },
              className: 'tether-hover',
              style: {
                border: 0, background: 'transparent', borderRadius: 5, padding: '3px 5px',
                fontSize: 12, lineHeight: '18px', color: index === crumbs.length - 1 ? C.ink : C.sub,
                cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190
              }
            }, segment.label)))
            : h('span', { style: { color: C.sub, fontSize: 12 } }, placeholder)),
        editablePath ? h('input', {
          key: path, defaultValue: path || '', spellCheck: false, 'aria-label': pathLabel,
          onKeyDown: (event) => {
            if (event.key === 'Enter' && event.currentTarget.value.trim() && onPath) {
              onPath(event.currentTarget.value.trim())
            }
          },
          style: {
            height: 28, boxSizing: 'border-box', border: 0, borderRadius: 6,
            background: C.soft, color: C.ink, fontSize: 12, padding: '0 8px',
            outline: 'none', flex: '0 0 220px', minWidth: 100, fontFamily: 'Consolas, monospace'
          }
        }) : null,
        !compact && path && entries !== null ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 5, flex: '0 1 200px',
            minWidth: 120, height: 28, boxSizing: 'border-box',
            padding: '0 4px 0 8px', borderRadius: 7, background: C.soft, color: C.mute
          }
        },
          h('span', { 'aria-hidden': true, style: { fontSize: 12 } }, '⌕'),
          h('input', {
            value: search, placeholder: searchPlaceholder, 'aria-label': searchPlaceholder, spellCheck: false,
            onChange: (event) => onSearch(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Escape') { onSearch(''); event.currentTarget.blur() } },
            style: {
              flex: '1 1 auto', minWidth: 0, height: 22, padding: 0, border: 0,
              background: 'transparent', color: C.ink, fontSize: 12, outline: 'none'
            }
          }),
          search ? h('button', {
            type: 'button', title: '清除搜索', 'aria-label': '清除搜索',
            onClick: () => onSearch(''), className: 'tether-hover',
            style: {
              width: 18, height: 18, flex: '0 0 auto', display: 'grid', placeItems: 'center',
              border: 0, borderRadius: 4, background: 'transparent', color: C.mute,
              fontSize: 13, lineHeight: '14px', padding: 0, cursor: 'pointer'
            }
          }, '×') : null) : null,
        iconButton('refresh', '刷新', () => { if (path && onRefresh) onRefresh(path) }, disabled || !path)),
      error && path && entries !== null ? h('div', { role: 'alert', style: { padding: '6px 14px', color: C.red || C.danger, fontSize: 12, borderBottom: C.line ? '1px solid ' + C.line : 0 } }, error) : null,
      body))
}
