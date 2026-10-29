import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const uiRoot = path.resolve(import.meta.dirname, '..')
const workerEntry = path.join(uiRoot, 'node_modules', 'monaco-editor', 'esm', 'vs', 'editor', 'editor.worker.js')
const runtimeEntry = path.join(uiRoot, 'src', 'monaco-runtime.js')

export function inlineCssPlugin() {
  return {
    name: 'tether-inline-css',
    setup(context) {
      context.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await fs.readFile(args.path, 'utf8')
        const id = 'tether-monaco-' + crypto.createHash('sha256').update(args.path).digest('hex').slice(0, 12)
        return {
          loader: 'js',
          contents: `const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined' && !document.getElementById(${JSON.stringify(id)})) {
  const style = document.createElement('style'); style.id = ${JSON.stringify(id)}; style.textContent = css;
  document.head.appendChild(style);
}
export default css;`
        }
      })
    }
  }
}

export async function editorWorkerSource() {
  const result = await build({
    entryPoints: [workerEntry], bundle: true, write: false, format: 'iife',
    platform: 'browser', target: ['chrome120'], minify: true, logLevel: 'silent'
  })
  const output = result.outputFiles.find((file) => file.path.endsWith('.js')) || result.outputFiles[0]
  return output.text
}

export async function monacoDefine() {
  return { __TETHER_MONACO_WORKER_SOURCE__: JSON.stringify(await editorWorkerSource()) }
}

export async function bundledMonacoRuntime() {
  const result = await build({
    entryPoints: [runtimeEntry], bundle: true, write: false, format: 'iife',
    globalName: 'TetherMonacoRuntime', platform: 'browser', target: ['chrome120'],
    define: await monacoDefine(), plugins: [inlineCssPlugin()], minify: true, logLevel: 'silent'
  })
  const output = result.outputFiles.find((file) => file.path.endsWith('.js')) || result.outputFiles[0]
  return output.text
}
