from pathlib import Path
from types import SimpleNamespace

from tether.node.fs_service import FsService


def service(tmp_path: Path):
    return FsService(device="NODE-TEST", workspace=tmp_path, data_dir=tmp_path / "data",
                     workspaces_root=tmp_path / "workspaces")


def test_dsh_account_status_uses_real_account_projection(tmp_path: Path):
    svc = service(tmp_path)
    svc.dsh_rpc = SimpleNamespace(account_status=lambda: {
        "state": "logged_in", "reason": "credential-stored", "attempt_phase": "succeeded", "error_code": None
    })

    result = svc.dispatch("dsh_account_status", {})

    assert result["device_id"] == "NODE-TEST"
    assert result["state"] == "logged_in"
    assert result["reason"] == "credential-stored"


def test_dsh_account_status_without_rpc_client_is_unknown(tmp_path: Path):
    svc = service(tmp_path)

    result = svc.dispatch("dsh_account_status", {})

    assert result["state"] == "unknown"
    assert result["reason"] == "account_rpc_unavailable"
