import fs from 'node:fs'
import path from 'node:path'

function copyTree(src, dst) {
  const realSrc = fs.realpathSync(src)
  const stat = fs.statSync(realSrc)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(realSrc, { withFileTypes: true })) {
      copyTree(path.join(realSrc, entry.name), path.join(dst, entry.name))
    }
    return
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(realSrc, dst)
}

const monacoVs = path.join('node_modules', 'monaco-editor', 'min', 'vs')
fs.rmSync(path.join('public', 'vs'), { recursive: true, force: true })
copyTree(monacoVs, path.join('public', 'vs'))

const loader = path.join('public', 'vs', 'loader.js')
fs.writeFileSync(loader, fs.readFileSync(loader, 'utf8').replace(/\n\/\/# sourceMappingURL=.*/, ''))

const pdfjsRoot = path.join('node_modules', 'pdfjs-dist')
fs.rmSync(path.join('public', 'pdfjs'), { recursive: true, force: true })
for (const entry of ['legacy/build/pdf.worker.min.mjs', 'cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  copyTree(
    path.join(pdfjsRoot, entry),
    path.join('public', 'pdfjs', entry.replace('legacy/build/', ''))
  )
}
