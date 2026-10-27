# tether-ui backlog

- 2026-10-27：Phase 1 窄切片。`src/app.js` 从 `dsh-plugin-tether-client/lib/client.js` 机械抽取（UI 主体 2167 行逐字未改），插件 bundle 由 `scripts/build.mjs` 生成，不要手改 `lib/client.js`。缩进是契约：现有测试按 4/6 空格从生成文件抽函数。
- 2026-10-27：WebHost 回落只实现了 App 实际用到的 `FileEntryRow`/`FileTypeIcon`（含 `kind:'folder'`）/`MarkdownText` 与三个语言字典；其余 DSH 原生组件属于旧 transcript 死代码，不要误以为 Web 已覆盖。
- 2026-10-27：WebUI 通过 `web/serve.mjs` 同源反代，因为 Controller CORS 仍只允许 `dsh-app://app`。原生 surface iframe 在非 DSH origin 下的 gateway/Cookie 行为未验收，不能据此宣称 Web 端原生页可用。
- 2026-10-27：`createDshHost` 的 API base 仍是固定 loopback（插件端）；APP 本机自举/远端 Hub 由 `TETHER_CONTROLLER_URL` 切换。真正的 Relay（Controller 在 NAT 后）未做。
- 2026-10-27：权限抽屉改为响应式（`width: min(480px,100%)`，≤760px 全宽、≤520px 表格列收窄）；删掉每个模式的说明段与审计副标题，说明进 tooltip。别再往里加长句。
- 2026-10-27：网络连线用 `vector-effect: non-scaling-stroke` + `strokeWidth:1`、虚线 `3 4`，屏幕厚度恒定；不要再按 viewBox 用户单位写 0.3 那类值。
- 2026-10-27：APP 服务 chip z-index 10、打开自身抽屉时隐藏；不要盖住权限抽屉的关闭按钮。
- 2026-10-27：权限抽屉改全高：顶部策略区 `maxHeight:58%` 独立滚动，审计表 `flex:1` 填满剩余高度；不要再给审计表写 `maxHeight:260`。
- 2026-10-27：`web/dist/app.js` 现已提交，保证拉代码即得新 UI；改 `src/` 后必须重建并一起提交。
- 2026-10-27：网络线 `non-scaling-stroke`，zoom>1 为 1px、其余 1.2px；颜色 `C.sub`、opacity 0.7/0.4、虚线 4 5。要更深、放大也能看清，不要再调回 `C.mute` 或 0.75px。
