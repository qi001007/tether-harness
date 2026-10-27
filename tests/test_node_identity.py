import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from tether.node.local_identity import identity_path, remove_identity, write_identity


def test_node_identity_is_atomically_refreshed_and_only_its_owner_removes_it(tmp_path):
    home = tmp_path / "isolated-dsh-home"
    first = write_identity(home, "LAPTOP-01", pid=os.getpid(), now=10)
    assert first == identity_path(home, os.getpid())
    assert json.loads(first.read_text(encoding="utf-8")) == {
        "version": 1, "pid": os.getpid(), "device_id": "LAPTOP-01", "updated_at": 10,
    }

    second = write_identity(home, "LAPTOP-01", pid=os.getpid(), now=20)
    assert second == first
    assert json.loads(second.read_text(encoding="utf-8"))["updated_at"] == 20
    assert list(first.parent.glob("*.tmp")) == []
    if os.name != "nt":
        assert first.stat().st_mode & 0o777 == 0o600

    assert remove_identity(home, "DESKTOP-LOCAL", pid=os.getpid()) is False
    assert first.exists()
    assert remove_identity(home, "LAPTOP-01", pid=os.getpid()) is True
    assert not first.exists()


def test_python_writer_descriptor_is_read_by_dsh_companion_as_current_identity(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the cross-language descriptor check")
    home = tmp_path / "isolated-dsh-home"
    write_identity(home, "LAPTOP-01", pid=os.getpid())
    root = Path(__file__).resolve().parents[1]
    script = (
        "import { internals } from './packages/tether-dsh-surface/lib/index.js';"
        "process.stdout.write(internals.readLocalDeviceId({ isPidAlive: () => true }) || 'unknown')"
    )
    result = subprocess.run(
        [node, "--input-type=module", "-e", script], cwd=root,
        env={**os.environ, "DSH_HOME": str(home)}, check=True, capture_output=True, text=True,
    )
    assert result.stdout == "LAPTOP-01"


@pytest.mark.parametrize("device_id", ["", "bad\nidentity", "x" * 257])
def test_node_identity_rejects_invalid_device_ids(tmp_path, device_id):
    with pytest.raises(ValueError):
        write_identity(tmp_path, device_id)

