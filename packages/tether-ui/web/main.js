import React from 'react'
import { createRoot } from 'react-dom/client'
import { createTetherPanel } from '../src/app.js'
import { createWebHost, createWebNative } from '../src/hosts/web.js'
import { createElectronHost } from '../src/hosts/electron.js'
import { createAppErrorBoundary } from './app-error-boundary.js'

function fail(error) {
  const box = document.getElementById('root')
  if (!box) return
  const pre = document.createElement('pre')
  pre.style.cssText = 'padding:24px;color:#b42318;font:13px/1.6 Consolas,monospace;white-space:pre-wrap'
  pre.textContent = 'Tether WebUI failed to mount\n\n' + String((error && error.stack) || error)
  box.replaceChildren(pre)
}

try {
  const inApp = typeof window !== 'undefined' && !!window.tetherApp
  const panel = createTetherPanel({
    React,
    Native: createWebNative(React),
    host: inApp ? createElectronHost({ apiBase: '' }) : createWebHost({ apiBase: '' })
  })
  const root = createRoot(document.getElementById('root'))
  const AppErrorBoundary = createAppErrorBoundary(React)
  root.render(React.createElement(AppErrorBoundary, null, React.createElement(panel.App)))
} catch (error) {
  fail(error)
}
