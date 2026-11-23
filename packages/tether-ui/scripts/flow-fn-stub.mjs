// Node 侧解析用的占位实现：app.js 的 `#tether-dsh-flow-fn` 只有在 WebUI 构建
// （scripts/build-web.mjs 的 esbuild 插件）里才会被替换成 tether/node/tether_dsh_directory_flow.js
// 的真实函数体。Node 直接 import 源码（单测、脚本）时解析到这里，返回 null，
// 让 app.js 里的 `typeof dshDirectoryFlowFn === 'function'` 守卫按“无 flow”降级。
// 不要在此内联 flow 源码：那会与 build-web 的注入路径产生两份真源。
export default function tetherDshDirectoryFlowStub() {
  return null
}