import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')

test('one-click device updates keep going after a transient component failure', () => {
  assert.match(source, /const transientUpdateError = \(error\) => \{/)
  assert.match(source, /code === 'device_offline' \|\| code === 'update_busy' \|\| code === 'surface_timeout'/)
  assert.match(source, /const checkUpdateWithRetry = async \(component, scope, attempts = 3\)/)
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, 2000\)\)/)
  assert.match(source, /const checkedApp = await checkUpdateWithRetry\('app', scope\)/)
  assert.match(source, /failures\.push\(component\)/)
  assert.match(source, /failures\.push\('app'\)/)
  assert.match(source, /if \(failures\.length\) setNotice\('部分组件未更新/)
  assert.equal(source.includes('if (!await updateOneClick(component, scope)) return'), false,
    'a failed step must not abort the remaining components')
})

test('a remote plugin that needs a DSH restart is shown instead of up to date', () => {
  assert.match(source, /const pluginRestart = !!\(hasPlugin && plugin && plugin\.restart_required\)/)
  assert.match(source, /pluginRestart \? pill\('插件待重启 DSH', C\.amber\)/)
})

test('the device chain waits for the target DSH to restart after a plugin apply', () => {
  assert.match(source, /const watchPluginRestart = async \(scope, authority\)/)
  assert.match(source, /status\.restart_required !== true\) return true/)
  assert.match(source, /else if \(component === 'plugin'\) \{/)
  assert.match(source, /插件已安装，目标 DSH 尚未完成重启/)
})
