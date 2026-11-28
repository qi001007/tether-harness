// Non-blocking draggable floating window shell with stacking management.
let floatingWindowZSeed = 50

export function createFloatingWindow(React) {
  const h = React.createElement

  function FloatingWindow({
    title,
    subtitle,
    onClose,
    width = 'min(760px, calc(100% - 32px))',
    height,
    maxHeight = 'min(600px, calc(100% - 32px))',
    topOffset = 40,
    disabledClose = false,
    ariaLabel,
    headerExtra,
    footer,
    bodyStyle = {},
    children
  }) {
    const [zIndex, setZIndex] = React.useState(() => {
      floatingWindowZSeed += 1
      return floatingWindowZSeed
    })
    const [offset, setOffset] = React.useState({ x: 0, y: 0 })
    const [dragging, setDragging] = React.useState(false)
    const dragRef = React.useRef(null)
    const frameRef = React.useRef(null)
    const offsetRef = React.useRef(offset)
    offsetRef.current = offset

    const bringToFront = React.useCallback(() => {
      floatingWindowZSeed += 1
      setZIndex(floatingWindowZSeed)
    }, [])

    React.useEffect(() => {
      const onKeyDown = (event) => {
        if (event.key !== 'Escape' || disabledClose) return
        if (floatingWindowZSeed === zIndex && onClose) {
          event.stopPropagation()
          onClose()
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [zIndex, disabledClose, onClose])

    const startDrag = (event) => {
      if (event.button !== 0) return
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('button, input, a, [role="button"], [role="combobox"]')) return
      event.preventDefault()
      bringToFront()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch (_) { /* ignore */ }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offsetRef.current.x,
        originY: offsetRef.current.y
      }
      setDragging(true)
    }

    const moveDrag = (event) => {
      const d = dragRef.current
      if (!d || d.pointerId !== event.pointerId) return
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800
      const box = frameRef.current && frameRef.current.getBoundingClientRect()
      const maxX = box ? Math.max(40, (vw - box.width) / 2 + box.width * 0.45) : 360
      const maxY = box ? Math.max(40, (vh - topOffset - box.height) / 2 + box.height * 0.4) : 260
      const nx = Math.max(-maxX, Math.min(maxX, d.originX + (event.clientX - d.startX)))
      const ny = Math.max(-maxY, Math.min(maxY, d.originY + (event.clientY - d.startY)))
      setOffset({ x: nx, y: ny })
    }

    const endDrag = (event) => {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragging(false)
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch (_) { /* ignore */ }
    }

    const bg = 'var(--dsw-alias-bg-base, #ffffff)'
    const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
    const line = 'var(--dsw-alias-border-l1, rgba(9, 30, 66, 0.10))'
    const ink = 'var(--dsw-alias-label-primary, #101828)'
    const mute = 'var(--dsw-alias-label-tertiary, #667085)'

    return h('div', {
      style: {
        position: 'absolute',
        inset: topOffset + 'px 0 0 0',
        zIndex,
        pointerEvents: 'none',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        boxSizing: 'border-box'
      }
    },
      h('section', {
        ref: frameRef,
        role: 'dialog',
        'aria-label': ariaLabel || title || '浮窗',
        onPointerDown: bringToFront,
        style: {
          pointerEvents: 'auto',
          width,
          ...(height ? { height } : {}),
          maxHeight,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 'var(--tether-radius-lg, 16px)',
          background: bg,
          color: ink,
          border: '1px solid var(--tether-glass-border, ' + line + ')',
          boxShadow: 'var(--tether-glass-shadow, 0 20px 56px rgba(16, 24, 40, 0.22), 0 4px 12px rgba(16, 24, 40, 0.10))',
          transform: 'translate3d(' + Math.round(offset.x) + 'px, ' + Math.round(offset.y) + 'px, 0)',
          transition: dragging ? 'none' : 'box-shadow 150ms var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1))'
        }
      },
        h('header', {
          onPointerDown: startDrag,
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          style: {
            height: 44,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: panel,
            borderBottom: '1px solid ' + line,
            flex: '0 0 auto',
            cursor: dragging ? 'grabbing' : 'grab',
            userSelect: 'none'
          }
        },
          h('strong', { style: { fontSize: 13.5, fontWeight: 'var(--tether-strong, 600)', color: ink } }, title),
          subtitle ? h('span', { className: 'tether-num', style: { fontSize: 11.5, color: mute } }, subtitle) : null,
          headerExtra || null,
          onClose ? h('button', {
            type: 'button',
            disabled: disabledClose,
            onClick: onClose,
            title: '关闭',
            'aria-label': '关闭',
            className: 'tether-hover',
            style: {
              marginLeft: headerExtra ? 4 : 'auto',
              width: 28,
              height: 28,
              border: 0,
              borderRadius: 'var(--tether-radius-sm, 6px)',
              background: 'transparent',
              fontSize: 18,
              lineHeight: '28px',
              display: 'grid',
              placeItems: 'center',
              cursor: disabledClose ? 'default' : 'pointer',
              color: mute,
              opacity: disabledClose ? 0.4 : 1
            }
          }, '×') : null
        ),
        h('div', {
          style: {
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            ...bodyStyle
          }
        }, children),
        footer || null
      )
    )
  }

  return { FloatingWindow }
}
