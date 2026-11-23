"""Keep this Node's own managed EasyTier networks alive without Hub help.

The Hub stays the only source of network configuration. This loop only touches
records the Node already wrote: it restores a stopped instance from its unchanged
local config, relaunches one still running under an older launch signature, and
refreshes the peer table for status reporting. An instance whose process identity
cannot be verified is never killed.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .mesh_runtime import MeshRuntimeError

INTERVAL_SECONDS = 30.0
FIRST_DELAY_SECONDS = 2.0
BACKOFF_SECONDS = (5.0, 10.0, 20.0, 40.0, 60.0)


class MeshSupervisor:
    """Single-flight 30 s health loop over the Node's recorded mesh instances."""

    def __init__(self, runtime: Any, *, busy: Callable[[str], bool] | None = None,
                 interval: float = INTERVAL_SECONDS) -> None:
        self.runtime = runtime
        self._busy = busy or (lambda _network_id: False)
        self.interval = interval
        self._lock = threading.Lock()
        self._guard = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._networks: dict[str, dict[str, Any]] = {}
        self._retry: dict[str, dict[str, Any]] = {}
        self._last_tick: float | None = None

    # ---- lifecycle of the loop itself -------------------------------------

    def start(self) -> None:
        with self._guard:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="tether-mesh-supervisor", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        with self._guard:
            thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5)

    @property
    def running(self) -> bool:
        thread = self._thread
        return bool(thread is not None and thread.is_alive())

    def _run(self) -> None:
        if self._stop.wait(FIRST_DELAY_SECONDS):
            return
        while not self._stop.is_set():
            self.tick()
            if self._stop.wait(self.interval):
                return

    # ---- one pass ---------------------------------------------------------

    def tick(self) -> None:
        """One non-overlapping pass; a slow restore never stacks up."""
        if not self._lock.acquire(blocking=False):
            return
        try:
            for entry in self.runtime.managed_networks():
                try:
                    self._reconcile(entry)
                except Exception as exc:  # noqa: BLE001 - one network must not stop the loop
                    self._fail(entry["network_id"], entry["instance_id"], str(exc) or "supervisor_error")
            self._last_tick = time.time()
        finally:
            self._lock.release()

    def _reconcile(self, entry: dict[str, Any]) -> None:
        network_id, instance_id = entry["network_id"], entry["instance_id"]
        retry = self._retry.get(network_id)
        if retry and time.monotonic() < retry["next"]:
            return
        status = self.runtime.status_for_network(network_id)
        state = status.get("state")
        if state == "ready":
            if self._launch_is_stale(entry) and not self._busy(network_id):
                status = self.runtime.relaunch(instance_id, network_id=network_id)
                state = status.get("state")
            if state == "ready":
                self._retry.pop(network_id, None)
                self._publish(network_id, instance_id, status)
                return
        if state == "unverified":
            # A live process we cannot attribute to this Node is never replaced.
            self._fail(network_id, instance_id, "process_identity_unverified", status)
            return
        if state == "ambiguous" or state == "not_connected":
            self._fail(network_id, instance_id, "instance_record_ambiguous", status)
            return
        if state == "starting":
            self._publish(network_id, instance_id, status)
            return
        try:
            status = self.runtime.restore_stopped_network(network_id)
        except MeshRuntimeError as exc:
            self._fail(network_id, instance_id, str(exc), status)
            return
        self._retry.pop(network_id, None)
        self._publish(network_id, instance_id, status)

    def _launch_is_stale(self, entry: dict[str, Any]) -> bool:
        current = getattr(self.runtime, "launch_sha256", None)
        if not callable(current):
            return False
        return entry.get("launch_sha256") != current()

    def _publish(self, network_id: str, instance_id: str, status: dict[str, Any]) -> None:
        health = self.runtime.peer_health(instance_id)
        self._networks[network_id] = {
            "network_id": network_id,
            "instance_id": instance_id,
            "state": status.get("state"),
            "revision": status.get("revision"),
            "service_ip": status.get("service_ip"),
            "socks_proxy": status.get("socks_proxy"),
            "peers": health.get("peers"),
            "peer_count": health.get("peer_count"),
            "remote_peer_count": health.get("remote_peer_count"),
            "peer_connectivity": health.get("peer_connectivity", "unknown"),
            "cost": health.get("cost"),
            "tunnel": health.get("tunnel"),
            "latency_ms": health.get("latency_ms"),
            "loss_rate": health.get("loss_rate"),
            "nat_type": health.get("nat_type"),
            "peer_read_at": health.get("peer_read_at"),
            "health_error": health.get("error"),
            "last_error": None,
            "checked_at": int(time.time()),
        }

    def _fail(self, network_id: str, instance_id: str, error: str,
              status: dict[str, Any] | None = None) -> None:
        attempt = self._retry.get(network_id, {"attempt": 0})
        attempt = {"attempt": attempt["attempt"] + 1,
                   "next": time.monotonic() + BACKOFF_SECONDS[min(attempt["attempt"], len(BACKOFF_SECONDS) - 1)]}
        self._retry[network_id] = attempt
        previous = self._networks.get(network_id, {})
        self._networks[network_id] = {
            **previous,
            "network_id": network_id,
            "instance_id": instance_id,
            "state": (status or {}).get("state", previous.get("state", "unknown")),
            "revision": (status or {}).get("revision", previous.get("revision")),
            "service_ip": (status or {}).get("service_ip", previous.get("service_ip")),
            "peers": None,
            "peer_count": None,
            "remote_peer_count": None,
            "peer_connectivity": "unknown",
            "cost": None,
            "tunnel": None,
            "latency_ms": None,
            "loss_rate": None,
            "nat_type": None,
            "peer_read_at": None,
            "health_error": None,
            "last_error": error,
            "retry_in_seconds": max(0, round(attempt["next"] - time.monotonic())),
            "checked_at": int(time.time()),
        }

    # ---- read side --------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        last_tick = self._last_tick
        return {"running": self.running, "interval_seconds": self.interval,
                "last_tick": int(last_tick) if last_tick else None,
                "networks": [dict(entry) for entry in self._networks.values()]}

    def network(self, network_id: str) -> dict[str, Any] | None:
        entry = self._networks.get(network_id)
        return dict(entry) if entry else None