// Shared custom UI controls following Owner UI Design rules (no raw <select> or checkbox).
export function createUiControls(React) {
  const h = React.createElement

  function chevronSvg(open) {
    return h('svg', {
      width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      style: {
        flex: '0 0 auto',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform var(--tether-duration-fast, 150ms) var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1))'
      }
    }, h('path', { d: 'M3 4.5L6 7.5L9 4.5' }))
  }

  function checkSvg() {
    return h('svg', {
      width: 10, height: 10, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
    }, h('path', { d: 'M2.5 6.2L5 8.7L9.5 3.6' }))
  }

  function StyledSelect({
    value = '',
    options = [],
    onChange,
    disabled = false,
    placeholder = '请选择…',
    searchable,
    ariaLabel,
    title,
    style = {},
    menuMinWidth = 180
  }) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [activeIndex, setActiveIndex] = React.useState(-1)
    const rootRef = React.useRef(null)
    const listRef = React.useRef(null)

    const normalized = React.useMemo(() => (options || []).map((item) => (
      typeof item === 'object' && item !== null
        ? { value: String(item.value ?? ''), label: String(item.label ?? item.value ?? ''), disabled: !!item.disabled }
        : { value: String(item), label: String(item), disabled: false }
    )), [options])

    const current = normalized.find((item) => item.value === String(value ?? '')) || null
    const useSearch = typeof searchable === 'boolean' ? searchable : normalized.length > 8
    const filtered = React.useMemo(() => {
      const term = query.trim().toLowerCase()
      if (!useSearch || !term) return normalized
      return normalized.filter((item) => item.label.toLowerCase().includes(term) || item.value.toLowerCase().includes(term))
    }, [normalized, query, useSearch])

    React.useEffect(() => {
      if (!open) { setQuery(''); return undefined }
      const selectedIdx = filtered.findIndex((item) => item.value === String(value ?? '') && !item.disabled)
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : filtered.findIndex((item) => !item.disabled))
      const onPointerDown = (event) => {
        if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') { setOpen(false); event.stopPropagation() }
      }
      document.addEventListener('pointerdown', onPointerDown)
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [open])

    const selectValue = (nextValue) => {
      setOpen(false)
      if (onChange && nextValue !== value) onChange(nextValue)
    }

    const onTriggerKeyDown = (event) => {
      if (disabled) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!open) { setOpen(true); return }
        const pick = filtered[activeIndex]
        if (pick && !pick.disabled) selectValue(pick.value)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!open) { setOpen(true); return }
        if (!filtered.length) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        let next = activeIndex
        for (let i = 0; i < filtered.length; i += 1) {
          next = (next + step + filtered.length) % filtered.length
          if (!filtered[next].disabled) { setActiveIndex(next); break }
        }
      }
    }

    const border = 'var(--dsw-alias-border-l2, rgba(9, 30, 66, 0.14))'
    const bg = style.background || 'var(--dsw-specific-input-major, var(--dsw-alias-bg-base, #ffffff))'
    const ink = style.color || 'var(--dsw-alias-label-primary, #101828)'
    const mute = 'var(--dsw-alias-label-tertiary, #667085)'

    return h('div', {
      ref: rootRef,
      style: {
        position: 'relative',
        display: 'inline-flex',
        minWidth: 0,
        ...(style.flex ? { flex: style.flex } : {}),
        ...(style.width ? { width: style.width } : {})
      }
    },
      h('button', {
        type: 'button',
        role: 'combobox',
        'aria-expanded': open,
        'aria-haspopup': 'listbox',
        'aria-label': ariaLabel || title || placeholder,
        title: title || (current ? current.label : placeholder),
        disabled,
        onClick: () => { if (!disabled) setOpen((prev) => !prev) },
        onKeyDown: onTriggerKeyDown,
        className: 'tether-hover',
        style: {
          width: '100%',
          height: style.height || 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 10px',
          boxSizing: 'border-box',
          border: style.border !== undefined ? style.border : ('1px solid ' + border),
          borderRadius: style.borderRadius || 'var(--tether-radius-sm, 6px)',
          background: bg,
          color: current ? ink : mute,
          fontSize: style.fontSize || 12,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          minWidth: 0,
          textAlign: 'left',
          outline: 'none'
        }
      },
        h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          current ? current.label : placeholder),
        chevronSvg(open)
      ),
      open ? h('div', {
        ref: listRef,
        role: 'listbox',
        className: 'tether-glass tether-scroll',
        style: {
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          minWidth: 'max(100%, ' + menuMinWidth + 'px)',
          maxWidth: 340,
          maxHeight: 240,
          overflowY: 'auto',
          zIndex: 120,
          padding: 4,
          borderRadius: 'var(--tether-radius-md, 10px)',
          boxShadow: 'var(--tether-glass-shadow, 0 12px 32px rgba(16, 24, 40, 0.18), 0 2px 6px rgba(16, 24, 40, 0.08))',
          display: 'grid',
          gap: 2
        }
      },
        useSearch ? h('input', {
          type: 'text',
          value: query,
          autoFocus: true,
          placeholder: '筛选…',
          onChange: (event) => { setQuery(event.target.value); setActiveIndex(0) },
          style: {
            height: 28,
            marginBottom: 2,
            padding: '0 8px',
            boxSizing: 'border-box',
            border: '1px solid ' + border,
            borderRadius: 'var(--tether-radius-sm, 6px)',
            background: 'var(--dsw-alias-bg-base, #ffffff)',
            color: ink,
            fontSize: 12,
            outline: 'none'
          }
        }) : null,
        filtered.length ? filtered.map((item, idx) => {
          const isSelected = item.value === String(value ?? '')
          const isActive = idx === activeIndex
          return h('button', {
            key: item.value,
            type: 'button',
            role: 'option',
            'aria-selected': isSelected,
            disabled: item.disabled,
            onMouseEnter: () => setActiveIndex(idx),
            onClick: () => { if (!item.disabled) selectValue(item.value) },
            style: {
              width: '100%',
              minHeight: 30,
              padding: '4px 8px',
              border: 0,
              borderRadius: 'var(--tether-radius-sm, 6px)',
              background: isSelected
                ? 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10))'
                : (isActive ? 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))' : 'transparent'),
              color: item.disabled ? mute : ink,
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              textAlign: 'left',
              cursor: item.disabled ? 'default' : 'pointer',
              opacity: item.disabled ? 0.5 : 1
            }
          },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.label),
            isSelected ? h('span', { style: { color: 'var(--dsw-alias-state-business-primary, #1570ef)', display: 'inline-flex', flex: '0 0 auto' } }, checkSvg()) : null
          )
        }) : h('div', { style: { padding: '8px 10px', color: mute, fontSize: 12, textAlign: 'center' } }, '无匹配项')
      ) : null
    )
  }

  function ToggleSwitch({ checked = false, onChange, disabled = false, label, ariaLabel }) {
    const activeBg = 'var(--dsw-alias-state-business-primary, #1570ef)'
    const offBg = 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.18))'
    return h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': !!checked,
      'aria-label': ariaLabel || label || '切换',
      disabled,
      onClick: () => { if (!disabled && onChange) onChange(!checked) },
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: 0,
        padding: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #101828)',
        fontSize: 12.5,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }
    },
      h('span', {
        style: {
          position: 'relative',
          width: 34,
          height: 20,
          borderRadius: 999,
          background: checked ? activeBg : offBg,
          transition: 'background-color var(--tether-duration-fast, 150ms) var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1))',
          flex: '0 0 auto'
        }
      },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.24)',
            transform: checked ? 'translateX(14px)' : 'translateX(0)',
            transition: 'transform var(--tether-duration-fast, 150ms) var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1))'
          }
        })
      ),
      label ? h('span', { style: { textAlign: 'left' } }, label) : null
    )
  }

  function StyledCheckbox({ checked = false, onChange, disabled = false, label, title }) {
    const border = 'var(--dsw-alias-border-l2, rgba(9, 30, 66, 0.2))'
    const active = 'var(--dsw-alias-state-business-primary, #1570ef)'
    const ink = 'var(--dsw-alias-label-secondary, #475467)'
    const mute = 'var(--dsw-alias-label-tertiary, #98a2b3)'
    return h('button', {
      type: 'button',
      role: 'checkbox',
      'aria-checked': !!checked,
      disabled,
      title,
      onClick: () => { if (!disabled && onChange) onChange(!checked) },
      className: 'tether-hover',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        border: 0,
        borderRadius: 'var(--tether-radius-sm, 6px)',
        background: 'transparent',
        color: disabled ? mute : ink,
        fontSize: 12,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        minWidth: 0
      }
    },
      h('span', {
        'aria-hidden': true,
        style: {
          width: 16,
          height: 16,
          borderRadius: 'var(--tether-radius-sm, 6px)',
          border: '1px solid ' + (checked ? active : border),
          background: checked ? active : 'transparent',
          color: '#ffffff',
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          transition: 'background-color var(--tether-duration-fast, 150ms) var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1)), border-color var(--tether-duration-fast, 150ms)'
        }
      }, checked ? checkSvg() : null),
      label ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label) : null
    )
  }

  function SegmentedControl({ value, options = [], onChange, disabled = false, ariaLabel }) {
    const track = 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))'
    const activeBg = 'var(--dsw-alias-bg-base, #ffffff)'
    const ink = 'var(--dsw-alias-label-primary, #101828)'
    const mute = 'var(--dsw-alias-label-tertiary, #667085)'
    return h('div', {
      role: 'radiogroup',
      'aria-label': ariaLabel,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: 'var(--tether-radius-sm, 6px)',
        background: track,
        opacity: disabled ? 0.55 : 1
      }
    }, (options || []).map((item) => {
      const val = String(item.value)
      const active = val === String(value)
      return h('button', {
        key: val,
        type: 'button',
        role: 'radio',
        'aria-checked': active,
        disabled: disabled || !!item.disabled,
        onClick: () => { if (!disabled && !item.disabled && onChange) onChange(val) },
        style: {
          height: 26,
          padding: '0 10px',
          border: 0,
          borderRadius: 4,
          background: active ? activeBg : 'transparent',
          color: active ? ink : mute,
          fontSize: 12,
          fontWeight: active ? 500 : 400,
          boxShadow: active ? '0 1px 2px rgba(16, 24, 40, 0.10)' : 'none',
          cursor: disabled || item.disabled ? 'default' : 'pointer',
          transition: 'background-color var(--tether-duration-fast, 150ms) var(--tether-ease, cubic-bezier(0.22, 1, 0.36, 1)), color var(--tether-duration-fast, 150ms)'
        }
      }, item.label)
    }))
  }

  return { StyledSelect, ToggleSwitch, StyledCheckbox, SegmentedControl }
}
