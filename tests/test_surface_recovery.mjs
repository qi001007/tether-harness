import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const clientSource = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const preloadSource = fs.readFileSync(new URL('../apps/tether-app/preload.js', import.meta.url), 'utf8')
const mainSource = fs.readFileSync(new URL('../apps/tether-app/main.js', import.meta.url), 'utf8')

test('surface retry delays back off and stay bounded', () => {
  const start = clientSource.indexOf('    const NATIVE_SURFACE_RETRIES = 3')
  const end = clientSource.indexOf('\n\n    function NativeSurface(', start)
  assert.ok(start >= 0 && end > start, 'surface retry helpers are present')
  const helpers = vm.runInNewContext(clientSource.slice(start, end)
    + '\n;({ NATIVE_SURFACE_RETRIES, nativeSurfaceRetryDelay, nativeSurfaceFailureMatches, nativeSurfaceTransientError })', { URL })
  assert.equal(helpers.NATIVE_SURFACE_RETRIES, 3)
  assert.equal(helpers.nativeSurfaceRetryDelay(1), 1000)
  assert.equal(helpers.nativeSurfaceRetryDelay(2), 2000)
  assert.equal(helpers.nativeSurfaceRetryDelay(3), 4000)
  assert.equal(helpers.nativeSurfaceRetryDelay(9), 8000)
  assert.equal(helpers.nativeSurfaceFailureMatches('https://g46285.example.test/?tether_native=1', 'https://g46285.example.test/assets/index.js'), true)
  assert.equal(helpers.nativeSurfaceFailureMatches('https://g46285.example.test/', 'https://g00001.example.test/assets/index.js'), false)
  assert.equal(helpers.nativeSurfaceFailureMatches('https://g46285.example.test/', '/assets/index.js'), false)
  assert.equal(helpers.nativeSurfaceFailureMatches('', 'https://g46285.example.test/assets/index.js'), false)
  assert.equal(helpers.nativeSurfaceTransientError({ surfaceStatus: 502 }), true)
  assert.equal(helpers.nativeSurfaceTransientError({ surfaceStatus: 504 }), true)
  assert.equal(helpers.nativeSurfaceTransientError({ surfaceCode: 'device_offline' }), true)
  assert.equal(helpers.nativeSurfaceTransientError({ surfaceCode: 'surface_timeout' }), true)
  assert.equal(helpers.nativeSurfaceTransientError({ surfaceCode: 'node_update_required' }), false)
  assert.equal(helpers.nativeSurfaceTransientError(null), false)
})

test('surface boot failures reach the renderer through the preload bridge', () => {
  assert.match(preloadSource, /onSurfaceBootFailed/)
  assert.match(preloadSource, /tether:surface-boot-failed/)
  assert.match(mainSource, /isSurfaceBootFailure/)
  assert.match(mainSource, /tether:surface-boot-failed/)
  assert.match(clientSource, /onSurfaceBootFailed/)
  assert.match(clientSource, /nativeSurfaceFailureMatches/)
  assert.match(clientSource, /DSH 工作区启动失败/)
})
