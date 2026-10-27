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

## Current limits

- Cross-machine **file explorer / permissions / rename / audit** work through `/api`.
- The **native DSH workspace iframe** returned by the Hub points at the Controller's
  loopback gateway and is not yet proxied through the public origin. Local plugin
  (on the target) still shows it; remote operator should treat that one view as pending.
- The Hub is single-user and token-protected. Do not share the token or open the API
  beyond the operator.