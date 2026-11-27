// ART-2：包内 pnpm 必须用包内 node 真实跑起来。
//
// 为什么不是"文件在就行"：`dsh plugin --profile web add` 会直接调用 PATH 上的
// pnpm。历史上出现过启动器指向包外的 D: 盘路径、或 pnpm.json 报了版本但入口
// 文件不存在——静态存在性检查全过，真机一点就炸。本脚本真的 spawn 一次。
//
// 用法：
//   node desktop/packaging/check-dsh-pnpm.cjs --runtime .runtime/desktop-candidate
//   node desktop/packaging/check-dsh-pnpm.cjs --runtime ... --with-dsh
//
// 退出码：0 全部可执行；1 任一失败；2 参数/目录不对。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const runtime = path.resolve(process.cwd(), argument('runtime', '.runtime/desktop-candidate'))
const nodeRuntime = path.join(runtime, 'components', 'nodejs')
const metadataPath = path.join(nodeRuntime, 'pnpm.json')
const windows = process.platform === 'win32'
const failures = []
const results = {}

if (!fs.existsSync(metadataPath)) {
  console.error(`FAIL 找不到 ${path.relative(process.cwd(), metadataPath)}（runtime 未装配，不能判通过）`)
  process.exit(1)
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
const node = windows
  ? path.join(nodeRuntime, 'node.exe')
  : path.join(nodeRuntime, 'bin', 'node')
const expectedShim = windows ? 'pnpm.cmd' : 'bin/pnpm'
const entry = path.resolve(nodeRuntime, metadata.entry || '')
const packageDir = path.join(runtime, 'components', 'dsh', 'node_modules', 'pnpm')
if (metadata.component !== 'pnpm' || metadata.shim !== expectedShim ||
    !entry.startsWith(packageDir + path.sep) || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
  console.error('FAIL invalid packaged pnpm metadata')
  process.exit(1)
}

function run(label, command, args) {
  if (!fs.existsSync(command)) {
    failures.push(`${label}: 可执行文件不存在 ${path.relative(process.cwd(), command)}`)
    results[label] = { error: 'missing executable' }
    return null
  }
  const spawned = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    cwd: nodeRuntime,
    env: { ...process.env, TETHER_PACKAGED_RUNTIME: nodeRuntime },
  })
  const stdout = (spawned.stdout || '').trim()
  const stderr = (spawned.stderr || '').trim()
  results[label] = { exit: spawned.status, stdout: stdout.split('\n')[0] || '', stderr: stderr.slice(0, 200) }
  if (spawned.error) {
    failures.push(`${label}: 无法启动 ${spawned.error.message}`)
    return null
  }
  if (spawned.status !== 0) {
    failures.push(`${label}: 退出码 ${spawned.status} ${stderr.split('\n')[0] || ''}`.trim())
  }
  return stdout
}

if (!fs.existsSync(node)) {
  failures.push(`打包 Node 运行时不存在：${path.relative(process.cwd(), node)}`)
} else if (!fs.existsSync(entry)) {
  failures.push(`pnpm 入口不存在：${path.relative(process.cwd(), entry)}（pnpm.json.entry=${metadata.entry}）`)
} else {
  const direct = run('pnpm.entry', node, [entry, '--version'])
  if (direct !== null && direct !== metadata.version) {
    failures.push(`pnpm 实际版本 ${direct} 与 pnpm.json 声明的 ${metadata.version} 不一致`)
  }
  if (direct !== null && !/^\d+\.\d+\.\d+/.test(direct)) {
    failures.push(`pnpm --version 输出不是版本号：${JSON.stringify(direct.slice(0, 60))}`)
  }
}

const shim = path.join(nodeRuntime, expectedShim)
if (!fs.existsSync(shim)) {
  failures.push(`pnpm 启动器不存在：${path.relative(process.cwd(), shim)}`)
} else {
  const viaShim = windows
    ? run('pnpm.shim', process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'pnpm.cmd', '--version'])
    : run('pnpm.shim', shim, ['--version'])
  if (viaShim !== null && viaShim !== metadata.version) {
    failures.push(`通过启动器调用得到 ${viaShim}，与声明的 ${metadata.version} 不一致`)
  }
}

if (process.argv.includes('--with-dsh')) {
  const dshEntry = path.join(runtime, 'components', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(dshEntry)) {
    failures.push(`DSH 入口不存在：${path.relative(process.cwd(), dshEntry)}`)
  } else {
    run('dsh.version', node, [dshEntry, '--version'])
  }
}

console.log(JSON.stringify({ runtime: path.relative(process.cwd(), runtime), declared: metadata.version, results }, null, 2))
for (const line of failures) console.log('FAIL ' + line)
if (failures.length) {
  console.log(`\n判据：包内 node 执行包内 pnpm 入口与启动器都要返回 pnpm.json 里的固定版本，退出码 0。`)
  process.exit(1)
}
console.log('PASS：包内 pnpm 用包内 node 可真实执行（入口与启动器两条路径）。')
