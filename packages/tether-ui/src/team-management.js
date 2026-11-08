export function createTeamManagementPage(React) {
  const h = React.createElement
  const PERMISSIONS = [
    ['files.read', '文件读取'],
    ['files.write', '文件写入'],
    ['agent.use', 'Agent 使用'],
    ['terminal.use', '终端使用'],
      ['remote_desktop.use', '远程桌面'],
    ['workbench:dsh', 'DSH 工作区'],
    ['workbench:codeg', 'Codeg 工作区'],
    ['workbench:herdr', 'Herdr 终端'],
    ['workbench:files', '工作区文件']
  ]
  const roleName = (role) => ({ owner: '所有者', admin: '管理员', member: '成员' }[role] || role || '成员')
  const errorText = (error) => String((error && error.message) || error || '请求失败')

  function TeamManagementPage({ api, post, devices = [], userId = '', onStateChanged }) {
    const [teams, setTeams] = React.useState([])
    const [teamId, setTeamId] = React.useState('')
    const [members, setMembers] = React.useState([])
    const [shares, setShares] = React.useState([])
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [teamName, setTeamName] = React.useState('')
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [inviteRole, setInviteRole] = React.useState('member')
    const [inviteToken, setInviteToken] = React.useState('')
    const [issuedToken, setIssuedToken] = React.useState('')
    const [deviceId, setDeviceId] = React.useState('')
    const [permissions, setPermissions] = React.useState(['files.read'])
    const [allowedRoots, setAllowedRoots] = React.useState('')
    const requestEpoch = React.useRef(0)
    const selectedTeam = teams.find((team) => team.team_id === teamId) || null
    const ownDevices = devices.filter((device) => device && device.device_id && device.owner_id === userId)
    const ownerDeviceById = new Map(ownDevices.map((device) => [device.device_id, device]))
    const manager = !!selectedTeam && ['owner', 'admin'].includes(selectedTeam.role)
    const selectedShare = shares.find((share) => share.device_id === deviceId) || null
    const style = {
      field: { height: 32, minWidth: 0, boxSizing: 'border-box', border: '1px solid #e4e7ec', borderRadius: 6, padding: '0 9px', background: '#fff', color: '#101828', fontSize: 12 },
      button: { height: 30, padding: '0 10px', border: 0, borderRadius: 6, background: '#f2f4f7', color: '#344054', fontSize: 12, cursor: 'pointer' },
      primary: { height: 30, padding: '0 11px', border: 0, borderRadius: 6, background: '#101828', color: '#fff', fontSize: 12, cursor: 'pointer' },
      card: { padding: 12, border: '1px solid #eaecf0', borderRadius: 8, background: '#fff' },
      muted: { color: '#667085', fontSize: 11.5, lineHeight: 1.55 }
    }

    const readJson = async (path) => api(path)
    const send = async (path, method, body) => api(path, {
      method,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) })
    })
    const refresh = async (preferredTeam = teamId) => {
      const epoch = ++requestEpoch.current
      setBusy(true); setError('')
      try {
        const result = await readJson('/api/teams')
        if (epoch !== requestEpoch.current) return
        const rows = Array.isArray(result && result.teams) ? result.teams : []
        setTeams(rows)
        const nextId = rows.some((item) => item.team_id === preferredTeam) ? preferredTeam : (rows[0] && rows[0].team_id) || ''
        setTeamId(nextId)
        if (nextId) {
          const [memberResult, shareResult] = await Promise.all([
            readJson('/api/teams/' + encodeURIComponent(nextId) + '/members'),
            readJson('/api/teams/' + encodeURIComponent(nextId) + '/shares')
          ])
          if (epoch !== requestEpoch.current) return
          setMembers(Array.isArray(memberResult && memberResult.members) ? memberResult.members : [])
          setShares(Array.isArray(shareResult && shareResult.shares) ? shareResult.shares : [])
        } else { setMembers([]); setShares([]) }
      } catch (requestError) {
        if (epoch === requestEpoch.current) setError(errorText(requestError))
      } finally {
        if (epoch === requestEpoch.current) setBusy(false)
      }
    }

    React.useEffect(() => { void refresh('') }, [])
    React.useEffect(() => {
      setPermissions(selectedShare ? (selectedShare.permissions || []) : ['files.read'])
      setAllowedRoots(selectedShare ? (selectedShare.allowed_roots || []).join('\n') : '')
    }, [deviceId, teamId, selectedShare])

    const act = async (operation) => {
      setBusy(true); setError('')
      try { await operation() } catch (requestError) { setError(errorText(requestError)) }
      finally { setBusy(false) }
    }
    const createTeam = (event) => {
      event.preventDefault()
      const name = teamName.trim()
      if (!name) { setError('请输入团队名称。'); return }
      void act(async () => {
        const result = await send('/api/teams', 'POST', { name })
        setTeamName('')
        const createdId = result && result.team && result.team.team_id
        await refresh(createdId || '')
      })
    }
    const issueInvite = (event) => {
      event.preventDefault()
      if (!teamId || !manager) return
      void act(async () => {
        const result = await send('/api/teams/' + encodeURIComponent(teamId) + '/invites', 'POST', {
          email: inviteEmail.trim() || undefined, role: inviteRole
        })
        setIssuedToken(String(result && result.token || ''))
        setInviteEmail('')
      })
    }
    const acceptInvite = (event) => {
      event.preventDefault()
      if (!inviteToken.trim()) { setError('请输入邀请令牌。'); return }
      void act(async () => {
        const result = await send('/api/teams/invites/accept', 'POST', { token: inviteToken.trim() })
        setInviteToken(''); setIssuedToken('')
        await refresh(result && result.team_id || '')
        if (onStateChanged) await onStateChanged()
      })
    }
    const removeMember = (member) => {
      if (!teamId || !member || member.role === 'owner') return
      if (!window.confirm(member.user_id === userId ? '退出此团队？当前共享设备权限会随成员关系撤销。' : '移除此团队成员？其共享设备权限会随成员关系撤销。')) return
      void act(async () => {
        await send('/api/teams/' + encodeURIComponent(teamId) + '/members/' + encodeURIComponent(member.user_id), 'DELETE')
        if (member.user_id === userId) await refresh('')
        else await refresh(teamId)
        if (onStateChanged) await onStateChanged()
      })
    }
    const togglePermission = (permission) => {
      setPermissions((current) => current.includes(permission)
        ? current.filter((item) => item !== permission) : [...current, permission])
    }
    const saveShare = (event) => {
      event.preventDefault()
      if (!teamId || !deviceId || !permissions.length) { setError('请选择设备和至少一项共享能力。'); return }
      const roots = allowedRoots.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      if (permissions.some((item) => item === 'files.read' || item === 'files.write') && !roots.length) {
        setError('文件读取或写入需要至少指定一个目标设备绝对路径。')
        return
      }
      void act(async () => {
        await send('/api/teams/' + encodeURIComponent(teamId) + '/shares', 'POST', {
          device_id: deviceId, permissions, allowed_roots: roots
        })
        await refresh(teamId)
        if (onStateChanged) await onStateChanged()
      })
    }
    const revokeShare = (share) => {
      if (!window.confirm('撤销此设备分享？队友将失去对应的访问权限。')) return
      void act(async () => {
        await send('/api/teams/' + encodeURIComponent(teamId) + '/shares/' + encodeURIComponent(share.device_id), 'DELETE')
        await refresh(teamId)
        if (onStateChanged) await onStateChanged()
      })
    }
    const copyToken = async () => {
      try { await navigator.clipboard.writeText(issuedToken) } catch (_) { setError('无法访问剪贴板，请手动复制邀请令牌。') }
    }
    const permissionLabel = (permission) => (PERMISSIONS.find((entry) => entry[0] === permission) || [permission, permission])[1]
    const teamOptions = teams.map((team) => h('option', { key: team.team_id, value: team.team_id },
      (team.name || team.team_id) + ' · ' + roleName(team.role)))
    const sectionTitle = (title, detail) => h('div', { style: { display: 'grid', gap: 3, marginBottom: 9 } },
      h('strong', { style: { color: '#344054', fontSize: 12.5 } }, title), detail ? h('span', { style: style.muted }, detail) : null)
    const memberRows = members.map((member) => h('div', { key: member.user_id, style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, borderTop: '1px solid #f2f4f7' } },
      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#344054', fontSize: 12 } },
        member.display_name || member.email || member.user_id, member.user_id === userId ? ' · 你' : ''),
      h('span', { style: { color: '#667085', fontSize: 11 } }, roleName(member.role)),
      (manager || member.user_id === userId) && member.role !== 'owner' ? h('button', { type: 'button', disabled: busy, onClick: () => removeMember(member), style: style.button },
        member.user_id === userId ? '退出团队' : '移除') : null))
    const shareRows = shares.map((share) => {
      const device = devices.find((item) => item.device_id === share.device_id)
      const mayRevoke = manager || (device && device.owner_id === userId)
      return h('div', { key: share.device_id, style: { ...style.card, display: 'grid', gap: 7 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { flex: '1 1 auto', color: '#344054', fontSize: 12, fontWeight: 600 } }, device && (device.name || device.device_id) || share.device_id),
          mayRevoke ? h('button', { type: 'button', disabled: busy, onClick: () => revokeShare(share), style: { ...style.button, color: '#b42318' } }, '撤销分享') : null),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, (share.permissions || []).map((permission) => h('span', {
          key: permission, style: { padding: '2px 6px', borderRadius: 5, background: '#f2f4f7', color: '#475467', fontSize: 10.5 }
        }, permissionLabel(permission)))),
        (share.allowed_roots || []).length ? h('div', { style: { ...style.muted, overflowWrap: 'anywhere' } }, '文件范围：' + share.allowed_roots.join(' · ')) : null)
    })

    return h('div', { style: { display: 'grid', gap: 14, maxWidth: 620 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('select', { value: teamId, onChange: (event) => { const next = event.target.value; setTeamId(next); setError(''); setIssuedToken(''); void refresh(next) }, disabled: busy || !teams.length, style: { ...style.field, flex: '1 1 auto' } },
          teamOptions.length ? teamOptions : h('option', { value: '' }, '还没有团队')),
        h('button', { type: 'button', disabled: busy, onClick: () => { void refresh(teamId) }, style: style.button }, busy ? '读取中…' : '刷新')),
      error ? h('div', { role: 'alert', style: { padding: '8px 10px', borderRadius: 6, background: '#fef3f2', color: '#b42318', fontSize: 11.5, overflowWrap: 'anywhere' } }, error) : null,
      h('div', { style: style.card },
        sectionTitle('创建团队'),
        h('form', { onSubmit: createTeam, style: { display: 'flex', gap: 8 } },
          h('input', { type: 'text', maxLength: 80, value: teamName, onChange: (event) => setTeamName(event.target.value), placeholder: '团队名称', disabled: busy, style: { ...style.field, flex: '1 1 auto' } }),
          h('button', { type: 'submit', disabled: busy || !teamName.trim(), style: style.primary }, '创建'))),
      h('div', { style: style.card },
        sectionTitle('接受邀请', '粘贴团队所有者或管理员提供的一次性邀请令牌。'),
        h('form', { onSubmit: acceptInvite, style: { display: 'flex', gap: 8 } },
          h('input', { type: 'text', value: inviteToken, onChange: (event) => setInviteToken(event.target.value), placeholder: '邀请令牌', disabled: busy, style: { ...style.field, flex: '1 1 auto' } }),
          h('button', { type: 'submit', disabled: busy || !inviteToken.trim(), style: style.button }, '接受'))),
      selectedTeam ? h(React.Fragment, null,
        h('div', { style: style.card },
          sectionTitle('成员', selectedTeam.name + ' · ' + roleName(selectedTeam.role)),
          memberRows.length ? memberRows : h('div', { style: style.muted }, '暂无成员')),
        manager ? h('div', { style: style.card },
          sectionTitle('邀请成员', '邀请令牌有效期 7 天。系统返回令牌，请通过可信渠道交给被邀请者。'),
          h('form', { onSubmit: issueInvite, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px auto', gap: 8 } },
            h('input', { type: 'email', value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), placeholder: '邮箱（可选）', disabled: busy, style: style.field }),
            h('select', { value: inviteRole, onChange: (event) => setInviteRole(event.target.value), disabled: busy, style: style.field },
              h('option', { value: 'member' }, '成员'), selectedTeam.role === 'owner' ? h('option', { value: 'admin' }, '管理员') : null),
            h('button', { type: 'submit', disabled: busy, style: style.button }, '生成邀请')),
          issuedToken ? h('div', { style: { display: 'grid', gap: 6, marginTop: 10 } },
            h('span', { style: style.muted }, '此令牌只显示在本次创建结果中。'),
            h('div', { style: { display: 'flex', gap: 6 } },
              h('input', { readOnly: true, value: issuedToken, style: { ...style.field, flex: '1 1 auto' } }),
              h('button', { type: 'button', onClick: copyToken, style: style.button }, '复制'))) : null) : null,
        h('div', { style: { ...style.card, display: 'grid', gap: 10 } },
          sectionTitle('设备共享', '只列出你拥有的设备。文件权限必须限定目标设备上的绝对目录。'),
          h('form', { onSubmit: saveShare, style: { display: 'grid', gap: 10 } },
            h('select', { value: deviceId, onChange: (event) => setDeviceId(event.target.value), disabled: busy || !ownDevices.length, style: style.field },
              h('option', { value: '' }, ownDevices.length ? '选择自己的设备' : '当前账号没有可分享设备'),
              ownDevices.map((device) => h('option', { key: device.device_id, value: device.device_id }, (device.name || device.device_id) + (device.online ? ' · 在线' : ' · 离线')))),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 6 } },
              PERMISSIONS.map(([permission, label, enabled = true]) => h('label', { key: permission, title: enabled ? '' : '远控授权接口尚未接入', style: { display: 'flex', alignItems: 'center', gap: 6, color: enabled ? '#475467' : '#98a2b3', fontSize: 11.5 } },
                h('input', { type: 'checkbox', checked: permissions.includes(permission), disabled: busy || !enabled,
                  onChange: () => togglePermission(permission) }), label))),
            permissions.some((item) => item === 'files.read' || item === 'files.write') ? h('label', { style: { display: 'grid', gap: 5, color: '#475467', fontSize: 11.5 } },
              '文件允许目录（每行一个绝对路径）',
              h('textarea', { rows: 3, value: allowedRoots, onChange: (event) => setAllowedRoots(event.target.value), disabled: busy,
                placeholder: '例如：D:/Shared', style: { boxSizing: 'border-box', width: '100%', resize: 'vertical', border: '1px solid #e4e7ec', borderRadius: 6, padding: 8, color: '#344054', fontSize: 11.5 } })) : null,
            h('button', { type: 'submit', disabled: busy || !teamId || !deviceId || !permissions.length, style: style.primary }, selectedShare ? '保存共享权限' : '共享设备'))),
        h('div', { style: style.card },
          sectionTitle('已共享设备'),
          shareRows.length ? h('div', { style: { display: 'grid', gap: 8 } }, shareRows) : h('div', { style: style.muted }, '此团队还没有设备共享'))
      ) : null,
      !teams.length ? h('div', { style: style.muted }, '创建团队后可邀请成员，并共享你拥有的设备。') : null
    )
  }

  return TeamManagementPage
}
