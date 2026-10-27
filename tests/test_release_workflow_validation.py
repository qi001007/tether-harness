from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _powershell() -> str:
    executable = shutil.which("pwsh") or shutil.which("powershell.exe")
    if not executable:
        pytest.skip("PowerShell is required for the release workflow validation test")
    return executable


def _validation_script() -> str:
    lines = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8").splitlines()
    step = lines.index("      - name: Validate release source and tag")
    run = lines.index("        run: |", step)
    body: list[str] = []
    for line in lines[run + 1 :]:
        if line and len(line) - len(line.lstrip(" ")) < 10:
            break
        body.append(line[10:] if line.startswith("          ") else line)
    return "\n".join(body) + "\nexit $LASTEXITCODE\n"


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def _repo(tmp_path: Path, version: str = "0.2.1") -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "test@example.invalid")
    _git(repo, "config", "user.name", "Release Workflow Test")
    (repo / "version.json").write_text(
        json.dumps({"schema": 1, "components": {
            "app": version, "plugin": version, "node": version,
        }}),
        encoding="utf-8",
    )
    _git(repo, "add", "version.json")
    _git(repo, "commit", "-m", "release fixture")
    return repo, _git(repo, "rev-parse", "HEAD")


def _run_validation(repo: Path, sha: str, tmp_path: Path) -> subprocess.CompletedProcess[bytes]:
    script = tmp_path / "validate-release.ps1"
    github_env = tmp_path / "github-env"
    script.write_text(_validation_script(), encoding="utf-8")
    env = dict(os.environ)
    env.update({
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF_TYPE": "branch",
        "GITHUB_REF_NAME": "main",
        "GITHUB_SHA": sha,
        "GITHUB_ENV": str(github_env),
        "INPUT_TAG": "v0.2.1",
    })
    return subprocess.run(
        [_powershell(), "-NoProfile", "-NonInteractive", "-File", str(script)],
        cwd=repo,
        env=env,
        capture_output=True,
        timeout=20,
        check=False,
    )


def test_release_workflow_accepts_new_tag_after_successful_main_validation(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path)

    result = _run_validation(repo, sha, tmp_path)

    assert result.returncode == 0, result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")
    assert not (repo / ".git" / "refs" / "tags" / "v0.2.1").exists()


def test_release_workflow_rejects_component_version_mismatch(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path, version="0.2.2")

    result = _run_validation(repo, sha, tmp_path)

    assert result.returncode != 0
    assert b"does not match component versions" in result.stdout + result.stderr


def test_release_workflow_rejects_tag_pointing_to_another_commit(tmp_path: Path) -> None:
    repo, first_sha = _repo(tmp_path)
    _git(repo, "tag", "v0.2.1", first_sha)
    (repo / "followup.txt").write_text("second commit", encoding="utf-8")
    _git(repo, "add", "followup.txt")
    _git(repo, "commit", "-m", "new source commit")
    second_sha = _git(repo, "rev-parse", "HEAD")

    result = _run_validation(repo, second_sha, tmp_path)

    assert result.returncode != 0
    assert b"points to" in result.stdout + result.stderr
