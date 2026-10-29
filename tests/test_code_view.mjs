import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../packages/tether-ui/src/app.js', import.meta.url), 'utf8')
const monacoSource = fs.readFileSync(new URL('../packages/tether-ui/src/monaco-runtime.js', import.meta.url), 'utf8')

test('code rendering has one Monaco path instead of a second handwritten highlighter', () => {
  assert.equal(source.includes('const highlightLines ='), false)
  assert.equal(source.includes('const codeView ='), false)
  assert.equal(source.includes("className: 'tether-code-row'"), false)
  assert.match(source, /if \(codeEditorFile\) return h\(CodeEditor/)
})

test('an open file gets a tab strip with its own close action', () => {
  assert.match(source, /className: 'tether-tabbar'/)
  assert.match(source, /className: 'tether-tab', title: file\.path/)
  assert.match(source, /className: 'tether-file-badge'/)
  assert.match(source, /className: 'tether-tab-title'/)
  assert.match(source, /function fileTypeMark\(name\)/)
  assert.match(source, /'aria-label': '关闭文件', onClick: closePreview/)
  assert.match(source, /fileTabBar, previewBody\(\)/)
  assert.equal(source.includes("className: 'tether-tab-accent'"), false, 'file tabs do not use a coloured accent strip')
  assert.equal(source.includes("h(Glyph, { name: 'file', size: 14 })"), false, 'the active file tab does not use the generic file glyph')
})

test('adjacent panes separate by colour instead of visible divider lines', () => {
  assert.match(source, /className: 'tether-resizer tether-side-split'/)
  assert.match(source, /--tether-tabstrip: #ececee/)
  assert.equal(source.includes("boxShadow: 'inset -1px 0 0 var(--tether-split)'"), false, 'sidebar has no divider shadow')
  assert.equal(source.includes("borderRight: '1px solid var(--tether-split)'"), false, 'no hard pane borders')
  assert.equal(source.includes("border-bottom: 1px solid var(--tether-split)"), false, 'no hard tab/status borders')
  assert.match(source, /\.tether-side-split::after \{[^}]*background: transparent/)
})

test('the file workspace uses distinct colour layers without hard pane borders', () => {
  assert.match(source, /--tether-topbar-bg:/)
  assert.match(source, /--tether-activity-bg:/)
  assert.match(source, /--tether-explorer-bg:/)
  assert.match(source, /--tether-command-bg:/)
  assert.match(source, /--tether-workbench-bg:/)
  assert.match(source, /--tether-status-bg:/)
  assert.match(source, /className: 'tether-activitybar'/)
  assert.match(source, /className: 'tether-sidebar'/)
  assert.match(source, /className: 'tether-workbench'/)
  assert.match(source, /className: 'tether-explorer-toolbar'/)
  assert.match(source, /className: 'tether-breadcrumbs'/)
  assert.match(source, /className: 'tether-editor-status'/)
  assert.match(source, /--tether-status-bg: #ececee/)
  assert.match(source, /--tether-explorer-bg: #efeff1/)
  assert.match(source, /--tether-tree-selected: #dedfe2/)
  assert.match(source, /\.tether-activity-button\[data-selected=true\] \{ color: var\(--tether-chrome-ink\)/)
  assert.equal(source.includes('--tether-status-bg: #1f6feb'), false, 'light workbench has no blue status strip')
  assert.equal(source.includes('--tether-status-bg: #1158a6'), false, 'dark workbench has no blue status strip')
  assert.equal(source.includes("borderRight: '1px solid"), false, 'workspace panes stay borderless')
})

test('ordinary code files open Monaco directly with no preview switch', () => {
  assert.match(source, /function CodeEditor\(\{ deviceId, path, value, onChange, onSave, encoding, newline/)
  assert.match(source, /monaco\.editor\.create\(containerRef\.current/)
  assert.match(source, /tabSize: 2, insertSpaces: true/)
  assert.match(source, /minimap: \{ enabled: true, renderCharacters: false/)
  assert.match(source, /lineDecorationsWidth: 22, renderLineHighlight: 'line'/)
  assert.equal(source.includes("renderLineHighlight: 'all'"), false, 'active line background must not cover the line-number gutter')
  assert.equal(source.includes('--tether-editor-rule'), false, 'gutter spacing must use color difference instead of a visible divider')
  assert.match(source, /\.tether-monaco-editor \.monaco-editor \.margin::after \{[^}]*width: 13px;[^}]*background: var\(--tether-workbench-bg\)/)
  assert.equal(source.includes('border-left: 1px solid var(--tether-editor-rule)'), false, 'gutter and code must not have an artificial divider line')
  assert.match(source, /fontLigatures: true/)
  assert.match(source, /monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS/)
  assert.match(source, /callbacksRef\.current\.onSave\(\)/)
  assert.match(source, /const key = deviceId \+ '\|' \+ path/)
  assert.match(source, /const codeEditorFile = !!\(file && file\.kind === 'text' && CODE_FILE\.test/)
  assert.match(source, /if \(codeEditorFile\) return h\(CodeEditor/)
  assert.equal(/editableFile && !\(tablePreview && tableView\) \? iconButton\(editMode/.test(source), false,
    'ordinary editable files do not expose a preview/edit switch')
  assert.match(source, /window\.addEventListener\('keydown', onKey\)/)
})

test('only renderable files expose a view switch and markdown edits in Monaco', () => {
  assert.match(source, /const markdownCanToggle = !!\(file && file\.kind === 'markdown' && editableFile\)/)
  assert.match(source, /markdownCanToggle \? iconButton\(editMode \? 'eye' : 'pencil', editMode \? '预览 Markdown' : '编辑 Markdown'/)
  assert.match(source, /if \(file\.kind === 'markdown'\) \{\s*if \(editMode\) return h\(CodeEditor/)
  assert.match(source, /tablePreview && !tableEdit \? h\('div', \{ className: 'tether-viewtoggle'/)
})

test('Monaco registers common languages and uses a VSCode-like syntax palette', () => {
  for (const language of ['ini', 'yaml', 'xml', 'sql', 'shell', 'powershell', 'go', 'rust', 'csharp', 'php', 'ruby', 'lua']) {
    assert.match(monacoSource, new RegExp(`languages/definitions/${language}/register\\.js`), language + ' is registered')
  }
  assert.match(monacoSource, /'\.toml': 'ini'/)
  assert.match(monacoSource, /\{ token: 'keyword', foreground: '0000FF' \}/)
  assert.match(monacoSource, /\{ token: 'string', foreground: 'A31515' \}/)
  assert.match(monacoSource, /\{ token: 'comment', foreground: '008000'/)
  assert.match(monacoSource, /\{ token: 'keyword', foreground: '569CD6' \}/)
  assert.match(monacoSource, /\{ token: 'string', foreground: 'CE9178' \}/)
  assert.match(monacoSource, /'editor\.selectionBackground': '#D7D7D788'/)
  assert.match(monacoSource, /'editorGutter\.background': '#F7F7F8'/)
  assert.match(monacoSource, /'editorGutter\.background': '#232325'/)
  assert.match(monacoSource, /'editorLineNumber\.activeForeground': '#292929'/)
})

test('dirty edits ask before closing or switching files', () => {
  assert.match(source, /if \(dirty && !window\.confirm\('有未保存的修改，确定关闭？'\)\) return/)
  assert.match(source, /if \(dirty && file && file\.path !== entry\.path && !window\.confirm\('有未保存的修改，确定打开其他文件？'\)\) return/)
})
