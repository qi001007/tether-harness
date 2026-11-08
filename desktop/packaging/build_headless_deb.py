from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / ".scratch" / "tether-desktop-candidates" / "0.5.0" / "headless" / "linux-x64"
ARCHIVE = OUTPUT_DIR / "Tether-node-runtime-0.5.0-linux-x64.tar.gz"
DEB_NAME = "Tether-node-runtime-0.5.0-linux-x64.deb"
PACKAGE_ROOT = "tether-node-runtime-0.5.0"
NFPM_SHA256 = "6d7f9a28b2f397934403950fcbba83f598b08d02edbe79a0815b3b4897341750"


def _extract_runtime(temporary: Path) -> Path:
    if not ARCHIVE.is_file():
        raise ValueError(f"headless runtime tarball is missing: {ARCHIVE}")
    destination = temporary / "unpacked"
    destination.mkdir()
    with tarfile.open(ARCHIVE, "r:gz") as archive:
        for member in archive.getmembers():
            name = member.name.rstrip("/")
            parts = PurePosixPath(name).parts
            if (not parts or parts[0] != PACKAGE_ROOT or name.startswith("/")
                    or "\\" in name or any(part in ("", ".", "..") for part in parts)):
                raise ValueError(f"unsafe runtime archive path: {member.name}")
            if not (member.isdir() or member.isfile()):
                raise ValueError(f"unsupported runtime archive entry: {member.name}")
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError(f"unreadable runtime archive entry: {member.name}")
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    package = destination / PACKAGE_ROOT
    manifest = json.loads((package / "runtime-manifest.json").read_text(encoding="utf-8"))
    if (manifest.get("schema") != 1 or manifest.get("version") != "0.5.0"
            or manifest.get("platform") != "linux-x64"):
        raise ValueError("headless runtime manifest does not match the Debian package")
    for path in (
        "bin/tether-node", "resources/tether-runtime/tether-python",
        "laptop/tether-node-pair",
        "tether-source/tether/node/agent.py", "tether-source/tether/node/pair_cli.py",
        "tether-source/tether/node/console.html",
        "resources/tether-runtime/components/nodejs/bin/node",
        "resources/tether-runtime/components/meshcentral/meshcentral.js",
    ):
        if not (package / path).is_file():
            raise ValueError(f"runtime package is missing {path}")
    return package


def _nfpm_config(build: Path, payload: Path) -> Path:
    packaging = ROOT / "desktop" / "packaging" / "headless-deb"
    office_dependencies_path = payload / "resources/tether-runtime/components/libreoffice/linux-dependencies.json"
    office_dependencies = json.loads(office_dependencies_path.read_text(encoding="utf-8"))
    depends = office_dependencies.get("depends")
    if (not isinstance(depends, list) or not all(isinstance(item, str) and item for item in depends)
            or office_dependencies.get("source_sha256") != "8290c8f46cb33d6df8f681cb796e0697461ea070f86ec55b63c94d7eb9d9a476"):
        raise ValueError("Debian runtime is missing verified LibreOffice system dependency metadata")
    config = {
        "name": "tether-node",
        "arch": "amd64",
        "platform": "linux",
        "version": "0.5.0",
        "maintainer": "Tether maintainers",
        "description": "Tether headless Node runtime",
        "license": "MIT",
        "depends": depends,
        "contents": [
            {"src": str(payload) + "/", "dst": "/opt/tether-node/releases/0.5.0", "type": "tree"},
            {"src": "/opt/tether-node/releases/0.5.0", "dst": "/opt/tether-node/current", "type": "symlink"},
            {"src": str(packaging / "tether-node.service"), "dst": "/usr/lib/systemd/system/tether-node.service", "file_info": {"mode": 0o644}},
            {"src": str(packaging / "README.Debian"), "dst": "/usr/share/doc/tether-node/README.Debian", "file_info": {"mode": 0o644}},
            {"src": str(payload / "laptop" / "tether-node-pair"), "dst": "/usr/bin/tether-node-pair", "file_info": {"mode": 0o755}},
        ],
        "scripts": {name: str(packaging / name) for name in ("preinst", "postinst", "prerm", "postrm")},
        "deb": {"arch": "amd64"},
    }
    path = build / "nfpm.yaml"
    # JSON is a valid YAML subset and safely quotes local absolute paths.
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--nfpm", required=True, type=Path)
    parser.add_argument("--nfpm-archive", required=True, type=Path)
    parser.add_argument("--nfpm-sha256", default=NFPM_SHA256)
    args = parser.parse_args()
    if not args.nfpm.is_file() or not args.nfpm_archive.is_file():
        raise ValueError(f"nFPM executable is missing: {args.nfpm}")
    archive_digest = hashlib.sha256(args.nfpm_archive.read_bytes()).hexdigest()
    if archive_digest.lower() != args.nfpm_sha256.lower():
        raise ValueError("nFPM release archive SHA-256 does not match the pinned release")
    with tarfile.open(args.nfpm_archive, "r:gz") as archive:
        member = next((item for item in archive.getmembers() if item.name == "nfpm" and item.isfile()), None)
        if member is None:
            raise ValueError("pinned nFPM archive has no regular nfpm executable")
        source = archive.extractfile(member)
        if source is None:
            raise ValueError("pinned nFPM executable cannot be read from its archive")
        extracted_digest = hashlib.sha256(source.read()).hexdigest()
    digest = hashlib.sha256(args.nfpm.read_bytes()).hexdigest()
    if digest != extracted_digest:
        raise ValueError("nFPM executable does not match the pinned release archive")
    if not ARCHIVE.is_file():
        raise ValueError("build the headless runtime tarball before packaging the Debian asset")
    target = OUTPUT_DIR / DEB_NAME
    if target.exists():
        raise ValueError(f"refusing to replace existing Debian artifact: {target}")
    with tempfile.TemporaryDirectory(prefix="tether-deb-build-", dir=OUTPUT_DIR) as temp:
        build = Path(temp)
        package = _extract_runtime(build)
        config = _nfpm_config(build, package)
        command = [str(args.nfpm), "package", "--packager", "deb", "--config", str(config), "--target", str(target)]
        subprocess.run(command, cwd=ROOT, check=True)
    digest = hashlib.sha256()
    with target.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    hexdigest = digest.hexdigest()
    (OUTPUT_DIR / (DEB_NAME + ".sha256")).write_text(f"{hexdigest}  {DEB_NAME}\n", encoding="ascii")
    metadata = {
        "format": "deb", "package": "tether-node", "architecture": "amd64",
        "version": "0.5.0", "filename": DEB_NAME,
        "size": target.stat().st_size, "sha256": hexdigest,
    }
    (OUTPUT_DIR / (DEB_NAME + ".manifest-fragment.json")).write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Created {target} ({target.stat().st_size} bytes, SHA-256 {hexdigest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
