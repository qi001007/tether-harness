from __future__ import annotations

import json
from pathlib import Path

import pytest

from tether.node.fs_service import MAX_PREVIEW_TEXT, FsError, FsService


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    data = tmp_path / "data"
    workspace = tmp_path / "node-work"
    workspace.mkdir()
    root = tmp_path / "TetherWorkspaces"
    service = FsService(device="TEST", workspace=workspace, data_dir=data, workspaces_root=root)
    return {"home": home, "data": data, "workspace": workspace, "root": root, "svc": service}


def test_readonly_allows_project_root_and_denies_outside(env, tmp_path: Path) -> None:
    svc: FsService = env["svc"]
    svc.dispatch("mkdir", {"path": str(env["root"] / "demo")})
    written = svc.dispatch("write", {"path": str(env["root"] / "demo" / "a.txt"), "text": "hello"})
    assert written["bytes"] == 5
    assert svc.dispatch("read", {"path": str(env["root"] / "demo" / "a.txt")})["text"] == "hello"
    listing = svc.dispatch("list", {"path": str(env["root"] / "demo")})
    assert [entry["name"] for entry in listing["entries"]] == ["a.txt"]

    outside = tmp_path / "outside.txt"
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {"path": str(outside), "text": "no"})
    assert caught.value.code == "denied"
    assert not outside.exists()

    audit = svc.dispatch("audit_list", {"limit": 20})["entries"]
    assert any(row["phase"] == "intent" and row["result"] == "denied" for row in audit)
    assert any(row["phase"] == "result" and row["result"] == "ok" for row in audit)


def test_existing_dsh_workspace_is_writable_in_readonly(env) -> None:
    home: Path = env["home"]
    dsh_dir = home / "dsh-project"
    dsh_dir.mkdir()
    registry = home / ".dsh" / "storages" / "workspace.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(json.dumps({
        "tables": {"workspaces": {"w1": {"path": str(dsh_dir), "title": "proj"}}}
    }), encoding="utf-8")

    svc: FsService = env["svc"]
    workspaces = svc.dispatch("workspaces", {})["workspaces"]
    project = next(item for item in workspaces if item["id"] == "w1")
    assert project["writable"] is True

    svc.dispatch("write", {"path": str(dsh_dir / "file.txt"), "text": "ok"})
    assert (dsh_dir / "file.txt").read_text(encoding="utf-8") == "ok"


def test_full_mode_writes_outside_but_still_protects_system_and_credentials(env, tmp_path: Path) -> None:
    svc: FsService = env["svc"]
    svc.dispatch("policy_set", {"mode": "full"})
    outside = tmp_path / "outside.txt"
    svc.dispatch("write", {"path": str(outside), "text": "full"})
    assert outside.read_text(encoding="utf-8") == "full"

    assert svc.policy.can_write(Path("C:/Windows/tether-test.txt"), op="write")[0] is False
    assert svc.policy.can_write(Path("C:/Program Files/tether-test.txt"), op="write")[0] is False

    secret = env["home"] / ".dsh" / ".credentials.yaml"
    secret.parent.mkdir(parents=True, exist_ok=True)
    secret.write_text("key: secret", encoding="utf-8")
    with pytest.raises(FsError) as caught:
        svc.dispatch("read", {"path": str(secret)})
    assert caught.value.code == "denied"


def test_audit_uses_sqlite_and_pages_newest_first(env) -> None:
    svc: FsService = env["svc"]
    for index in range(12):
        svc.audit.add(op="probe", path=str(index), phase="result", result="ok")
    first = svc.dispatch("audit_list", {"limit": 5, "offset": 0})
    assert [row["path"] for row in first["entries"]] == ["11", "10", "9", "8", "7"]
    second = svc.dispatch("audit_list", {"limit": 5, "offset": 5})
    assert [row["path"] for row in second["entries"]] == ["6", "5", "4", "3", "2"]
    assert first["count"] >= 12
    assert first["retained"] == 100000
    assert (env["data"] / "audit.db").is_file()


def test_drive_root_without_trailing_separator_resolves(env) -> None:
    svc: FsService = env["svc"]
    resolved = svc._resolve("C:")
    assert resolved.is_absolute()
    assert str(resolved).endswith("\\")


def test_preview_returns_renderable_text_markdown_image_and_pdf(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "preview"
    folder.mkdir()
    (folder / "note.md").write_text("# Title\n\nbody", encoding="utf-8")
    (folder / "plain.txt").write_text("line one", encoding="utf-8")
    (folder / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 16)
    (folder / "doc.pdf").write_bytes(b"%PDF-1.4\n%%EOF")
    (folder / "blob.bin").write_bytes(b"\x00\x01\x02")

    markdown = svc.dispatch("preview", {"path": str(folder / "note.md")})
    assert markdown["kind"] == "markdown" and "# Title" in markdown["text"]
    assert svc.dispatch("preview", {"path": str(folder / "plain.txt")})["kind"] == "text"
    image = svc.dispatch("preview", {"path": str(folder / "pic.png")})
    assert image["kind"] == "image" and image["mime"] == "image/png" and image["base64"]
    pdf = svc.dispatch("preview", {"path": str(folder / "doc.pdf")})
    assert pdf["kind"] == "pdf" and pdf["mime"] == "application/pdf" and pdf["base64"]
    assert svc.dispatch("preview", {"path": str(folder / "blob.bin")})["kind"] == "unsupported"


def test_text_preview_preserves_remote_identity_encoding_newline_and_version(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "editing"
    folder.mkdir()
    target = folder / "legacy.py"
    target.write_bytes("# 中文\r\nprint('ok')\r\n".encode("gb18030"))

    preview = svc.dispatch("preview", {"path": str(target)})
    assert preview["device_id"] == "TEST"
    assert preview["encoding"] == "gb18030"
    assert preview["newline"] == "crlf"
    assert preview["editable"] is True
    assert preview["truncated"] is False
    assert len(preview["version"]) == 64
    stat = svc.dispatch("stat", {"path": str(target)})
    assert stat["device_id"] == "TEST"
    assert stat["version"] == preview["version"]

    saved = svc.dispatch("write", {
        "path": str(target),
        "text": preview["text"].replace("ok", "saved"),
        "expected_version": preview["version"],
        "encoding": preview["encoding"],
        "newline": preview["newline"],
    })
    assert saved["device_id"] == "TEST"
    assert saved["version"] != preview["version"]
    raw = target.read_bytes()
    assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    assert raw.decode("gb18030").endswith("print('saved')\r\n")

    target.write_text("external\n", encoding="utf-8")
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {
            "path": str(target), "text": "stale", "expected_version": saved["version"],
            "encoding": "gb18030", "newline": "crlf",
        })
    assert caught.value.code == "conflict"
    assert target.read_text(encoding="utf-8") == "external\n"


def test_only_complete_source_text_is_editable(env) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "editable"
    folder.mkdir()
    unknown = folder / "Dockerfile.custom"
    unknown.write_text("FROM python:3.13\n", encoding="utf-8")
    archive = folder / "sample.zip"
    with __import__("zipfile").ZipFile(archive, "w") as output:
        output.writestr("inside.txt", "data")
    large = folder / "large.txt"
    large.write_text("x" * (MAX_PREVIEW_TEXT + 1), encoding="utf-8")

    unknown_preview = svc.dispatch("preview", {"path": str(unknown)})
    assert unknown_preview["kind"] == "text"
    assert unknown_preview["editable"] is True
    assert unknown_preview["encoding"] == "utf-8"
    assert svc.dispatch("preview", {"path": str(archive)})["editable"] is False
    large_preview = svc.dispatch("preview", {"path": str(large)})
    assert large_preview["truncated"] is True
    assert large_preview["editable"] is False


def test_office_preview_reuses_converted_pdf_until_source_changes(env, monkeypatch: pytest.MonkeyPatch) -> None:
    svc: FsService = env["svc"]
    folder = env["root"] / "office"
    folder.mkdir()
    doc = folder / "report.docx"
    doc.write_bytes(b"fake-docx")
    calls: list[tuple[str, str]] = []

    def fake_convert(source: Path, kind: str) -> bytes:
        calls.append((str(source), kind))
        return b"%PDF-1.4\nfake-converted"

    monkeypatch.setattr(svc, "_office_pdf", fake_convert)
    first = svc.dispatch("preview", {"path": str(doc)})
    second = svc.dispatch("preview", {"path": str(doc)})
    assert first["converted"] is True and second["converted"] is True
    assert first["base64"] == second["base64"]
    assert len(calls) == 1
    assert len(list(svc.preview_cache_dir.glob("*.pdf"))) == 1
    audit = svc.dispatch("audit_list", {"limit": 20})["entries"]
    assert any(row.get("from_cache") is True for row in audit)

    doc.write_bytes(b"fake-docx-v2")
    third = svc.dispatch("preview", {"path": str(doc)})
    assert third["kind"] == "pdf"
    assert len(calls) == 2


def test_locked_mode_blocks_all_writes(env) -> None:
    svc: FsService = env["svc"]
    svc.dispatch("policy_set", {"mode": "locked"})
    target = env["root"] / "locked.txt"
    with pytest.raises(FsError) as caught:
        svc.dispatch("write", {"path": str(target), "text": "no"})
    assert caught.value.code == "denied"
    assert not target.exists()
    svc.dispatch("policy_set", {"mode": "readonly"})


def test_delete_moves_to_trash(env) -> None:
    svc: FsService = env["svc"]
    target = env["root"] / "demo" / "gone.txt"
    svc.dispatch("mkdir", {"path": str(env["root"] / "demo")})
    svc.dispatch("write", {"path": str(target), "text": "x"})
    result = svc.dispatch("delete", {"path": str(target)})
    assert not target.exists()
    assert Path(result["trash"]).exists()
    assert Path(result["trash"]).parent.name == ".tether-trash"
