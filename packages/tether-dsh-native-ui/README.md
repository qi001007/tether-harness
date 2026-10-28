# DSH native UI bridge

This package wraps selected `@deepseek-ai/dsh-client-ui-chat`,
`@deepseek-ai/dsh-client-ui-workspace`,
`@deepseek-ai/dsh-client-ui-sidebar-files`, and
`@deepseek-ai/dsh-client-ui-tool` factory bodies in isolated lexical
scopes and returns the original presentation components. The generator never
evaluates source text, registers the upstream module IDs, or calls their `apply`
functions. It also carries the upstream Simplified Chinese locale dictionaries,
including the tool-card labels from the conversation bundle.

Source packages: DeepSeek Harness, release `0.2.1-rc.2`, MIT License. The
generated client file records SHA-256 hashes of the complete installed source
bundles. Recreate it with `node scripts/build-native-ui-bridge.mjs` from the
Tether repository root after the matching DSH runtime packages are installed.
It also exports only the installed MIT `ComposerAttachments` component from
`@deepseek-ai/dsh-client-ui-attachment`; Tether wraps that component with the
target-device picker and leaves its native attachment behavior in place. The
factory source is consumed only by the repository bridge generator; the emitted
factory is embedded in `lib/client.js`, so this UI-only module is not a new
runtime package dependency.

Exported presentation bindings include `MarkdownText`, `FileTypeIcon`,
`IconFolderOpenRegular`, `IconFolderCloseRegular`, the outline chevrons,
`DisclosureRow`, `UserStyleBubble`,
`UserContent`, `ReasoningRow`, `TurnProcessNodeView`, `RunningStatus`,
`ProcessGroupHeader`, `ChatGroupSeat_module_css_default`, `GenericToolCard`,
`toolRowModel`, `markdownLabels`, `ProjectRowItem`, `SessionNodeItem`,
`FileEntryRow`, `ComposerAttachments`, `chatZh`, `workspaceZh`, and `toolZh`. Tether supplies its own callbacks and remote data projection;
the bridge does not turn the Tether panel into DSH's complete Host-backed
workspace browser or ChatView.
