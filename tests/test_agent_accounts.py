from __future__ import annotations

import json

from tether.node.agent_accounts import AgentAccounts


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_save_and_switch_restores_files(tmp_path) -> None:
    home = tmp_path / "home"
    accounts = AgentAccounts(tmp_path / "data", home=home)
    _write(home / ".codex" / "auth.json", "account-a")
    saved = accounts.save("codex", "个人号")
    profile = saved["profiles"][0]
    assert profile["name"] == "个人号"
    assert profile["current"] is True

    _write(home / ".codex" / "auth.json", "account-b")
    listed = accounts.list("codex")
    assert listed["profiles"][0]["current"] is False

    switched = accounts.switch("codex", profile["id"])
    assert switched["profiles"][0]["current"] is True
    assert (home / ".codex" / "auth.json").read_text(encoding="utf-8") == "account-a"


def test_delete_profile_keeps_live_files(tmp_path) -> None:
    home = tmp_path / "home"
    accounts = AgentAccounts(tmp_path / "data", home=home)
    _write(home / ".gemini" / "settings.json", "{}")
    saved = accounts.save("gemini", "work")
    profile = saved["profiles"][0]
    accounts.delete("gemini", profile["id"])
    assert (home / ".gemini" / "settings.json").exists()
    assert accounts.list("gemini")["profiles"] == []


def test_requires_existing_files_and_valid_names(tmp_path) -> None:
    accounts = AgentAccounts(tmp_path / "data", home=tmp_path / "home")
    try:
        accounts.save("codex", "empty")
    except ValueError as exc:
        assert "no account files" in str(exc)
    else:
        raise AssertionError("save should fail without files")

    (tmp_path / "home" / ".codex").mkdir(parents=True)
    (tmp_path / "home" / ".codex" / "auth.json").write_text("x", encoding="utf-8")
    try:
        accounts.save("codex", "   ")
    except ValueError as exc:
        assert "name" in str(exc)
    else:
        raise AssertionError("empty name should fail")


def test_profile_ids_are_validated(tmp_path) -> None:
    accounts = AgentAccounts(tmp_path / "data", home=tmp_path / "home")
    try:
        accounts.switch("codex", "../../etc")
    except ValueError as exc:
        assert "profile id" in str(exc)
    else:
        raise AssertionError("bad id should fail")


def _jwt(claims):
    import base64
    enc = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
    return "h." + enc(claims) + ".s"


def test_codex_identity_and_usage(tmp_path) -> None:
    from tether.node import codex_accounts

    claims = {
        "email": "person@example.com",
        "https://api.openai.com/auth": {
            "chatgpt_plan_type": "plus",
            "chatgpt_account_id": "acct-1",
        },
    }
    home = tmp_path / ".codex"
    _write(home / "auth.json", json.dumps({"tokens": {"id_token": _jwt(claims), "account_id": "acct-1"}}))
    info = codex_accounts.identity(home)
    assert info["email"] == "person@example.com"
    assert info["plan"] == "plus"
    assert info["account_id"] == "acct-1"

    usage = codex_accounts.normalize_usage({
        "rateLimits": {
            "primary": {"usedPercent": 3, "windowDurationMins": 300, "resetsAt": 123},
            "secondary": {"usedPercent": 8, "windowDurationMins": 10080, "resetsAt": 456},
            "planType": "plus",
        }
    })
    assert usage["primary"]["usedPercent"] == 3
    assert usage["secondary"]["windowMins"] == 10080
    assert usage["plan"] == "plus"


def test_dsh_auto_import_and_delete(tmp_path) -> None:
    home = tmp_path / "home"
    accounts = AgentAccounts(tmp_path / "data", home=home)
    _write(home / ".dsh" / ".credentials.yaml", "token: fake")
    listed = accounts.list("dsh")
    assert len(listed["profiles"]) == 1
    assert listed["profiles"][0]["current"] is True
    profile = listed["profiles"][0]
    accounts.delete("dsh", profile["id"])
    assert accounts.list("dsh")["profiles"] == []
    assert (home / ".dsh" / ".credentials.yaml").exists()
