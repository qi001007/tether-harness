export function createAppsPage({ React, Glyph, post, C, devices = [], localDevice = '', activeDevice = '', onDeviceChange, onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const pick = (value) => value && online.some((item) => item.device_id === value) ? value : ''
  const initial = pick(activeDevice) || pick(localDevice) || (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
  const [apps, setApps] = React.useState([])
  const [reason, setReason] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(null)
  const [menu, setMenu] = React.useState(false)
  const [frameKey, setFrameKey] = React.useState(0)
  const requestRef = React.useRef(0)

  const load = async (id) => {
    if (!id) return
    const seq = ++requestRef.current
    setLoading(true)
    try {
      const result = await post('/api/devices/' + encodeURIComponent(id) + '/fs/apps_list', {})
      if (seq !== requestRef.current) return
      setApps(Array.isArray(result && result.apps) ? result.apps : [])
      setReason(String((result && result.reason) || ''))
    } catch (error) {
      if (seq !== requestRef.current) return
      setApps([])
      setReason('')
      if (onError) onError(error)
    } finally {
      if (seq === requestRef.current) setLoading(false)
    }
  }

  React.useEffect(() => { void load(device) }, [device])

  React.useEffect(() => {
    const next = pick(activeDevice)
    if (!next || next === device) return
    setOpen(null)
    setApps([])
    setDevice(next)
  }, [activeDevice])

  const selectDevice = (value) => {
    setOpen(null)
    setMenu(false)
    setApps([])
    setDevice(value)
    if (onDeviceChange) onDeviceChange(value)
  }

  const field = {
    height: 28, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const button = {
    height: 28, padding: '0 14px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const reasonHint = reason === 'mesh_unavailable' ? '虚拟内网未接通'
    : reason === 'no_apps' ? '' : reason === 'bind_failed' ? '端口绑定失败' : ''
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' } },
      h('div', { style: { position: 'relative' } },
        h('button', {
          type: 'button', title: '选择要打开应用的电脑', 'aria-label': '应用目标设备',
          'aria-haspopup': 'listbox', 'aria-expanded': menu,
          onClick: () => setMenu((value) => !value), className: 'tether-hover tether-press',
          style: { ...field, minWidth: 180, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left' }
        },
          h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (online.find((item) => item.device_id === device) || {}).name || device || '没有在线设备'),
          h(Glyph, { name: 'chevronDown', size: 12 })),
        menu ? h('div', {
          onPointerDown: (event) => { event.preventDefault(); setMenu(false) },
          style: { position: 'fixed', inset: 0, zIndex: 70, background: 'transparent' }
        }) : null,
        menu ? h('div', { role: 'listbox', style: { position: 'absolute', top: 32, left: 0, minWidth: 200, maxHeight: 300, overflow: 'auto', zIndex: 80,
          background: C.layer1, borderRadius: 9, boxShadow: C.shadow, padding: 4 } },
          online.length ? online.map((item) => h('button', {
            key: item.device_id, type: 'button', role: 'option', 'aria-selected': item.device_id === device,
            onClick: () => selectDevice(item.device_id), className: 'tether-hover',
            style: { display: 'flex', width: '100%', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', border: 0, borderRadius: 6,
              background: item.device_id === device ? C.soft : 'transparent', color: C.ink, fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }
          }, item.name || item.device_id)) : h('div', { style: { padding: '8px 10px', fontSize: 12, color: C.mute } }, '没有在线设备')
        ) : null),
      h('button', { type: 'button', onClick: () => void load(device), disabled: loading || !device,
        title: '刷新应用列表', 'aria-label': '刷新应用列表', className: 'tether-hover',
        style: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 7,
          background: 'transparent', color: C.sub, cursor: loading || !device ? 'default' : 'pointer',
          opacity: loading || !device ? 0.5 : 1 } },
        loading ? h('span', { className: 'tether-spin' }, h(Glyph, { name: 'refresh', size: 15 })) : h(Glyph, { name: 'refresh', size: 15 })),
      reasonHint ? h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.mute } }, reasonHint) : null
    ),
    loading && !apps.length
      ? h('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', color: C.mute, fontSize: 12 } }, '正在读取应用…')
      : h('div', {
        style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start',
          gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))' }
      },
        apps.length ? apps.map((app) => h('button', {
          key: app.id, type: 'button', onClick: () => { setOpen(app); setFrameKey((value) => value + 1) },
          className: 'tether-press tether-hover',
          style: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, textAlign: 'left',
            border: '1px solid ' + C.line, borderRadius: 10, background: C.panel || C.bg, color: C.ink, cursor: 'pointer' }
        },
          h('span', { style: { width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center',
            borderRadius: 9, background: C.soft, color: C.blue } }, h(Glyph, { name: app.kind === 'dsh' ? 'monitor' : 'apps', size: 18 })),
          h('span', { style: { minWidth: 0, display: 'grid', gap: 2 } },
            h('span', { style: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, app.name),
            h('span', { style: { fontSize: 11, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              app.kind === 'dsh' ? '本机 DSH' : String(app.url || '').replace(/^https?:\/\//, ''))
          )
        )) : h('div', { style: { gridColumn: '1 / -1', padding: '52px 24px', display: 'grid', justifyItems: 'center', gap: 10, color: C.mute, fontSize: 12 } },
          h('span', { style: { width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 11, background: C.soft, color: C.sub } },
            h(Glyph, { name: 'apps', size: 19 })),
          h('span', null, online.length ? '没有可打开的应用' : '没有在线设备'),
          online.length ? h('button', { type: 'button', onClick: () => void load(device), title: '刷新应用列表', 'aria-label': '刷新应用列表',
            className: 'tether-hover', style: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 7,
              background: 'transparent', color: C.sub, cursor: 'pointer' } }, h(Glyph, { name: 'refresh', size: 15 })) : null
        )),
    open ? h('div', {
      style: { position: 'absolute', inset: 0, zIndex: 8, display: 'flex', flexDirection: 'column',
        background: C.bg, borderRadius: 10, border: '1px solid ' + C.line, overflow: 'hidden' }
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid ' + C.line, flex: '0 0 auto' } },
        h('span', { style: { fontSize: 12, fontWeight: 500, color: C.ink } }, open.name),
        h('span', { style: { fontSize: 11, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          String(open.url || '').replace(/^https?:\/\//, '') + (open.path || '/')),
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
          h('button', { type: 'button', onClick: () => setFrameKey((value) => value + 1), title: '重新加载应用', 'aria-label': '重新加载应用',
            className: 'tether-hover', style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6,
              background: 'transparent', color: C.sub, cursor: 'pointer' } }, h(Glyph, { name: 'refresh', size: 14 })),
          h('button', { type: 'button', onClick: () => setOpen(null), title: '关闭应用', 'aria-label': '关闭应用',
            className: 'tether-hover', style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6,
              background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 15, padding: 0 } }, '×')
        )
      ),
      h('iframe', {
        key: frameKey, title: open.name, src: (open.url || '') + (open.path || '/'),
        style: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' },
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads'
      })
    ) : null
  )
}