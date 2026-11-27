"""linux-arm64 Node 制品侧的架构判定。

`ARCHITECTURE = "amd64"` 一旦写死，Pi 上的 deb 会被自己的身份校验判成
deb_identity_mismatch —— 包造出来了也装不上。这里先钉住「按宿主推导」。
"""
from __future__ import annotations

import platform as platform_module
from pathlib import Path

import pytest

from tether.node.debian_package_update import DebianPackageUpdater, deb_filename
from tether.updates import debian_architecture


@pytest.mark.parametrize(("machine", "expected"), [
    ("x86_64", "amd64"),
    ("AMD64", "amd64"),
    ("aarch64", "arm64"),
    ("arm64", "arm64"),
    ("armv7l", None),
    ("i386", None),
])
def test_debian_architecture_maps_known_machines(machine: str, expected: str | None) -> None:
    assert debian_architecture(machine) == expected


def test_debian_architecture_is_none_off_linux(monkeypatch) -> None:
    """宿主不是 Linux 时不给架构名，否则 Windows 也能声称自己是 amd64。"""
    import tether.updates as updates

    monkeypatch.setattr(updates.sys, "platform", "win32", raising=False)

    assert updates.debian_architecture() is None


@pytest.fixture
def linux_host(monkeypatch):
    """把「这是一台 Linux 机器」这件事说清楚：映射函数看的是 sys.platform。"""
    import sys
    import tether.updates as updates

    monkeypatch.setattr(updates.sys, "platform", "linux", raising=False)
    monkeypatch.setattr(sys, "platform", "linux", raising=False)
    return monkeypatch


def test_updater_architecture_follows_the_host_not_a_constant(tmp_path: Path, linux_host) -> None:
    linux_host.setattr(platform_module, "machine", lambda: "aarch64")

    updater = DebianPackageUpdater(tmp_path, owner="deb_package_manager")

    assert updater.architecture == "arm64"


def test_deb_filename_carries_the_requested_architecture() -> None:
    assert deb_filename("0.5.16", "arm64") == "tether-node_0.5.16_arm64.deb"
    assert deb_filename("0.5.16", "amd64") == "tether-node_0.5.16_amd64.deb"


def test_updater_reports_no_unsupported_architecture_on_arm64(tmp_path: Path, linux_host) -> None:
    """架构本身不该再是拒绝理由；后面的 root/dpkg 判定才该管。"""
    import os as os_module

    linux_host.setattr(platform_module, "machine", lambda: "aarch64")
    linux_host.setattr(DebianPackageUpdater, "_os_id", lambda self: "ubuntu")
    # geteuid 在 Windows 上不存在，raising=False 让这条 Linux-only 路径能在本机跑。
    linux_host.setattr(os_module, "geteuid", lambda: 0, raising=False)
    linux_host.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    # availability() 用 Path("/run/systemd/system").is_dir() 判 systemd；只放开这一条，
    # 全局改 is_dir 会把 pathlib 自己的 glob 弄坏。
    original_is_dir = Path.is_dir
    linux_host.setattr(Path, "is_dir",
                       lambda self: True if str(self) == "/run/systemd/system" else original_is_dir(self))
    updater = DebianPackageUpdater(tmp_path, owner="deb_package_manager")
    linux_host.setattr(updater, "_installed", lambda: {
        "package": "tether-node", "version": "0.5.15", "architecture": "arm64"})

    linux_host.setattr(updater, "_systemd_owner", lambda: True)
    reason = updater.availability()["reason"]

    assert reason != "unsupported_architecture"


def test_headless_targets_share_one_architecture_table() -> None:
    """产者与验者必须用同一张表，否则 arm64 包造出来会被自己的校验拒收。"""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "prepare_runtime_under_test",
        Path(__file__).resolve().parents[1] / "desktop" / "packaging" / "prepare_runtime.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    assert module.HEADLESS_TARGETS == {"linux-x64": "amd64", "linux-arm64": "arm64"}
    assert module.headless_deb_arch("linux-arm64") == "arm64"
    assert module.headless_deb_arch("linux-x64") == "amd64"


def test_headless_target_names_follow_the_target() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "prepare_runtime_names",
        Path(__file__).resolve().parents[1] / "desktop" / "packaging" / "prepare_runtime.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    assert module.headless_archive_name("0.5.16", "linux-arm64") == "Tether-node-runtime-0.5.16-linux-arm64.tar.gz"
    assert module.headless_deb_name("0.5.16", "linux-arm64") == "Tether-node-runtime-0.5.16-linux-arm64.deb"


def test_unknown_headless_target_is_refused_not_defaulted() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "prepare_runtime_unknown",
        Path(__file__).resolve().parents[1] / "desktop" / "packaging" / "prepare_runtime.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    with pytest.raises(ValueError):
        module.headless_deb_arch("linux-armv7l")


@pytest.fixture
def fake_machine(monkeypatch):
    import tether.node.croc_transfer as croc_module

    def apply(machine: str) -> None:
        monkeypatch.setattr(croc_module.host_platform, "machine", lambda: machine)
        monkeypatch.setattr("shutil.which", lambda name: None)
        monkeypatch.setattr(croc_module.os, "environ", {**croc_module.os.environ, "TETHER_CROC": ""})
        monkeypatch.delenv("TETHER_CROC", raising=False)
    return apply


def test_croc_does_not_run_the_x64_binary_on_arm64(fake_machine) -> None:
    """缺陷三：aarch64 上选中 croc-linux-x64 会得到 Exec format error。"""
    from tether.node.croc_transfer import CrocTransfer

    fake_machine("aarch64")
    croc = CrocTransfer(relay="r:1", platform="linux")

    assert croc.binary() == "", f"cross-arch fallback picked {croc.binary()}"
    assert croc.available() is False


def test_croc_still_picks_x64_on_x86_64(fake_machine) -> None:
    """收紧只管架构不匹配，别把现有 x64 路径一起废掉。"""
    from tether.node.croc_transfer import CrocTransfer

    fake_machine("x86_64")
    croc = CrocTransfer(relay="r:1", platform="linux")

    assert croc.binary().endswith("croc-linux-x64")


def test_croc_keeps_the_rosetta_fallback_on_macos_arm64(fake_machine) -> None:
    """macOS arm64 跑 x64 是 Rosetta，和 Linux 的硬错误不是同一件事。"""
    from tether.node.croc_transfer import CrocTransfer

    fake_machine("arm64")
    croc = CrocTransfer(relay="r:1", platform="darwin")

    assert croc.binary().endswith(("croc-darwin-arm64", "croc-darwin-x64"))


def test_croc_accepts_a_host_installed_binary_on_arm64(monkeypatch, fake_machine) -> None:
    """用户自己装的 croc 属于本机架构，不该被收紧误伤。"""
    from tether.node.croc_transfer import CrocTransfer

    fake_machine("aarch64")
    monkeypatch.setattr("shutil.which", lambda name: "/usr/local/bin/croc" if name == "croc" else None)
    croc = CrocTransfer(relay="r:1", platform="linux")

    assert croc.binary() == "/usr/local/bin/croc"



@pytest.mark.parametrize(("target", "architecture"), [("linux-arm64", "arm64"), ("linux-x64", "amd64")])
def test_debian_build_identity_and_service_are_consistent(tmp_path, monkeypatch, target, architecture):
    import importlib.util
    import json

    packaging = Path(__file__).resolve().parents[1] / "desktop/packaging"
    monkeypatch.syspath_prepend(str(packaging))
    monkeypatch.setenv("TETHER_HEADLESS_TARGET", target)
    spec = importlib.util.spec_from_file_location("headless_deb_under_test", packaging / "build_headless_deb.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    payload = tmp_path / "runtime"
    if target == "linux-x64":
        office = payload / "resources/tether-runtime/components/libreoffice/linux-dependencies.json"
        office.parent.mkdir(parents=True)
        office.write_text(json.dumps({"depends": ["libx11-6"], "source_sha256":
                                     "8290c8f46cb33d6df8f681cb796e0697461ea070f86ec55b63c94d7eb9d9a476"}))
    config = json.loads(builder._nfpm_config(tmp_path, payload).read_bytes())
    assert config["arch"] == config["deb"]["arch"] == architecture
    assert builder.DEB_NAME == f"Tether-node-runtime-{builder.VERSION}-{target}.deb"
    postinst = Path(config["scripts"]["postinstall"]).read_text()
    assert f"ARCH={architecture}" in postinst and "useradd --system --gid tether" in postinst
    service = next(Path(item["src"]) for item in config["contents"] if item["dst"].endswith("tether-node.service"))
    assert "User=tether" in service.read_text() and "Group=tether" in service.read_text()

def test_unprivileged_deb_install_reports_an_administrator_update(tmp_path, linux_host):
    import os
    from unittest.mock import patch

    linux_host.setattr(platform_module, "system", lambda: "Linux")
    linux_host.setattr(DebianPackageUpdater, "_os_id", lambda self: "debian")
    linux_host.setattr(os, "geteuid", lambda: 99, raising=False)
    updater = DebianPackageUpdater(tmp_path, owner="deb_package_manager")
    linux_host.setattr(updater, "_installed", lambda: None)
    with patch.object(Path, "is_dir", side_effect=PermissionError):
        result = updater.availability()
    assert result["available"] is False
    assert result["reason"] == "root_required" and result["transaction"] is None
