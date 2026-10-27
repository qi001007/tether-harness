import { createWebHost } from './web.js'

export function createElectronHost({ apiBase = '' } = {}) {
  return {
    ...createWebHost({ apiBase }),
    kind: 'app',
    connectionInfo: async () => {
      const state = await window.tetherApp.services()
      return {
        address: state.remoteUrl || (state.endpoints && state.endpoints.api) || '未配置',
        status: state.lastProbe && state.lastProbe.status || 'unknown',
        errorKind: state.lastProbe && state.lastProbe.errorKind,
        checkedAt: state.lastProbe && state.lastProbe.checkedAt,
        durationMs: state.lastProbe && state.lastProbe.durationMs
      }
    },
    probeConnection: async () => {
      const state = await window.tetherApp.probeServices()
      return {
        address: state.remoteUrl || (state.endpoints && state.endpoints.api) || '未配置',
        status: state.lastProbe && state.lastProbe.status || 'unknown',
        errorKind: state.lastProbe && state.lastProbe.errorKind,
        checkedAt: state.lastProbe && state.lastProbe.checkedAt,
        durationMs: state.lastProbe && state.lastProbe.durationMs
      }
    },
    updates: {
      status: () => window.tetherApp.updatesStatus(),
      check: () => window.tetherApp.updatesCheck(),
      prepare: () => window.tetherApp.updatesPrepare(),
      apply: (preparedId) => window.tetherApp.updatesApply(preparedId)
    }
  }
}
