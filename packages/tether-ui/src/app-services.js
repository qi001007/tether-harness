const C = {
  ink: 'var(--dsw-alias-label-primary, #101828)',
  sub: 'var(--dsw-alias-label-secondary, #475467)',
  mute: 'var(--dsw-alias-label-tertiary, #667085)',
  bg: 'var(--dsw-alias-bg-base, #ffffff)',
  panel: 'var(--dsw-specific-sidebar-fill, #f9fafb)',
  soft: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
  line: 'var(--dsw-alias-border-l1, rgba(9, 30, 66, 0.04))',
  green: 'var(--dsw-alias-state-success-primary, #16a34a)',
  red: 'var(--dsw-alias-state-error-primary, #b42318)',
  amber: 'var(--dsw-alias-state-warn-primary, #b54708)',
  primary: 'var(--dsw-alias-button-primary-fill, #101828)',
  onPrimary: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
  shadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(16, 24, 40, 0.12))'
}

const LABELS = { online: '运行中', starting: '启动中', running: '运行中', stopped: '已停止', error: '出错', offline: '离线', external: '外部管理' }

export function createAppServices(React) {
  const h = React.createElement

  const button = (label, onClick, opts) => {
    const o = opts || {}
    return h('button', {
      onClick, disabled: o.disabled, title: label, className: 'tether-press tether-hover',
      style: {
        height: 28, padding: '0 12px', borderRadius: 6, border: 0, fontSize: 12,
        background: o.primary ? C.primary : C.soft,
        color: o.primary ? C.onPrimary : (o.danger ? C.red : C.ink),
        cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.5 : 1
      }
    }, label)
  }

  return function AppServices() {
    const bridge = typeof window !== 'undefined' ? window.tetherApp : null
    const [state, setState] = React.useState(null)
    const [open, setOpen] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')

    React.useEffect(() => {
      if (!bridge || !bridge.services) return undefined
      let alive = true
      const load = async () => {
        try {
          const next = await bridge.services()
          if (alive) setState(next)
        } catch (failure) {
          if (alive) setError(String((failure && failure.message) || failure))
        }
      }
      load()
      const timer = setInterval(load, 2000)
      return () => { alive = false; clearInterval(timer) }
    }, [])

    if (!bridge || !bridge.services) return null

    const controller = (state && state.controller) || { state: 'stopped', port: 18890 }
    const node = (state && state.node) || { state: 'stopped', deviceOnline: false }
    const hub = !!(state && state.mode === 'hub')
    const dot = state && state.error ? C.red
      : controller.state === 'error' || controller.state === 'offline' ? C.red
        : controller.state === 'starting' || node.state === 'starting' ? C.amber
          : controller.state === 'online' ? C.green : C.mute

    const action = async (name) => {
      setBusy(true)
      setError('')
      try {
        const next = await bridge[name]()
        if (next && next.controller) setState(next)
      } catch (failure) {
        setError(String((failure && failure.message) || failure))
      } finally {
        setBusy(false)
      }
    }

    const row = (label, value, color) => h('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 32, fontSize: 12.5 }
    },
      h('span', { style: { color: C.mute } }, label),
      h('span', { style: { color: color || C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))

    const chip = !open ? h('button', {
      onClick: () => setOpen(true), title: 'APP 服务状态与启动/停止',
      className: 'tether-press tether-hover',
      style: {
        position: 'fixed', top: 8, right: 14, zIndex: 10, height: 26, padding: '0 10px',
        borderRadius: 999, border: 0, background: C.bg, color: C.sub,
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(16,24,40,0.06)'
      }
    },
      h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dot, flex: '0 0 auto' } }),
      '服务'
    ) : null

    const drawer = open ? h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) setOpen(false) },
      style: { position: 'fixed', inset: 0, background: 'rgba(16,24,40,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }
    },
      h('div', { style: { width: 'min(400px, 100%)', height: '100%', background: C.bg, display: 'flex', flexDirection: 'column', boxShadow: C.shadow } },
        h('div', { style: { padding: '12px 16px', background: C.panel, display: 'flex', alignItems: 'center' } },
          h('span', { style: { fontWeight: 600, fontSize: 14, color: C.ink } }, 'APP 服务'),
          h('span', { style: { marginLeft: 8, fontSize: 11, color: C.mute } },
            state && state.mode === 'external' ? '已连接外部 Controller' : (state && state.mode === 'hub' ? '远端 Hub' : (state && state.mode === 'standalone' ? '本机自举' : '未启动'))),
          h('button', {
            onClick: () => setOpen(false), title: '关闭', 'aria-label': '关闭', className: 'tether-hover',
            style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: C.mute, fontSize: 16, cursor: 'pointer' }
          }, '×')
        ),
        h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '14px 16px 24px' } },
          h('div', { style: { borderRadius: 8, background: C.panel, padding: '4px 12px', marginBottom: 14 } },
            row('Controller', (LABELS[controller.state] || controller.state) + ' · :' + controller.port, controller.state === 'error' || controller.state === 'offline' ? C.red : (controller.state === 'starting' ? C.amber : C.green)),
            row('Node', (LABELS[node.state] || node.state) + (state && state.device ? ' · ' + state.device : ''), node.state === 'error' ? C.red : (node.state === 'starting' ? C.amber : C.green)),
            row(hub ? '在线设备' : '节点在线', node.deviceOnline ? '是' : '否', node.deviceOnline ? C.green : C.mute)
          ),
          state && state.error ? h('div', { style: { fontSize: 11.5, lineHeight: '18px', color: C.red, marginBottom: 12, wordBreak: 'break-all' } }, state.error) : null,
          error ? h('div', { style: { fontSize: 11.5, lineHeight: '18px', color: C.red, marginBottom: 12, wordBreak: 'break-all' } }, error) : null,
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
            hub
              ? button('重新探测', () => action('startServices'), { primary: true, disabled: busy })
              : [
                button('启动', () => action('startServices'), { primary: true, disabled: busy }),
                button('重启', () => action('restartServices'), { disabled: busy }),
                button('停止', () => action('stopServices'), { danger: true, disabled: busy })
              ]
          ),
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
            button('打开日志目录', () => action('openLogs')),
            button('打开数据目录', () => action('openDataDir'))
          ),
          h('div', { style: { fontSize: 11.5, lineHeight: '19px', color: C.mute } },
            hub
              ? ['当前通过 APP 代理连接远端 Hub：', h('code', null, (state && state.remoteUrl) || ''), '。目标机 Node 用 ', h('code', null, 'wss://<hub>/ws/node'), ' 出站注册；Controller 不暴露明文端口。']
              : ['插件在本机使用 ', h('code', null, 'http://127.0.0.1:18890'), '。本机自举时 APP 启动 Controller 与 Node；已有外部 Controller 时只连接、不抢占。跨机连接要求双方可达（局域网/端口转发/Tailscale），或等 Relay（Phase 3）。']
          ),
          state && state.python ? h('div', { style: { marginTop: 12, fontSize: 10.5, color: C.mute, fontFamily: 'Consolas, monospace', wordBreak: 'break-all' } }, state.python) : null
        )
      )
    ) : null

    return h(React.Fragment, null, chip, drawer)
  }
}