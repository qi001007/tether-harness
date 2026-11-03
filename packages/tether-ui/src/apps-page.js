export function createAppsPage({ React, Glyph, post, C, devices = [], localDevice = '', onError }) {
  const h = React.createElement
  const online = devices.filter((item) => item && item.online)
  const initial = localDevice && online.some((item) => item.device_id === localDevice)
    ? localDevice
    : (online[0] && online[0].device_id) || ''
  const [device, setDevice] = React.useState(initial)
  const [apps, setApps] = React.useState([])
  const [reason, setReason] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(null)
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

  const selectDevice = (value) => {
    setOpen(null)
    setApps([])
    setDevice(value)
  }

  const field = {
    height: 28, boxSizing: 'border-box', border: '1px solid ' + C.line,
    borderRadius: 7, padding: '0 9px', background: C.bg, color: C.ink, fontSize: 12
  }
  const button = {
    height: 28, padding: '0 14px', border: 0, borderRadius: 7, fontSize: 12,
    cursor: 'pointer', color: '#fff', background: C.blue
  }
  const hint = reason === 'mesh_unavailable' ? '目标电脑未接入虚拟内网，暂时无法转发本机应用'
    : reason === 'no_apps' ? '目标电脑没有登记可打开的应用'
    : reason === 'bind_failed' ? '目标电脑无法绑定虚拟内网端口'
    : '只转发目标电脑上登记的回环 HTTP 服务'
  return h('div', { style: { flex: '1 1 auto', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: C.bg } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' } },
      h('select', {
        value: device, 'aria-label': '应用目标设备', title: '选择要打开应用的电脑',
        onChange: (event) => { selectDevice(event.target.value); event.currentTarget.blur() },
        style: { ...field, minWidth: 180 }
      },
        !online.length ? h('option', { value: '' }, '没有在线设备') : null,
        online.map((item) => h('option', { key: item.device_id, value: item.device_id }, item.name || item.device_id))
      ),
      h('button', { type: 'button', onClick: () => void load(device), disabled: loading || !device,
        title: '刷新应用列表', 'aria-label': '刷新应用列表',
        style: { ...button, padding: '0 10px', opacity: loading || !device ? 0.5 : 1 } }, '刷新'),
      h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.mute } }, hint)
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
        )) : h('div', { style: { gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: C.mute, fontSize: 12 } },
          online.length ? '没有可打开的应用。在目标电脑的 apps.json 里登记 name、port 与 path 后刷新；DSH 请用“原生工作区”。' : '没有在线设备')
      ),
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
            style: { ...field, cursor: 'pointer', background: 'transparent' } }, '刷新'),
          h('button', { type: 'button', onClick: () => setOpen(null), title: '关闭应用', 'aria-label': '关闭应用',
            style: { ...field, cursor: 'pointer', background: 'transparent' } }, '关闭')
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