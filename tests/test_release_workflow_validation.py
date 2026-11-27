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


def _repo(tmp_path: Path, version: str = "0.2.1", *, plugin_version: str | None = None,
         node_version: str | None = None) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "test@example.invalid")
    _git(repo, "config", "user.name", "Release Workflow Test")
    (repo / "version.json").write_text(
        json.dumps({"schema": 1, "components": {
            "app": version, "plugin": plugin_version or version, "node": node_version or version,
        }}),
        encoding="utf-8",
    )
    _git(repo, "add", "version.json")
    _git(repo, "commit", "-m", "release fixture")
    return repo, _git(repo, "rev-parse", "HEAD")


def _run_validation(
    repo: Path,
    sha: str,
    tmp_path: Path,
    *,
    event: str = "workflow_dispatch",
    ref_type: str = "branch",
    ref_name: str = "main",
    input_tag: str = "v0.2.1",
) -> subprocess.CompletedProcess[bytes]:
    script = tmp_path / "validate-release.ps1"
    github_env = tmp_path / "github-env"
    script.write_text(_validation_script(), encoding="utf-8")
    env = dict(os.environ)
    env.update({
        "GITHUB_EVENT_NAME": event,
        "GITHUB_REF_TYPE": ref_type,
        "GITHUB_REF_NAME": ref_name,
        "GITHUB_SHA": sha,
        "GITHUB_ENV": str(github_env),
        "INPUT_TAG": input_tag,
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


def test_release_workflow_accepts_candidate_branch_and_derives_tag(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path)

    result = _run_validation(
        repo, sha, tmp_path, event="push", ref_type="branch", ref_name="release-candidate/v0.2.1"
    )

    assert result.returncode == 0, result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")
    values = (tmp_path / "github-env").read_text(encoding="utf-8")
    assert "RELEASE_TAG=v0.2.1" in values
    assert "CREATE_TAG=True" in values
    assert "CREATE_TAG_ALLOWED=True" in values


def test_release_workflow_rejects_arbitrary_push_branch(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path)

    result = _run_validation(repo, sha, tmp_path, event="push", ref_type="branch", ref_name="feature/work")

    assert result.returncode != 0
    assert b"release-candidate/vX.Y.Z" in result.stdout + result.stderr


def test_release_workflow_accepts_only_existing_tag_pushes(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path)
    _git(repo, "tag", "v0.2.1", sha)

    result = _run_validation(repo, sha, tmp_path, event="push", ref_type="tag", ref_name="v0.2.1")

    assert result.returncode == 0, result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")
    values = (tmp_path / "github-env").read_text(encoding="utf-8")
    assert "CREATE_TAG=False" in values
    assert "CREATE_TAG_ALLOWED=False" in values


def test_release_workflow_rejects_component_version_mismatch(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path, version="0.2.2")

    result = _run_validation(repo, sha, tmp_path)

    assert result.returncode != 0
    assert b"does not match APP and Node versions" in result.stdout + result.stderr


def test_release_workflow_accepts_frozen_plugin_version(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path, plugin_version="0.2.93")

    result = _run_validation(repo, sha, tmp_path)

    assert result.returncode == 0, result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")
    assert b"FROZEN_PLUGIN=True" in (tmp_path / "github-env").read_bytes()


def test_release_workflow_rejects_app_node_version_mismatch(tmp_path: Path) -> None:
    repo, sha = _repo(tmp_path, node_version="0.2.2")

    result = _run_validation(repo, sha, tmp_path)

    assert result.returncode != 0
    assert b"APP and Node versions" in result.stdout + result.stderr


def test_release_workflow_downloads_and_uploads_only_frozen_component_assets() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "- 'release-candidate/v*'" in workflow
    assert "- '!v*-preview.*'" in workflow
    assert "Hydrate pinned Herdr v0.9.5 runtime" in workflow
    assert "CREATE_TAG_ALLOWED !== 'True'" in workflow
    assert '$releaseBase = "https://github.com/qi001007/tether-harness/releases/download/v$pluginVersion"' in workflow
    assert "--frozen-plugin-manifest" in workflow
    assert "--frozen-plugin-archive" in workflow
    assert "tether-plugin-$pluginVersion.zip" in workflow
    assert "if (!frozenPlugin) names.splice(1, 0, `tether-plugin-${releaseVersion}.zip`)" in workflow
    assert "if (names.includes(asset.name) || (frozenPlugin && asset.name === obsoletePluginName))" in workflow
    posix = (ROOT / ".github" / "workflows" / "posix.yml").read_text(encoding="utf-8")
    assert "--proto '=https' --tlsv1.2" in posix
    assert "--frozen-plugin-manifest" in posix and "--frozen-plugin-archive" in posix
    assert "'version.json'" in posix


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


def test_desktop_preview_workflow_is_dispatch_driven_and_draft_only() -> None:
    import yaml

    raw = (ROOT / ".github" / "workflows" / "tether-desktop-candidate.yml").read_text(encoding="utf-8")
    workflow = yaml.safe_load(raw)
    triggers = workflow.get("on", workflow.get(True))
    assert list(triggers) == ["workflow_dispatch"]
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"version", "preview_tag", "posix_only"}

    assert "concurrency:\n  group: ${{ github.workflow }}-${{ inputs.version }}\n  cancel-in-progress: true" in raw
    assert "CANDIDATE_VERSION: ${{ inputs.version }}" in raw
    assert "CANDIDATE_TAG: ${{ inputs.preview_tag || format('v{0}-preview.1', inputs.version) }}" in raw
    assert "refs/heads/codex/" not in raw
    assert "github.ref == 'refs/heads/" not in raw

    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["app"]
    assert version not in raw

    jobs = workflow["jobs"]
    assert "test" in jobs
    assert jobs["package"]["needs"] == ["build-codeg-web", "test"]
    assert "test-${{ matrix.os }}" == jobs["test"]["name"]
    assert "fail-fast: false" in raw
    assert "python -m pytest -q" in raw
    assert "node --test --test-force-exit tests/test_*.mjs" in raw
    assert "node --test --test-force-exit tests/test_*.cjs" in raw

    validate = next(step for step in jobs["package"]["steps"] if step.get("name") == "Validate candidate version and frozen plugin channel")
    assert "0.2.93" in validate["run"]
    assert "pyproject.toml" in validate["run"]
    assert "preview\\.([1-9]\\d*)" in validate["run"]

    assert "name: tether-${{ matrix.target }}-${{ env.CANDIDATE_VERSION }}-preview" in raw
    assert ".scratch/tether-desktop-candidates/${{ env.CANDIDATE_VERSION }}/${{ matrix.target }}" in raw
    assert "tether-node-runtime-linux-x64-${{ env.CANDIDATE_VERSION }}-preview" in raw
    assert "checksum.get('version') != candidate_version" in raw
    assert "checksum.get('platform') != target" in raw
    assert "hydrate_herdr_runtime.py --windows-only --destination .release-herdr-runtime" in raw
    assert "--herdr-runtime .release-herdr-runtime" in raw

    publish = jobs["publish-preview-draft"]
    assert "always()" in publish["if"]
    assert "needs.package.result == 'success'" in publish["if"]
    assert "!inputs.posix_only" in publish["if"]
    assert publish["permissions"] == {"actions": "read", "contents": "write"}
    release_action = next(step for step in publish["steps"] if step.get("uses", "").startswith("softprops/action-gh-release@"))
    assert release_action["with"]["draft"] is True
    assert release_action["with"]["prerelease"] is True
    assert release_action["with"]["make_latest"] is False
    assert "tag_name: ${{ env.CANDIDATE_TAG }}" in raw


def test_desktop_preview_workflow_keeps_draft_and_codeg_guards() -> None:
    import yaml

    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "tether-desktop-candidate.yml").read_text(encoding="utf-8"))
    jobs = workflow["jobs"]
    assert "if" not in jobs["build-codeg-web"]
    assert "if" not in jobs["package"]

    publish = jobs["publish-preview-draft"]
    steps = publish["steps"]
    checkout = next(step for step in steps if step.get("uses", "").startswith("actions/checkout@"))
    assert checkout["with"]["fetch-depth"] == 2
    artifact_steps = [step for step in steps if step.get("uses", "").startswith("actions/download-artifact@")]
    assert len(artifact_steps) == 2
    assert all(step["with"]["run-id"] == "${{ github.run_id }}" for step in artifact_steps)
    assert all(step["with"]["github-token"] == "${{ secrets.GITHUB_TOKEN }}" for step in artifact_steps)
    release_action = next(step for step in steps if step.get("uses", "").startswith("softprops/action-gh-release@"))
    assert release_action["with"]["draft"] is True
    assert release_action["with"]["prerelease"] is True
    assert release_action["with"]["make_latest"] is False
    assert "Guard fixed preview.2 reassembly source" not in [step.get("name") for step in steps]


def test_release_matrix_workflow_is_manual_draft_only_and_tests_every_platform() -> None:
    import yaml

    raw = (ROOT / ".github" / "workflows" / "release-matrix.yml").read_text(encoding="utf-8")
    workflow = yaml.safe_load(raw)
    triggers = workflow.get("on", workflow.get(True))
    assert list(triggers) == ["workflow_dispatch"]
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"version", "channel", "sign"}
    assert inputs["sign"]["default"] is False

    assert "concurrency:\n  group: release-matrix-${{ inputs.version }}\n  cancel-in-progress: false" in raw
    targets = {item["target"]: item["runner"] for item in workflow["jobs"]["package"]["strategy"]["matrix"]["include"]}
    assert targets == {
        "windows-x64": "windows-latest",
        "linux-x64": "ubuntu-22.04",
        "linux-arm64": "ubuntu-22.04-arm",
        "macos-arm64": "macos-15",
        "macos-x64": "macos-15-intel",
    }
    jobs = workflow["jobs"]
    assert jobs["package"]["needs"] == ["preflight", "build-codeg-web"]
    names = [step.get("name") for step in jobs["package"]["steps"]]
    assert "Run Python and JavaScript regressions" in names
    assert names.index("Run Python and JavaScript regressions") < names.index("Package installer")
    assert "Record signing status and SHA256SUMS" in names
    assert "Verify Windows Authenticode signatures" in names
    assert "${{ inputs.sign && secrets.WINDOWS_CERT_PFX_BASE64 || '' }}" in raw
    assert "SIGN=1 needs WINDOWS_CERT_PFX_BASE64" in raw

    assemble = jobs["assemble-draft"]
    assert assemble["needs"] == ["build-codeg-web", "package"]
    assert assemble["permissions"] == {"actions": "read", "contents": "write"}
    release_action = next(step for step in assemble["steps"] if step.get("uses", "").startswith("softprops/action-gh-release@"))
    assert release_action["with"]["draft"] is True
    assert release_action["with"]["prerelease"] == "${{ inputs.channel == 'preview' }}"
    assert release_action["with"]["make_latest"] is False
    assert "TETHER_RELEASE_PRIVATE_KEY" in raw
    assert "scripts/assemble_release_manifest.py matrix" in raw
    assert "scripts/build_release.py --channel" in raw
    assert "TETHER_REQUIRE_SIGNED_RELEASE: '1'" in raw
    assert "gh release" not in raw and "hub-pin" not in raw


def test_codeg_web_checkout_step_copies_dynamic_artifact_and_preserves_old_tree_on_invalid_source(tmp_path: Path) -> None:
    import yaml

    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "tether-desktop-candidate.yml").read_text(encoding="utf-8"))
    steps = workflow["jobs"]["publish-preview-draft"]["steps"]
    step = next(item for item in steps if item.get("name") == "Replace stale Codeg runtime web in the isolated release checkout")
    run = step["run"]
    script = run.split("python - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]

    def prepare(root: Path, *, missing: str | None = None) -> tuple[Path, Path]:
        source = root / ".release-codeg-web"
        web = root / "tether" / "node" / "bin" / "agents-runtime" / "web"
        source.mkdir(parents=True)
        web.mkdir(parents=True)
        for name in ("index.html", "login.html", "workspace.html", "token.html", "chunks/app.js"):
            if name == missing:
                continue
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"artifact:{name}\n", encoding="utf-8")
        (web / "stale.js").write_text("stale\n", encoding="utf-8")
        return source, web

    valid_root = tmp_path / "valid"
    source, web = prepare(valid_root)
    result = subprocess.run([os.sys.executable, "-c", script], cwd=valid_root, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    source_files = {path.relative_to(source).as_posix(): path.read_bytes() for path in source.rglob("*") if path.is_file()}
    target_files = {path.relative_to(web).as_posix(): path.read_bytes() for path in web.rglob("*") if path.is_file()}
    assert target_files == source_files
    assert "stale.js" not in target_files
    metadata = json.loads(result.stdout)
    assert metadata["status"] == "verified"
    assert metadata["web"] == "tether/node/bin/agents-runtime/web"
    assert metadata["files"] == len(source_files)
    assert metadata["bytes"] == sum(map(len, source_files.values()))
    assert set(metadata["pages"]) == {"index.html", "login.html", "workspace.html", "token.html"}

    invalid_root = tmp_path / "invalid"
    _, invalid_web = prepare(invalid_root, missing="workspace.html")
    result = subprocess.run([os.sys.executable, "-c", script], cwd=invalid_root, capture_output=True, text=True, check=False)
    assert result.returncode != 0
    assert "required page: workspace.html" in result.stderr
    assert (invalid_web / "stale.js").read_text(encoding="utf-8") == "stale\n"


def test_headless_linux_builders_derive_artifact_paths_and_metadata_from_version_json(monkeypatch, tmp_path: Path) -> None:
    import importlib

    monkeypatch.syspath_prepend(str(ROOT / "desktop" / "packaging"))
    node_builder = importlib.import_module("build_headless_node")
    deb_builder = importlib.import_module("build_headless_deb")
    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["components"]["node"]

    assert node_builder.VERSION == deb_builder.VERSION == version
    assert node_builder.OUTPUT_DIR == ROOT / ".scratch" / "tether-desktop-candidates" / version / "headless" / "linux-x64"
    assert deb_builder.OUTPUT_DIR == node_builder.OUTPUT_DIR
    assert node_builder.ARCHIVE_NAME == f"Tether-node-runtime-{version}-linux-x64.tar.gz"
    assert deb_builder.ARCHIVE.name == node_builder.ARCHIVE_NAME
    assert deb_builder.DEB_NAME == f"Tether-node-runtime-{version}-linux-x64.deb"

    postinstall = deb_builder._write_postinstall(tmp_path)
    contents = postinstall.read_text(encoding="utf-8")
    assert f"VERSION={version}" in contents
    assert "@TETHER_VERSION@" not in contents

    readme = deb_builder._write_versioned_file(
        tmp_path, "README.Debian", Path("headless-deb") / "README.Debian", "@TETHER_VERSION@"
    )
    readme_contents = readme.read_text(encoding="utf-8")
    assert f"Tether-node-runtime-{version}-linux-x64.deb" in readme_contents
    assert "@TETHER_VERSION@" not in readme_contents
