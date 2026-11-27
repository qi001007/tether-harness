"""清单装配脚本的回归：CI 曾经产出 Hub 收不下的清单，这里把那条路堵死。"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "assemble_release_manifest", ROOT / "scripts" / "assemble_release_manifest.py")
module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(module)


def _draft(tmp_path: Path, version: str = "0.9.9", plugin_version: str = "0.2.93",
           deb_bytes: int = 4096, architectures: tuple[str, ...] = ("x64",)) -> Path:
    dist = tmp_path / "draft"
    dist.mkdir(parents=True)
    payloads = {
        f"tether-app-{version}.zip": b"app-payload",
        f"tether-node-{version}.zip": b"node-payload",
        f"tether-plugin-{plugin_version}.zip": b"plugin-payload",
    }
    for architecture in architectures:
        payloads[f"Tether-node-runtime-{version}-linux-{architecture}.deb"] = bytes(deb_bytes)
    for name, payload in payloads.items():
        (dist / name).write_bytes(payload)
    return dist


BASE = "https://github.com/o/r/releases/download/v0.9.9"


def _signed(manifest: dict) -> dict:
    manifest["signature"] = "MEUCIQD-fake-signature-for-shape-tests"
    return manifest


def test_assemble_emits_every_component_with_flat_fields(tmp_path: Path) -> None:
    dist = _draft(tmp_path)
    manifest = module.assemble(dist, "0.9.9", "0.2.93", "preview", BASE)

    assert set(manifest["components"]) == {"app", "node", "plugin"}
    app = manifest["components"]["app"]
    assert app["url"] == f"{BASE}/tether-app-0.9.9.zip"
    assert app["size"] == len(b"app-payload")
    assert app["sha256"] == hashlib.sha256(b"app-payload").hexdigest()
    assert manifest["components"]["plugin"]["version"] == "0.2.93"
    debian = manifest["components"]["node"]["debian"]["amd64"]
    assert debian["package"] == "tether-node" and debian["format"] == "deb"


def test_assemble_refuses_a_missing_artifact(tmp_path: Path) -> None:
    dist = _draft(tmp_path)
    (dist / "tether-node-0.9.9.zip").unlink()

    with pytest.raises(SystemExit):
        module.assemble(dist, "0.9.9", "0.2.93", "preview", BASE)


def test_validate_catches_the_matrix_draft_shape(tmp_path: Path) -> None:
    """This is the exact shape release-matrix.yml used to upload: no plugin, no flat fields."""
    broken = _signed({
        "schema": 1, "channel": "preview",
        "components": {
            name: {"version": "0.9.9", "protocol": 1, "min_protocol": 1, "min_updater": "0.2.1",
                   "platforms": {"windows-x64": {"url": f"{BASE}/a.exe", "size": 10,
                                                 "sha256": "0" * 64, "format": "exe"}}}
            for name in ("app", "node")},
    })

    problems = module.validate(broken)

    assert any("plugin" in item for item in problems)
    assert any("url" in item for item in problems)


def test_validate_accepts_the_generated_manifest(tmp_path: Path) -> None:
    manifest = _signed(module.assemble(_draft(tmp_path), "0.9.9", "0.2.93", "preview", BASE))

    assert module.validate(manifest) == []


def test_oversized_deb_is_a_capacity_note_not_a_rejection(tmp_path: Path) -> None:
    dist = _draft(tmp_path, deb_bytes=module.HUB_MAX_MIRROR_BYTES + 1)
    manifest = _signed(module.assemble(dist, "0.9.9", "0.2.93", "preview", BASE))

    assert module.validate(manifest) == []
    assert any("Hub 镜像上限" in note for note in module.mirror_capacity(manifest))


def test_http_origin_is_rejected(tmp_path: Path) -> None:
    manifest = _signed(module.assemble(_draft(tmp_path), "0.9.9", "0.2.93", "preview",
                                       "http://github.com/o/r/releases/download/v0.9.9"))

    assert any("https" in item for item in module.validate(manifest))


def test_arm64_deb_is_registered_under_debian_arm64(tmp_path: Path) -> None:
    """发布矩阵即将产出 linux-arm64 deb，清单映射必须先被钉住。"""
    dist = _draft(tmp_path, architectures=("x64", "arm64"))

    manifest = _signed(module.assemble(dist, "0.9.9", "0.2.93", "preview", BASE))
    debian = manifest["components"]["node"]["debian"]

    assert set(debian) == {"amd64", "arm64"}
    assert debian["arm64"]["architecture"] == "arm64"
    assert debian["arm64"]["package"] == "tether-node"
    assert debian["arm64"]["url"] == f"{BASE}/Tether-node-runtime-0.9.9-linux-arm64.deb"
    assert module.validate(manifest) == []


def test_arm64_only_draft_still_produces_a_valid_manifest(tmp_path: Path) -> None:
    dist = _draft(tmp_path, architectures=("arm64",))

    manifest = _signed(module.assemble(dist, "0.9.9", "0.2.93", "preview", BASE))

    assert set(manifest["components"]["node"]["debian"]) == {"arm64"}
    assert module.validate(manifest) == []


def test_unknown_deb_architecture_is_rejected(tmp_path: Path) -> None:
    manifest = _signed(module.assemble(_draft(tmp_path), "0.9.9", "0.2.93", "preview", BASE))
    manifest["components"]["node"]["debian"]["rpi-32"] = dict(
        manifest["components"]["node"]["debian"]["amd64"], architecture="rpi-32")

    assert any("rpi-32" in item for item in module.validate(manifest))

@pytest.mark.parametrize(("channel", "feed"), [("stable", "latest"), ("preview", "preview")])
def test_signed_matrix_feed_can_update_all_supported_architectures(tmp_path, monkeypatch, channel, feed):
    import base64
    import sys
    import yaml
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from tether import release

    version, plugin = "0.9.9", "0.2.93"
    dist = _draft(tmp_path, version, plugin, architectures=())
    inputs = tmp_path / "inputs"
    key = Ed25519PrivateKey.generate()
    seed_bytes = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                  serialization.NoEncryption())
    monkeypatch.setenv("TETHER_RELEASE_PRIVATE_KEY", base64.b64encode(seed_bytes).decode())
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    monkeypatch.setattr(release, "PUBLIC_KEY_HEX", public.hex())
    seed = module.assemble(dist, version, plugin, channel, BASE, plugin_base_url="https://example.org/v0.2.93")
    seed["signature"] = base64.b64encode(key.sign(release.canonical_bytes(seed))).decode()
    (dist / "tether-update.json").write_text(json.dumps(seed), encoding="utf-8")
    (dist / f"tether-plugin-{plugin}.zip").unlink()  # plugin is served from its independent release

    for target, extension, suffix in [
        ("windows-x64", ".exe", ""), ("linux-x64", ".AppImage", "-linux"),
        ("linux-arm64", None, None), ("macos-x64", ".dmg", "-mac"), ("macos-arm64", ".dmg", "-mac"),
    ]:
        directory = inputs / f"tether-{version}-{target}" / target
        directory.mkdir(parents=True)
        if target.startswith("linux-"):
            for ext in ("tar.gz", "deb"):
                (directory / f"Tether-node-runtime-{version}-{target}.{ext}").write_bytes(target.encode())
        if extension:
            name = f"Tether-{version}-{target}{extension}"
            (directory / name).write_bytes(target.encode())
            if suffix == "-mac":
                name = f"Tether-{version}-{target}.zip"
                (directory / name).write_bytes(target.encode())
            files = [{"url": name, "size": len(target), "sha512": "fixture"}]
            (directory / f"{feed}{suffix}.yml").write_text(yaml.safe_dump({"version": version, "files": files}))

    monkeypatch.setattr(sys, "argv", ["assemble_release_manifest", "matrix", "--inputs", str(inputs),
                                     "--dist", str(dist), "--version", version, "--channel", channel, "--base-url", BASE])
    assert module.main() == 0
    manifest = json.loads((dist / "tether-update.json").read_bytes())
    release.verify_signature(manifest)
    assert module.validate(manifest) == []
    assert manifest["components"]["plugin"] == seed["components"]["plugin"]
    for slot in ("platforms", "debian"):
        assert len(manifest["components"]["node"][slot]) == 2
        for entry in manifest["components"]["node"][slot].values():
            path = dist / entry["url"].split("/")[-1]
            assert entry["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert len(manifest["components"]["app"]["platforms"]) == 4
    mac_feed = yaml.safe_load((dist / f"{feed}-mac.yml").read_text())
    assert {entry["url"] for entry in mac_feed["files"]} == {
        f"Tether-{version}-macos-x64.zip", f"Tether-{version}-macos-arm64.zip"}
    assert f"{module.digest(dist / 'tether-update.json')}  tether-update.json" in (dist / "SHA256SUMS").read_text()
