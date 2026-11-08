# DSH production dependency overrides

The APP ships the fixed `@deepseek-ai/dsh@0.2.1-rc.5` package and its npm production lock. The candidate lock applies only these four upstream security fixes; it does not change the DSH package or plugin source:

| Package | Locked version | Upstream advisory | Finding |
| --- | --- | --- | --- |
| `undici` | 8.12.2 | GHSA-2m5v-pch6-74hx | TLS options dropped by `Agent` can bypass certificate validation |
| `undici` | 8.12.2 | GHSA-4w7w-5xrc-9h26 | Cross-origin redirects can cause cache poisoning and cross-user disclosure |
| `undici` | 8.12.2 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-55wc-3pg8-jfw6, GHSA-9fm3-97px-rjf6, GHSA-qrxm-fqhp-jwvm, GHSA-xjj6-f33q-929c | EventSource/WebSocket/decompression/renegotiation denial of service and SRI bypass |
| `@modelcontextprotocol/client` | 2.3.0 | GHSA-6prh-2h8m-c8cw | Cross-origin redirects can resend custom headers and request bodies |
| `fflate` | 0.8.3 | GHSA-px8p-9vwx-vf98 | Malformed ZIP64 can make `unzipSync` loop indefinitely |
| `zod` | 4.6.7 | GHSA-mrhx-c7xc-m3w5 | Oversized constrained collections can exhaust memory |

These are upstream patched versions (minimums: `undici` 8.12.2, MCP client 2.3.0, `fflate` 0.8.3, `zod` 4.6.6). Some DSH subpackages declare the older versions exactly, so the overrides deliberately replace those transitive pins; they are not claimed compatible solely because the package major is unchanged. A real isolated DSH host/plugin startup check is required before accepting compatibility.

The bounded production audit of the resulting lock reported zero advisories on 2026-11-08. The reviewed advisory set contains no unauthenticated remote code execution or authentication-bypass advisory. TLS validation, cross-origin credential forwarding, and denial-of-service findings remain relevant to runtime request paths and are not an end-to-end safety certification.
