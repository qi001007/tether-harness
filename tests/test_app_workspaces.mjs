import assert from 'node:assert/strict'
import test from 'node:test'
import { validateWorkspaceResponse, workspaceStateAfterLoadFailure } from '../packages/tether-ui/src/app.js'

test('a valid empty workspace list remains an empty list', () => {
  const response = { workspaces: [] }
  assert.equal(validateWorkspaceResponse(response), response)
  assert.deepEqual(response.workspaces, [])
})

test('a missing workspace list is rejected instead of treated as empty', () => {
  assert.throws(() => validateWorkspaceResponse({ error: 'offline' }), /工作区接口返回的数据格式无效/)
})

test('a non-array workspace value is rejected', () => {
  assert.throws(() => validateWorkspaceResponse({ workspaces: null }), /工作区接口返回的数据格式无效/)
})

test('an unsuccessful response is rejected', () => {
  assert.throws(() => validateWorkspaceResponse({ ok: false, workspaces: [] }), /工作区接口返回的数据格式无效/)
})

test('workspace entries must provide a string path', () => {
  for (const workspace of [null, {}, { path: 12 }]) {
    assert.throws(() => validateWorkspaceResponse({ workspaces: [workspace] }), /工作区接口返回的数据格式无效/)
  }
})

test('same-device failures keep the loaded workspace selection instead of replacing it with a fallback', () => {
  const projects = { workspaces: [{ path: 'D:\\Work\\selected' }] }
  const project = projects.workspaces[0]
  const result = workspaceStateAfterLoadFailure({ projects, project, loadedDeviceId: 'device-a', requestDeviceId: 'device-a', fallbackPath: 'D:\\Work\\fallback' })
  assert.equal(result.synthetic, false)
  assert.equal(result.projects, projects)
  assert.equal(result.project, project)
})

test('device changes can use the fallback when no workspace list belongs to the requested device', () => {
  const result = workspaceStateAfterLoadFailure({ projects: null, project: null, loadedDeviceId: '', requestDeviceId: 'device-b', fallbackPath: 'E:\\Work\\fallback' })
  assert.equal(result.synthetic, true)
  assert.deepEqual(result.projects.workspaces, [result.project])
  assert.equal(result.project.path, 'E:\\Work\\fallback')
})
