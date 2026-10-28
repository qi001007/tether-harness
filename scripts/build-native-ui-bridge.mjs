import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = resolve(root, '.runtime/npm/node_modules/@deepseek-ai')
const outputPath = resolve(root, 'packages/tether-dsh-native-ui/lib/client.js')

const modules = [
  {
    id: '@deepseek-ai/dsh-client-ui-chat',
    exports: {
      MarkdownText: '_deepseek_ai_dsh_client_ui_primitives.MarkdownText',
      FileTypeIcon: '_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon',
      IconFolderOpenRegular: '_deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular',
      IconFolderCloseRegular: '_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular',
      IconChevronRightOutlineRegular: '_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular',
      IconChevronDownOutlineRegular: '_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular',
      DisclosureRow: '_deepseek_ai_dsh_client_ui_primitives.DisclosureRow',
      UserStyleBubble: 'UserStyleBubble',
      UserContent: 'UserContent',
      ReasoningRow: 'ReasoningRow',
      TurnProcessNodeView: 'TurnProcessNodeView',
      ProcessGroupHeader: 'ProcessGroupHeader',
      ChatGroupSeat_module_css_default: 'ChatGroupSeat_module_css_default',
      RunningStatus: 'RunningStatus',
      markdownLabels: 'markdownLabels'
    },
    version: '0.2.1-rc.2'
  },
  {
    id: '@deepseek-ai/dsh-client-ui-workspace',
    exports: { ProjectRowItem: 'ProjectRowItem', SessionNodeItem: 'SessionNodeItem' },
    version: '0.2.1-rc.2'
  },
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar-files',
    exports: { FileEntryRow: 'Entry' },
    version: '0.2.1-rc.2'
  },
  {
    id: '@deepseek-ai/dsh-client-ui-tool',
    exports: { GenericToolCard: 'GenericToolCard', toolRowModel: 'toolRowModel' },
    version: '0.2.1-rc.2'
  },
  {
    id: '@deepseek-ai/dsh-client-ui-attachment',
    exports: { ComposerAttachments: 'ComposerAttachments' },
    version: '0.2.1-rc.2'
  }
]

function extractFactory(source, moduleId) {
  const startToken = `id: "${moduleId}",\n\tfactory: (require) => {`
  const start = source.indexOf(startToken)
  if (start < 0) throw new Error(`Factory not found: ${moduleId}`)
  const bodyStart = start + startToken.length
  const terminator = '\n\t\treturn module.exports;\n\t}\n});'
  const bodyEnd = source.indexOf(terminator, bodyStart)
  if (bodyEnd < 0) throw new Error(`Factory terminator not found: ${moduleId}`)
  return source.slice(bodyStart, bodyEnd).replace(/\s+$/, '')
}

function extractZh(source, moduleLabel) {
  const start = source.indexOf('const zh = {')
  if (start < 0) throw new Error(`Chinese locale object not found: ${moduleLabel}`)
  const objectStart = source.indexOf('{', start)
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return source.slice(objectStart, index + 1) + ';'
  }
  throw new Error(`Chinese locale object did not close: ${moduleLabel}`)
}

function extractConstStatement(source, name, moduleLabel) {
  const start = source.indexOf(`const ${name} =`)
  if (start < 0) throw new Error(`Locale constant not found: ${moduleLabel}.${name}`)
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === ';') return source.slice(start, index + 1)
  }
  throw new Error(`Locale constant did not close: ${moduleLabel}.${name}`)
}

const sourceMap = {
  '@deepseek-ai/dsh-client-ui-chat': resolve(runtime, 'dsh-client-ui-chat/lib/client.js'),
  '@deepseek-ai/dsh-client-ui-workspace': resolve(runtime, 'dsh-client-ui-workspace/lib/client.js'),
  '@deepseek-ai/dsh-client-ui-sidebar-files': resolve(runtime, 'dsh-client-ui-sidebar-files/lib/client.js'),
  '@deepseek-ai/dsh-client-ui-tool': resolve(runtime, 'dsh-client-ui-tool/lib/client.js'),
  '@deepseek-ai/dsh-client-ui-attachment': resolve(runtime, 'dsh-client-ui-attachment/lib/client.js'),
  '@deepseek-ai/dsh-client-ui-conversation': resolve(runtime, 'dsh-client-ui-conversation/lib/client.js')
}

const chunks = []
const hashes = []
for (const module of modules) {
  const path = sourceMap[module.id]
  const source = await readFile(path, 'utf8')
  const manifest = JSON.parse(await readFile(resolve(dirname(path), '../package.json'), 'utf8'))
  if (manifest.version !== module.version || manifest.license !== 'MIT') {
    throw new Error(`Unexpected source metadata for ${module.id}: ${manifest.version}, ${manifest.license}`)
  }
  hashes.push(`${module.id} ${manifest.version} sha256:${createHash('sha256').update(source).digest('hex')}`)
  const variable = module.id.endsWith('chat') ? 'chat'
    : module.id.endsWith('workspace') ? 'workspace'
      : module.id.endsWith('sidebar-files') ? 'files'
        : module.id.endsWith('attachment') ? 'attachment' : 'tool'
  const requested = Object.entries(module.exports).map(([name, value]) => {
    if (variable === 'files' && name === 'FileEntryRow') {
      return `FileEntryRow: (props) => {
        const item = Entry(props)
        if (props.entry.type !== "directory") return item.props.children
        const button = item.props.children[0]
        const children = button.props.children
        const Icon = props.expanded ? _deepseek_ai_dsh_client_ui_primitives.IconFolderOpenRegular : _deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular
        return React.cloneElement(button, { "aria-expanded": !!props.expanded }, React.createElement(Icon, children[0].props), children[1])
      }`
    }
    return `${name}: ${value}`
  }).join(',\n      ')
  let factory = extractFactory(source, module.id)
  if (module.id.endsWith('workspace')) {
    const replacements = [
      ['function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t })', 'function SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t, disableActions = false })'],
      ['onDoubleClick: row.blank ? void 0 : (e) => {', 'onDoubleClick: row.blank || disableActions ? void 0 : (e) => {'],
      ['!row.blank && (0, react_jsx_runtime.jsxs)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,', '!row.blank && !disableActions && (0, react_jsx_runtime.jsxs)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,']
    ]
    for (const [before, after] of replacements) {
      if (!factory.includes(before)) throw new Error(`Expected workspace patch target missing: ${before.slice(0, 70)}`)
      factory = factory.replace(before, after)
    }
  }
  if (module.id.endsWith('attachment')) {
    if (!factory.includes('function ComposerAttachments(')) throw new Error('Installed attachment component is missing')
    factory = factory.replace('return module.exports;', 'exports.ComposerAttachments = ComposerAttachments;\n\t\treturn module.exports;')
  }
  chunks.push(`    const ${variable} = (() => {\n${factory}\n      return { ${requested} }\n    })()`)
}

const chatZhSource = await readFile(sourceMap['@deepseek-ai/dsh-client-ui-chat'], 'utf8')
const workspaceZhSource = await readFile(sourceMap['@deepseek-ai/dsh-client-ui-workspace'], 'utf8')
const toolZhSource = await readFile(sourceMap['@deepseek-ai/dsh-client-ui-conversation'], 'utf8')
const toolZhPrelude = extractConstStatement(toolZhSource, 'PLAN_NEXT_ACTION_ZH', 'tool')
const toolLocaleManifest = JSON.parse(await readFile(resolve(dirname(sourceMap['@deepseek-ai/dsh-client-ui-conversation']), '../package.json'), 'utf8'))
if (toolLocaleManifest.version !== '0.2.1-rc.2' || toolLocaleManifest.license !== 'MIT') {
  throw new Error(`Unexpected source metadata for tool locale: ${toolLocaleManifest.version}, ${toolLocaleManifest.license}`)
}
hashes.push(`@deepseek-ai/dsh-client-ui-conversation ${toolLocaleManifest.version} sha256:${createHash('sha256').update(toolZhSource).digest('hex')}`)
const prelude = `// Generated by scripts/build-native-ui-bridge.mjs. Do not edit by hand.\n// Source integrity:\n${hashes.map((line) => `// ${line}`).join('\n')}\nwindow.__ModuleLoader__.load({\n  id: 'tether-dsh-native-ui',\n  factory: (require) => {\n    const React = require('react')\n    const h = React.createElement\n${chunks.join('\n')}\n    const chatZh = ${extractZh(chatZhSource, 'chat')}\n    const workspaceZh = ${extractZh(workspaceZhSource, 'workspace')}\n    ${toolZhPrelude}\n    const toolZh = ${extractZh(toolZhSource, 'tool')}\n    return { ...chat, ...workspace, ...files, ...tool, ...attachment, chatZh, workspaceZh, toolZh, inject: [], apply() {} }\n  }\n})\n`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, prelude)
await writeFile(resolve(root, 'packages/tether-dsh-native-ui/lib/index.js'), "export const name = 'tether-dsh-native-ui'\nexport function apply() {}\n")
console.log(`Generated ${outputPath}`)
console.log(hashes.join('\n'))
