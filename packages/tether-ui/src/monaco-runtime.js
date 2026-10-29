import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/powershell/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/php/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/swift/register.js'
import 'monaco-editor/languages/definitions/kotlin/register.js'
import 'monaco-editor/languages/definitions/lua/register.js'
import 'monaco-editor/languages/definitions/r/register.js'
import 'monaco-editor/languages/definitions/perl/register.js'
import 'monaco-editor/languages/definitions/dart/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/less/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'

const WORKER_SOURCE = __TETHER_MONACO_WORKER_SOURCE__
let workerUrl = ''

function editorWorkerUrl() {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  }
  return workerUrl
}

globalThis.MonacoEnvironment = {
  getWorker() {
    return new Worker(editorWorkerUrl(), { name: 'tether-monaco-editor' })
  }
}

monaco.editor.defineTheme('tether-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0000FF' },
    { token: 'string', foreground: 'A31515' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267F99' },
    { token: 'type.identifier', foreground: '267F99' },
    { token: 'function', foreground: '795E26' },
    { token: 'variable', foreground: '001080' },
    { token: 'tag', foreground: '800000' },
    { token: 'attribute.name', foreground: 'E50000' }
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#1F1F1F',
    'editorGutter.background': '#F7F7F8',
    'editorLineNumber.foreground': '#929292',
    'editorLineNumber.activeForeground': '#292929',
    'editor.lineHighlightBackground': '#F3F3F3',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#D7D7D788',
    'editor.inactiveSelectionBackground': '#E5E5E588',
    'editorCursor.foreground': '#1F1F1F',
    'editorIndentGuide.background1': '#E1E1E1',
    'editorIndentGuide.activeBackground1': '#A8A8A8',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#D6D6D6',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.border': '#D6D6D6',
    'editorSuggestWidget.selectedBackground': '#E7E7E7',
    'scrollbarSlider.background': '#8080802E',
    'scrollbarSlider.hoverBackground': '#80808055',
    'scrollbarSlider.activeBackground': '#60606070'
  }
})

monaco.editor.defineTheme('tether-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'tag', foreground: '569CD6' },
    { token: 'attribute.name', foreground: '9CDCFE' }
  ],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#D4D4D4',
    'editorGutter.background': '#232325',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#C6C6C6',
    'editor.lineHighlightBackground': '#252525',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#5A5A5A88',
    'editor.inactiveSelectionBackground': '#45454588',
    'editorCursor.foreground': '#E6E6E6',
    'editorIndentGuide.background1': '#404040',
    'editorIndentGuide.activeBackground1': '#707070',
    'editorWidget.background': '#252526',
    'editorWidget.border': '#454545',
    'editorSuggestWidget.background': '#252526',
    'editorSuggestWidget.border': '#454545',
    'editorSuggestWidget.selectedBackground': '#3A3A3A',
    'scrollbarSlider.background': '#79797933',
    'scrollbarSlider.hoverBackground': '#79797966',
    'scrollbarSlider.activeBackground': '#9A9A9A88'
  }
})

export function languageForPath(path) {
  const lower = String(path || '').toLowerCase()
  const name = lower.split(/[\\/]/).pop() || ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  return ({
    '.py': 'python', '.pyw': 'python', '.js': 'javascript', '.mjs': 'javascript',
    '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json', '.css': 'css', '.scss': 'scss', '.less': 'less', '.html': 'html',
    '.htm': 'html', '.md': 'markdown', '.markdown': 'markdown', '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.java': 'java', '.xml': 'xml',
    '.yml': 'yaml', '.yaml': 'yaml', '.sql': 'sql', '.sh': 'shell', '.bat': 'bat',
    '.ps1': 'powershell', '.ini': 'ini', '.toml': 'ini', '.go': 'go', '.rs': 'rust'
  })[extension] || 'plaintext'
}

export function modelUri(deviceId, path) {
  const device = encodeURIComponent(String(deviceId || 'unknown'))
  const normalized = String(path || 'untitled.txt').replace(/\\/g, '/').replace(/^\/+/, '')
  return monaco.Uri.parse(`tether://${device}/${normalized}`)
}

export function preferredTheme() {
  if (typeof document === 'undefined') return 'tether-light'
  const dark = !!(document.body && document.body.hasAttribute('data-ds-dark-theme'))
    || !!(document.documentElement && document.documentElement.hasAttribute('data-ds-dark-theme'))
  return dark ? 'tether-dark' : 'tether-light'
}

function watchHostTheme() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const apply = () => {
    try { monaco.editor.setTheme(preferredTheme()) } catch (_) { /* no editor yet */ }
  }
  const observer = new MutationObserver(apply)
  const options = { attributes: true, attributeFilter: ['data-ds-dark-theme'] }
  observer.observe(document.documentElement, options)
  if (document.body) observer.observe(document.body, options)
}

watchHostTheme()

export { monaco }
