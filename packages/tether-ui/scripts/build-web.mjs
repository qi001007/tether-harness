import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { inlineCssPlugin, monacoDefine } from './monaco-build.mjs'

const root = path.resolve(import.meta.dirname, '..')
// 与 DSH plugin 构建（build.mjs）和 native_surface.py 在途注入共用同一份 flow 源码。
// 这里把它包成函数 (ctx, React) => {…} 内嵌进 web bundle，供 app.js 客户端 guest 注入
// 用 .toString() 取出函数体注入到 DSH webview，避免依赖代理路径或运行时网络读取。
const flowPath = path.resolve(root, '../../tether/node/tether_dsh_directory_flow.js')
const dshFlowFnPlugin = {
  name: 'tether-dsh-flow-fn',
  setup(build) {
    build.onResolve({ filter: /^#tether-dsh-flow-fn$/ }, () => ({ path: 'tether-dsh-flow-fn', namespace: 'tether-dsh-flow' }))
    build.onLoad({ filter: /.*/, namespace: 'tether-dsh-flow' }, () => ({
      contents: 'export default function (ctx, React) {\n' + fs.readFileSync(flowPath, 'utf8') + '\n}',
      loader: 'js'
    }))
  }
}
await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'web/main.js')],
  bundle: true,
  format: 'esm',
  outfile: path.join(root, 'web/dist/app.js'),
  define: { 'process.env.NODE_ENV': '"production"', ...(await monacoDefine()) },
  plugins: [inlineCssPlugin(), dshFlowFnPlugin],
  target: ['chrome120'],
  logLevel: 'info'
})
