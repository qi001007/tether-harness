# Tether Hub on a public VPS

Minimal, working cross-network setup in ~30 minutes. The VPS runs the existing
Controller as a Hub; target Nodes connect **outbound** over WSS; the operator APP
proxies the Hub API with a token. No inbound ports on target machines, no new
tunnel protocol.

## 1. Buy

- Ubuntu 22.04/24.04 LTS, 1 vCPU / 1 GB RAM, public IPv4.
- Optional but strongly recommended: a domain (A record → VPS IP) so Caddy can
  issue a real certificate. Without a domain use the self-signed fallback below.
- Firewall: allow 22, 80, 443. Do **not** expose 18890 directly.

## 2. Install on the VPS

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip git caddy
sudo adduser --system --home /opt/tether --group tether
sudo -u tether git clone https://github.com/qi001007/tether-harness /opt/tether/app
cd /opt/tether/app
sudo -u tether python3 -m venv .venv
sudo -u tether .venv/bin/pip install -e .
```

Create `/opt/tether/app/.env` (root-readable, not world-readable):

```dotenv
TETHER_PORT=18890
TETHER_HOST=127.0.0.1
TETHER_DB=/opt/tether/data/controller.db
TETHER_NODE_TOKEN=<long-random-node-token>
TETHER_ACCESS_TOKEN=<long-random-operator-token>
```

```bash
sudo mkdir -p /opt/tether/data && sudo chown -R tether:tether /opt/tether/data
```

Systemd unit: `deploy/hub/tether-hub.service` →

```bash
sudo cp deploy/hub/tether-hub.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tether-hub
```

Caddy with a domain (`/etc/caddy/Caddyfile`):

```
hub.example.com {
    reverse_proxy 127.0.0.1:18890
}
```

```bash
sudo systemctl reload caddy
```

Verify from your laptop:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://hub.example.com/api/state            # 401
curl -s -H "Authorization: Bearer <operator-token>" https://hub.example.com/api/state # 200
```

## 3. Target machine (Node)

Windows target, in its `.env`:

```dotenv
TETHER_CONTROLLER=wss://hub.example.com/ws/node
TETHER_NODE_TOKEN=<same node token as the Hub>
TETHER_DEVICE=LAPTOP-01
```

Then run the node (`laptop/tether-node.ps1` or `python -m tether.node.agent ...`).
It opens no inbound port. With a self-signed certificate also set
`TETHER_INSECURE_TLS=1`; prefer `TETHER_CA_FILE=<path-to-ca.pem>` when you have one.

## 4. Operator APP

In the desktop repo `.env`:

```dotenv
TETHER_CONTROLLER_URL=https://hub.example.com
TETHER_ACCESS_TOKEN=<operator token from step 2>
```

Start the APP. It switches to **远端 Hub** mode: the embedded UI proxies `/api` to
the Hub and injects the token server-side; the token never reaches the browser.
The top-right `服务` drawer shows the Hub state.

## 5. Self-signed fallback (no domain)

On the VPS, generate a certificate and let uvicorn terminate TLS:

```bash
mkdir -p /opt/tether/tls
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout /opt/tether/tls/key.pem -out /opt/tether/tls/cert.pem \
  -subj "/CN=<VPS_PUBLIC_IP>"
```

Run uvicorn with `--ssl-keyfile /opt/tether/tls/key.pem --ssl-certfile /opt/tether/tls/cert.pem`
(port 8443, open it in the firewall), skip Caddy, and use:

```dotenv
# Node
TETHER_CONTROLLER=wss://<VPS_PUBLIC_IP>:8443/ws/node
TETHER_INSECURE_TLS=1
# APP
TETHER_CONTROLLER_URL=https://<VPS_PUBLIC_IP>:8443
TETHER_INSECURE_TLS=1
```

This is for today's demo only; a real certificate is the production path.

## Native DSH page across machines

Each device gateway gets its own public origin instead of a Hub loopback URL:

- Caddy serves `https://g<port>.<TETHER_SURFACE_SUFFIX>` with on-demand TLS.
- `deploy/hub/surface_mux.py` (systemd `tether-surface-mux.service`, listen
  `127.0.0.1:18990`) maps the host to that gateway port and rewrites Host/Origin
  for HTTP and WebSocket, including the gateway cookie.
- The Controller sets `TETHER_SURFACE_SUFFIX` and returns the public URL.

```bash
# once, on the Hub
/opt/tether/app/.venv/bin/pip install httpx
cp deploy/hub/surface_mux.py /opt/tether/app/deploy/hub/
cp deploy/hub/tether-surface-mux.service /etc/systemd/system/
echo 'TETHER_SURFACE_SUFFIX=8-220-198-26.sslip.io' >> /opt/tether/app/.env
systemctl daemon-reload && systemctl enable --now tether-surface-mux
systemctl restart tether-hub
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
cp deploy/hub/Caddyfile.example /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

The wildcard DNS must resolve to the Hub (sslip.io does for any `g<port>` prefix).
Do not open gateway ports; only 443 is used.

## Current limits

- The native page needs both the target Node and its DSH surface; a Node alone is
  not enough.
- Cross-machine **file explorer / permissions / rename / audit** and the native
  DSH page work through `/api` and the per-device public origin.
- The Hub is single-user and token-protected. Do not share the token or open the API
  beyond the operator.