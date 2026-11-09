from __future__ import annotations

from threading import RLock

import pytest

from tether.node.remote_desktop import MeshCentralDesktop, RemoteDesktopError


def _manager(item: dict[str, object]) -> MeshCentralDesktop:
    manager = object.__new__(MeshCentralDesktop)
    manager._lock = RLock()
    manager._native_node_id = lambda: str(item["mesh_node_id"])
    manager._validate_authority = lambda authority: authority
    manager._load_shares = lambda: {str(item["grant_id"]): dict(item)}
    manager._load_record = lambda: {}
    manager._meshctrl = lambda *_args: "removed"
    manager._native_share_exists = lambda _item: False
    manager._save_shares = lambda _shares: None
    return manager


def _grant(revision: str = "2") -> dict[str, str]:
    return {"actor_id": "qa-owner", "target_id": "QA-DEST-01", "grant_id": "grant-1",
            "authorization_revision": revision, "operation_id": "operation-1"}


def _share(revision: str = "1") -> dict[str, str]:
    return {**_grant(revision), "mesh_node_id": "node/qa/MeshNode1234", "share_id": "share-1"}


def test_close_accepts_controller_revocation_revision_advance() -> None:
    item = _share("1")
    manager = _manager(item)

    result = manager.close(_grant("2"))

    assert result["state"] == "revoked"
    assert result["connections_closed"] is True


@pytest.mark.parametrize("field,value", [("authorization_revision", "0"), ("actor_id", "other-owner"),
                                          ("target_id", "other-target")])
def test_close_rejects_stale_revision_or_foreign_actor_and_target(field: str, value: str) -> None:
    item = _share("2")
    authority = _grant("3")
    authority[field] = value
    manager = _manager(item)

    with pytest.raises(RemoteDesktopError) as error:
        manager.close(authority)

    assert error.value.code == "grant_mismatch"


def test_close_rejects_a_different_local_mesh_node() -> None:
    item = _share("1")
    manager = _manager(item)
    manager._native_node_id = lambda: "node/qa/OtherMeshNode1234"

    with pytest.raises(RemoteDesktopError) as error:
        manager.close(_grant("2"))

    assert error.value.code == "grant_mismatch"


def test_view_and_renew_still_require_exact_revision() -> None:
    item = _share("1")
    manager = _manager(item)

    with pytest.raises(RemoteDesktopError) as view_error:
        manager.view(_grant("2"))
    assert view_error.value.code == "grant_mismatch"

    manager._validate_duration = lambda _duration: None
    with pytest.raises(RemoteDesktopError) as renew_error:
        manager.renew(_grant("2"), duration_seconds=3600)
    assert renew_error.value.code == "grant_mismatch"
