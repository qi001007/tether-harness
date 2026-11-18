from pathlib import Path

from tether.node.sftpgo_grants import SftpGoGrants


def test_windows_managed_sftpgo_uses_bolt_for_new_instances(tmp_path: Path) -> None:
    result = SftpGoGrants._managed_provider_config(tmp_path, platform="nt")

    assert result == {"driver": "bolt", "name": str(tmp_path / "sftpgo.bolt")}


def test_windows_managed_sftpgo_preserves_existing_sqlite_database(tmp_path: Path) -> None:
    legacy_db = tmp_path / "sftpgo.db"
    legacy_db.write_bytes(b"existing sqlite database")

    result = SftpGoGrants._managed_provider_config(tmp_path, platform="nt")

    assert result == {"driver": "sqlite", "name": str(legacy_db)}
    assert legacy_db.read_bytes() == b"existing sqlite database"


def test_non_windows_managed_sftpgo_keeps_sqlite_default(tmp_path: Path) -> None:
    result = SftpGoGrants._managed_provider_config(tmp_path, platform="posix")

    assert result == {"driver": "sqlite", "name": str(tmp_path / "sftpgo.db")}
