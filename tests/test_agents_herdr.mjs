import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentsPage = fs.readFileSync(path.join(root, 'packages/tether-ui/src/agents-page.js'), 'utf8').replace(/\r\n/g, '\n')

function herdrHarness({ available = true } = {}) {
  const supportStart = agentsPage.indexOf('const HERDR_SUPPORTED_CODEG_TYPES = new Set([')
  const supportEnd = agentsPage.indexOf('\n\nexport function createAgentsPage', supportStart)
  const openStart = agentsPage.indexOf('  const openHerdr = (', supportEnd)
  const openEnd = agentsPage.indexOf('\n\n  const openRuntimeCli', openStart)
  assert.ok(supportStart >= 0 && supportEnd > supportStart && openStart > supportEnd && openEnd > openStart,
    'the current support set and openHerdr implementation are present')
  const panes = []
  const errors = []
  const sandbox = {
    device: 'target-a',
    herdrAvailable: available,
    addPane: (pane) => panes.push(pane),
    setHomeError: (message) => errors.push(message)
  }
  const implementation = agentsPage.slice(supportStart, supportEnd) + '\n'
    + agentsPage.slice(openStart, openEnd) + '\nthis.openHerdr = openHerdr'
  vm.runInNewContext(implementation, sandbox)
  return { openHerdr: sandbox.openHerdr, panes, errors }
}

test('Herdr project pane identity includes canonical Agent type and retains project context', () => {
  const harness = herdrHarness()
  harness.openHerdr('D:\\work\\project\\', 'codex')
  harness.openHerdr('D:/work/project/', 'codex')
  harness.openHerdr('D:/work/project', 'claude_code')

  assert.equal(harness.panes.length, 3)
  assert.equal(harness.panes[0].key, 'herdr:D:/work/project:codex')
  assert.equal(harness.panes[1].key, harness.panes[0].key, 'same project and Agent reuse a pane key after slash normalization')
  assert.notEqual(harness.panes[2].key, harness.panes[0].key, 'different Agents keep separate panes for the same project')
  assert.equal(harness.panes[0].cwd, 'D:\\work\\project\\', 'the actual project path is passed through unchanged')
  assert.equal(harness.panes[0].targetId, 'target-a')
  assert.equal(harness.panes[0].herdrAgentType, 'codex')
  assert.equal(harness.panes[2].herdrAgentType, 'claude_code')
  assert.equal(harness.panes[0].herdrProject, true)
})

test('Herdr requires a project and rejects unsupported Agent types without opening a pane', () => {
  const harness = herdrHarness()
  harness.openHerdr('', 'codex')
  assert.equal(harness.panes.length, 0)
  assert.equal(harness.errors.at(-1), '打开 Herdr 前请先选择项目')

  harness.openHerdr('D:/work/project', 'unknown_agent')
  assert.equal(harness.panes.length, 0)
  assert.equal(harness.errors.at(-1), 'Herdr 暂不支持所选 Agent 类型')
})
