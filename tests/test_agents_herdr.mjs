import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = fs.readFileSync(path.join(root, 'packages/tether-ui/src/agents-page.js'), 'utf8')
const terminalDock = fs.readFileSync(path.join(root, 'packages/tether-ui/src/terminal-dock.js'), 'utf8')

test('Herdr project panes are keyed by normalized cwd and pass it as an opt-in project scope', () => {
  const cwdKey = page.split('\n').find((line) => line.includes('const normalizedCwd = cwd.replace('))
  assert.ok(cwdKey && cwdKey.includes('.replace('))
  assert.match(page, /const key = normalizedCwd \? 'herdr:' \+ normalizedCwd : 'herdr'/)
  assert.match(page, /herdrProject: !!normalizedCwd/)
  assert.match(page, /cwd: pane\.cwd \|\| ''/)
  assert.match(page, /initialHerdrProject: pane\.herdrProject \|\| false/)
  assert.match(terminalDock, /if \(initialHerdrProject && shellId === 'herdr'\) \{[\s\S]*?if \(herdr\.project_sessions !== true\) throw new Error\([\s\S]*?payload\.herdr_project = true/)
  assert.match(terminalDock, /const preferred = initialHerdrProject \? 'herdr' :/)
})
