import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { resolvePreviewBody, usablePreviewData } from '../packages/tether-ui/src/app.js'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')

const body = { kind: 'text', text: 'print(1)', path: 'E:\\demo.py' }

test('only bodies carrying a kind count as preview data', () => {
  assert.equal(usablePreviewData(undefined), false)
  assert.equal(usablePreviewData(null), false)
  assert.equal(usablePreviewData('text'), false)
  assert.equal(usablePreviewData({}), false)
  assert.equal(usablePreviewData({ kind: '' }), false)
  for (const kind of ['text', 'markdown', 'image', 'pdf', 'unsupported']) {
    assert.equal(usablePreviewData({ kind }), true)
  }
})

test('an in-flight prefetch body is reused without a second request', async () => {
  let fetches = 0
  const data = await resolvePreviewBody({
    pending: Promise.resolve(body),
    fetchFresh: async () => { fetches += 1; return { kind: 'text', text: 'fresh' } }
  })
  assert.equal(data, body)
  assert.equal(fetches, 0)
})

test('a prefetch that resolves without a body falls back to a fresh request', async () => {
  let fetches = 0
  const data = await resolvePreviewBody({
    pending: Promise.resolve(undefined),
    fetchFresh: async () => { fetches += 1; return body }
  })
  assert.equal(data, body)
  assert.equal(fetches, 1)
})

test('a failed prefetch retries instead of failing the first open', async () => {
  let fetches = 0
  const transient = Object.assign(new Error('native surface request failed'), { status: 502 })
  const data = await resolvePreviewBody({
    pending: Promise.reject(transient),
    fetchFresh: async () => { fetches += 1; return body }
  })
  assert.equal(data, body)
  assert.equal(fetches, 1)
})

test('an aborted open is not turned into a replacement request', async () => {
  let fetches = 0
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  await assert.rejects(resolvePreviewBody({
    pending: Promise.reject(abort),
    fetchFresh: async () => { fetches += 1; return body },
    isAborted: (error) => error && error.name === 'AbortError'
  }), (error) => error.name === 'AbortError')
  assert.equal(fetches, 0)
})

test('a fresh open bypasses a stale prefetch', async () => {
  let fetches = 0
  const data = await resolvePreviewBody({
    pending: Promise.resolve({ kind: 'text', text: 'stale' }),
    fresh: true,
    fetchFresh: async () => { fetches += 1; return body }
  })
  assert.equal(data, body)
  assert.equal(fetches, 1)
})

test('preview caching and application never accept an empty body', () => {
  assert.match(source, /const rememberPreview = \(key, data\) => \{\s*if \(!usablePreviewData\(data\)\) return/)
  assert.match(source, /let cached = opts\.fresh === true \? null : previewCacheRef\.current\.get\(key\)\s*if \(cached && !usablePreviewData\(cached\.data\)\) \{\s*previewCacheRef\.current\.delete\(key\)\s*cached = null/)
  assert.match(source, /if \(!usablePreviewData\(data\)\) throw new Error\('预览数据无效'\)/)
})

test('the prefetch promise itself is what open reuses, and it is cleared by identity', () => {
  assert.match(source, /const request = post\('\/api\/devices\/' \+ encodeURIComponent\(requestDevice\) \+ '\/fs\/preview'/)
  assert.match(source, /previewInflightRef\.current\.set\(key, request\)/)
  assert.match(source, /if \(previewInflightRef\.current\.get\(key\) === request\) previewInflightRef\.current\.delete\(key\)/)
  assert.match(source, /fetchFresh: \(\) => postRetry\('\/api\/devices\/' \+ encodeURIComponent\(requestDevice\) \+ '\/fs\/preview'/)
})
