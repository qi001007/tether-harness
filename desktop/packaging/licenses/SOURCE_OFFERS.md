# Third-party source and license materials

The candidate includes the following pinned third-party runtimes. Their source tags and license texts are recorded here and in `component-assets.json`.

| Component | Version | License | Corresponding source |
| --- | --- | --- | --- |
| Codeg | v0.42.0 | Apache-2.0 | https://github.com/spacering-net/codeg/tree/v0.42.0 |
| EasyTier | v2.6.4 | LGPL-3.0-only | https://github.com/EasyTier/EasyTier/tree/v2.6.4 |
| Caddy | v2.11.9 | Apache-2.0 | https://github.com/caddyserver/caddy/tree/v2.11.9 |
| rclone | v1.76.0 | MIT | https://github.com/rclone/rclone/tree/v1.76.0 |
| SFTPGo core | v2.7.6 | AGPL-3.0-only | https://github.com/drakkan/sftpgo/tree/v2.7.6 |
| Herdr | v0.9.5 | Apache-2.0 | https://github.com/herdrdev/herdr/tree/v0.9.5 |
| Node.js | v24.22.2 | MIT | https://github.com/nodejs/node/tree/v24.22.2 |
| MeshCentral | v1.3.1 | Apache-2.0 | https://github.com/Ylianst/MeshCentral/tree/1.3.1 (npm source archive included in candidate) |
| MeshAgent | legacy-1.2.6 | Apache-2.0 | https://github.com/Ylianst/MeshAgent/tree/legacy-1.2.6 |
| DSH CLI | 0.2.1-rc.5 | MIT | https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.1-rc.5 |
| Tether DSH plugin | 0.2.93 | MIT | https://github.com/qi001007/tether-harness/releases/tag/v0.2.93 (original release ZIP included; no same-version rebuild) |
| LibreOffice | 26.8.2 | MPL-2.0 (third-party components carry additional notices) | https://www.libreoffice.org/about-us/source-code/ (runtime assets use fixed platform installers and their included license/notice materials) |

SFTPGo is included as an open-source core integration with Tether's frontend. The candidate carries its `LICENSE`, `NOTICE`, and the corresponding source archive at `sources/SFTPGo/sftpgo_v2.7.6_src_with_deps.tar.xz`. It does not carry SFTPGo proprietary web templates, static frontend, or preseeded database. Tether is not endorsed by or affiliated with the SFTPGo project.

MeshCentral is a target-local service. The candidate includes its exact npm source archive, Apache-2.0 license, and a lockfile for all production npm dependencies. MeshAgent binaries are the four fixed release assets recorded in `remote-desktop-assets.json`; the package retains the upstream Apache-2.0 notice and source link. Node.js is copied from its official fixed release archive and its upstream license is included. User data is not included in runtime resources.

The DSH production npm tree uses the pinned lock in `desktop/packaging/dsh/package-lock.json`. Four narrowly scoped dependency overrides address upstream advisories; versions and compatibility status are recorded in `DSH_DEPENDENCY_OVERRIDES.md`. The DSH top-level package remains 0.2.1-rc.5. The frozen plugin is the original 0.2.93 release artifact, verified by SHA-256; it is not rebuilt from the current workspace.

LibreOffice 26.8.2 is assembled from fixed official Windows MSI, Linux Debian archive, and macOS disk images recorded with SHA-256 in `libreoffice-assets.json`. The package includes the upstream license text and notice; platform resources are extracted into `components/libreoffice`, with private conversion profiles created only at runtime.
