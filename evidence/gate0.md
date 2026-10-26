# Gate 0 findings (2026-10-26)

## Environment

- Python 3.11.4; project venv at `tether/.venv`
- `deepseek-harness-sdk==0.2.1rc2`, `deepseek-harness-runtime-bin==0.2.1rc2` (Windows x64)
- `dsh --version` → `0.2.1-rc.2`
- Isolated `DSH_HOME=tether/.runtime/dsh-home`; no `~/.dsh` writes

## Passed

- SDK initializes and creates a lazy session with no model call:
  `{"server":"started","session":"gate0-session",...}`
- Prompt path reaches the provider and returns a real provider error with a dummy key:
  `Authentication Fails, Your api key: ****ummy is invalid (401)`.
  This proves initialize → session/prompt → session.event → session.status idle works.

## Packaging bug found

The bundled Windows runtime fails every turn with:

```
The specified module could not be found.
\\?\E:\snapshot\node\node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node
```

`koffi.node` is absent from the wheel and the path points at the build machine.
Workaround: install the npm runtime and pass `_launch_args=(node, .../dsh/lib/bin.js,
"--profile","sdk")` to the Python SDK. The npm package ships the native module:

```
npm install --prefix .runtime/npm @deepseek-ai/dsh@0.2.1-rc.2
```

With that launch override the same dummy-key prompt reaches the provider (401),
so the SDK main chain is viable without touching the broken wheel path.

## Event vocabulary observed

`agent/inbox/spliced`, `turn/start`, `step/start`, `system/message`, `user/message`,
`request/header`, `request/context`, `session/title`, `assistant/attempt`,
`step/end`, `turn/end`, `session.status`.

Tether mapping currently ignores system/user/request frames, maps
`assistant/attempt` text deltas to `assistant`, tool frames to `tool`, and treats
`turn/end(reason.kind=error)` as a failed run (not completed).

## Approval limitation

The installed 0.2.1rc2 wheel has no `approval_requests` handshake
(`DeepSeekHarnessConfig` and `HarnessClient.initialize` lack it; master docs have
it). Approval UI is therefore `Designed, not implemented` for v0.1.

## Next

- Add a real `DEEPSEEK_API_KEY` to `tether/.env` (gitignored) and run Gate 2:
  create a file, stream tool events, second run in the same session.
- Verify hard cancel (`harness.close()`) against a slow real prompt and confirm
  no orphan `node.exe` children; add Job Object if needed.