# tether-dsh-plugin

DeepSeek Harness bundle that installs the Tether client page. The actual UI is in
`../dsh-plugin-tether-client` and registers the `main` and `sidebar.panellist`
slots; this package only contributes the profile patch.

Install from the repository root:

```powershell
.\desktop\install-plugin.ps1
# restart DeepSeek Harness, then click Tether in the sidebar
```

The client talks to the Tether controller on `http://127.0.0.1:18890`; the
controller accepts cross-origin calls only from `dsh-app://app`.
