import { createWebHost } from './web.js'

export function createElectronHost({ apiBase = '' } = {}) {
  return {
    ...createWebHost({ apiBase }),
    kind: 'app'
  }
}