from __future__ import annotations

import hashlib
import importlib.util
import io
import zipfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "hydrate_herdr_runtime", Path(__file__).parents[1] / "scripts" / "hydrate_herdr_runtime.py"
)
assert SPEC and SPEC.loader
hydrator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hydrator)


def _asset(data: bytes, url: str) -> dict:
    return {"url": url, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _fixture():
    payloads = {
        "linux": b"linux runtime",
        "macos": b"macos runtime",
        "windows": b"windows runtime",
        "dll": b"conpty dll",
        "json": b'{"version":1}',
        "openconsole-x64": b"x64 console",
        "openconsole-arm64": b"arm console",
    }
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, key in {
            "herdr.exe": "windows",
            "conpty/conpty.dll": "dll",
            "conpty/herdr-conpty.json": "json",
            "conpty/x64/OpenConsole.exe": "openconsole-x64",
            "conpty/arm64/OpenConsole.exe": "openconsole-arm64",
            "THIRD-PARTY-NOTICES/extra.txt": "json",
        }.items():
            archive.writestr(path, payloads[key])
    payloads["windows-archive"] = archive_buffer.getvalue()
    assets = {
        name: _asset(payloads[key], f"https://assets.invalid/{name}")
        for name, key in {"linux": "linux", "macos": "macos", "windows": "windows-archive"}.items()
    }
    files = {
        "herdr-linux-x86_64": {"asset": "linux", "size": len(payloads["linux"]), "sha256": hashlib.sha256(payloads["linux"]).hexdigest()},
        "herdr-macos-x86_64": {"asset": "macos", "size": len(payloads["macos"]), "sha256": hashlib.sha256(payloads["macos"]).hexdigest()},
        "herdr.exe": {"asset": "windows", "member": "herdr.exe", "size": len(payloads["windows"]), "sha256": hashlib.sha256(payloads["windows"]).hexdigest()},
        "conpty/conpty.dll": {"asset": "windows", "member": "conpty/conpty.dll", "size": len(payloads["dll"]), "sha256": hashlib.sha256(payloads["dll"]).hexdigest()},
        "conpty/herdr-conpty.json": {"asset": "windows", "member": "conpty/herdr-conpty.json", "size": len(payloads["json"]), "sha256": hashlib.sha256(payloads["json"]).hexdigest()},
        "conpty/x64/OpenConsole.exe": {"asset": "windows", "member": "conpty/x64/OpenConsole.exe", "size": len(payloads["openconsole-x64"]), "sha256": hashlib.sha256(payloads["openconsole-x64"]).hexdigest()},
        "conpty/arm64/OpenConsole.exe": {"asset": "windows", "member": "conpty/arm64/OpenConsole.exe", "size": len(payloads["openconsole-arm64"]), "sha256": hashlib.sha256(payloads["openconsole-arm64"]).hexdigest()},
    }
    url_to_payload = {spec["url"]: payloads[name + ("-archive" if name == "windows" else "")] for name, spec in assets.items()}

    def downloader(url: str, destination: Path) -> None:
        destination.write_bytes(url_to_payload[url])

    return payloads, assets, files, downloader


def test_hydrate_verifies_and_installs_only_pinned_runtime_files(tmp_path: Path):
    _, assets, files, downloader = _fixture()
    installed = hydrator.hydrate(tmp_path / "bin", downloader=downloader, assets=assets, files=files)
    assert set(installed) == set(files)
    assert {path.relative_to(tmp_path / "bin").as_posix() for path in (tmp_path / "bin").rglob("*") if path.is_file()} == set(files)
    assert hydrator.hydrate(tmp_path / "bin", downloader=downloader, assets=assets, files=files) == []


def test_mismatching_existing_runtime_file_aborts_before_any_install_or_download(tmp_path: Path):
    _, assets, files, downloader = _fixture()
    destination = tmp_path / "bin"
    destination.mkdir()
    (destination / "herdr-linux-x86_64").write_bytes(b"wrong local file")
    calls = []

    def counted_download(url: str, path: Path) -> None:
        calls.append(url)
        downloader(url, path)

    try:
        hydrator.hydrate(destination, downloader=counted_download, assets=assets, files=files)
    except ValueError as error:
        assert "failed pinned size/SHA-256 verification" in str(error)
    else:
        raise AssertionError("mismatching existing file was overwritten")
    assert calls == []
    assert {path.name for path in destination.iterdir()} == {"herdr-linux-x86_64"}


def test_bad_archive_is_rejected_before_any_runtime_file_is_installed(tmp_path: Path):
    _, assets, files, downloader = _fixture()
    assets = {**assets, "windows": {**assets["windows"], "sha256": "0" * 64}}
    destination = tmp_path / "bin"
    try:
        hydrator.hydrate(destination, downloader=downloader, assets=assets, files=files)
    except ValueError as error:
        assert "official Herdr windows asset failed pinned size/SHA-256 verification" in str(error)
    else:
        raise AssertionError("bad archive was accepted")
    assert not any(path.is_file() for path in destination.rglob("*"))


def test_hydrated_files_remain_in_the_standalone_node_runtime_archive(tmp_path: Path):
    _, assets, files, downloader = _fixture()
    destination = tmp_path / "tether" / "node" / "bin"
    hydrator.hydrate(destination, downloader=downloader, assets=assets, files=files)
    build_spec = importlib.util.spec_from_file_location(
        "build_release_hydration_test", Path(__file__).parents[1] / "scripts" / "build_release.py"
    )
    assert build_spec and build_spec.loader
    builder = importlib.util.module_from_spec(build_spec)
    build_spec.loader.exec_module(builder)
    builder.ROOT = tmp_path
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        builder.add_tether_runtime(archive, "node-root")
    with zipfile.ZipFile(io.BytesIO(archive_bytes.getvalue())) as archive:
        names = set(archive.namelist())
    assert names == {"node-root/tether/node/bin/" + relative for relative in files}
