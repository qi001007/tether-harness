from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import release_pipeline  # noqa: E402


def _fixture(root: Path, newline: str = "\n") -> None:
    (root / "apps" / "tether-app").mkdir(parents=True)
    files = {
        "version.json": json.dumps({"schema": 1, "components": {
            "app": "1.2.3", "plugin": "0.2.93", "node": "1.2.3"}}, indent=2) + "\n",
        "apps/tether-app/package.json": json.dumps({
            "name": "tether-app", "version": "1.2.3", "dependencies": {"electron-updater": "1.2.3"}}, indent=2) + "\n",
        "apps/tether-app/package-lock.json": json.dumps({
            "name": "tether-app", "version": "1.2.3", "lockfileVersion": 3, "requires": True,
            "packages": {
                "": {"name": "tether-app", "version": "1.2.3", "license": "MIT"},
                "node_modules/electron-updater": {"version": "1.2.3"},
            }}, indent=2) + "\n",
        "pyproject.toml": '[project]\nname = "tether-harness"\nversion = "1.2.3"\n',
    }
    for name, text in files.items():
        (root / name).write_bytes(text.replace("\n", newline).encode("utf-8"))


def test_bump_dry_run_reports_four_sources_without_writing(tmp_path: Path) -> None:
    _fixture(tmp_path)
    before = {path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}

    assert release_pipeline.bump(tmp_path, "1.2.4", write=False) == 0

    assert {path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()} == before


def test_bump_write_updates_only_the_four_version_sources(tmp_path: Path) -> None:
    _fixture(tmp_path)

    assert release_pipeline.bump(tmp_path, "1.2.4", write=True) == 0

    versions = json.loads((tmp_path / "version.json").read_text(encoding="utf-8"))["components"]
    assert versions == {"app": "1.2.4", "plugin": "0.2.93", "node": "1.2.4"}
    assert json.loads((tmp_path / "apps" / "tether-app" / "package.json").read_text(encoding="utf-8"))["version"] == "1.2.4"
    lock = json.loads((tmp_path / "apps" / "tether-app" / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["version"] == "1.2.4"
    assert lock["packages"][""]["version"] == "1.2.4"
    assert lock["packages"]["node_modules/electron-updater"]["version"] == "1.2.3"
    assert 'version = "1.2.4"' in (tmp_path / "pyproject.toml").read_text(encoding="utf-8")


def test_bump_preserves_crlf_line_endings(tmp_path: Path) -> None:
    _fixture(tmp_path, newline="\r\n")

    assert release_pipeline.bump(tmp_path, "1.2.4", write=True) == 0

    payload = (tmp_path / "apps" / "tether-app" / "package-lock.json").read_bytes()
    assert b'"version": "1.2.4"' in payload or b'"version": "1.2.4",' in payload
    assert payload.count(b"\n") == payload.count(b"\r\n")


def test_bump_rejects_versions_that_are_not_xyz(tmp_path: Path) -> None:
    _fixture(tmp_path)

    with pytest.raises(SystemExit):
        release_pipeline.bump(tmp_path, "1.2", write=False)
    with pytest.raises(SystemExit):
        release_pipeline.bump(tmp_path, "1.2.3.4", write=True)