"""Download, verify and safely assemble pinned open-source runtime assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import stat
import tarfile
import tempfile
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("component-assets.json")
REMOTE_MANIFEST = Path(__file__).with_name("remote-desktop-assets.json")
DSH_MANIFEST = Path(__file__).with_name("dsh-assets.json")
LICENSE_DIR = Path(__file__).with_name("licenses")
TARGETS = {"windows-x64", "linux-x64", "macos-x64", "macos-arm64"}
MESHCENTRAL_TIMESTAMP_SOURCE_SHA256 = "19de2c8d87e8bbd12b1a7b46fe0dfa4a78c3c46a70464814b1f106af1d07eb26"
MESHCENTRAL_TIMESTAMP_PATCHED_SHA256 = "5abee591a3c5e1d8864b4e14df3832be7e11089ce60a3b39b9d31dc9614839ba"
MESHCTRL_SOURCE_SHA256 = "f40a77911f4bddd211b3807236a986db5647ea968d151bddeed01ce8253aec15"
MESHCTRL_PATCHED_SHA256 = "11e5a718832d8caa6c99c6fc21d72ab4fb499729fa32bc8dfac5e01af238b140"


def _safe_asset_location(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    return f"{parsed.hostname or 'unknown'}{parsed.path}"


def _github_release_download(url: str) -> tuple[str, str, str, str] | None:
    parsed = urllib.parse.urlsplit(url)
    parts = [urllib.parse.unquote(part) for part in parsed.path.split('/') if part]
    if (parsed.scheme != 'https' or parsed.hostname != 'github.com' or len(parts) != 6
            or parts[2:4] != ['releases', 'download']):
        return None
    return parts[0], parts[1], parts[4], parts[5]


def _download_failure_reason(returncode: int, stderr: str = '', status: str = '') -> str:
    if status.isdigit() and len(status) == 3 and status != '000':
        return f'HTTP {status}'
    match = re.search(r'\bHTTP(?:Error)?\D{0,8}(\d{3})\b', stderr)
    return f'HTTP {match.group(1)}' if match else f'exit {returncode}'


def _download_github_release_asset(asset: dict, destination: Path, parts: tuple[str, str, str, str]) -> bool:
    gh = shutil.which('gh')
    if not gh or not os.environ.get('GH_TOKEN', '').strip():
        return False
    owner, repo, tag, filename = parts
    tag_path = urllib.parse.quote(tag, safe='')
    metadata = subprocess.run(
        [gh, 'api', f'repos/{owner}/{repo}/releases/tags/{tag_path}',
         '-H', 'Accept: application/vnd.github+json'],
        check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60,
    )
    if metadata.returncode:
        reason = _download_failure_reason(metadata.returncode, metadata.stderr)
        raise RuntimeError(f'GitHub release metadata request failed ({reason})')
    release = json.loads(metadata.stdout)
    if release.get('tag_name') != tag:
        raise ValueError('GitHub release tag did not match pinned source URL')
    matches = [item for item in release.get('assets', [])
               if item.get('name') == filename and item.get('state') == 'uploaded']
    if len(matches) != 1 or matches[0].get('size') != asset.get('size'):
        raise ValueError('GitHub release asset name or pinned size did not match')
    asset_id = matches[0].get('id')
    if not isinstance(asset_id, int) or asset_id <= 0:
        raise ValueError('GitHub release asset ID is invalid')
    with destination.open('wb') as output:
        result = subprocess.run(
            [gh, 'api', f'repos/{owner}/{repo}/releases/assets/{asset_id}',
             '-H', 'Accept: application/octet-stream'],
            check=False, stdout=output, stderr=subprocess.PIPE, timeout=300,
        )
    if result.returncode:
        destination.unlink(missing_ok=True)
        detail = result.stderr.decode('utf-8', errors='replace') if isinstance(result.stderr, bytes) else str(result.stderr or '')
        reason = _download_failure_reason(result.returncode, detail)
        raise RuntimeError(f'GitHub release asset request failed ({reason})')
    return True


def _download_with_curl(url: str, destination: Path) -> None:
    result = subprocess.run(
        ['curl', '--fail', '--location', '--retry', '2', '--retry-delay', '2',
         '--connect-timeout', '20', '--max-time', '300', '--retry-max-time', '300',
         '--silent', '--show-error', '--write-out', '%{http_code}',
         '--output', str(destination), url],
        check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if result.returncode:
        reason = _download_failure_reason(result.returncode, result.stderr, result.stdout.strip())
        raise RuntimeError(f'curl download failed ({reason})')


def download(asset: dict, destination: Path) -> None:
    url = str(asset['url'])
    location = _safe_asset_location(url)
    try:
        release_parts = _github_release_download(url)
        if release_parts is not None and _download_github_release_asset(asset, destination, release_parts):
            pass
        else:
            _download_with_curl(url, destination)
        digest = hashlib.sha256()
        size = 0
        with destination.open('rb') as source:
            while block := source.read(1024 * 1024):
                digest.update(block)
                size += len(block)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        if isinstance(exc, urllib.error.HTTPError):
            reason = f'HTTP {exc.code}'
        elif isinstance(exc, (RuntimeError, ValueError)):
            reason = str(exc)
        else:
            reason = type(exc).__name__
        raise RuntimeError(f"download failed for {asset['name']} ({location}): {reason}") from None
    if size != asset["size"] or digest.hexdigest() != asset["sha256"]:
        destination.unlink(missing_ok=True)
        raise ValueError(f"download failed size/SHA-256 verification: {asset['name']} ({location})")

def _sftpgo_pe_machine(path: Path) -> int | None:
    with path.open("rb") as stream:
        if stream.read(2) != b"MZ":
            return None
        stream.seek(0x3C)
        offset_bytes = stream.read(4)
        if len(offset_bytes) != 4:
            return None
        stream.seek(int.from_bytes(offset_bytes, "little"))
        if stream.read(4) != b"PE\0\0":
            return None
        machine = stream.read(2)
        return int.from_bytes(machine, "little") if len(machine) == 2 else None


def _select_sftpgo_files(extracted: Path, target: str, asset_name: str) -> tuple[Path, Path]:
    binary = "sftpgo.exe" if target.startswith("windows") else "sftpgo"
    expected_pe_machine = {"windows-x64": 0x8664, "windows-arm64": 0xAA64,
                           "windows-x86": 0x014C}.get(target)
    if target.startswith("windows") and expected_pe_machine is None:
        raise ValueError(f"unsupported SFTPGo Windows target: {target}")
    if target.startswith("windows"):
        valid_magic = (b"MZ",)
    elif target.startswith("linux"):
        valid_magic = (b"\x7fELF",)
    else:
        valid_magic = (b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe",
                       b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
                       b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca")
    binaries: list[Path] = []
    configs: list[Path] = []
    for item in extracted.rglob("*"):
        if not item.is_file():
            continue
        if item.name == binary:
            with item.open("rb") as stream:
                header = stream.read(4)
            if not any(header.startswith(magic) for magic in valid_magic):
                continue
            if expected_pe_machine is not None and _sftpgo_pe_machine(item) != expected_pe_machine:
                continue
            binaries.append(item)
        elif item.name == "sftpgo.json":
            try:
                config = json.loads(item.read_text(encoding="utf-8-sig"))
            except (OSError, UnicodeError, ValueError):
                continue
            if isinstance(config, dict):
                configs.append(item)
    if len(binaries) != 1 or len(configs) != 1:
        raise ValueError(f"SFTPGo core binary/config missing from {asset_name}")
    return binaries[0], configs[0]


def safe_relative(name: str) -> Path:
    normalized = name.replace("\\", "/")
    parsed = PurePosixPath(normalized)
    parts = [part for part in parsed.parts if part not in {"", "."}]
    if not normalized or normalized.startswith("/") or not parts or ":" in parts[0] or ".." in parts:
        raise ValueError(f"unsafe archive path: {name!r}")
    return Path(*parts)


def extract_archive(archive_path: Path, destination: Path) -> None:
    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path) as archive:
            for info in archive.infolist():
                relative = safe_relative(info.filename.rstrip("/")) if info.filename.rstrip("/") else None
                if relative is None:
                    continue
                mode = (info.external_attr >> 16) & 0xFFFF
                if mode and (mode & 0o170000) == 0o120000:
                    raise ValueError(f"symbolic link in archive: {info.filename}")
                target = destination / relative
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    if mode:
                        target.chmod(mode & 0o777)
        return
    try:
        with tarfile.open(archive_path, "r:*") as archive:
            for member in archive.getmembers():
                relative = safe_relative(member.name.rstrip("/")) if member.name.rstrip("/") else None
                if relative is None:
                    continue
                if not (member.isfile() or member.isdir()):
                    raise ValueError(f"link or special file in archive: {member.name}")
                target = destination / relative
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError(f"unreadable archive member: {member.name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod(member.mode & 0o777)
    except tarfile.TarError as error:
        raise ValueError(f"unsupported or corrupt component archive: {archive_path.name}") from error


def copy_tree(source: Path, destination: Path) -> None:
    for item in source.rglob("*"):
        if item.is_symlink():
            raise ValueError(f"symbolic link in extracted component: {item}")
        relative = item.relative_to(source)
        target = destination / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif item.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def copy_prepared_tree(source: Path, destination: Path) -> None:
    """Copy an assembled tree while retaining only existing relative in-tree links."""
    source = source.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    symlinks = []
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        target = destination / relative
        mode = item.lstat().st_mode
        if stat.S_ISLNK(mode):
            link = os.readlink(item)
            link_parts = PurePosixPath(link.replace("\\", "/")).parts
            resolved = item.resolve(strict=True)
            try:
                resolved.relative_to(source)
            except ValueError as error:
                raise ValueError(f"prepared runtime link escapes its component: {relative}") from error
            if (Path(link).is_absolute() or PurePosixPath(link.replace("\\", "/")).is_absolute()
                    or not link_parts or ":" in link_parts[0]):
                raise ValueError(f"prepared runtime link is not relative: {relative}")
            symlinks.append((target, link, resolved.is_dir(), relative))
        elif stat.S_ISDIR(mode):
            target.mkdir(parents=True, exist_ok=True)
        elif stat.S_ISREG(mode):
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
        else:
            raise ValueError(f"special file in prepared runtime tree: {relative}")
    for target, link, is_directory, relative in symlinks:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            raise ValueError(f"prepared runtime link collides with another entry: {relative}")
        target.symlink_to(link, target_is_directory=is_directory)
    for target, _, _, relative in symlinks:
        try:
            target.resolve(strict=True).relative_to(destination.resolve())
        except (OSError, ValueError) as error:
            raise ValueError(f"copied runtime link is dangling or escapes its component: {relative}") from error


def copy_node_dependencies(source: Path, destination: Path, locked_root: Path,
                           *, omit_symlinks: frozenset[str] = frozenset()) -> None:
    locked_root = locked_root.resolve()
    source = source.resolve()
    try:
        source.relative_to(locked_root)
    except ValueError as error:
        raise ValueError(f"dependency source escapes locked Node dependency tree: {source}") from error
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        if item.name == ".package-lock.json":
            continue
        if item.is_symlink():
            link = os.readlink(item)
            link_parts = PurePosixPath(link.replace("\\", "/")).parts
            if (Path(link).is_absolute() or PurePosixPath(link.replace("\\", "/")).is_absolute()
                    or not link_parts or ":" in link_parts[0]):
                raise ValueError(f"absolute symbolic link in locked Node dependency tree: {item}")
            try:
                resolved = item.resolve(strict=True)
                resolved.relative_to(locked_root)
            except (OSError, ValueError) as error:
                raise ValueError(f"symbolic link escapes or is missing in locked Node dependency tree: {item}") from error
            link_name = item.relative_to(locked_root).as_posix()
            if link_name in omit_symlinks:
                if link_name != ".bin/meshcentral" or resolved != (locked_root / "meshcentral" / "bin" / "meshcentral").resolve():
                    raise ValueError(f"unexpected locked dependency link omission: {link_name}")
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(link, target_is_directory=resolved.is_dir())
            continue
        target = destination / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif item.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def assemble_node_runtime(asset: dict, destination: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="tether-node-archive-") as temporary:
        workspace = Path(temporary)
        archive_path = workspace / asset["name"]
        download(asset, archive_path)
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path) as archive:
                members = archive.infolist()
                for suffix, target_name in [("/node.exe", "node.exe"), ("/LICENSE", "LICENSE"),
                                            ("/README.md", "README.md")]:
                    candidate = next((item for item in members if item.filename.endswith(suffix) and not item.is_dir()), None)
                    if candidate is None:
                        raise ValueError(f"pinned Node runtime is missing {suffix}")
                    destination.mkdir(parents=True, exist_ok=True)
                    with archive.open(candidate) as source, (destination / target_name).open("wb") as output:
                        shutil.copyfileobj(source, output)
        else:
            with tarfile.open(archive_path, "r:*") as archive:
                selected = [("/bin/node", Path("bin/node")), ("/LICENSE", Path("LICENSE")),
                            ("/README.md", Path("README.md"))]
                destination.mkdir(parents=True, exist_ok=True)
                for suffix, target in selected:
                    member = next((item for item in archive.getmembers()
                                   if item.name.endswith(suffix) and item.isfile()), None)
                    if member is None:
                        raise ValueError(f"pinned Node runtime is missing {suffix}")
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError(f"unreadable Node runtime member: {member.name}")
                    output = destination / target
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with source, output.open("wb") as stream:
                        shutil.copyfileobj(source, stream)
                    if target.name == "node":
                        output.chmod(0o755)


def assemble_libreoffice(manifest: dict, target: str, destination: Path) -> None:
    asset = next((item for item in manifest["assets"] if item["target"] == target), None)
    if asset is None:
        raise ValueError(f"pinned LibreOffice asset is missing for {target}")
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tether-libreoffice-") as temporary:
        workspace = Path(temporary)
        archive_path = workspace / asset["name"]
        download(asset, archive_path)
        if target == "windows-x64":
            system_drive = os.environ.get("SystemDrive", "C:")
            subprocess.run(["msiexec.exe", "/a", str(archive_path), "/qn",
                            f"TARGETDIR={destination}", f"ROOTDRIVE={system_drive}"],
                           check=True, timeout=900, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            executable = destination / "program" / "soffice.com"
        elif target == "linux-x64":
            extracted = workspace / "extracted"
            extract_archive(archive_path, extracted)
            debs = sorted(extracted.rglob("*.deb"))
            if not debs:
                raise ValueError("LibreOffice Linux archive contains no Debian packages")
            package_names = set()
            package_depends = []
            for package in debs:
                package_field = subprocess.run(["dpkg-deb", "-f", str(package), "Package"],
                                               check=True, capture_output=True, text=True, timeout=30).stdout.strip()
                depends_field = subprocess.run(["dpkg-deb", "-f", str(package), "Depends"],
                                               check=True, capture_output=True, text=True, timeout=30).stdout
                if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", package_field):
                    raise ValueError(f"invalid Debian package metadata in {package.name}")
                package_names.add(package_field)
                package_depends.append((package.name, " ".join(depends_field.split())))
            for package in debs:
                subprocess.run(["dpkg-deb", "-x", str(package), str(destination)],
                               check=True, timeout=180)
            launcher_links = [destination / "usr" / "local" / "bin" / "libreoffice26.8"]
            launcher_links.extend((destination / "usr" / "share" / "applications").glob("*.desktop"))
            for link in launcher_links:
                if not link.is_symlink():
                    continue
                target_text = os.readlink(link)
                if not target_text.startswith("/opt/libreoffice26.8/"):
                    raise ValueError(f"unexpected LibreOffice launcher link: {link.relative_to(destination)}")
                target_parts = PurePosixPath(target_text).parts
                if len(target_parts) < 3 or target_parts[:2] != ("/", "opt") or ".." in target_parts:
                    raise ValueError(f"unsafe LibreOffice launcher target: {link.relative_to(destination)}")
                relocated_target = destination.joinpath(*target_parts[1:])
                if not relocated_target.is_file():
                    raise ValueError(f"LibreOffice launcher points outside its bundled runtime: {link.relative_to(destination)}")
                link.unlink()
            external_dependencies = set()
            for package_name, depends in package_depends:
                groups = []
                current = []
                depth = 0
                for character in depends:
                    if character == "(":
                        depth += 1
                    elif character == ")":
                        depth -= 1
                        if depth < 0:
                            raise ValueError(f"malformed Depends field in {package_name}")
                    if character == "," and depth == 0:
                        groups.append("".join(current).strip())
                        current = []
                    else:
                        current.append(character)
                if depth != 0:
                    raise ValueError(f"malformed Depends field in {package_name}")
                if current:
                    groups.append("".join(current).strip())
                for group in groups:
                    if not group:
                        continue
                    alternatives = [item.strip() for item in group.split("|")]
                    names = [re.match(r"^([a-z0-9][a-z0-9+.-]*)", item) for item in alternatives]
                    if any(match is None for match in names):
                        raise ValueError(f"unrecognized Depends entry in {package_name}: {group}")
                    # LibreOffice packages contained in this official archive are installed as
                    # files in the runtime tree; only their external package dependencies belong
                    # in the enclosing Tether Debian package metadata.
                    external_alternatives = [item for item, match in zip(alternatives, names)
                                             if match and match.group(1) not in package_names]
                    if external_alternatives:
                        external_dependencies.add(" | ".join(external_alternatives))
            # Ubuntu's NSS/NSPR packages provide the SONAMEs required by soffice.bin.
            external_dependencies.update({"libnspr4", "libnss3"})
            font_directory = destination / "opt" / "libreoffice26.8" / "share" / "fonts" / "truetype"
            for font in manifest.get("linux_fonts", []):
                if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", str(font.get("name") or "")):
                    raise ValueError("invalid pinned LibreOffice font filename")
                font_archive = workspace / font["name"]
                license_archive = workspace / font["license_file"]
                download(font, font_archive)
                license_asset = {"name": font["license_file"], "url": font["license_url"],
                                 "size": font["license_size"], "sha256": font["license_sha256"]}
                download(license_asset, license_archive)
                with font_archive.open("rb") as stream:
                    if stream.read(4) != b"OTTO":
                        raise ValueError(f"pinned LibreOffice font is not an OpenType CFF font: {font['name']}")
                font_directory.mkdir(parents=True, exist_ok=True)
                shutil.copy2(font_archive, font_directory / font["name"])
                shutil.copy2(license_archive, font_directory / font["license_file"])
            (destination / "linux-dependencies.json").write_text(json.dumps({
                "source_archive": asset["name"],
                "source_sha256": asset["sha256"],
                "bundled_debian_packages": sorted(package_names),
                "depends": sorted(external_dependencies),
            }, indent=2) + "\n", encoding="utf-8")
            executable = destination / "opt" / "libreoffice26.8" / "program" / "soffice"
        else:
            mount = workspace / "mount"
            mount.mkdir()
            subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint",
                            str(mount), str(archive_path)], check=True, timeout=180,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                app = next(mount.glob("LibreOffice*.app"), None)
                if app is None:
                    raise ValueError("LibreOffice macOS disk image has no application bundle")
                target_app = destination / "LibreOffice.app"
                subprocess.run(["ditto", str(app), str(target_app)], check=True, timeout=300)
            finally:
                subprocess.run(["hdiutil", "detach", str(mount), "-quiet"],
                               check=False, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            executable = destination / "LibreOffice.app" / "Contents" / "MacOS" / "soffice"
        if not executable.is_file():
            raise ValueError(f"LibreOffice executable missing for {target}: {executable}")
    (destination / "asset.json").write_text(json.dumps({
        "component": manifest["component"], "version": manifest["version"],
        "target": target, "license": manifest["license"], "source": manifest["source"],
        "asset": asset["name"], "size": asset["size"], "sha256": asset["sha256"],
        "executable": str(executable.relative_to(destination)).replace("\\", "/"),
    }, indent=2) + "\n", encoding="utf-8")


def assemble_meshcentral(remote: dict, destination: Path, source_output: Path) -> None:
    package_dir = Path(__file__).with_name("meshcentral")
    lock = package_dir / "package-lock.json"
    package_json = package_dir / "package.json"
    if not lock.is_file() or not package_json.is_file():
        raise ValueError("pinned MeshCentral dependency lock is missing")
    with tempfile.TemporaryDirectory(prefix="tether-meshcentral-") as temporary:
        workspace = Path(temporary)
        archive_path = workspace / remote["name"]
        download(remote, archive_path)
        extracted = workspace / "extracted"
        extracted.mkdir()
        extract_archive(archive_path, extracted)
        package_source = extracted / "package"
        if not (package_source / "meshcentral.js").is_file():
            raise ValueError("MeshCentral npm source archive has no meshcentral.js entry")
        install_root = workspace / "npm-install"
        install_root.mkdir()
        shutil.copy2(lock, install_root / "package-lock.json")
        shutil.copy2(package_json, install_root / "package.json")
        npm = "npm.cmd" if sys.platform == "win32" else "npm"
        subprocess.run([npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=install_root, check=True, timeout=600)
        npm_meshcentral = install_root / "node_modules" / "meshcentral"
        if not (npm_meshcentral / "meshcentral.js").is_file():
            raise ValueError("locked npm install did not produce MeshCentral 1.3.1")
        destination.mkdir(parents=True, exist_ok=True)
        copy_tree(package_source, destination)
        copy_tree(npm_meshcentral, destination)
        dependencies = install_root / "node_modules"
        target_dependencies = destination / "node_modules"
        target_dependencies.mkdir(exist_ok=True)
        for item in dependencies.iterdir():
            if item.name == "meshcentral":
                continue
            target = target_dependencies / item.name
            if item.is_dir():
                omitted = frozenset({".bin/meshcentral"}) if item.name == ".bin" else frozenset()
                copy_node_dependencies(item, target, dependencies, omit_symlinks=omitted)
            elif item.is_file():
                shutil.copy2(item, target)
        patches = [
            patch_meshcentral_timestamp_argument(destination / "meshcentral.js"),
            patch_meshctrl_tls_validation(destination / "meshctrl.js"),
        ]
        source_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive_path, source_output)
    (destination / "tether-runtime.json").write_text(json.dumps({
        "component": "MeshCentral", "version": "1.3.1", "license": "Apache-2.0",
        "source": "https://github.com/Ylianst/MeshCentral/tree/1.3.1",
        "dependencies_lock": "desktop/packaging/meshcentral/package-lock.json",
        "local_patches": patches,
    }, indent=2) + "\n", encoding="utf-8")


def patch_meshcentral_timestamp_argument(meshcentral_entry: Path) -> dict[str, str]:
    expected_source_digest = MESHCENTRAL_TIMESTAMP_SOURCE_SHA256
    patched_digest = MESHCENTRAL_TIMESTAMP_PATCHED_SHA256
    source_bytes = meshcentral_entry.read_bytes()
    source_digest = hashlib.sha256(source_bytes).hexdigest()
    if source_digest != expected_source_digest:
        raise ValueError("pinned MeshCentral 1.3.1 source changed; refusing to apply the Tether patch")
    needle = b"'dev', 'mysql', 'mariadb', 'trustedproxy', 'migratevolumeinfo'"
    if source_bytes.count(needle) != 1:
        raise ValueError("pinned MeshCentral argument allowlist did not match the reviewed source")
    patched_bytes = source_bytes.replace(
        needle,
        b"'dev', 'mysql', 'mariadb', 'trustedproxy', 'agenttimestampserver', 'migratevolumeinfo'",
        1,
    )
    if hashlib.sha256(patched_bytes).hexdigest() != patched_digest:
        raise ValueError("Tether MeshCentral timestamp-flag patch output did not match its reviewed hash")
    meshcentral_entry.write_bytes(patched_bytes)
    return {"file": "meshcentral.js",
            "purpose": "Allow the upstream no-agenttimestampserver option used to avoid external TSA requests.",
            "upstream_sha256": expected_source_digest,
            "patched_sha256": patched_digest}


def patch_meshctrl_tls_validation(meshctrl_entry: Path) -> dict[str, str]:
    source_bytes = meshctrl_entry.read_bytes()
    source_digest = hashlib.sha256(source_bytes).hexdigest()
    if source_digest != MESHCTRL_SOURCE_SHA256:
        raise ValueError("pinned MeshCentral 1.3.1 meshctrl.js changed; refusing the Tether TLS patch")
    needle = b"{ rejectUnauthorized: false, checkServerIdentity: onVerifyServer }"
    if source_bytes.count(needle) != 3:
        raise ValueError("pinned MeshCentral TLS options did not match the reviewed source")
    patched_bytes = source_bytes.replace(needle, b"{ rejectUnauthorized: true }")
    if hashlib.sha256(patched_bytes).hexdigest() != MESHCTRL_PATCHED_SHA256:
        raise ValueError("Tether MeshCtrl TLS patch output did not match its reviewed hash")
    meshctrl_entry.write_bytes(patched_bytes)
    return {"file": "meshctrl.js",
            "purpose": "Use Node.js CA and hostname verification for MeshCentral local administration and agent downloads.",
            "upstream_sha256": MESHCTRL_SOURCE_SHA256,
            "patched_sha256": MESHCTRL_PATCHED_SHA256}


def assemble_meshagent(remote: dict, target: str, destination: Path) -> None:
    target_asset = {"windows-x64": "MeshService64.exe", "linux-x64": "meshagent_x86-64",
                    "macos-x64": "meshagent_osx-x86-64", "macos-arm64": "meshagent_osx-arm-64"}[target]
    asset = next((item for item in remote["assets"] if item["filename"] == target_asset), None)
    if asset is None:
        raise ValueError(f"pinned MeshAgent asset is missing for {target}")
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / target_asset
    download(asset, output)
    if not target.startswith("windows"):
        output.chmod(0o755)
    (destination / "asset.json").write_text(json.dumps({
        "component": "MeshAgent", "version": remote["version"], "license": remote["license"],
        "platform": target, "asset": asset["filename"], "size": asset["size"],
        "sha256": asset["sha256"], "sha384": asset["sha384"], "source": asset["url"],
    }, indent=2) + "\n", encoding="utf-8")


def assemble_dsh(manifest: dict, target: str, runtime_destination: Path, plugin_destination: Path,
                 licenses_destination: Path) -> None:
    package_dir = Path(__file__).with_name("dsh")
    lock = package_dir / "package-lock.json"
    package_json = package_dir / "package.json"
    runtime = manifest["runtime"]
    if not lock.is_file() or not package_json.is_file():
        raise ValueError("pinned DSH npm dependency lock is missing")
    if runtime.get("package") != "@deepseek-ai/dsh" or runtime.get("version") != "0.2.1-rc.5":
        raise ValueError("unexpected DSH runtime package version")
    with tempfile.TemporaryDirectory(prefix="tether-dsh-") as temporary:
        workspace = Path(temporary)
        install_root = workspace / "npm-install"
        install_root.mkdir()
        shutil.copy2(lock, install_root / "package-lock.json")
        shutil.copy2(package_json, install_root / "package.json")
        npm = "npm.cmd" if sys.platform == "win32" else "npm"
        subprocess.run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=install_root, check=True, timeout=900)
        node_modules = install_root / "node_modules"
        entry = node_modules / "@deepseek-ai" / "dsh" / "lib" / "bin.js"
        if not entry.is_file():
            raise ValueError("locked DSH npm install has no lib/bin.js entry")
        platform, architecture = {
            "windows-x64": ("win32", "x64"), "linux-x64": ("linux", "x64"),
            "macos-x64": ("darwin", "x64"), "macos-arm64": ("darwin", "arm64"),
        }[target]
        node_pty = node_modules / "node-pty"
        native_dir = node_pty / "prebuilds" / f"{platform}-{architecture}"
        native_module = native_dir / ("conpty.node" if platform == "win32" else "pty.node")
        if not native_module.is_file():
            raise ValueError(f"locked node-pty has no native module for {target}")
        node = shutil.which("node.exe" if sys.platform == "win32" else "node")
        if not node:
            raise ValueError("pinned Node.js is unavailable while assembling DSH native dependencies")
        postinstall = node_pty / "scripts" / "post-install.js"
        subprocess.run([node, str(postinstall)], cwd=node_pty, check=True, timeout=120)
        helper = native_dir / "spawn-helper"
        if platform == "darwin" and not helper.is_file():
            raise ValueError(f"locked node-pty has no spawn-helper for {target}")
        if platform == "win32":
            conpty_dir = node_pty / "build" / "Release" / "conpty"
            if not (conpty_dir / "conpty.dll").is_file() or not (conpty_dir / "OpenConsole.exe").is_file():
                raise ValueError("locked node-pty Windows ConPTY runtime files are missing")
        helper_script = node_modules / "@deepseek-ai" / "dsh-subprocess-local" / "scripts" / "ensure-spawn-helper.mjs"
        subprocess.run([node, str(helper_script)], cwd=install_root, check=True, timeout=120)
        if platform == "darwin" and not os.access(helper, os.X_OK):
            raise ValueError(f"node-pty spawn-helper is missing or not executable for {target}")
        subprocess.run([npm, "prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=install_root, check=True, timeout=600)
        runtime_destination.mkdir(parents=True, exist_ok=True)
        runtime_dependencies = runtime_destination / "node_modules"
        runtime_dependencies.mkdir(parents=True, exist_ok=True)
        for item in node_modules.iterdir():
            if item.name == "meshcentral":
                continue
            target_path = runtime_dependencies / item.name
            if item.is_dir():
                copy_node_dependencies(item, target_path, node_modules)
            elif item.is_file():
                shutil.copy2(item, target_path)
        shutil.copy2(package_json, runtime_destination / "package.json")
        shutil.copy2(lock, runtime_destination / "package-lock.json")
        (runtime_destination / "runtime.json").write_text(json.dumps({
            "component": "@deepseek-ai/dsh", "version": runtime["version"],
            "license": runtime["license"], "source": runtime["source"],
            "entry": runtime["entry"], "lock": runtime["lock"],
        }, indent=2) + "\n", encoding="utf-8")
        packages = node_modules.rglob("package.json")
        dependency_rows = []
        licenses_destination.mkdir(parents=True, exist_ok=True)
        for metadata_path in packages:
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            name = str(metadata.get("name") or metadata_path.parent.name)
            version = str(metadata.get("version") or "unknown")
            license_name = metadata.get("license", "see package source")
            if isinstance(license_name, dict):
                license_name = license_name.get("type", "see package source")
            dependency_rows.append(f"{name}@{version}: {license_name}")
            safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)
            for license_file in metadata_path.parent.iterdir():
                if license_file.is_file() and license_file.name.lower() in {
                        "license", "license.md", "license.txt", "notice", "notice.md", "notice.txt"}:
                    shutil.copy2(license_file, licenses_destination / f"{safe_name}-{version}-{license_file.name}")
        (licenses_destination / "DEPENDENCIES.txt").write_text(
            "\n".join(sorted(set(dependency_rows))) + "\n", encoding="utf-8")
    plugin = manifest["frozen_plugin"]
    plugin_destination.mkdir(parents=True, exist_ok=True)
    plugin_archive = plugin_destination / plugin["name"]
    download(plugin, plugin_archive)
    (plugin_destination / "asset.json").write_text(json.dumps({
        "component": "Tether DSH plugin", "version": plugin["version"],
        "source": plugin["source"], "asset": plugin["name"],
        "size": plugin["size"], "sha256": plugin["sha256"],
        "install": "Only unpack this original archive into the Node's private DSH_HOME on explicit first-time user action.",
    }, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=sorted(TARGETS))
    parser.add_argument("--output", type=Path, default=ROOT / ".runtime/desktop-candidate")
    parser.add_argument("--codeg-web", type=Path, required=True)
    parser.add_argument("--herdr-runtime", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    expected = (ROOT / ".runtime/desktop-candidate").resolve()
    if output != expected:
        raise ValueError("output must be the isolated .runtime/desktop-candidate build staging directory")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    remote_manifest = json.loads(REMOTE_MANIFEST.read_text(encoding="utf-8-sig"))
    dsh_manifest = json.loads(DSH_MANIFEST.read_text(encoding="utf-8-sig"))
    libreoffice_manifest = json.loads((Path(__file__).with_name("libreoffice-assets.json")).read_text(encoding="utf-8-sig"))
    components = {str(item["name"]).lower(): item for item in manifest["components"]}
    required = {"codeg", "easytier", "sftpgo", "caddy", "rclone"}
    if set(components) != required:
        raise ValueError("component manifest must contain exactly the five pinned runtime components")

    output.mkdir(parents=True, exist_ok=True)
    component_root = output / "components"
    if component_root.exists():
        shutil.rmtree(component_root)
    component_root.mkdir(parents=True)
    node_asset_name = remote_manifest["platforms"][args.target]["node_asset"]
    node_asset = next((item for item in remote_manifest["nodejs"]["assets"] if item["name"] == node_asset_name), None)
    if node_asset is None:
        raise ValueError(f"pinned Node.js asset is missing for {args.target}")
    node_runtime_dir = component_root / "nodejs"
    assemble_node_runtime(node_asset, node_runtime_dir)
    (node_runtime_dir / "runtime.json").write_text(json.dumps({
        "component": "Node.js", "version": remote_manifest["nodejs"]["version"],
        "license": remote_manifest["nodejs"]["license"], "source": remote_manifest["nodejs"]["source"],
        "asset": node_asset["name"], "size": node_asset["size"], "sha256": node_asset["sha256"],
    }, indent=2) + "\n", encoding="utf-8")
    meshcentral_dir = component_root / "meshcentral"
    source_archive = output / "sources" / "MeshCentral" / remote_manifest["source_archives"][0]["name"]
    assemble_meshcentral(remote_manifest["source_archives"][0], meshcentral_dir, source_archive)
    assemble_meshagent(remote_manifest["meshagent"], args.target, component_root / "meshagent" / args.target)
    assemble_libreoffice(libreoffice_manifest, args.target, component_root / "libreoffice")
    assemble_dsh(dsh_manifest, args.target, component_root / "dsh", component_root / "dsh-plugin",
                 output / "licenses" / "DSH-node-dependencies")
    for icon_name in ["tether-app-s.ico", "tether-app-s.png"]:
        icon_source = ROOT / "assets" / icon_name
        if not icon_source.is_file():
            raise ValueError(f"required APP runtime icon is missing: {icon_name}")
        icon_target = output / "assets" / icon_name
        icon_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon_source, icon_target)
    node_bin = output / "node-bin"
    if node_bin.exists():
        shutil.rmtree(node_bin)
    agents_runtime = node_bin / "agents-runtime"
    agents_runtime.mkdir(parents=True)
    codeg_web = args.codeg_web.resolve()
    for required_page in ["index.html", "login.html", "workspace.html", "token.html"]:
        if not (codeg_web / required_page).is_file():
            raise ValueError(f"pinned Codeg UI export is missing {required_page}")
    copy_tree(codeg_web, agents_runtime / "web")
    herdr_source = args.herdr_runtime.resolve()
    herdr_required = {
        "windows-x64": ["herdr.exe", "conpty/conpty.dll", "conpty/x64/OpenConsole.exe", "conpty/arm64/OpenConsole.exe", "conpty/herdr-conpty.json"],
        "linux-x64": ["herdr-linux-x86_64"],
        "macos-x64": ["herdr-macos-x86_64"],
        "macos-arm64": ["herdr-macos-aarch64"],
    }[args.target]
    for relative in herdr_required:
        if not (herdr_source / relative).is_file():
            raise ValueError(f"pinned Herdr runtime is missing {relative}")
    copy_tree(herdr_source, node_bin)
    if not args.target.startswith("windows"):
        (node_bin / herdr_required[0]).chmod(0o755)
    for notice in ["LICENSE.herdr", "THIRD-PARTY-NOTICES.herdr"]:
        source = ROOT / "tether/node/bin" / notice
        if not source.exists() and notice == "THIRD-PARTY-NOTICES.herdr":
            source = ROOT / "tether/node/bin/THIRD-PARTY-NOTICES.herdr"
        if source.is_file():
            shutil.copy2(source, node_bin / notice)
    conpty_notices = ROOT / "tether/node/bin/THIRD-PARTY-NOTICES.herdr"
    if conpty_notices.is_dir():
        copy_tree(conpty_notices, node_bin / "THIRD-PARTY-NOTICES.herdr")
    for component_name, component in components.items():
        asset = next((entry for entry in component["assets"] if entry["platform"] == args.target), None)
        if asset is None:
            raise ValueError(f"{component_name} has no pinned asset for {args.target}")
        destination = output / "components" / component_name
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        with tempfile.TemporaryDirectory(prefix="tether-component-") as temporary:
            workspace = Path(temporary)
            archive_path = workspace / asset["name"]
            extracted = workspace / "extracted"
            extracted.mkdir()
            download(asset, archive_path)
            extract_archive(archive_path, extracted)
            if component_name == "sftpgo":
                binary = "sftpgo.exe" if args.target.startswith("windows") else "sftpgo"
                core, config = _select_sftpgo_files(extracted, args.target, asset["name"])
                shutil.copy2(core, destination / binary)
                shutil.copy2(config, destination / "sftpgo.json")
                if not args.target.startswith("windows"):
                    (destination / binary).chmod(0o755)
            else:
                if component_name != "codeg":
                    copy_tree(extracted, destination)
                if component_name == "codeg":
                    suffix = ".exe" if args.target.startswith("windows") else ""
                    names = {"codeg-server" + suffix, "codeg-mcp" + suffix, "codeg-computer-helper" + suffix}
                    found = set()
                    for binary in extracted.rglob("*"):
                        if binary.is_file() and binary.name in names:
                            found.add(binary.name)
                            target = agents_runtime / binary.name
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(binary, target)
                            if not args.target.startswith("windows"):
                                target.chmod(0o755)
                    if "codeg-server" + suffix not in found:
                        raise ValueError(f"Codeg server executable missing from {asset['name']}")
            (destination / "asset.json").write_text(json.dumps({
                "component": component_name,
                "version": component["version"],
                "platform": args.target,
                "asset": asset["name"],
                "size": asset["size"],
                "sha256": asset["sha256"],
                "source": asset["url"],
            }, indent=2) + "\n", encoding="utf-8")

    for notice in ["LICENSE.Caddy", "LICENSE.Codeg", "LICENSE.EasyTier", "LICENSE.rclone", "LICENSE.SFTPGo", "NOTICE.SFTPGo"]:
        source = LICENSE_DIR / notice
        if not source.is_file():
            raise ValueError(f"required license/notice is missing: {notice}")
        target = output / "licenses" / notice
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    shutil.copy2(node_runtime_dir / "LICENSE", output / "licenses" / "LICENSE.Node.js")
    shutil.copy2(meshcentral_dir / "LICENSE", output / "licenses" / "LICENSE.MeshCentral")
    shutil.copy2(LICENSE_DIR / "LICENSE.LibreOffice", output / "licenses" / "LICENSE.LibreOffice")
    shutil.copy2(LICENSE_DIR / "NOTICE.LibreOffice", output / "licenses" / "NOTICE.LibreOffice")
    agent_license = LICENSE_DIR / "LICENSE.MeshAgent"
    if not agent_license.is_file():
        raise ValueError("MeshAgent Apache-2.0 license text is missing")
    shutil.copy2(agent_license, output / "licenses" / "LICENSE.MeshAgent")
    (output / "licenses" / "NOTICE.MeshAgent").write_text(
        "MeshAgent legacy-1.2.6 fixed upstream binaries. Apache-2.0 attribution: "
        "https://github.com/Ylianst/MeshAgent/tree/legacy-1.2.6 (README.md, License section).\n",
        encoding="utf-8")
    dependency_notices = output / "licenses" / "MeshCentral-node-dependencies"
    dependency_notices.mkdir(parents=True, exist_ok=True)
    dependency_rows = []
    for package_json in (meshcentral_dir / "node_modules").rglob("package.json"):
        try:
            metadata = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        package_name = str(metadata.get("name") or package_json.parent.name)
        package_version = str(metadata.get("version") or "unknown")
        package_license = metadata.get("license", "see package source")
        if isinstance(package_license, dict):
            package_license = package_license.get("type", "see package source")
        dependency_rows.append(f"{package_name}@{package_version}: {package_license}")
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", package_name)
        for license_file in package_json.parent.iterdir():
            if license_file.is_file() and license_file.name.lower() in {
                    "license", "license.md", "license.txt", "notice", "notice.md", "notice.txt"}:
                shutil.copy2(license_file, dependency_notices / f"{safe_name}-{package_version}-{license_file.name}")
    (dependency_notices / "DEPENDENCIES.txt").write_text(
        "\n".join(sorted(set(dependency_rows))) + "\n", encoding="utf-8")
    source_offer = LICENSE_DIR / "SOURCE_OFFERS.md"
    shutil.copy2(source_offer, output / "licenses" / "SOURCE_OFFERS.md")
    for asset in manifest.get("source_archives", []):
        if asset.get("component") != "SFTPGo" or asset.get("version") != "v2.7.6":
            raise ValueError("unexpected source archive in component manifest")
        with tempfile.TemporaryDirectory(prefix="tether-source-") as temporary:
            archive_path = Path(temporary) / asset["name"]
            download(asset, archive_path)
            source_target = output / "sources" / "SFTPGo" / asset["name"]
            source_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(archive_path, source_target)
    shutil.copytree(Path(__file__).with_name("licenses"), output / "licenses", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("description.md", "backlog.md"))
    shutil.copy2(Path(__file__).with_name("capability-policy.json"), output / "capability-policy.json")
    shutil.copy2(MANIFEST, output / "component-assets.json")
    shutil.copy2(REMOTE_MANIFEST, output / "remote-desktop-assets.json")
    shutil.copy2(DSH_MANIFEST, output / "dsh-assets.json")
    shutil.copy2(Path(__file__).with_name("libreoffice-assets.json"), output / "libreoffice-assets.json")
    print(f"Verified and assembled pinned runtime assets for {args.target} in {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError, urllib.error.URLError) as error:
        print(f"candidate assembly failed: {error}", file=sys.stderr)
        raise SystemExit(1)
