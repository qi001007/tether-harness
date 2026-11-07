const CROP_VIEW = 240
const AVATAR_OUTPUT = 256

export function createSettingsPanel(React) {
  const h = React.createElement
  const ink = 'var(--dsw-alias-label-primary, #101828)'
  const sub = 'var(--dsw-alias-label-secondary, #475467)'
  const mute = 'var(--dsw-alias-label-tertiary, #667085)'
  const bg = 'var(--dsw-alias-bg-base, #ffffff)'
  const panel = 'var(--dsw-specific-sidebar-fill, #f9fafb)'
  const line = 'var(--dsw-alias-border-secondary, #e4e7ec)'
  const blue = 'var(--dsw-alias-state-business-primary, #1570ef)'
  const danger = 'var(--dsw-alias-state-error-primary, #b42318)'
  const success = 'var(--dsw-alias-state-success-primary, #16a34a)'
  const field = { width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid ' + line, borderRadius: 7, padding: '0 9px', background: bg, color: ink, fontSize: 12.5, font: 'inherit', outline: 'none' }
  const primary = { height: 30, padding: '0 12px', border: 0, borderRadius: 7, color: 'var(--dsw-alias-label-primary-inverted, #ffffff)', background: 'var(--dsw-alias-button-primary-fill, #101828)', cursor: 'pointer', fontSize: 12, font: 'inherit' }
  const secondary = { height: 30, padding: '0 12px', border: '1px solid ' + line, borderRadius: 7, color: sub, background: 'transparent', cursor: 'pointer', fontSize: 12, font: 'inherit' }
  const timeText = (value) => {
    if (!value) return '—'
    try { const date = new Date(value); return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':') } catch (_) { return '—' }
  }
  const card = (rows) => h('div', { style: { border: '1px solid ' + line, borderRadius: 10, overflow: 'hidden', background: bg } },
    rows.filter(Boolean).map((row, index) => h('div', {
      key: index,
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, minHeight: 40, padding: '0 14px', borderTop: index ? '1px solid ' + line : 0, fontSize: 12.5 }
    },
      h('span', { style: { color: mute, flex: '0 0 auto' } }, row[0]),
      h('span', { style: { color: ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' } }, row[1] || '—'))))
  const toggle = (checked, onChange, label) => h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, onClick: () => onChange(!checked),
    style: {
      width: 36, height: 20, flex: '0 0 auto', border: 0, borderRadius: 999, padding: 2,
      background: checked ? blue : 'var(--dsw-alias-border-secondary, #d0d5dd)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background 140ms ease'
    }
  }, h('span', {
    'aria-hidden': true,
    style: { width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.24)', transition: 'transform 140ms ease' }
  }))

  function SettingsPanel({ open, onClose, Glyph, accountEmail = '', accountRole = '', accountName = '',
    accountAvatar = '', onAvatarChange, onAccountNameChange, initialSection = 'account',
    server = '', connection = {}, device = {}, versions = {}, update = null, dsh = null, dshBusy = '',
    onDshStart, onDshInstall, extraSections = [],
    onRefreshConnection, onRestartNode, onLogout, onPasswordChanged }) {
    const [section, setSection] = React.useState(initialSection)
    const [currentPassword, setCurrentPassword] = React.useState('')
    const [newPassword, setNewPassword] = React.useState('')
    const [confirmPassword, setConfirmPassword] = React.useState('')
    const [showCurrentPassword, setShowCurrentPassword] = React.useState(false)
    const [showNewPassword, setShowNewPassword] = React.useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
    const [passwordTouched, setPasswordTouched] = React.useState({ current: false, next: false, confirm: false })
    const [capsLock, setCapsLock] = React.useState(false)
    const [busy, setBusy] = React.useState('')
    const [message, setMessage] = React.useState('')
    const [avatar, setAvatar] = React.useState(accountAvatar || '')
    const [avatarError, setAvatarError] = React.useState('')
    const [nameDraft, setNameDraft] = React.useState(accountName || '')
    const [nameError, setNameError] = React.useState('')
    const [editModal, setEditModal] = React.useState('')
    const [refreshing, setRefreshing] = React.useState(false)
    const [crop, setCrop] = React.useState(null)
    const [cropError, setCropError] = React.useState('')
    const avatarInputRef = React.useRef(null)
    const cropImageRef = React.useRef(null)
    const cropDragRef = React.useRef(null)
    const cropUrlRef = React.useRef('')
    const [keepSurfaces, setKeepSurfaces] = React.useState(() => {
      try { return localStorage.getItem('tether.keepSurfaces') !== '0' } catch (_) { return true }
    })
    React.useEffect(() => {
      if (!open) return
      setSection(initialSection)
      setEditModal('')
      setMessage('')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setPasswordTouched({ current: false, next: false, confirm: false })
    }, [open, initialSection])
    React.useEffect(() => { setAvatar(accountAvatar || '') }, [accountAvatar])
    React.useEffect(() => {
      if (editModal !== 'name') setNameDraft(accountName || '')
    }, [accountName, editModal])
    React.useEffect(() => {
      if (open) return
      setEditModal('')
      setCrop(null); setCropError('')
      if (cropUrlRef.current) { URL.revokeObjectURL(cropUrlRef.current); cropUrlRef.current = '' }
    }, [open])
    React.useEffect(() => () => {
      if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current)
    }, [])
    const updateRef = React.useRef(update)
    updateRef.current = update
    React.useEffect(() => {
      if (!open || section !== 'update') return
      const handler = updateRef.current && updateRef.current.onRefresh
      if (typeof handler === 'function') handler()
    }, [open, section])
    React.useEffect(() => {
      if (!crop) return undefined
      const onKey = (event) => {
        if (event.key !== 'Escape') return
        setCrop(null); setCropError('')
        if (cropUrlRef.current) { URL.revokeObjectURL(cropUrlRef.current); cropUrlRef.current = '' }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [crop])
    if (!open) return null
    const status = connection.status || 'unknown'
    const roleLabel = accountRole === 'owner' ? '所有者' : accountRole === 'member' ? '成员' : accountRole === 'admin' ? '管理员' : accountRole || ''
    const dotColor = status === 'online' ? success : status === 'offline' ? danger : status === 'checking' ? 'var(--dsw-alias-state-warn-primary, #b54708)' : mute
    const statusLabel = status === 'online' ? '已连接' : status === 'offline' ? '不可达' : status === 'checking' ? '检测中' : '未知'

    const closeCrop = () => {
      if (cropUrlRef.current) { URL.revokeObjectURL(cropUrlRef.current); cropUrlRef.current = '' }
      setCrop(null)
      setCropError('')
    }
    const chooseAvatar = () => { try { if (avatarInputRef.current) avatarInputRef.current.click() } catch (_) { /* input unavailable */ } }
    const loadAvatar = (event) => {
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      setAvatarError('')
      if (!file) return
      if (!/^image\//.test(file.type) || file.size > 8 * 1024 * 1024) {
        setAvatarError('请选择 8 MB 以内的图片')
        return
      }
      if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current)
      const url = URL.createObjectURL(file)
      cropUrlRef.current = url
      setCropError('')
      setCrop({ url, name: file.name, ready: false, imageW: 0, imageH: 0, baseScale: 1, zoom: 1, x: 0, y: 0 })
    }
    const onCropLoad = () => {
      const image = cropImageRef.current
      if (!image) return
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (!width || !height) { setCropError('无法读取这张图片'); return }
      const baseScale = Math.max(CROP_VIEW / width, CROP_VIEW / height)
      setCrop((current) => current ? {
        ...current, ready: true, imageW: width, imageH: height, baseScale, zoom: 1,
        x: (CROP_VIEW - width * baseScale) / 2, y: (CROP_VIEW - height * baseScale) / 2
      } : current)
    }
    const clampCrop = (current, x, y, zoom = current.zoom) => {
      const scale = current.baseScale * zoom
      return {
        x: Math.min(0, Math.max(CROP_VIEW - current.imageW * scale, x)),
        y: Math.min(0, Math.max(CROP_VIEW - current.imageH * scale, y))
      }
    }
    const setCropZoom = (value) => {
      setCrop((current) => {
        if (!current || !current.ready) return current
        const zoom = Math.max(1, Math.min(3, Number(value) || 1))
        const ratio = zoom / current.zoom
        const center = CROP_VIEW / 2
        const x = center - (center - current.x) * ratio
        const y = center - (center - current.y) * ratio
        return { ...current, zoom, ...clampCrop(current, x, y, zoom) }
      })
    }
    const resetCrop = () => {
      setCrop((current) => current && current.ready ? {
        ...current, zoom: 1,
        x: (CROP_VIEW - current.imageW * current.baseScale) / 2,
        y: (CROP_VIEW - current.imageH * current.baseScale) / 2
      } : current)
    }
    const cropPointerDown = (event) => {
      if (!crop || !crop.ready) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      cropDragRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: crop.x, originY: crop.y }
    }
    const cropPointerMove = (event) => {
      const drag = cropDragRef.current
      if (!drag) return
      setCrop((current) => {
        if (!current) return current
        return {
          ...current,
          ...clampCrop(current, drag.originX + event.clientX - drag.pointerX, drag.originY + event.clientY - drag.pointerY)
        }
      })
    }
    const cropPointerUp = () => { cropDragRef.current = null }
    const saveCrop = () => {
      const image = cropImageRef.current
      if (!crop || !crop.ready || !image) return
      const scale = crop.baseScale * crop.zoom
      const sourceSize = CROP_VIEW / scale
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_OUTPUT; canvas.height = AVATAR_OUTPUT
      const context = canvas.getContext('2d')
      if (!context) { setCropError('无法保存这张图片'); return }
      context.drawImage(image, -crop.x / scale, -crop.y / scale, sourceSize, sourceSize, 0, 0, AVATAR_OUTPUT, AVATAR_OUTPUT)
      let dataUrl
      try { dataUrl = canvas.toDataURL('image/jpeg', 0.9) } catch (_) { setCropError('无法保存这张图片'); return }
      setAvatar(dataUrl)
      if (typeof onAvatarChange === 'function') onAvatarChange(dataUrl)
      closeCrop()
    }
    const removeAvatar = () => {
      setAvatar('')
      if (typeof onAvatarChange === 'function') onAvatarChange('')
      closeCrop()
    }
    const startNameEdit = () => {
      setNameDraft(accountName || '')
      setNameError('')
      setEditModal('name')
    }
    const saveName = () => {
      const value = nameDraft.trim()
      if (value.length > 32) { setNameError('最多 32 个字符'); return }
      if (typeof onAccountNameChange === 'function') onAccountNameChange(value)
      setEditModal('')
      setNameError('')
    }
    const cancelName = () => {
      setNameDraft(accountName || '')
      setEditModal('')
      setNameError('')
    }
    const openPassword = () => {
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setPasswordTouched({ current: false, next: false, confirm: false })
      setMessage('')
      setCapsLock(false)
      setEditModal('password')
    }
    const closePassword = () => {
      if (busy === 'password') return
      setEditModal('')
      setMessage('')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setPasswordTouched({ current: false, next: false, confirm: false })
    }

    const passwordRules = {
      current: !currentPassword ? '请输入当前密码' : '',
      next: !newPassword ? '请输入新密码' : newPassword.length < 10 ? '新密码至少 10 位' : newPassword === currentPassword ? '新密码不能与当前密码相同' : '',
      confirm: !confirmPassword ? '请再次输入新密码' : confirmPassword !== newPassword ? '两次输入的新密码不一致' : ''
    }
    const passwordValid = !passwordRules.current && !passwordRules.next && !passwordRules.confirm
    const changePassword = async () => {
      setPasswordTouched({ current: true, next: true, confirm: true })
      if (!passwordValid) return
      if (!server) { setMessage('未配置服务器地址'); return }
      setMessage('')
      setBusy('password')
      try {
        const response = await fetch(server.replace(/\/+$/, '') + '/api/auth/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (connection.token || '') },
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          const detail = data.detail && (data.detail.error || data.detail.code) || data.error
          throw new Error(response.status === 401 ? '当前密码不正确' : detail || ('HTTP ' + response.status))
        }
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
        setPasswordTouched({ current: false, next: false, confirm: false })
        if (typeof onPasswordChanged === 'function') onPasswordChanged(data)
        setMessage('密码已更新')
        setTimeout(() => {
          setEditModal('')
          setMessage('')
        }, 900)
      } catch (error) {
        setMessage(String(error && error.message || error))
      } finally {
        setBusy('')
      }
    }
    const refreshConnection = async () => {
      if (refreshing || typeof onRefreshConnection !== 'function') return
      setRefreshing(true)
      try { await onRefreshConnection() } finally { setRefreshing(false) }
    }

    const textAction = (label, onClick, color = blue) => h('button', {
      type: 'button', onClick, className: 'tether-hover',
      style: { border: 0, background: 'transparent', padding: 0, color, fontSize: 11.5, cursor: 'pointer', font: 'inherit' }
    }, label)
    const groupTitle = (label) => h('div', { style: { fontSize: 12, fontWeight: 600, color: sub, letterSpacing: 0.2 } }, label)
    const cardStyle = { border: '1px solid ' + line, borderRadius: 10, background: bg, padding: 16 }
    const avatarView = h('button', {
      type: 'button', onClick: chooseAvatar, title: '更换头像', 'aria-label': '更换头像',
      style: {
        position: 'relative', width: 64, height: 64, flex: '0 0 auto', padding: 0, border: 0,
        borderRadius: 999, overflow: 'hidden', cursor: 'pointer',
        background: 'color-mix(in srgb, ' + blue + ' 14%, transparent)', color: blue
      }
    },
      avatar
        ? h('img', { src: avatar, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
        : h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: '100%', height: '100%', fontSize: 21, fontWeight: 600 } },
          String(accountName || accountEmail || '?').trim().charAt(0).toUpperCase()),
      h('span', {
        'aria-hidden': true,
        style: {
          position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 999,
          display: 'grid', placeItems: 'center', background: bg, color: sub,
          boxShadow: '0 0 0 1px ' + line
        }
      }, Glyph ? h(Glyph, { name: 'camera', size: 12 }) : '✎'))
    const profileCard = h('div', { style: { ...cardStyle, position: 'relative' } },
      avatar ? h('button', {
        type: 'button', onClick: removeAvatar, title: '移除头像', 'aria-label': '移除头像', className: 'tether-hover',
        style: { position: 'absolute', top: 10, right: 10, width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: mute, cursor: 'pointer' }
      }, Glyph ? h(Glyph, { name: 'trash', size: 14 }) : '×') : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, paddingRight: 28 } },
        avatarView,
        h('div', { style: { minWidth: 0, display: 'grid', gap: 3, flex: '1 1 auto' } },
          h('div', { style: { fontSize: 13.5, fontWeight: 600, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, accountEmail || '未登录'),
          roleLabel ? h('div', { style: { fontSize: 12, color: mute } }, roleLabel) : null)),
      avatarError ? h('div', { role: 'alert', style: { marginTop: 8, color: danger, fontSize: 11.5 } }, avatarError) : null,
      h('div', { style: { height: 1, background: line, margin: '14px 0' } }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 } },
        h('span', { style: { width: 78, flex: '0 0 auto', fontSize: 12, color: mute } }, '显示名称'),
        h('span', { style: { flex: '1 1 auto', minWidth: 0, fontSize: 13, color: accountName ? ink : mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, accountName || '未设置'),
        h('button', {
          type: 'button', onClick: startNameEdit, title: '编辑显示名称', 'aria-label': '编辑显示名称', className: 'tether-hover',
          style: { width: 26, height: 26, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: mute, cursor: 'pointer' }
        }, Glyph ? h(Glyph, { name: 'pencil', size: 14 }) : '✎')))
    const passwordInput = (key, label, value, onChange, visible, onToggle, autoComplete) => {
      const error = passwordTouched[key] ? passwordRules[key] : ''
      return h('label', { style: { display: 'grid', gap: 6, fontSize: 12, color: sub } },
        label,
        h('div', { style: { position: 'relative' } },
          h('input', {
            type: visible ? 'text' : 'password', value, onChange: (event) => onChange(event.target.value),
            onBlur: () => { setPasswordTouched((current) => ({ ...current, [key]: true })); setCapsLock(false) },
            onKeyUp: (event) => { if (event.getModifierState) setCapsLock(event.getModifierState('CapsLock')) },
            name: autoComplete, autoComplete, 'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': error ? 'pw-' + key + '-error' : undefined,
            style: { ...field, height: 34, paddingRight: 34 }
          }),
          h('button', {
            type: 'button', onMouseDown: (event) => event.preventDefault(), onClick: onToggle,
            title: visible ? '隐藏密码' : '显示密码', 'aria-label': visible ? '隐藏密码' : '显示密码',
            'aria-pressed': visible, className: 'tether-hover',
            style: { position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, border: 0, borderRadius: 5, background: 'transparent', color: visible ? blue : mute, display: 'grid', placeItems: 'center', cursor: 'pointer' }
          }, Glyph ? h(Glyph, { name: 'eye', size: 14 }) : null)),
        error ? h('div', { id: 'pw-' + key + '-error', role: 'alert', style: { color: danger, fontSize: 11.5 } }, error) : null)
    }
    const securityCard = h('div', { style: cardStyle },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 36 } },
        h('span', { style: { flex: '1 1 auto', fontSize: 13, color: ink, fontWeight: 'var(--tether-strong, 500)' } }, '密码'),
        h('button', {
          type: 'button', onClick: openPassword, className: 'tether-hover',
          style: { ...secondary, height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }
        }, Glyph ? h(Glyph, { name: 'pencil', size: 13 }) : null, '修改密码')))
    const accountSection = h('div', { style: { display: 'grid', gap: 18, maxWidth: 520 } },
      h('input', { ref: avatarInputRef, type: 'file', accept: 'image/*', onChange: loadAvatar, style: { display: 'none' } }),
      h('div', { style: { display: 'grid', gap: 8 } }, groupTitle('个人资料'), profileCard),
      h('div', { style: { display: 'grid', gap: 8 } }, groupTitle('登录与安全'), securityCard),
      h('div', { style: { borderTop: '1px solid ' + line, paddingTop: 14 } },
        h('button', {
          type: 'button', onClick: onLogout, className: 'tether-hover',
          style: { border: 0, background: 'transparent', padding: 0, color: danger, fontSize: 12.5, cursor: 'pointer' }
        }, '退出登录')))
    const cropModal = crop ? h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) closeCrop() },
      style: { position: 'absolute', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(16,24,40,.45)' }
    },
      h('section', {
        role: 'dialog', 'aria-label': '更换头像', onPointerDown: (event) => event.stopPropagation(),
        style: { width: 'min(440px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: bg, borderRadius: 12, boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,.22))' }
      },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid ' + line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 14 } }, '更换头像'),
          h('button', { type: 'button', onClick: closeCrop, title: '关闭', 'aria-label': '关闭', className: 'tether-hover', style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: mute, fontSize: 18, cursor: 'pointer' } }, '×')),
        h('div', { style: { padding: 20, display: 'grid', gap: 14, justifyItems: 'center' } },
          h('div', {
            onPointerDown: cropPointerDown, onPointerMove: cropPointerMove, onPointerUp: cropPointerUp, onPointerCancel: cropPointerUp,
            onWheel: (event) => { if (crop.ready) { event.preventDefault(); setCropZoom(crop.zoom - event.deltaY * 0.0015) } },
            style: {
              position: 'relative', width: CROP_VIEW, height: CROP_VIEW, borderRadius: '50%', overflow: 'hidden',
              background: '#111318', cursor: crop.ready ? 'grab' : 'default', touchAction: 'none', flex: '0 0 auto'
            }
          },
            h('img', {
              ref: cropImageRef, src: crop.url, alt: '', draggable: false, onLoad: onCropLoad,
              onDragStart: (event) => event.preventDefault(),
              style: {
                position: 'absolute', left: 0, top: 0, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
                opacity: crop.ready ? 1 : 0, transformOrigin: '0 0',
                transform: 'translate(' + crop.x + 'px,' + crop.y + 'px) scale(' + (crop.baseScale * crop.zoom) + ')'
              }
            }),
            h('div', { 'aria-hidden': true, style: { position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.55)', pointerEvents: 'none' } }),
            !crop.ready && !cropError ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#98a2b3', fontSize: 12 } }, '读取图片…') : null),
          crop.ready ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%' } },
            h('span', { 'aria-hidden': true, style: { color: mute, fontSize: 14 } }, '−'),
            h('input', {
              type: 'range', min: 1, max: 3, step: 0.01, value: crop.zoom, 'aria-label': '缩放头像',
              onChange: (event) => setCropZoom(event.target.value),
              style: { flex: '1 1 auto', accentColor: blue }
            }),
            h('span', { 'aria-hidden': true, style: { color: mute, fontSize: 14 } }, '+'),
            h('button', {
              type: 'button', onClick: resetCrop, title: '重置', 'aria-label': '重置', className: 'tether-hover',
              style: { width: 24, height: 24, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 5, background: 'transparent', color: mute, cursor: 'pointer' }
            }, Glyph ? h(Glyph, { name: 'refresh', size: 13 }) : '↺')) : null,
          cropError ? h('div', { role: 'alert', style: { color: danger, fontSize: 11.5 } }, cropError) : null),
        h('footer', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid ' + line, flex: '0 0 auto' } },
          avatar ? textAction('移除头像', removeAvatar, danger) : h('span', { style: { flex: '1 1 auto' } }),
          h('button', { type: 'button', onClick: closeCrop, style: { ...secondary, height: 28, padding: '0 10px', marginLeft: 'auto' } }, '取消'),
          h('button', { type: 'button', onClick: saveCrop, disabled: !crop.ready, style: { ...primary, height: 28, padding: '0 12px', opacity: crop.ready ? 1 : 0.5 } }, '保存'))))
      : null
    const nameModal = editModal === 'name' ? h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) cancelName() },
      style: { position: 'absolute', inset: 0, zIndex: 86, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(16,24,40,.45)' }
    },
      h('section', {
        role: 'dialog', 'aria-label': '修改昵称', onPointerDown: (event) => event.stopPropagation(),
        style: { width: 'min(360px, 100%)', background: bg, borderRadius: 12, boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,.22))', overflow: 'hidden' }
      },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid ' + line } },
          h('strong', { style: { fontSize: 14 } }, '修改昵称'),
          h('button', { type: 'button', onClick: cancelName, title: '关闭', 'aria-label': '关闭', className: 'tether-hover', style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: mute, fontSize: 18, cursor: 'pointer' } }, '×')),
        h('div', { style: { padding: 18, display: 'grid', gap: 10 } },
          h('label', { style: { display: 'grid', gap: 6, fontSize: 12, color: sub } }, '显示名称',
            h('input', {
              value: nameDraft, onChange: (event) => setNameDraft(event.target.value), maxLength: 32,
              autoComplete: 'nickname', autoFocus: true, 'aria-label': '显示名称',
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); saveName() }
                if (event.key === 'Escape') { event.preventDefault(); cancelName() }
              },
              style: field
            })),
          nameError ? h('div', { role: 'alert', style: { color: danger, fontSize: 11.5 } }, nameError) : null),
        h('footer', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 14px', borderTop: '1px solid ' + line } },
          h('button', { type: 'button', onClick: cancelName, style: { ...secondary, height: 28, padding: '0 10px' } }, '取消'),
          h('button', {
            type: 'button', onClick: saveName,
            disabled: nameDraft.trim() === String(accountName || '').trim(),
            style: { ...primary, height: 28, padding: '0 12px', opacity: nameDraft.trim() === String(accountName || '').trim() ? 0.5 : 1 }
          }, '保存'))))
      : null
    const passwordModal = editModal === 'password' ? h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) closePassword() },
      style: { position: 'absolute', inset: 0, zIndex: 86, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(16,24,40,.45)' }
    },
      h('section', {
        role: 'dialog', 'aria-label': '修改密码', onPointerDown: (event) => event.stopPropagation(),
        style: { width: 'min(380px, 100%)', maxHeight: 'calc(100vh - 48px)', background: bg, borderRadius: 12, boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,.22))', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
      },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid ' + line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 14 } }, '修改密码'),
          h('button', { type: 'button', onClick: closePassword, title: '关闭', 'aria-label': '关闭', className: 'tether-hover', style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', color: mute, fontSize: 18, cursor: 'pointer' } }, '×')),
        h('form', { onSubmit: (event) => { event.preventDefault(); void changePassword() }, style: { display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { className: 'tether-scroll', style: { padding: 18, display: 'grid', gap: 12, overflowY: 'auto' } },
            passwordInput('current', '当前密码', currentPassword, setCurrentPassword, showCurrentPassword, () => setShowCurrentPassword((value) => !value), 'current-password'),
            passwordInput('next', '新密码', newPassword, setNewPassword, showNewPassword, () => setShowNewPassword((value) => !value), 'new-password'),
            passwordInput('confirm', '确认新密码', confirmPassword, setConfirmPassword, showConfirmPassword, () => setShowConfirmPassword((value) => !value), 'new-password'),
            capsLock ? h('div', { style: { color: 'var(--dsw-alias-state-warn-primary, #b54708)', fontSize: 11.5 } }, 'Caps Lock 已开启') : null,
            message ? h('div', { role: 'status', style: { color: message === '密码已更新' ? success : danger, fontSize: 12 } }, message) : null),
          h('footer', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 14px', borderTop: '1px solid ' + line, flex: '0 0 auto' } },
            h('button', { type: 'button', onClick: closePassword, style: { ...secondary, height: 28, padding: '0 10px' } }, '取消'),
            h('button', {
              type: 'submit', disabled: busy === 'password',
              style: { ...primary, height: 28, padding: '0 12px', opacity: busy === 'password' ? 0.5 : 1, cursor: busy === 'password' ? 'default' : 'pointer' }
            }, busy === 'password' ? '更新中…' : '更新密码')))))
      : null
    const connectionSection = h('div', { style: { display: 'grid', gap: 10 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 } },
        h('span', { style: { flex: '1 1 auto', fontSize: 12, color: mute } }, '服务器'),
        h('button', {
          type: 'button', onClick: refreshConnection, disabled: refreshing, title: '重新检测', 'aria-label': '重新检测',
          className: 'tether-hover',
          style: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: sub, cursor: refreshing ? 'default' : 'pointer' }
        }, Glyph ? h('span', { className: refreshing ? 'tether-spin' : '', style: { display: 'grid', placeItems: 'center' } }, h(Glyph, { name: 'refresh', size: 15 })) : '↻')),
      card([
        ['地址', server || '未配置'],
        ['状态', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dotColor } }), statusLabel)],
        ['最近检测', timeText(connection.checkedAt)],
        ['响应', Number.isFinite(connection.durationMs) ? connection.durationMs + ' ms' : '—']
      ]))
    const workspaceSection = h('div', { style: { display: 'grid', gap: 12 } },
      h('div', {
        title: '切换设备时保留最近三个原生工作区；关闭后释放后台页面',
        style: { display: 'flex', alignItems: 'center', gap: 16, minHeight: 44 }
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { fontSize: 13, color: ink } }, '保留最近设备工作区'),
          h('div', { style: { marginTop: 2, fontSize: 11.5, color: mute } }, '最多 3 台')),
        toggle(keepSurfaces, (next) => {
          setKeepSurfaces(next)
          try { localStorage.setItem('tether.keepSurfaces', next ? '1' : '0') } catch (_) { /* storage unavailable */ }
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('tether-surfaces-pref'))
        }, '保留最近设备工作区')))
    const dshKnown = !!(dsh && typeof dsh.installed === 'boolean')
    const dshStatus = dshKnown
      ? (dsh.installing ? '安装中 ' + (Number(dsh.progress) || 0) + '%' : dsh.running ? '运行中' : dsh.installed ? '未启动' : '未安装')
      : '—'
    const dshValue = dshKnown
      ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, dsh.version || '—'),
        h('span', { style: { color: dsh.running ? success : mute, fontSize: 11, flex: '0 0 auto' } }, dshStatus))
      : '—'
    const dshAction = dshKnown && !dsh.running
      ? h('button', {
        type: 'button', onClick: dsh.installed ? onDshStart : onDshInstall,
        disabled: !!dshBusy || !!dsh.installing,
        style: { ...secondary, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: dshBusy || dsh.installing ? 0.5 : 1, cursor: dshBusy || dsh.installing ? 'default' : 'pointer' }
      },
        dshBusy || dsh.installing
          ? h('span', { className: 'tether-spin', style: { display: 'grid', placeItems: 'center' } }, Glyph ? h(Glyph, { name: 'refresh', size: 14 }) : null)
          : Glyph ? h(Glyph, { name: dsh.installed ? 'arrowUp' : 'download', size: 14 }) : null,
        dsh.installing ? '安装中 ' + (Number(dsh.progress) || 0) + '%' : dsh.installed ? '启动 DSH' : '安装 DSH')
      : null
    const deviceSection = h('div', { style: { display: 'grid', gap: 12 } },
      card([
        ['设备名', device.name || device.device_id || '—'],
        ['设备 ID', device.device_id || '—'],
        ['平台', (device.capabilities && device.capabilities.os_label) || device.platform || '—'],
        ['DSH', dshValue],
        ['Node', device.online ? '在线' : '离线']
      ]),
      dshKnown && dsh.error ? h('div', { role: 'alert', style: { color: danger, fontSize: 11.5 } }, dsh.error) : null,
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        dshAction,
        h('button', {
          type: 'button', onClick: onRestartNode, disabled: !device.online,
          style: { ...secondary, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: device.online ? 1 : 0.5, cursor: device.online ? 'pointer' : 'default' }
        }, Glyph ? h(Glyph, { name: 'refresh', size: 14 }) : null, '重启 Node')))
    const versionRows = [
      ['客户端', versions.app || '—'],
      ['Node', versions.node || '—'],
      ['DSH 插件', versions.plugin || '—']
    ]
    const aboutSection = h('div', { style: { display: 'grid', gap: 14 } },
      h('div', { style: { fontSize: 17, fontWeight: 600, color: ink } }, 'Tether'),
      card(versionRows))
    const updateRow = (row, index) => {
      const chips = (row.products || []).map((product) => h('span', {
        key: product.label,
        title: product.latest && product.latest !== product.current ? '最新 ' + product.latest : '',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px',
          borderRadius: 6, background: panel, color: ink, fontSize: 11.5, flex: '0 0 auto'
        }
      },
        h('span', { style: { color: mute } }, product.label),
        h('span', { className: 'tether-num' }, product.current || '—')))
      const action = row.running
        ? h('span', { className: 'tether-spin', title: '更新中', 'aria-label': '更新中', style: { display: 'grid', placeItems: 'center', color: blue } }, Glyph ? h(Glyph, { name: 'refresh', size: 15 }) : null)
        : row.error
          ? h('button', {
            type: 'button', onClick: () => update && update.onUpdate(row), title: row.error, 'aria-label': '重试',
            className: 'tether-hover',
            style: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: danger, cursor: 'pointer' }
          }, Glyph ? h(Glyph, { name: 'refresh', size: 14 }) : '!')
          : row.available && row.online
            ? h('button', {
              type: 'button', onClick: () => update && update.onUpdate(row), title: '更新', 'aria-label': '更新 ' + (row.name || ''),
              className: 'tether-hover',
              style: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: sub, cursor: 'pointer' }
            }, Glyph ? h(Glyph, { name: 'download', size: 15 }) : '↓')
            : null
      return h('div', {
        key: row.key,
        style: {
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '8px 12px',
          borderTop: index ? '1px solid ' + line : 0, background: bg
        }
      },
        h('span', { 'aria-hidden': true, style: { width: 7, height: 7, borderRadius: 999, flex: '0 0 auto', background: row.online ? success : mute } }),
        h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 13, color: ink, fontWeight: 'var(--tether-strong, 500)', flex: '0 0 auto', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.name || '—'),
          chips),
        h('span', { style: { width: 28, flex: '0 0 28px', display: 'grid', placeItems: 'center' } }, action))
    }
    const updateGroup = (key, label, rows) => rows.length
      ? h('div', { key, style: { display: 'grid', gap: 8 } },
        groupTitle(label),
        h('div', { style: { border: '1px solid ' + line, borderRadius: 10, overflow: 'hidden', background: bg } }, rows.map(updateRow)))
      : null
    const updateGroups = []
    if (update && update.local) updateGroups.push(updateGroup('local', '本机', [update.local]))
    const updateDevices = (update && update.devices) || []
    if (updateDevices.length) updateGroups.push(updateGroup('devices', '其他设备', updateDevices))
    const updateSection = h('div', { style: { display: 'grid', gap: 16 } },
      h('div', { style: { display: 'flex', alignItems: 'center', minHeight: 28 } },
        h('strong', { style: { fontSize: 15, color: ink, fontWeight: 'var(--tether-strong, 600)' } }, '更新'),
        h('button', {
          type: 'button', onClick: () => update && update.onRefresh && update.onRefresh(), disabled: !!(update && update.refreshing),
          title: '刷新', 'aria-label': '刷新更新状态', className: 'tether-hover',
          style: { marginLeft: 'auto', width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: sub, cursor: update && update.refreshing ? 'default' : 'pointer' }
        }, Glyph ? h('span', { className: update && update.refreshing ? 'tether-spin' : '', style: { display: 'grid', placeItems: 'center' } }, h(Glyph, { name: 'refresh', size: 16 })) : '↻')),
      updateGroups.length ? updateGroups : h('div', { style: { fontSize: 12, color: mute } }, '没有已连接的设备'))
    const builtIn = [
      { id: 'account', label: '账号', render: () => accountSection },
      { id: 'connection', label: '连接', render: () => connectionSection },
      { id: 'update', label: '更新', render: () => updateSection },
      { id: 'workspace', label: '工作区', render: () => workspaceSection },
      { id: 'device', label: '本机设备', render: () => deviceSection },
      { id: 'about', label: '关于', render: () => aboutSection }
    ]
    const sections = builtIn.concat((Array.isArray(extraSections) ? extraSections : [])
      .filter((item) => item && item.id && item.label && typeof item.render === 'function'))
    const current = sections.find((item) => item.id === section) || sections[0]
    const nav = h('div', {
      style: { width: 150, flex: '0 0 auto', padding: '12px 8px', background: panel, borderRight: '1px solid ' + line, display: 'flex', flexDirection: 'column', gap: 2 }
    },
      sections.map((item) => h('button', {
        key: item.id, type: 'button', onClick: () => { setMessage(''); setSection(item.id) },
        className: 'tether-hover', 'aria-current': current.id === item.id ? 'page' : undefined,
        style: {
          height: 30, padding: '0 10px', border: 0, borderRadius: 6, textAlign: 'left',
          background: current.id === item.id ? 'var(--dsw-alias-interactive-bg-active, rgba(38,49,72,.10))' : 'transparent',
          color: current.id === item.id ? ink : sub, fontSize: 12.5, cursor: 'pointer', font: 'inherit'
        }
      }, item.label)))
    return h('div', {
      onPointerDown: (event) => { if (event.target === event.currentTarget) onClose() },
      style: { position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(16,24,40,0.35)', display: 'grid', placeItems: 'center', padding: 24 }
    },
      h('section', {
        role: 'dialog', 'aria-label': '设置',
        style: { width: 'min(760px, 100%)', height: 'min(560px, 100%)', background: bg, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--dsw-elevation-panel, 0 18px 50px rgba(16,24,40,0.18))', display: 'flex', flexDirection: 'column' }
      },
        h('header', { style: { height: 44, padding: '0 14px', display: 'flex', alignItems: 'center', background: panel, borderBottom: '1px solid ' + line, flex: '0 0 auto' } },
          h('strong', { style: { fontSize: 14 } }, '设置'),
          h('button', {
            type: 'button', onClick: onClose, title: '关闭', 'aria-label': '关闭', className: 'tether-hover',
            style: { marginLeft: 'auto', width: 28, height: 28, border: 0, borderRadius: 6, background: 'transparent', fontSize: 18, cursor: 'pointer', color: mute }
          }, '×')),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex' } },
          nav,
          h('div', { className: 'tether-scroll', style: { flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: '20px 24px' } }, current.render()))),
      cropModal,
      nameModal,
      passwordModal)
  }
  return { SettingsPanel }
}