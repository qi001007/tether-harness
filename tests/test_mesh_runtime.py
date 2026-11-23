from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from tether.node.fs_service import FsError, FsService
from tether.node.mesh_runtime import EasyTierRuntime, MeshRuntimeError


@pytest.fixture
def managed_mesh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    core = tmp_path / "easytier-core"
    cli = tmp_path / "easytier-cli"
    core.write_bytes(b"core")
    cli.write_bytes(b"cli")
    runtime = EasyTierRuntime(core, cli, tmp_path / "managed-mesh")
    active = {"value": False, "pid_reused": False}
    starts: list[str] = []

    monkeypatch.setattr(runtime, "_secure_instance_directory", lambda _path: None)
    monkeypatch.setattr(runtime, "_validate_child_runtime", lambda: None)
    monkeypatch.setattr(runtime, "_check_config", lambda *_args: None)
    monkeypatch.setattr(runtime, "_port_available", lambda _port: True)
    monkeypatch.setattr(runtime, "_create_time", lambda _pid: 1.0)
    monkeypatch.setattr(runtime, "_owned_process", lambda _record: active["value"])
    monkeypatch.setattr(runtime, "_pid_exists", lambda _record: active["value"] or active["pid_reused"])
    monkeypatch.setattr(runtime, "_socks_ready", lambda _record: active["value"])

    def start(instance_id, *_args):
        starts.append(instance_id)
        active["value"] = True
        return SimpleNamespace(pid=234567890)

    monkeypatch.setattr(runtime, "_start", start)
    monkeypatch.setattr(runtime, "_wait_ready", lambda instance_id, record: {
        "state": "ready", "network_id": record["network_id"], "instance_id": instance_id,
        "revision": record["revision"], "service_ip": record["service_ip"],
        "socks_proxy": {"host": "127.0.0.1", "port": record["socks_port"]},
    })
    network_id = "00000000-0000-0000-0000-000000000001"
    instance_id = "00000000-0000-0000-0000-000000000002"
    config = {
        "network_id": network_id,
        "instance_id": instance_id,
        "revision": 1,
        "network_name": "paired-network",
        "ipv4": "10.240.0.10/32",
        "service_ip": "10.224.0.10",
        "peers": ["udp://127.0.0.1:11010"],
        "credential_private_key": base64.b64encode(b"k" * 32).decode("ascii"),
    }
    return runtime, config, starts, active


def test_transfer_network_route_restores_only_the_saved_stopped_instance(managed_mesh) -> None:
    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    assert applied["state"] == "ready"
    starts.clear()
    active["value"] = False

    status = runtime.status_for_network(config["network_id"])
    assert status["state"] == "stopped"
    assert starts == []
    record = runtime._load_records()[config["instance_id"].replace("-", "")]
    saved_config = Path(record["config_path"]).read_bytes()

    service = FsService.__new__(FsService)
    service.mesh_runtime = runtime
    service_ip = service._network_address(config["network_id"])
    socks_proxy = service._network_socks_proxy(config["network_id"])

    assert service_ip == config["service_ip"]
    assert socks_proxy == {"host": "127.0.0.1", "port": applied["socks_proxy"]["port"]}
    assert starts == [config["instance_id"].replace("-", "")]
    assert Path(record["config_path"]).read_bytes() == saved_config
    assert runtime.status(config["instance_id"])["state"] == "ready"
    assert runtime.restore_stopped_network(config["network_id"])["state"] == "ready"
    assert starts == [config["instance_id"].replace("-", "")]


def test_registered_mesh_restore_requires_matching_fresh_authority(managed_mesh) -> None:
    import time
    from uuid import UUID

    runtime, config, starts, active = managed_mesh
    runtime.apply(config)
    starts.clear()
    active["value"] = False
    service = object.__new__(FsService)
    service.device = "node"
    service.mesh_runtime = runtime
    now = int(time.time())
    authority = {"kind": "hub_mesh", "actor_id": "owner", "target_id": "node",
                 "network_id": config["network_id"], "instance_id": config["instance_id"],
                 "service_ip": config["service_ip"], "operation_id": "reconnect",
                 "authorization_revision": 2, "config_revision": config["revision"],
                 "issued_at": now, "expires_at": now + 40}
    for override in ({"expires_at": now - 1}, {"config_revision": 2},
                     {"instance_id": "f" * 32}, {"service_ip": "10.224.0.11"}):
        with pytest.raises(FsError):
            service.dispatch_hub("mesh_restore", {}, {**authority, **override})
        assert not starts
    result = service.dispatch_hub("mesh_restore", {}, authority)
    assert result["state"] == "ready" and result["instance_id"] == config["instance_id"]
    assert len(starts) == 1
    active["value"] = True
    service.dispatch_hub("mesh_restore", {}, authority)
    assert len(starts) == 1
    active["value"] = False
    runtime.stop(UUID(config["instance_id"]).hex)
    with pytest.raises(FsError):
        service.dispatch_hub("mesh_restore", {}, authority)
    assert len(starts) == 1


def test_restore_refuses_modified_local_configuration_without_starting(managed_mesh) -> None:
    runtime, config, starts, active = managed_mesh
    runtime.apply(config)
    starts.clear()
    active["value"] = False
    record = runtime._load_records()[config["instance_id"].replace("-", "")]
    Path(record["config_path"]).write_text("# changed\n", encoding="utf-8")

    with pytest.raises(MeshRuntimeError, match="configuration changed"):
        runtime.restore_stopped_network(config["network_id"])
    assert starts == []


def test_restore_refuses_unverified_pid_without_replacing_it(managed_mesh) -> None:
    runtime, config, starts, active = managed_mesh
    runtime.apply(config)
    starts.clear()
    active["value"] = False
    active["pid_reused"] = True

    with pytest.raises(MeshRuntimeError, match="not verifiably stopped"):
        runtime.restore_stopped_network(config["network_id"])
    assert starts == []


def test_member_wss_retains_the_issuer_trust_and_base_config(managed_mesh, monkeypatch) -> None:
    runtime, config, starts, active = managed_mesh
    original = runtime.apply(config)
    record = runtime._load_records()[original["instance_id"]]
    base = Path(record["config_path"])
    credentials = base.with_name("managed-credentials.json")
    original_body, original_trust = base.read_bytes(), credentials.read_bytes()
    common = {"network_id": original["network_id"], "expires_at": int(time.time()) + 120}
    policies = (
        ({**common, "mode": "listen", "port": 11015}, 'ws://127.0.0.1:11015'),
        ({**common, "mode": "dial", "uri": f"wss://hub.example/tether-mesh-relay?network={original['network_id']}",
          "public_key": base64.b64encode(bytes(range(1, 33))).decode("ascii")}, 'peer_public_key = '),
    )
    for policy, expected in policies:
        monkeypatch.setenv("TETHER_MESH_MEMBER_WSS", json.dumps(policy))
        active["value"] = False
        assert runtime.restore_stopped_network(original["network_id"]) == original
        effective = base.with_name(".transport-runtime.toml").read_text(encoding="utf-8")
        assert expected in effective and 'disable_relay_data = true' in effective
        assert f'uri = "{config["peers"][0]}"' in effective
        assert base.read_bytes() == original_body and credentials.read_bytes() == original_trust
        assert not base.with_name(".relay-credentials.json").exists()
    monkeypatch.delenv("TETHER_MESH_MEMBER_WSS")
    active["value"] = False
    assert runtime.restore_stopped_network(original["network_id"]) == original
    assert not base.with_name(".transport-runtime.toml").exists()
    assert starts == [original["instance_id"]] * 4


@pytest.mark.skipif(os.name != "nt", reason="uses a Windows directory junction")
def test_restore_accepts_only_the_migrated_credential_path(managed_mesh, tmp_path) -> None:
    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    instance_id = applied["instance_id"]
    starts.clear()
    active["value"] = False

    old_root = tmp_path / "previous-managed-mesh"
    subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/j", str(old_root), str(runtime.root)],
                   check=True, capture_output=True)
    records = runtime._load_records()
    record = records[instance_id]
    config_path = Path(record["config_path"])
    credential = config_path.with_name("managed-credentials.json")
    expected = config_path.read_bytes()
    old_directory = old_root / "instances" / instance_id
    old_credential = old_directory / credential.name
    alias_config = expected.replace(runtime._toml_string(str(credential)).encode("utf-8"),
                                    runtime._toml_string(str(old_credential)).encode("utf-8"), 1)
    assert old_credential.samefile(credential)
    assert alias_config != expected
    record.update(directory=str(old_directory), config_path=str(old_directory / config_path.name))

    # A valid stored digest does not authorize a second configuration change.
    unexpected = alias_config.replace(b"disable_relay_data = true", b"disable_relay_data = false")
    record["config_sha256"] = hashlib.sha256(unexpected).hexdigest()
    config_path.write_bytes(unexpected)
    runtime._save_records(records)
    with pytest.raises(MeshRuntimeError, match="without a new revision"):
        runtime.restore_stopped_network(config["network_id"])
    assert starts == []

    record["config_sha256"] = hashlib.sha256(alias_config).hexdigest()
    config_path.write_bytes(alias_config)
    runtime._save_records(records)
    credential.unlink()
    with pytest.raises(MeshRuntimeError, match="credential file is unavailable"):
        runtime.restore_stopped_network(config["network_id"])
    assert starts == []

    credential.write_text("{}\n", encoding="utf-8")
    assert runtime.restore_stopped_network(config["network_id"]) == applied
    assert starts == [instance_id]
    assert config_path.read_bytes() == expected
    assert runtime._load_records()[instance_id]["config_sha256"] == hashlib.sha256(expected).hexdigest()


def test_peer_health_reads_the_instances_own_rpc_portal(managed_mesh, monkeypatch) -> None:
    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    payload = json.dumps([
        {"id": "self", "hostname": "node", "cost": "Local", "lat_ms": "-", "loss_rate": "-",
         "tunnel_proto": "-", "nat_type": "Symmetric"},
        {"id": "peer-a", "hostname": "laptop", "cost": "relay(2)", "lat_ms": "148.00", "loss_rate": "0.0%",
         "tunnel_proto": "", "nat_type": "Symmetric"},
        {"id": "peer-b", "hostname": "desktop", "cost": "p2p", "lat_ms": "23.40", "loss_rate": "0.25%",
         "tunnel_proto": "udp", "nat_type": "PortRestricted"},
    ]).encode()
    calls = []

    def run(argv, **_kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, stdout=payload)

    monkeypatch.setattr("tether.node.mesh_runtime.subprocess.run", run)
    health = runtime.peer_health(applied["instance_id"], max_age=0)
    assert health["peer_connectivity"] == "direct"
    assert health["peer_count"] == 3 and health["remote_peer_count"] == 2 and health["cost"] == "p2p"
    assert health["tunnel"] == "udp" and health["latency_ms"] == 23.4 and health["loss_rate"] == 0.25
    record = runtime._load_records()[applied["instance_id"]]
    assert calls[0][:2] == [str(runtime.cli), "-p"]
    assert calls[0][2] == f"127.0.0.1:{record['rpc_port']}" and calls[0][-2:] == ["peer", "list"]
    assert [peer["hostname"] for peer in runtime.status(applied["instance_id"])["peers"]] == [
        "node", "laptop", "desktop"]

    monkeypatch.setattr("tether.node.mesh_runtime.subprocess.run",
                        lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stdout=b""))
    failed = runtime.peer_health(applied["instance_id"], max_age=0)
    assert failed["peers"] is None and failed["peer_connectivity"] == "unknown"
    assert failed["error"] == "peer_query_failed"


def test_supervisor_restores_a_stopped_instance_and_reports_real_health(managed_mesh) -> None:
    from tether.node.mesh_supervisor import MeshSupervisor

    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    starts.clear()
    active["value"] = False
    supervisor = MeshSupervisor(runtime)
    supervisor.tick()

    assert starts == [applied["instance_id"]]
    assert runtime.status(applied["instance_id"])["state"] == "ready"
    entry = supervisor.summary()["networks"][0]
    assert entry["state"] == "ready" and entry["instance_id"] == applied["instance_id"]
    assert entry["peers"] is None and entry["peer_connectivity"] == "unknown"
    assert entry["health_error"] == "peer_query_failed"


def test_supervisor_never_replaces_a_process_it_cannot_attribute(managed_mesh) -> None:
    from tether.node.mesh_supervisor import MeshSupervisor

    runtime, config, starts, active = managed_mesh
    runtime.apply(config)
    starts.clear()
    active["value"] = False
    active["pid_reused"] = True
    supervisor = MeshSupervisor(runtime)
    supervisor.tick()
    supervisor.tick()

    assert starts == []
    entry = supervisor.summary()["networks"][0]
    assert entry["state"] == "unverified"
    assert entry["last_error"] == "process_identity_unverified"
    assert entry["peer_connectivity"] == "unknown"


def test_supervisor_relaunches_an_instance_built_by_a_previous_launch(managed_mesh, monkeypatch) -> None:
    from tether.node.mesh_supervisor import MeshSupervisor

    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    records = runtime._load_records()
    records[applied["instance_id"]]["launch_sha256"] = "0" * 64
    runtime._save_records(records)
    starts.clear()
    monkeypatch.setattr(runtime, "_stop_record", lambda _record: active.__setitem__("value", False))
    supervisor = MeshSupervisor(runtime)
    supervisor.tick()

    assert starts == [applied["instance_id"]]
    assert runtime._load_records()[applied["instance_id"]]["launch_sha256"] == runtime.launch_sha256()
    assert supervisor.summary()["networks"][0]["state"] == "ready"


def test_supervisor_backs_off_after_a_failed_restore(managed_mesh) -> None:
    from tether.node.mesh_supervisor import MeshSupervisor

    runtime, config, starts, active = managed_mesh
    applied = runtime.apply(config)
    starts.clear()
    active["value"] = False
    record = runtime._load_records()[applied["instance_id"]]
    Path(record["config_path"]).write_text("# changed\n", encoding="utf-8")
    supervisor = MeshSupervisor(runtime)
    supervisor.tick()
    supervisor.tick()

    assert starts == [] and runtime.status(applied["instance_id"])["state"] == "stopped"
    entry = supervisor.summary()["networks"][0]
    assert entry["state"] == "stopped" and "configuration changed" in entry["last_error"]
    assert entry["retry_in_seconds"] >= 0
