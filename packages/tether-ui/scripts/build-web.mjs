import { build } from 'esbuild'
import path from 'node:path'
import { inlineCssPlugin, monacoDefine } from './monaco-build.mjs'

const root = path.resolve(import.meta.dirname, '..')
await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'web/main.js')],
  bundle: true,
  format: 'esm',
  outfile: path.join(root, 'web/dist/app.js'),
  define: { 'process.env.NODE_ENV': '"production"', ...(await monacoDefine()) },
  plugins: [inlineCssPlugin()],
  target: ['chrome120'],
  logLevel: 'info'
})
