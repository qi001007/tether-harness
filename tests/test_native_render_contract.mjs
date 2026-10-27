import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { TextDecoder, TextEncoder } from 'node:util'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../packages/dsh-plugin-tether-client/lib/client.js', import.meta.url), 'utf8')
const bridgeSource = fs.readFileSync(new URL('../packages/tether-dsh-native-ui/lib/client.js', import.meta.url), 'utf8')
function extract(name) {
  const start = source.indexOf('    function ' + name + '(')
  assert.notEqual(start, -1, `missing ${name}`)
  const open = source.indexOf('{', source.indexOf(') {', start) + 1)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1).replace(/^    /gm, '')
  }
  throw new Error(`unterminated ${name}`)
}
function extractArrow(name) {
  const start = source.indexOf('      const ' + name + ' = ')
  assert.notEqual(start, -1, `missing ${name}`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = open; i < source.length; i += 1) {
    const character = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return source.slice(start, i + 1).replace(/^      /gm, '')
  }
  throw new Error(`unterminated ${name}`)
}

let expectedHooks = null
let currentHooks = 0
const sandbox = {
  h: (type, props, ...children) => ({ type, props: props || {}, children }),
  Native: {
    TurnProcessNodeView: 'NativeTurnProcessNodeView',
    ProcessGroupHeader: 'NativeProcessGroupHeader',
    ChatGroupSeat_module_css_default: { root: 'native-root', body: 'native-body', expandedBody: 'native-expanded', content: 'native-content' }
  },
  React: {
    useState: (initial) => { currentHooks += 1; return [initial, () => {}] },
    useId: () => 'native-group-body'
  },
  chatT: () => '',
  turnRunning: (turn, live) => turn.state === 'running' || (!turn.ended_at && !!live),
  ProcessRow: 'ProcessRow',
  console
}
vm.runInNewContext(extract('ProcessGroup'), sandbox)
function render(props) {
  currentHooks = 0
  const result = sandbox.ProcessGroup(props)
  if (expectedHooks === null) expectedHooks = currentHooks
  assert.equal(currentHooks, expectedHooks, 'ProcessGroup hook count must not change across status renders')
  return result
}

test('ProcessGroup keeps hook order when a live turn finishes', () => {
  const turn = { turn: 1, state: 'running', started_at: 1 }
  const blocks = [{ type: 'tool', name: 'shell' }]
  assert.equal(render({ blocks, turn, live: true }).type, 'div')
  turn.state = 'completed'
  turn.ended_at = 2
  assert.equal(render({ blocks, turn, live: false }).type, 'div')
})

test('ProcessGroup keeps the native tool group and original process-row order mounted while folded', () => {
  const turn = { turn: 7, state: 'completed', started_at: 1, ended_at: 2 }
  const blocks = [{ type: 'reasoning', text: 'thought' }, { type: 'tool', name: 'remote_task' }]
  const tree = render({ blocks, turn, live: false })
  const collect = (value, out = []) => {
    if (Array.isArray(value)) value.forEach((item) => collect(item, out))
    else if (value && typeof value === 'object' && value.type) {
      out.push(value)
      collect(value.children, out)
    }
    return out
  }
  const nodes = collect(tree)
  const header = nodes.find((node) => node.type === 'NativeProcessGroupHeader')
  assert.ok(header)
  assert.equal(header.props.bodyId, 'native-group-body')
  const body = nodes.find((node) => node.props.id === header.props.bodyId)
  assert.ok(body)
  assert.equal(body.props.hidden, true)
  const rows = nodes.filter((node) => node.type === sandbox.ProcessRow)
  assert.deepEqual(rows.map((node) => node.props.block.type), ['reasoning', 'tool'])
})

test('ProcessRow adapts running calls to the native card and keeps parsed argument details', () => {
  const rowSandbox = {
    React: { useState: (initial) => [initial, () => {}] },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    Native: { GenericToolCard: 'NativeGenericToolCard', toolZh: { 'tool.title.generic': '工具调用' } },
    toolT: () => '',
    useNativeDisclosure: () => ({ expanded: false, toggle() {} })
  }
  vm.runInNewContext(`${extract('toolArguments')}\n${extract('ProcessRow')}\nthis.renderProcessRow = ProcessRow`, rowSandbox)
  const raw = '{"device":"LAPTOP-01","command":"echo hi"}'
  const tree = rowSandbox.renderProcessRow({ block: { type: 'tool', id: 'call-1', name: 'mcp__tether__remote_task', arguments: raw, status: 'running' }, streaming: true })
  const card = tree.children[0]
  assert.equal(card.type, 'NativeGenericToolCard')
  assert.equal(card.props.block.phase, 'start')
  assert.equal(card.props.block.argsRaw, raw)
  assert.equal(card.props.block.args.text('device'), 'LAPTOP-01')
  assert.equal(card.props.block.args.complete('device'), true)
  assert.equal(card.props.block.callId, 'call-1')
  assert.equal(typeof card.props.useDisclosure, 'function')
})

test('ProcessRow preserves malformed raw arguments and maps settled error output to the native result shape', () => {
  const rowSandbox = {
    React: { useState: (initial) => [initial, () => {}] },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    Native: { GenericToolCard: 'NativeGenericToolCard', toolZh: {} },
    toolT: () => '',
    useNativeDisclosure: () => ({ expanded: false, toggle() {} })
  }
  vm.runInNewContext(`${extract('toolArguments')}\n${extract('ProcessRow')}\nthis.renderProcessRow = ProcessRow`, rowSandbox)
  const raw = '{"device":'
  const tree = rowSandbox.renderProcessRow({ block: { type: 'tool', id: 'call-2', name: 'remote_task', arguments: raw, result: 'remote rejected', status: 'error', is_error: true } })
  const card = tree.children[0]
  assert.equal(card.props.block.kind, 'tool-result')
  assert.equal(card.props.block.call.name, 'remote_task')
  assert.equal(card.props.block.call.argsRaw, raw)
  assert.equal(card.props.block.args.text('device'), undefined)
  assert.equal(card.props.block.isError, true)
  assert.equal(card.props.block.content[0].text, 'remote rejected')
})

test('runConversation marks a tool result error from the DSH event message', () => {
  const runSandbox = { shortText: (text, length) => String(text || '').slice(0, length) }
  vm.runInNewContext(`${extractArrow('runConversation')}\nthis.buildRunConversation = runConversation`, runSandbox)
  const events = [
    { kind: 'tool', payload: { type: 'tool/call', data: JSON.stringify({ callId: 'call-error', name: 'remote_task', arguments: '{"device":"LAPTOP-01"}' }) } },
    { kind: 'tool', payload: {
      type: 'tool/result', text: '权限拒绝',
      data: JSON.stringify({ turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call-error', isError: true, content: [{ type: 'text', text: '权限拒绝' }] } })
    } }
  ]
  const conversation = runSandbox.buildRunConversation({ state: 'running', prompt: '启动远程任务' }, events)
  const tool = conversation.turns[0].blocks[0]
  assert.equal(tool.status, 'error')
  assert.equal(tool.is_error, true)
  assert.equal(tool.result, '权限拒绝')
})

test('generated native bridge factory boots in a clean VM with its locale dependencies', () => {
  let registration
  const context = {
    window: { __ModuleLoader__: { load: (module) => { registration = module } } },
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder
  }
  vm.runInNewContext(bridgeSource, context)
  assert.equal(registration.id, 'tether-dsh-native-ui')

  const jsx = (type, props) => ({ type, props: props || {} })
  const react = {
    Fragment: Symbol.for('react.fragment'),
    Component: class Component {},
    createElement: jsx,
    createRef: () => ({ current: null }),
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    memo: (component) => component,
    forwardRef: (component) => component,
    createContext: () => ({ Provider() {}, Consumer() {} })
  }
  const reactModule = new Proxy(react, { get: (target, key) => key in target ? target[key] : (() => undefined) })
  const genericModule = new Proxy(function stubModule() {}, {
    get: (_target, key) => key === 'then' ? undefined : genericModule,
    apply: () => undefined
  })
  const jsxRuntime = { jsx, jsxs: jsx, Fragment: react.Fragment }
  const exports = registration.factory((name) => {
    if (name === 'react') return reactModule
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (name === 'clsx') return genericModule
    return genericModule
  })

  assert.equal(typeof exports.GenericToolCard, 'function')
  assert.equal(typeof exports.ProcessGroupHeader, 'function')
  assert.equal(exports.toolZh['hint.plan'], '描述你的任务以生成计划')
  assert.equal(exports.toolZh['placeholder.plan'], exports.toolZh['hint.plan'])
})
