# UI 宿主适配

本目录为共享 Tether UI 提供宿主侧 API 地址、请求凭据、原生组件适配及更新能力边界。Electron APP 自更新使用主进程 IPC；DSH/浏览器更新请求通过选中设备的 Controller API。DSH Hub bearer 凭据按目标 API base 限定到 Hub 地址。
