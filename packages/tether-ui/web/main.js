import React from 'react'
import { createRoot } from 'react-dom/client'
import { createTetherPanel } from '../src/app.js'
import { createWebHost, createWebNative } from '../src/hosts/web.js'

function fail(error) {
  const box = document.getElementById('root')
  if (!box) return
  const pre = document.createElement('pre')
  pre.style.cssText = 'padding:24px;color:#b42318;font:13px/1.6 Consolas,monospace;white-space:pre-wrap'
  pre.textContent = 'Tether WebUI failed to mount\n\n' + String((error && error.stack) || error)
  box.replaceChildren(pre)
}

try {
  const panel = createTetherPanel({
    React,
    Native: createWebNative(React),
    host: createWebHost({ apiBase: '' })
  })
  createRoot(document.getElementById('root')).render(React.createElement(panel.App))
} catch (error) {
  fail(error)
}