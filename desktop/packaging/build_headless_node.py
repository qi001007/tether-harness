from __future__ import annotations

import hashlib
import json
import re
import shutil
import tarfile
import tempfile
from pathlib import Path

from prepare_runtime import copy_prepared_tree

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / ".runtime" / "desktop-candidate"
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["node"]
if not isinstance(VERSION, str) or not re.fullmatch(r"\d+\.\d+\.\d+", VERSION):
    raise ValueError("version.json must contain a numeric Tether Node version")
OUTPUT_DIR = ROOT / ".scratch" / "tether-desktop-candidates" / VERSION / "headless" / "linux-x64"
ARCHIVE_NAME = f"Tether-node-runtime-{VERSION}-linux-x64.tar.gz"


def copy_lf_script(source: Path, destination: Path) -> None:
    content = source.read_bytes().replace(b"\r\n", b"\n")
    if b"\r" in content:
        raise ValueError(f"Linux runtime script contains a bare carriage return: {source.name}")
    destination.write_bytes(content)
    shutil.copystat(source, destination)


def main() -> int:
    if not (STAGING / "tether-python").is_file():
        raise ValueError("PyInstaller Tether runtime is missing")
    launcher = ROOT / "laptop" / "tether-node-runtime.sh"
    if not launcher.is_file():
        raise ValueError("Node owner launcher laptop/tether-node-runtime.sh is missing")
    source_root = ROOT / "tether"
    if not (source_root / "node" / "agent.py").is_file():
        raise ValueError("Tether Node source is missing")
    for required in [ROOT / "LICENSE", ROOT / "THIRD_PARTY_NOTICES.md", ROOT / "version.json"]:
        if not required.is_file():
            raise ValueError(f"Headless Node package metadata is missing: {required.name}")
    if OUTPUT_DIR.exists():
        raise ValueError(f"Refusing to replace existing headless artifact directory: {OUTPUT_DIR}")

    OUTPUT_DIR.mkdir(parents=True)
    temp_root = ROOT / ".scratch"
    with tempfile.TemporaryDirectory(prefix="tether-headless-stage-", dir=temp_root) as temporary:
        staging = Path(temporary)
        package = staging / f"tether-node-runtime-{VERSION}"
        resources = package / "resources" / "tether-runtime"
        resources.mkdir(parents=True)
        for item in STAGING.iterdir():
            if item.name in {"tether-python", "node-bin"}:
                continue
            destination = resources / item.name
            if item.is_dir():
                copy_prepared_tree(item, destination)
            elif item.is_file():
                shutil.copy2(item, destination)
        shutil.copy2(STAGING / "tether-python", resources / "tether-python")
        (resources / "tether-python").chmod(0o755)

        for source in source_root.rglob("*.py"):
            relative = source.relative_to(ROOT)
            target = package / "tether-source" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        runtime_bin = STAGING / "node-bin"
        if not runtime_bin.is_dir():
            raise ValueError("prepared Codeg/Herdr runtime node-bin is missing")
        packaged_bin = package / "tether-source" / "tether" / "node" / "bin"
        if packaged_bin.exists():
            shutil.rmtree(packaged_bin)
        copy_prepared_tree(runtime_bin, packaged_bin)
        console_html = ROOT / "tether" / "node" / "console.html"
        if not console_html.is_file():
            raise ValueError("Tether Node console.html asset is missing")
        console_target = package / "tether-source" / "tether" / "node" / "console.html"
        console_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(console_html, console_target)
        shutil.copy2(ROOT / "version.json", package / "tether-source" / "version.json")
        shutil.copy2(ROOT / "LICENSE", package / "tether-source" / "LICENSE")
        shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", package / "tether-source" / "THIRD_PARTY_NOTICES.md")
        binary_launcher = package / "bin" / "tether-node"
        binary_launcher.parent.mkdir(parents=True, exist_ok=True)
        copy_lf_script(launcher, binary_launcher)
        binary_launcher.chmod(0o755)
        laptop_dir = package / "laptop"
        laptop_dir.mkdir(parents=True, exist_ok=True)
        for name in ["install-node.sh", "tether-node-runtime.sh", "tether-node-pair"]:
            source = ROOT / "laptop" / name
            if not source.is_file():
                raise ValueError(f"Node owner installer file is missing: laptop/{name}")
            copy_lf_script(source, laptop_dir / name)
        (laptop_dir / "install-node.sh").chmod(0o755)
        (laptop_dir / "tether-node-runtime.sh").chmod(0o755)
        (laptop_dir / "tether-node-pair").chmod(0o755)
        runtime_manifest = {
            "schema": 1,
            "version": VERSION,
            "platform": "linux-x64",
            "entry": "bin/tether-node",
            "python": "resources/tether-runtime/tether-python",
            "resources": "resources/tether-runtime",
            "source": "tether-source",
        }
        (package / "runtime-manifest.json").write_text(json.dumps(runtime_manifest, indent=2) + "\n", encoding="utf-8")
        archive = OUTPUT_DIR / ARCHIVE_NAME
        with tarfile.open(archive, "w:gz", compresslevel=1) as output:
            output.add(package, arcname=package.name, recursive=True)
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    digest = digest.hexdigest()
    (OUTPUT_DIR / (ARCHIVE_NAME + ".sha256")).write_text(f"{digest}  {ARCHIVE_NAME}\n", encoding="ascii")
    print(f"Created {archive} ({archive.stat().st_size} bytes, SHA-256 {digest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
