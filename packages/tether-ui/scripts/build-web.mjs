import { build } from 'esbuild'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
await build({
  entryPoints: [path.join(root, 'web/main.js')],
  bundle: true,
  format: 'esm',
  outfile: path.join(root, 'web/dist/app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info'
})