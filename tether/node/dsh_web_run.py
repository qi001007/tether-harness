#!/usr/bin/env python3
"""Run DSH Web and publish its one-time token URL to the Tether app catalog."""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

NODE = "/opt/tether-node/dsh-web/node-v24.22.2-linux-x64/bin/node"
ENTRY = "/opt/tether-node/dsh-web/node_modules/@deepseek-ai/dsh/lib/bin.js"
APPS = Path("/opt/tether-node/apps.json")


def main() -> int:
    env = os.environ.copy()
    env["HOME"] = "/root"
    env["PATH"] = os.path.dirname(NODE) + ":/usr/local/bin:/usr/bin:/bin"
    process = subprocess.Popen(
        [NODE, ENTRY, "web", "--host", "127.0.0.1", "--no-open", "--port", "3080",
         "--public-url", "http://10.144.0.1:37301/",
         "--trusted-host", "10.144.0.1:37301"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env,
    )

    def stop(_signum, _frame):
        process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    published = False
    assert process.stdout is not None
    for line in process.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if published:
            continue
        match = re.search(r"[?&]token=([A-Za-z0-9_-]+)", line)
        if not match:
            continue
        payload = {"apps": [{"name": "DSH Web", "port": 3080, "listen_port": 37301,
                             "url": "http://10.144.0.1:37301",
                             "path": "/?token=" + match.group(1)}]}
        temp = APPS.with_suffix(".tmp")
        temp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(temp, APPS)
        os.chmod(APPS, 0o600)
        published = True
    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
