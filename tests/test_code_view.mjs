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
  assert.match(source, /className: 'tether-code-gutter'/)
  assert.match(source, /className: 'tether-code-gutter-row'/)
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

test('adjacent panes separate by colour instead of visible divider lines', () => {
  assert.match(source, /--tether-code-keyword: #1a5fb4/)
  assert.match(source, /--tether-code-string: #2f855a/)
  assert.match(source, /--tether-code-number: #6b46c1/)
  assert.match(source, /--tether-code-comment: #667085/)
  assert.match(source, /--tether-code-keyword: #7aa2f7/)
  assert.match(source, /--tether-code-string: #9ece6a/)
  assert.match(source, /--tether-code-number: #bb9af7/)
  assert.match(source, /className: 'tether-resizer tether-side-split'/)
  assert.match(source, /--tether-tabstrip: color-mix/)
  assert.equal(source.includes("boxShadow: 'inset -1px 0 0 var(--tether-split)'"), false, 'sidebar has no divider shadow')
  assert.equal(source.includes("borderRight: '1px solid var(--tether-split)'"), false, 'no hard pane borders')
  assert.equal(source.includes("border-bottom: 1px solid var(--tether-split)"), false, 'no hard tab/status borders')
  assert.match(source, /\.tether-side-split::after \{[^}]*background: transparent/)
  assert.match(source, /\.tether-code-gutter \{ position: sticky; left: 0;[^}]*background: var\(--tether-code-gutter\)/)
  assert.match(source, /style: \{ width: gutterWidth, minHeight: '100%' \}/)
})

test('code files open an editor with gutter, tab insert and Ctrl+S save', () => {
  assert.match(source, /function CodeEditor\(\{ value, onChange, onSave, font \}\)/)
  assert.match(source, /className: 'tether-code-gutter', style: \{ width: gutterWidth, overflow: 'hidden' \}/)
  assert.match(source, /el\.setRangeText\('  ', el\.selectionStart, el\.selectionEnd, 'end'\)/)
  assert.match(source, /String\(event\.key\)\.toLowerCase\(\) === 's'/)
  assert.match(source, /onSave\(\)/)
  assert.match(source, /\(file\.kind === 'markdown' \|\| file\.kind === 'text'\) && file\.writable && !\(tablePreview && tableView\) \? iconButton\(editMode/)
  assert.match(source, /if \(editMode && CODE_FILE\.test\(String\(file\.name \|\| ''\)\)\) return h\(CodeEditor/)
  assert.match(source, /window\.addEventListener\('keydown', onKey\)/)
})

test('dirty edits ask before closing or switching files', () => {
  assert.match(source, /if \(dirty && !window\.confirm\('有未保存的修改，确定关闭？'\)\) return/)
  assert.match(source, /if \(dirty && file && file\.path !== entry\.path && !window\.confirm\('有未保存的修改，确定打开其他文件？'\)\) return/)
})
