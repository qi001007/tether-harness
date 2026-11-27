"""发布编排器的安全性回归。

`run` 把 bump→build→test→gate→publish→pin 串成一条命令，所以它的风险不在
「能不能跑完」，而在「未经批准时会不会偷偷把包推给全网」。这里全部走桩：
不发真请求、不碰 Hub、不发布，只验证闸门与状态文件。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_pipeline_under_test",
                                              ROOT / "scripts" / "release_pipeline.py")
pipeline = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(pipeline)


@pytest.fixture
def calls(monkeypatch, tmp_path):
    """Stub every side effect and record what the chain actually asked for."""
    log: list[tuple] = []

    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "_repo", lambda: "o/r")
    monkeypatch.setattr(pipeline, "bump", lambda root, version, write: 0)
    monkeypatch.setattr(pipeline, "stage_build",
                        lambda version, channel, ref, sign, poll, timeout, approve=True:
                        log.append(("build", "ran" if approve else "refused")) or (0 if approve else 2))
    monkeypatch.setattr(pipeline, "stage_test",
                        lambda *a, **k: log.append(("test",)) or 0)
    monkeypatch.setattr(pipeline, "stage_gate",
                        lambda *a, **k: log.append(("gate",)) or 0)

    def fake_github(method, path, body=None):
        log.append(("github", method, path))
        if method == "GET":
            return 200, {"id": 7, "draft": True, "html_url": "https://github.com/o/r/releases/tag/v1"}
        return 200, {"html_url": "https://github.com/o/r/releases/tag/v1"}

    def fake_hub(method, path, body=None):
        log.append(("hub", method, path, body))
        return 200, {"pinned": "0.5.16"}

    monkeypatch.setattr(pipeline, "_github", fake_github)
    monkeypatch.setattr(pipeline, "_hub", fake_hub)
    return log


def _run(calls, **kwargs) -> int:
    options = {"version": "0.5.16", "channel": "preview", "until": "gate",
               "approve": set(), "ref": "main", "sign": False, "write": False}
    options.update(kwargs)
    return pipeline.run_chain(**options)


def test_a_bare_run_is_a_local_report_and_dispatches_no_ci(calls) -> None:
    assert _run(calls) == 2
    assert [entry[0] for entry in calls] == ["build", "test", "gate"]
    assert calls[0] == ("build", "refused")
    assert not [entry for entry in calls if entry[0] in ("github", "hub")]


def test_approved_build_runs_and_the_chain_still_stops_before_publish(calls) -> None:
    assert _run(calls, approve={"build"}) == 0
    assert calls[0] == ("build", "ran")
    assert not [entry for entry in calls if entry[0] in ("github", "hub")]


def test_publish_and_pin_are_refused_without_approval(calls) -> None:
    assert _run(calls, until="pin", approve={"build"}) == 2
    assert not [entry for entry in calls if entry[0] == "github"]
    assert not [entry for entry in calls if entry[0] == "hub"]
    state = json.loads((Path(pipeline.ROOT) / ".scratch/release-run/0.5.16/state.json")
                       .read_text(encoding="utf-8"))
    assert state["stages"]["publish"]["status"] == "refused"
    assert state["stages"]["pin"]["status"] == "refused"


def test_approved_chain_publishes_then_pins(calls) -> None:
    assert _run(calls, until="pin", approve={"build", "publish", "pin"}) == 0
    assert ("github", "PATCH", "/repos/o/r/releases/7") in calls
    assert ("hub", "POST", "/api/releases/pin", {"version": "0.5.16"}) in calls
    state = json.loads((Path(pipeline.ROOT) / ".scratch/release-run/0.5.16/state.json")
                       .read_text(encoding="utf-8"))
    assert state["stages"]["pin"]["status"] == "success"
    assert state["anomaly"] is False


def test_a_failing_gate_stops_the_chain(calls, monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "stage_gate", lambda *a, **k: (calls.append(("gate",)), 1)[1])

    assert _run(calls, until="pin", approve={"build", "publish", "pin"}) == 1

    assert [entry[0] for entry in calls] == ["build", "test", "gate"]
    assert not [entry for entry in calls if entry[0] in ("github", "hub")]


def test_an_already_public_release_is_not_republished(calls, monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "_github",
                        lambda method, path, body=None: (200, {"id": 7, "draft": False}))

    assert pipeline.stage_publish("0.5.16", "preview", True) == 0
    state = json.loads((Path(pipeline.ROOT) / ".scratch/release-run/0.5.16/state.json")
                       .read_text(encoding="utf-8"))
    assert state["stages"]["publish"]["status"] == "already-public"


def test_state_file_flags_anomalies_only(calls) -> None:
    pipeline._record("0.5.17", "build", "success", run_id=1)
    path = Path(pipeline.ROOT) / ".scratch/release-run/0.5.17/state.json"
    assert json.loads(path.read_text(encoding="utf-8"))["anomaly"] is False

    pipeline._record("0.5.17", "build", "failure", run_id=1)
    assert json.loads(path.read_text(encoding="utf-8"))["anomaly"] is True


def test_invalid_version_and_until_are_rejected_before_any_action(calls) -> None:
    assert _run(calls, version="0.5") == 2
    assert _run(calls, until="ship") == 2
    assert not calls

def test_unapproved_stages_run_without_remote_or_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "_repo", lambda: pytest.fail("unexpected remote lookup"))
    assert pipeline.stage_build("1.0.0", "preview", "main", False, 0, 0, approve=False) == 2
    assert pipeline.stage_publish("1.0.0", "preview", approve=False) == 2

@pytest.mark.parametrize(("replies", "paths", "result"), [
    ([(200, None)], ["pin"], 0),
    ([(409, "version_artifacts_not_cached"), (200, None), (200, None)], ["pin", "prepare", "pin"], 0),
    ([(404, "manifest_not_found"), (200, None), (200, None)], ["pin", "refresh", "pin"], 0),
    ([(409, "version_not_cached"), (200, None), (409, "version_artifacts_not_cached"),
      (200, None), (200, None)], ["pin", "refresh", "pin", "prepare", "pin"], 0),
    ([(409, "version_artifacts_not_cached"), (502, "artifact_hash_mismatch")], ["pin", "prepare"], 1),
    ([(403, "forbidden")], ["pin"], 1),
])
def test_pin_recovers_only_from_actionable_cache_errors(calls, monkeypatch, replies, paths, result):
    replies = iter(replies)
    seen = []

    def request(method, path, body):
        assert method == "POST"
        action = path.split("/")[-1]
        assert body == ({} if action == "refresh" else {"version": "0.5.16"})
        seen.append(action)
        status, code = next(replies)
        return status, {"detail": {"code": code}} if code else {}

    monkeypatch.setattr(pipeline, "_hub", request)
    assert pipeline.stage_pin("0.5.16", "preview", True) == result
    assert seen == paths
