#!/usr/bin/env python3
"""Hydrate the pinned Herdr v0.9.5 runtime files needed by release archives."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = ROOT / "tether" / "node" / "bin"

# SHA-256 values come from herdrdev/herdr distribution/latest.json at v0.9.5.
# Sizes are pinned from the matching verified official release assets/archive.
ASSETS = {
    "linux-x86_64": {
        "url": "https://github.com/herdrdev/herdr/releases/download/v0.9.5/herdr-linux-x86_64",
        "size": 30_285_672,
        "sha256": "14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d",
    },
    "macos-x86_64": {
        "url": "https://github.com/herdrdev/herdr/releases/download/v0.9.5/herdr-macos-x86_64",
        "size": 24_367_600,
        "sha256": "5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369",
    },
    "macos-aarch64": {
        "url": "https://github.com/herdrdev/herdr/releases/download/v0.9.5/herdr-macos-aarch64",
        "size": 22_536_176,
        "sha256": "fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2",
    },
    "windows-x86_64": {
        "url": "https://github.com/herdrdev/herdr/releases/download/v0.9.5/herdr-windows-x86_64.zip",
        "size": 10_037_141,
        "sha256": "d2c6c9c971c43a0bfdde8c692a9a1a7a45c3e4807cd01ae45662b4734fac1cbf",
    },
}

# The Windows ZIP is verified before only these exact members are extracted.
FILES = {
    "herdr-linux-x86_64": {
        "asset": "linux-x86_64", "size": 30_285_672,
        "sha256": "14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d",
    },
    "herdr-macos-x86_64": {
        "asset": "macos-x86_64", "size": 24_367_600,
        "sha256": "5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369",
    },
    "herdr-macos-aarch64": {
        "asset": "macos-aarch64", "size": 22_536_176,
        "sha256": "fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2",
    },
    "herdr.exe": {
        "asset": "windows-x86_64", "member": "herdr.exe", "size": 26_821_120,
        "sha256": "cd877c8744296f4a38a2703bf13cf11728973649ec54959959c4587ffe5368b2",
    },
    "conpty/arm64/OpenConsole.exe": {
        "asset": "windows-x86_64", "member": "conpty/arm64/OpenConsole.exe", "size": 1_120_056,
        "sha256": "ed7622fd0d3bedc9ab9f122f5e58edf0def9e7999224f52dd395ba9f54edbe09",
    },
    "conpty/conpty.dll": {
        "asset": "windows-x86_64", "member": "conpty/conpty.dll", "size": 109_920,
        "sha256": "39fba2713e2495117b1591ae8c32a3b904bea7aa66069cf7815e2844c76d75d8",
    },
    "conpty/herdr-conpty.json": {
        "asset": "windows-x86_64", "member": "conpty/herdr-conpty.json", "size": 450,
        "sha256": "c8f499ad82c568e737d6bc7d0b583e3785d2f43af3d2c0cebb856076690533f5",
    },
    "conpty/x64/OpenConsole.exe": {
        "asset": "windows-x86_64", "member": "conpty/x64/OpenConsole.exe", "size": 1_066_296,
        "sha256": "b7fd936c2668b87b9ecf7b3366dc6568afc1c6f981874cba3e955a1c35cf8160",
    },
}
WINDOWS_RUNTIME_FILES = tuple(
    relative for relative, spec in FILES.items() if spec["asset"] == "windows-x86_64"
)


def _hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def _verify_file(path: Path, expected: dict, label: str) -> None:
    size, digest = _hash_file(path)
    if size != expected["size"] or digest != expected["sha256"]:
        raise ValueError(f"{label} failed pinned size/SHA-256 verification")


def verify_windows_runtime(destination: Path) -> tuple[str, ...]:
    destination = Path(destination)
    for relative in WINDOWS_RUNTIME_FILES:
        path = destination / relative
        if not path.is_file():
            raise ValueError(f"pinned Herdr runtime is missing {relative}")
        _verify_file(path, FILES[relative], relative)
    return WINDOWS_RUNTIME_FILES


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Tether-release-hydrator"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)


def _extract_member(archive: zipfile.ZipFile, member: str, destination: Path, expected: dict) -> None:
    matches = [item for item in archive.infolist() if item.filename == member and not item.is_dir()]
    if len(matches) != 1 or matches[0].file_size != expected["size"]:
        raise ValueError(f"Windows Herdr ZIP is missing or duplicates pinned member {member}")
    digest = hashlib.sha256()
    size = 0
    with archive.open(matches[0], "r") as source, destination.open("wb") as output:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            if size > expected["size"]:
                raise ValueError(f"Windows Herdr member exceeds pinned size: {member}")
            digest.update(chunk)
            output.write(chunk)
    if size != expected["size"] or digest.hexdigest() != expected["sha256"]:
        raise ValueError(f"Windows Herdr member failed pinned size/SHA-256 verification: {member}")


def hydrate(
    destination: Path = DEFAULT_DESTINATION,
    *,
    downloader: Callable[[str, Path], None] = _download,
    assets: dict = ASSETS,
    files: dict = FILES,
) -> list[str]:
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)

    # Refuse conflicting local contents before downloading or installing anything.
    for relative, expected in files.items():
        existing = destination / relative
        if existing.exists():
            if not existing.is_file():
                raise ValueError(f"Herdr runtime path is not a regular file: {relative}")
            _verify_file(existing, expected, relative)

    with tempfile.TemporaryDirectory(prefix="tether-herdr-") as temporary:
        stage = Path(temporary)
        needed_assets = {
            spec["asset"] for relative, spec in files.items()
            if not (destination / relative).is_file()
        }
        downloaded: dict[str, Path] = {}
        for name in sorted(needed_assets):
            spec = assets[name]
            path = stage / (name + (".zip" if name == "windows-x86_64" else ".bin"))
            downloader(spec["url"], path)
            _verify_file(path, spec, f"official Herdr {name} asset")
            downloaded[name] = path

        staged_files: dict[str, Path] = {}
        for relative, spec in files.items():
            if (destination / relative).is_file():
                continue
            output = stage / "files" / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            if "member" in spec:
                with zipfile.ZipFile(downloaded[spec["asset"]]) as archive:
                    _extract_member(archive, spec["member"], output, spec)
            else:
                shutil.copyfile(downloaded[spec["asset"]], output)
                _verify_file(output, spec, relative)
            staged_files[relative] = output

        # Validate every staged payload and all existing destinations before the first install.
        for relative, staged in staged_files.items():
            _verify_file(staged, files[relative], relative)
            existing = destination / relative
            if existing.exists():
                if not existing.is_file():
                    raise ValueError(f"Herdr runtime path is not a regular file: {relative}")
                _verify_file(existing, files[relative], relative)

        installed: list[str] = []
        for relative, staged in staged_files.items():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                _verify_file(target, files[relative], relative)
                continue
            temporary_target = target.with_name(target.name + ".herdr-stage")
            shutil.copyfile(staged, temporary_target)
            _verify_file(temporary_target, files[relative], relative)
            try:
                os.link(temporary_target, target)
            except FileExistsError:
                _verify_file(target, files[relative], relative)
            finally:
                temporary_target.unlink(missing_ok=True)
            installed.append(relative)
        return installed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--windows-only", action="store_true",
                        help="hydrate only the pinned Windows Herdr executable and ConPTY files")
    args = parser.parse_args()
    files = {relative: FILES[relative] for relative in WINDOWS_RUNTIME_FILES} if args.windows_only else FILES
    installed = hydrate(args.destination, files=files)
    print("Herdr runtime ready; installed " + str(len(installed)) + " missing file(s).")


if __name__ == "__main__":
    main()
