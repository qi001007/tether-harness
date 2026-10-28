import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')

test('the code page renders one row per line with a gutter and a current line', () => {
  assert.match(source, /const highlightLines = \(text, name\) => \{/)
  assert.match(source, /const codeView = \(lines\) => \{/)
  assert.match(source, /className: 'tether-code-row'/)
  assert.match(source, /'data-active': codeLine === index \+ 1 \? 'true' : undefined/)
  assert.match(source, /onClick: \(\) => setCodeLine\(index \+ 1\)/)
  assert.match(source, /className: 'tether-code-lineno'/)
  assert.match(source, /className: 'tether-code-line'/)
  assert.match(source, /className: 'tether-tok-' \+ token\.cls/)
  assert.match(source, /React\.useEffect\(\(\) => \{ setCodeLine\(1\) \}, \[file && file\.path\]\)/)
})

test('very large code files keep the plain gutter fallback instead of per-line rows', () => {
  assert.match(source, /if \(text\.length > MAX_HIGHLIGHT_CHARS \|\| text\.split\(String\.fromCharCode\(10\)\)\.length > MAX_HIGHLIGHT_LINES\) return null/)
  assert.match(source, /const highlighted = highlightLines\(draft, file\.name\)\s*if \(highlighted\) return codeView\(highlighted\)/)
  assert.match(source, /Very large files skip per-line rendering/)
})

test('an open file gets a tab strip with its own close action', () => {
  assert.match(source, /className: 'tether-tabbar'/)
  assert.match(source, /className: 'tether-tab', title: file\.path/)
  assert.match(source, /'aria-label': '关闭文件', onClick: closePreview/)
  assert.match(source, /fileTabBar, previewBody\(\)/)
})

test('the file tree and the editor are separated by a visible splitter', () => {
  assert.match(source, /--tether-split: var\(--dsw-alias-border-l2, rgba\(9, 30, 66, 0\.16\)\)/)
  assert.match(source, /body\[data-ds-dark-theme\] \.tether-root \{[\s\S]*?--tether-split: rgba\(255, 255, 255, 0\.12\)/)
  assert.match(source, /className: 'tether-resizer tether-side-split'/)
  assert.match(source, /--tether-code-keyword: #569cd6/)
  assert.match(source, /--tether-tabstrip: color-mix/)
})
