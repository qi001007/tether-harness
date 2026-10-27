# tether-ui backlog

- 2026-10-27：Phase 1 窄切片。`src/app.js` 从 `dsh-plugin-tether-client/lib/client.js` 机械抽取（UI 主体 2167 行逐字未改），插件 bundle 由 `scripts/build.mjs` 生成，不要手改 `lib/client.js`。缩进是契约：现有测试按 4/6 空格从生成文件抽函数。
- 2026-10-27：WebHost 回落只实现了 App 实际用到的 `FileEntryRow`/`FileTypeIcon`（含 `kind:'folder'`）/`MarkdownText` 与三个语言字典；其余 DSH 原生组件属于旧 transcript 死代码，不要误以为 Web 已覆盖。
- 2026-10-27：WebUI 通过 `web/serve.mjs` 同源反代，因为 Controller CORS 仍只允许 `dsh-app://app`。原生 surface iframe 在非 DSH origin 下的 gateway/Cookie 行为未验收，不能据此宣称 Web 端原生页可用。
- 2026-10-27：未做 Electron、未接 Relay/Account；`createDshHost` 的 API base 仍是固定 loopback，APP 发现/回落在 Phase 2。