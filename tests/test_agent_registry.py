from __future__ import annotations

import sys

from tether.node.agent_registry import AgentRegistry


def test_catalog_lists_builtins_and_manual_agents(tmp_path) -> None:
    registry = AgentRegistry(tmp_path)
    catalog = registry.catalog(force=True)
    ids = {item["id"] for item in catalog["agents"]}
    assert {"codex", "opencode", "qoder", "claude", "dsh"} <= ids
    assert catalog["path"].endswith("agents.json")

    saved = registry.save({
        "name": "Python Worker", "command": sys.executable, "args": ["--version"],
        "kind": "cli", "icon": "python", "color": "#0f766e",
    })
    record = next(item for item in saved["agents"] if item["id"] == "python-worker")
    assert record["source"] == "manual"
    assert record["available"] is True
    assert record["transports"] == ["terminal"]
    assert record["version"].lower().startswith("python")

    removed = registry.remove("python-worker")
    assert "python-worker" not in {item["id"] for item in removed["agents"]}


def test_manual_entry_overrides_a_builtin(tmp_path) -> None:
    registry = AgentRegistry(tmp_path)
    saved = registry.save({
        "id": "codex", "name": "Codex (custom)", "command": sys.executable,
        "args": ["--version"], "kind": "app-server", "enabled": True,
    })
    record = next(item for item in saved["agents"] if item["id"] == "codex")
    assert record["name"] == "Codex (custom)"
    assert record["source"] == "overridden"
    assert record["transports"][0] == "app-server"


def test_invalid_agents_are_rejected(tmp_path) -> None:
    registry = AgentRegistry(tmp_path)
    for payload in ({}, {"name": "x"}, {"name": "x", "command": "y", "kind": "nope"}):
        try:
            registry.save(payload)
        except ValueError:
            continue
        raise AssertionError("invalid agent should be rejected")
