"""发布门禁自身的回归。

门禁脚本最怕两种失效：永远 FAIL（没人用）和永远 PASS（假绿灯）。这里用合成数据
把每条判据都跑一遍正反两面。不落任何真实证据文件，不改仓库状态。
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(f"gate_{name}", SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def hub_pin(monkeypatch, tmp_path):
    module = load_script("release_gate_hub_pin")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    (tmp_path / "version.json").write_text(json.dumps(
        {"schema": 1, "components": {"app": "0.5.15", "plugin": "0.2.93", "node": "0.5.15"}}),
        encoding="utf-8")
    return module, tmp_path


def signed_manifest(private_key, version="0.5.15"):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from tether.release import canonical_bytes

    def platform(target, suffix):
        name = f"Tether-{version}-{target}.{suffix}"
        return {name: {"url": f"https://example.invalid/{name}", "size": 1234,
                       "sha256": "a" * 64, "format": suffix}}

    manifest = {
        "schema": 1, "channel": "preview",
        "components": {
            "app": {"version": version, "platforms": {
                **platform("win-x64", "exe"), **platform("linux-x64", "AppImage"),
                **platform("mac-arm64", "dmg")}},
            "node": {"version": version, "platforms": platform("linux-x64", "tar.gz")},
            # Hub 的 _valid_manifest 要求 app/node/plugin 三段齐全；插件按官方发行冻结版本。
            "plugin": {"version": "0.2.93",
                       "url": "https://example.invalid/tether-plugin-0.2.93.zip",
                       "sha256": "c" * 64, "size": 4096, "format": "zip"},
        },
    }
    manifest["signature"] = base64.b64encode(private_key.sign(canonical_bytes(manifest))).decode()
    return manifest


class Args:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def run_check(module, tmp_path, manifest, pin="0.5.15", withdrawn=None, assets=None,
              additional_assets=None):
    (tmp_path / "hub.json").write_text(json.dumps(manifest), encoding="utf-8")
    return module.check("hub.json", "0.5.15", Args(
        release_assets=assets, additional_release_assets=additional_assets,
        pin=pin, withdrawn=withdrawn))


@pytest.fixture
def keypair(monkeypatch):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import tether.release as release

    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes_raw().hex()
    monkeypatch.setattr(release, "PUBLIC_KEY_HEX", public)
    return private


def test_signed_matching_manifest_passes(hub_pin, keypair):
    module, tmp_path = hub_pin
    problems = run_check(module, tmp_path, signed_manifest(keypair))
    assert problems == [], problems


def test_wrong_pin_is_caught(hub_pin, keypair):
    module, tmp_path = hub_pin
    problems = run_check(module, tmp_path, signed_manifest(keypair), pin="0.5.14")
    assert problems, "pin 不等于候选版本必须被抓到"
    assert {item["rule"] for item in problems} == {"pin"}, problems


def test_missing_sha256_is_caught(hub_pin, keypair):
    module, tmp_path = hub_pin
    manifest = signed_manifest(keypair)
    entry = manifest["components"]["app"]["platforms"]
    list(entry.values())[0]["sha256"] = "nope"
    problems = run_check(module, tmp_path, manifest)
    assert any(item["rule"] == "digest" for item in problems)


def test_unsigned_manifest_is_caught(hub_pin, keypair):
    module, tmp_path = hub_pin
    manifest = signed_manifest(keypair)
    del manifest["signature"]
    problems = run_check(module, tmp_path, manifest)
    assert any(item["rule"] == "signature" for item in problems)


def test_withdrawn_asset_is_caught(hub_pin, keypair):
    module, tmp_path = hub_pin
    manifest = signed_manifest(keypair)
    withdrawn = list(manifest["components"]["app"]["platforms"].values())[0]["url"]
    (tmp_path / "withdrawn.txt").write_text(withdrawn.rsplit("/", 1)[-1] + "\n", encoding="utf-8")
    problems = run_check(module, tmp_path, manifest, withdrawn="withdrawn.txt")
    assert any(item["rule"] == "withdrawn" for item in problems)


def test_plugin_assets_may_come_from_frozen_release(hub_pin, keypair):
    module, tmp_path = hub_pin
    (tmp_path / "release.json").write_text(json.dumps({"assets": [
        {"name": "Tether-0.5.15-win-x64.exe"},
        {"name": "Tether-0.5.15-linux-x64.AppImage"},
        {"name": "Tether-0.5.15-mac-arm64.dmg"},
        {"name": "Tether-0.5.15-linux-x64.tar.gz"},
    ]}), encoding="utf-8")
    (tmp_path / "plugin.json").write_text(json.dumps({"assets": [
        {"name": "tether-plugin-0.2.93.zip"}]}), encoding="utf-8")

    problems = run_check(module, tmp_path, signed_manifest(keypair),
                         assets="release.json", additional_assets="plugin.json")

    assert problems == [], problems


def test_release_asset_must_exist(hub_pin, keypair):
    module, tmp_path = hub_pin
    (tmp_path / "assets.json").write_text(json.dumps({"assets": [{"name": "other.exe"}]}),
                                          encoding="utf-8")
    problems = run_check(module, tmp_path, signed_manifest(keypair),
                         assets="assets.json")
    assert any(item["rule"] == "asset" for item in problems)


# --- 证据校验器 -----------------------------------------------------------

@pytest.fixture
def runner(monkeypatch, tmp_path):
    module = load_script("release_gate")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    (tmp_path / "version.json").write_text(json.dumps(
        {"schema": 1, "components": {"app": "0.5.15", "node": "0.5.15", "plugin": "0.2.93"}}),
        encoding="utf-8")
    return module, tmp_path


def args_for(module, tmp_path, **over):
    """参数表来自 runner 自己的 argparse，不在测试里手抄字段。

    手抄过一次事故：`GATES` 新增 `{hub_repo}`/`{fleet_size}` 后，测试的假 namespace
    缺字段，resolve() 直接 AttributeError，把本该 BLOCKED 的门禁变成 REG-1 红。
    """
    namespace = module.defaults_namespace()
    namespace.action = "check-evidence"
    namespace.version = "0.5.15"
    namespace.commit = "abc1234"
    namespace.evidence_root = ".scratch/release-gate"
    namespace.timeout = 60
    for key, value in over.items():
        setattr(namespace, key, value)
    return namespace


def write_record(tmp_path, gate_id, **fields):
    from datetime import datetime, timezone

    shot = tmp_path / "shot.png"
    shot.write_bytes(b"fake-png")
    record = {
        "gate": gate_id, "version": "0.5.15", "commit": "abc1234",
        "executed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verdict": "pass", "evidence": [{"path": "shot.png", "sha256": hashlib.sha256(shot.read_bytes()).hexdigest()}],
    }
    record.update(fields)
    directory = tmp_path / ".scratch/release-gate/0.5.15/real"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{gate_id}.json").write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return shot


def test_missing_record_is_blocked_not_passed(runner):
    module, tmp_path = runner
    gate = module.GATE_BY_ID["F-CODEG-LOCAL"]
    result = module.verify_real_gate(gate, args_for(module, tmp_path))
    assert result["verdict"] == "BLOCKED"


def test_complete_record_passes(runner):
    module, tmp_path = runner
    write_record(tmp_path, "F-TRANSFER", device="LAPTOP", os="Windows 11",
                 screenshot="shot.png", log="shot.png", sha256_source="a", sha256_target="a",
                 measured={"mb_per_min": 5.1, "elapsed_s": 20, "streams": 4})
    result = module.verify_real_gate(module.GATE_BY_ID["F-TRANSFER"], args_for(module, tmp_path))
    assert result["verdict"] == "PASS", result


def test_tampered_screenshot_fails(runner):
    module, tmp_path = runner
    shot = write_record(tmp_path, "F-TRANSFER", device="LAPTOP", os="Windows 11",
                        screenshot="shot.png", log="shot.png", sha256_source="a", sha256_target="a",
                        measured={"mb_per_min": 5.1, "elapsed_s": 20, "streams": 4})
    shot.write_bytes(b"swapped-later")
    result = module.verify_real_gate(module.GATE_BY_ID["F-TRANSFER"], args_for(module, tmp_path))
    assert result["verdict"] == "FAIL"
    assert any("哈希不符" in item for item in result["problems"])


def test_unknown_measurement_fails(runner):
    module, tmp_path = runner
    write_record(tmp_path, "F-TRANSFER", device="LAPTOP", os="Windows 11",
                 screenshot="shot.png", log="shot.png", sha256_source="a", sha256_target="a",
                 measured={"mb_per_min": "unknown", "elapsed_s": 20, "streams": 4})
    result = module.verify_real_gate(module.GATE_BY_ID["F-TRANSFER"], args_for(module, tmp_path))
    assert result["verdict"] == "FAIL"
    assert any("mb_per_min" in item for item in result["problems"])


def test_stale_evidence_for_another_commit_fails(runner):
    module, tmp_path = runner
    write_record(tmp_path, "F-HUB-LOGIN", device="HUB", os="Ubuntu 22.04",
                 screenshot="shot.png", log="shot.png", measured={"login_ms": 900},
                 commit="deadbee")
    result = module.verify_real_gate(module.GATE_BY_ID["F-HUB-LOGIN"], args_for(module, tmp_path))
    assert result["verdict"] == "FAIL"
    assert any("提交" in item for item in result["problems"])


def test_evidence_older_than_freeze_fails(runner):
    module, tmp_path = runner
    write_record(tmp_path, "F-HUB-LOGIN", device="HUB", os="Ubuntu 22.04",
                 screenshot="shot.png", log="shot.png", measured={"login_ms": 900})
    # 冻结时间设在证据之后一天：旧验收记录不能给新版本背书。
    future = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 86400))
    args = args_for(module, tmp_path, not_before=future)
    result = module.verify_real_gate(module.GATE_BY_ID["F-HUB-LOGIN"], args)
    assert result["verdict"] == "FAIL"
    assert any("早于冻结提交时间" in item for item in result["problems"])


def test_host_snapshot_refused_without_consent(netmod):
    module, tmp_path = netmod
    sys.argv = ["release_gate_network.py", "--host-snapshot", str(tmp_path / "snap.json")]
    assert module.main() == 2, "未加 --allow-host-snapshot 不得执行主机命令"
    assert not (tmp_path / "snap.json").exists()


def test_fail_verdict_record_is_not_a_pass(runner):
    module, tmp_path = runner
    write_record(tmp_path, "F-HUB-LOGIN", device="HUB", os="Ubuntu 22.04",
                 screenshot="shot.png", log="shot.png", measured={"login_ms": 900}, verdict="fail")
    result = module.verify_real_gate(module.GATE_BY_ID["F-HUB-LOGIN"], args_for(module, tmp_path))
    assert result["verdict"] == "FAIL"


def test_missing_snapshot_input_blocks_instead_of_failing(runner):
    module, tmp_path = runner
    gate = module.GATE_BY_ID["VER-2"]
    result = module.run_auto_gate(gate, args_for(module, tmp_path, version="0.5.15"))
    assert result["verdict"] == "BLOCKED"
    assert "--hub-manifest" in result["reason"]


def test_resolve_survives_incomplete_namespace(runner):
    """占位符解析不许因为 namespace 少字段就 AttributeError。"""
    module, _ = runner

    class Bare:
        version = "0.5.15"

    assert module.resolve("--v {version} --repo {hub_repo} --n {fleet_size}", Bare()) == \
        "--v 0.5.15 --repo  --n "


def test_every_placeholder_is_declared_or_defaulted(runner):
    """GATES 里出现的每个 {占位符} 都必须要么是可缺省参数，要么登记进缺输入表。

    漏登记时 runner 会把空串塞进命令行，门禁变成 FAIL 而不是 BLOCKED，等于把
    "主人还没给快照"谎报成"版本有问题"。
    """
    import re as _re

    module, _ = runner
    defaults = vars(module.defaults_namespace())
    problems = []
    for gate in module.GATES:
        for part in gate.get("command", []):
            for name in _re.findall(r"\{(\w+)\}", part):
                if name not in module.SNAPSHOT_ARGS and name not in defaults:
                    problems.append(f"{gate['id']}: 未登记占位符 {name}")
    assert not problems, problems


def test_placeholder_without_input_is_blocked_not_failing(runner):
    module, tmp_path = runner
    result = module.run_auto_gate(module.GATE_BY_ID["AUD-1"], args_for(module, tmp_path))
    assert result["verdict"] == "BLOCKED", result
    assert "--hub-repo" in result["reason"], result


def test_defaults_namespace_matches_snapshot_args(runner):
    """defaults_namespace 与 SNAPSHOT_ARGS 的键必须都能落到 argparse 上。"""
    module, _ = runner
    defaults = vars(module.defaults_namespace())
    for key in module.SNAPSHOT_ARGS:
        assert key in defaults, f"SNAPSHOT_ARGS 里的 {key} 没有对应 CLI 参数"


def test_runner_never_touches_network_by_default(runner):
    """保持默认不联网：ART-4 只能 BLOCKED，不能被当成通过。"""
    module, tmp_path = runner
    result = module.run_auto_gate(module.GATE_BY_ID["ART-4"], args_for(module, tmp_path))
    assert result["verdict"] == "BLOCKED", result
    assert "--allow-network" in result["reason"], result




def test_partial_run_can_never_say_ready(runner, capsys):
    """只跑一条门禁也判 READY 是这类 runner 最危险的失效方式。"""
    module, tmp_path = runner
    args = args_for(module, tmp_path)
    code = module.print_verdict([{"gate": "VER-1", "kind": "auto", "verdict": "PASS",
                                  "blocking": True}], args)
    out = capsys.readouterr().out
    assert code == 2
    assert "PARTIAL" in out
    payload = json.loads((tmp_path / ".scratch/release-gate/0.5.15/verdict.json")
                         .read_text(encoding="utf-8"))
    assert payload["verdict"] == "PARTIAL"
    assert "F-TRANSFER" in payload["not_evaluated"]


def test_gate_ids_are_documented(runner):
    """runner 的 GATES 与 docs/RELEASE_GATE.md 必须逐条对应，防止两边漂开。"""
    import re

    module, _ = runner
    doc = (ROOT / "docs" / "RELEASE_GATE.md").read_text(encoding="utf-8")
    orphans = []
    for gate in module.GATES:
        pattern = rf"(?m)^(#{{2,4}}\s.*\b{re.escape(gate['id'])}\b)|\|\s*`{re.escape(gate['id'])}`"
        if not re.search(pattern, doc):
            orphans.append(gate["id"])
    assert not orphans, (f"门禁表有 ID 未写进 docs/RELEASE_GATE.md：{orphans}"
                         "（谁往 GATES 里加了 ID，谁就得同时补上判据小节）")
    assert all(gate.get("title") and gate.get("id") for gate in module.GATES)
    assert len({gate["id"] for gate in module.GATES}) == len(module.GATES), "ID 重复"


def test_every_real_gate_declares_evidence_fields(runner):
    """REAL 门禁不声明证据字段就等于随便写点什么都能过。"""
    module, _ = runner
    loose = [gate["id"] for gate in module.GATES
             if gate["kind"] == "real" and not gate.get("evidence_fields")]
    assert not loose, loose


def test_blocking_gates_cover_the_release_surface(runner):
    module, _ = runner
    prefixes = {gate["id"].split("-")[0] for gate in module.GATES if gate["blocking"]}
    for family in ("ART", "VER", "NET", "PRV", "UPD", "F", "PLAT", "REG"):
        assert family in prefixes, f"blocking 门禁缺 {family} 族"


def test_all_blocking_pass_is_the_only_ready_state(runner, capsys):
    module, tmp_path = runner
    args = args_for(module, tmp_path)
    results = [{"gate": gate["id"], "kind": gate["kind"], "verdict": "PASS",
                "blocking": gate["blocking"]} for gate in module.GATES]
    assert module.print_verdict(results, args) == 0
    assert "READY-FOR-APPROVAL" in capsys.readouterr().out


# --- 网络/隐私扫描 -------------------------------------------------------

@pytest.fixture
def netmod(monkeypatch, tmp_path):
    module = load_script("release_gate_network")
    for base in list(module.FIRST_PARTY):
        (tmp_path / base).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    return module, tmp_path


def write_source(tmp_path, relative, text):
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_clean_sources_pass(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "tether/node/mesh_runtime.py",
                 'argv = [str(self.core), "--no-tun", "--use-smoltcp"]\n')
    assert module.scan("tun-route") == []
    assert module.check_mesh_no_tun() == []


def test_tun_flag_and_route_edit_are_caught(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "tether/node/bad.py",
                 'core = "easytier-core"\nargv = [core, "--tun", "--network-name", "x"]\n')
    hits = module.scan("tun-route")
    assert any("TUN" in item["why"] for item in hits)
    assert module.check_mesh_no_tun(), "缺 --no-tun 的命令行构造必须被抓到"


def test_pppoe_and_proxy_writes_are_caught(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "apps/tether-app/dial.js", 'spawnSync("rasdial", args)\n')
    write_source(tmp_path, "apps/tether-app/proxy.js", 'set("ProxyEnable", 1)\n')
    assert module.scan("pppoe")
    assert module.scan("proxy")


def test_env_proxy_strip_is_allowed(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "tether/node/croc.py", 'env.pop("HTTP_PROXY", None)\n')
    assert module.scan("proxy") == []


def test_bundled_assets_are_excluded(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "tether/node/bin/agents-runtime/web/chunk.js",
                 'const help = "rasdial route add wintun"\n')
    for check in ("pppoe", "proxy", "tun-route"):
        assert module.scan(check) == [], f"{check} 不应扫打包产物"


def test_private_mesh_reference_is_caught(netmod):
    module, tmp_path = netmod
    write_source(tmp_path, "laptop/start.ps1", 'Start-Process "Tether-Private-Mesh.exe"\n')
    assert any("私有mesh" in item["why"] for item in module.scan("private-mesh"))


# --- 唯一入口（ENT） ------------------------------------------------------

@pytest.fixture
def entrymod(monkeypatch, tmp_path):
    module = load_script("release_gate_entry_uniqueness")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    return module, tmp_path


LEGACY_LITERAL = '"Tether APP.lnk", "Tether-App.cmd", "Tether APP.cmd"'


def entry_repo_files(*, entry_name="Tether.lnk", aumid="com.tether.app", icon_fallback=False,
                     with_deletes=True, with_macros=True, with_legacy_list=True,
                     with_ps1_loop=True, with_realpath=True, with_lnk_aumid=True):
    """按 ENT 门禁现行契约造一份装配源码；每个开关关掉一项就该被抓到。"""
    legacy_names = [name.strip().strip('"') for name in LEGACY_LITERAL.split(",")]
    deletes = "".join(f'Delete "$DESKTOP\\{name}"\n' for name in legacy_names) if with_deletes \
        else "Call PreserveTetherLegacyData\n"
    purge = "  TetherPurgeLegacyEntries\n" if with_macros else ""
    migration = (f"!macro customInit\n{purge}  Call ResolveTetherInstallRoot\n!macroend\n"
                 f"!macro customUnInstall\n{purge}  Call PreserveTetherLegacyData\n!macroend\n"
                 f"Function TetherPurgeLegacyEntries\n{deletes}FunctionEnd\n")
    main = (
        f"const APP_USER_MODEL_ID = '{aumid}'\n"
        + (f"const legacyNames = [{LEGACY_LITERAL}]\n" if with_legacy_list else "")
        + "function ensureAppShortcuts() {\n"
        + ("  const target = fs.realpathSync(process.execPath)\n" if with_realpath
           else "  const target = process.execPath\n")
        + (f"  const options = {{ target, appUserModelId: APP_USER_MODEL_ID }}\n" if with_lnk_aumid
           else "  const options = { target }\n")
        + f"  links.add(path.join(app.getPath('desktop'), '{entry_name}'))\n"
          "  shell.writeShortcutLink(link, 'update', options)\n}\n")
    ps1_loop = ("foreach ($legacy in @(\n  'Tether APP.lnk',\n  'Tether-App.cmd',\n"
                "  'Tether APP.cmd'\n)) { Remove-Item $legacy }\n") if with_ps1_loop else ""
    return {
        "desktop/packaging/electron-builder.yml": (
            "appId: com.tether.app\nproductName: Tether\nwin:\n"
            "  icon: assets/tether-app-s.ico\nnsis:\n"
            "  createDesktopShortcut: true\n  createStartMenuShortcut: true\n"
            "  shortcutName: Tether\n"),
        "desktop/packaging/nsis/migration.nsh": migration,
        "apps/tether-app/main.js": main,
        "desktop/install-app.ps1": (
            '$icon = Join-Path $Repo "assets\\tether-app-s.ico"\n'
            + ("$icon = $Electron\n" if icon_fallback else "")
            + f'$lnk = $shell.CreateShortcut((Join-Path $folder "{entry_name}"))\n'
              "$lnk.TargetPath = $Electron\n" + ps1_loop),
    }


def seed_entry_repo(tmp_path, **kwargs):
    for relative, text in entry_repo_files(**kwargs).items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text if isinstance(text, str) else "".join(text), encoding="utf-8")


def test_compliant_entry_contract_passes(entrymod):
    """合规夹具必须判 0 项，否则这条门禁永远是红的、没人看。"""
    module, tmp_path = entrymod
    seed_entry_repo(tmp_path)
    problems = module.scan_ent1() + module.scan_ent2() + module.scan_ent3()
    assert problems == [], problems


def test_duplicate_entry_names_are_caught(entrymod):
    module, tmp_path = entrymod
    seed_entry_repo(tmp_path, entry_name="Tether APP.lnk")
    assert any(item["gate"] == "ENT-1" for item in module.scan_ent1()), \
        "NSIS 的 Tether.lnk 与 install-app.ps1 的 Tether APP.lnk 并存必须被抓"


def test_missing_legacy_cleanup_is_caught(entrymod):
    module, tmp_path = entrymod
    seed_entry_repo(tmp_path, with_deletes=False, with_macros=False,
                    with_legacy_list=False, with_ps1_loop=False)
    hits = module.scan_ent3()
    assert hits, "四处都不清理时 ENT-3 必须报"
    assert {item["file"] for item in hits} >= {
        "desktop/packaging/nsis/migration.nsh", "apps/tether-app/main.js",
        "desktop/install-app.ps1"}, hits
    seed_entry_repo(tmp_path)
    assert module.scan_ent3() == [], module.scan_ent3()


def test_icon_fallback_and_aumid_mismatch_are_caught(entrymod):
    module, tmp_path = entrymod
    seed_entry_repo(tmp_path, icon_fallback=True)
    assert any("回退" in item["why"] for item in module.scan_ent2())
    seed_entry_repo(tmp_path, aumid="com.other.app")
    assert any("APP_USER_MODEL_ID" in item["why"] for item in module.scan_ent2())


def test_host_inspection_refused_without_consent(entrymod):
    module, tmp_path = entrymod
    sys.argv = ["release_gate_entry_uniqueness.py", "--inspect", str(tmp_path / "entries.json")]
    assert module.main() == 2
    assert not (tmp_path / "entries.json").exists()


def test_upgrade_diff_catches_growth_and_dead_targets(entrymod):
    module, tmp_path = entrymod
    before = tmp_path / "before.json"
    after = tmp_path / "after.json"
    before.write_text(json.dumps({"count": 1, "entries": [{"name": "Tether.lnk", "exists": True}]}),
                      encoding="utf-8")
    after.write_text(json.dumps({"count": 2, "entries": [
        {"name": "Tether.lnk", "exists": True},
        {"name": "Tether APP.lnk", "exists": False}]}), encoding="utf-8")
    problems = module.diff(before, after)
    rules = {item["gate"] for item in problems}
    assert {"ENT-1", "ENT-2", "ENT-3"} <= rules, problems


def test_ent4_record_never_claims_pass_without_a_real_zero_entry_run(entrymod):
    """ENT-4 记录装配器不得替卸载编造结论：数从快照读，非 0 判 fail，--synthetic 永远 fail。"""
    module, tmp_path = entrymod
    snapshot = tmp_path / "entries.json"
    out = tmp_path / "real" / "ENT-4.json"
    shot = tmp_path / "shot.png"
    log = tmp_path / "uninstall.log"
    shot.write_bytes(b"\x89PNG\r\n")
    log.write_text("uninstalled\n", encoding="utf-8")

    snapshot.write_text(json.dumps({"count": 2, "entries": [
        {"name": "Tether.lnk", "exists": True, "path": "C:\\d\\Tether.lnk"},
        {"name": "Tether APP.lnk", "exists": True, "path": "C:\\d\\Tether APP.lnk"}]}), encoding="utf-8")
    assert module.build_ent4_record(snapshot, out, "9.9.9", str(shot), str(log), False) == 1
    record = json.loads(out.read_text(encoding="utf-8"))
    assert record["verdict"] == "fail"
    assert record["measured"]["entry_count_after_uninstall"] == 2
    assert any("legacy" in item for item in record["problems"]), record["problems"]

    snapshot.write_text(json.dumps({"count": 0, "entries": []}), encoding="utf-8")
    assert module.build_ent4_record(snapshot, out, "9.9.9", str(shot), str(log), True) == 1
    assert json.loads(out.read_text(encoding="utf-8"))["verdict"] == "fail", "合成快照不能判 pass"

    assert module.build_ent4_record(snapshot, out, "9.9.9", str(shot), str(log), False) == 0
    record = json.loads(out.read_text(encoding="utf-8"))
    assert record["verdict"] == "pass" and record["measured"]["entry_count_after_uninstall"] == 0
    stamp = record["executed_at"]
    assert len(stamp) >= 19 and stamp[4:5] == "-" and stamp[13:14] == ":", stamp
    assert {Path(item["path"]).name for item in record["evidence"]} == {
        "entries.json", "shot.png", "uninstall.log"}
    # release_gate.py 用 ROOT / evidence[].path 取文件，所以路径必须是仓库相对的。
    assert all(not Path(item["path"]).is_absolute() for item in record["evidence"])
    for item in record["evidence"]:
        path = tmp_path / item["path"]
        assert path.is_file() and item["sha256"] == module.sha256_file(path)


def test_ent_gates_are_registered_and_documented(runner):
    module, _ = runner
    for gate_id in ("ENT-1", "ENT-2", "ENT-3", "ENT-4"):
        assert gate_id in module.GATE_BY_ID, gate_id
    assert module.GATE_BY_ID["ENT-4"]["kind"] == "real", "卸载后清理只能真机枚举"


# --- DSH 账号与映射 -------------------------------------------------------

@pytest.fixture
def dshmod(monkeypatch, tmp_path):
    module = load_script("release_gate_dsh_account")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    return module, tmp_path


DESKTOP_TEMPLATE = '''
EXE_NAME = "DeepSeek Harness.exe"
from typing import Any


def _candidate_exes(home):
    values = []
    override = os.environ.get("TETHER_DSH_EXE", "").strip()
    if override:
        values.append(Path(override))
    values.append(home / EXE_NAME)
    for drive in ("C", "D", "E"):
        values.append(Path(f"{drive}:\\\\DeepSeek Harness\\\\{{EXE_NAME}}"))
    seen = set()
    unique = []
    for value in values:
        key = os.path.normcase(str(value))
        if key not in seen:
            seen.add(key)
            unique.append(value)
    return unique


def repair_auth():
    current = self.status()
    if not current["installed"]:
        raise DshError("DSH 未安装", "dsh_not_installed")
    appdata_backup = appdata.with_name(appdata.name + ".bak-tether-" + stamp)
    credentials_backup = credentials.with_name(credentials.name + ".bak-tether-" + stamp)
    self.stop()
    if appdata_backup.exists():
        raise DshError("认证备份已存在", "dsh_backup_exists")
    shutil.move(str(appdata), str(appdata_backup))
'''


def seed_dsh_files(tmp_path, desktop_body, *, approved_word=None, surface=True,
                   gc_protected=False, selector_protected=False, stale_only=False,
                   audit=True, ui=""):
    (tmp_path / "tether/node").mkdir(parents=True, exist_ok=True)
    (tmp_path / "packages/tether-ui/src").mkdir(parents=True, exist_ok=True)
    (tmp_path / "apps/tether-app").mkdir(parents=True, exist_ok=True)
    body = desktop_body
    if approved_word:
        body += f"\n{approved_word} = 1\n"
    (tmp_path / "tether/node/dsh_desktop.py").write_text(body, encoding="utf-8")
    (tmp_path / "tether/node/dsh_rpc.py").write_text(
        'AUTH_COOKIE_PREFIX = "dsh-auth"\nREAD_ENDPOINTS = frozenset({"session/list"})\n'
        'ALLOWED_ENDPOINTS = READ_ENDPOINTS | {"session/prompt"}\n'
        "self._cookies, self._origin = {}, \"\"\n", encoding="utf-8")
    if surface:
        (tmp_path / "tether/node/native_surface.py").write_text(
            'info["pid"] = self._pid\nprofile = data.get("profile")\n'
            "self._active_home = self.home\n", encoding="utf-8")
    exempt = ", protectedPartitions = new Set()" if selector_protected else ""
    guard = "!protectedPartitions.has(e.name) && " if selector_protected else ""
    fguard = "" if stale_only else guard
    if stale_only and not selector_protected:
        fguard = ""
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        "// Retention is bounded on purpose: keep a warm cache for the same working day.\n"
        "const PARTITION_PREFIX = 'tether-wb-'\n"
        f"function selectStalePartitions(entries, {{ now = 0, maxAgeMs = 1, maxCount = 2"
        f"{exempt} }} = {{}}) {{\n"
        f"  const stale = entries.filter((e) => {guard}now - e.mtimeMs >= maxAgeMs)\n"
        f"  const fresh = entries.filter((e) => {fguard}now - e.mtimeMs < maxAgeMs)\n"
        "  const overflow = Math.max(0, fresh.length - maxCount)\n"
        "  return [...stale, ...fresh.slice(0, overflow)]\n}\n", encoding="utf-8")
    passed = ", { protectedPartitions: livePartitions() }" if gc_protected else ""
    (tmp_path / "apps/tether-app/main.js").write_text(
        "function gcWorkbenchPartitions() {\n"
        f"  const stale = selectStalePartitions(entries{passed})\n"
        "  for (const name of stale) { fs.rmSync(name, { recursive: true, force: true }) }\n}\n",
        encoding="utf-8")
    (tmp_path / "tether/node/fs_service.py").write_text(
        "    def _op_dsh_repair_auth(self, _args):\n"
        "        result = self.dsh_desktop.repair_auth()\n"
        + ("        self.audit.add(op=\"dsh_repair_auth\")\n" if audit else "        return result\n"),
        encoding="utf-8")
    (tmp_path / "packages/tether-ui/src/app.js").write_text(
        ui or ("const dshAccountState = { value: 'unknown', pid: status.pid,\n"
               "  profile: status.profile }\n// onLogin -> reload the surface"), encoding="utf-8")


def test_dsh5_drive_scan_without_allowlist_is_caught(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE)
    hits = module.check_selection()
    assert any("批准实例清单" in item["why"] for item in hits), hits


def test_dsh5_substring_pin_is_not_a_constraint(dshmod):
    """`typing`/`mapping` 里含 "pin"，词边界没写对就会变成假绿灯。"""
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, approved_word="mapping = {'a': 1}")
    hits = module.check_selection()
    assert any("批准实例清单" in item["why"] for item in hits), hits


def test_dsh5_real_allowlist_passes(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, approved_word="approved_instances = []")
    assert module.check_selection() == [], module.check_selection()


def test_dsh1_catches_external_origin_and_unapproved_instance(dshmod):
    module, tmp_path = dshmod
    (tmp_path / "d.json").write_text(json.dumps(
        {"origin": "http://10.0.0.9:4310", "auth_url": "http://127.0.0.1:4310/login",
         "pid": 4242, "dsh_home": "E:/other/dsh"}), encoding="utf-8")
    (tmp_path / "approved.json").write_text(json.dumps({"instances": [
        {"id": "DESKTOP-LOCAL", "dsh_home": "D:/DeepSeek Harness/.dsh",
         "profile": "desktop", "host": "http://127.0.0.1:4310"}]}), encoding="utf-8")
    args = Args(descriptor=str(tmp_path / "d.json"), dsh_home=None,
                approved=str(tmp_path / "approved.json"), allow_host_inspection=False)
    whys = " ".join(item["why"] for item in module.check_mapping(args))
    assert "回环" in whys and "批准实例" in whys, whys


def test_dsh1_missing_descriptor_exits_two(dshmod):
    module, tmp_path = dshmod
    args = Args(descriptor=None, dsh_home=None, approved=None, allow_host_inspection=False)
    with pytest.raises(SystemExit) as excinfo:
        module.check_mapping(args)
    assert excinfo.value.code == 2


def test_dsh_ui_account_positive_display_required(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE)
    assert module.check_ui_account() == []
    (tmp_path / "packages/tether-ui/src/app.js").write_text(
        "if (e.status === 401) showRelogin()", encoding="utf-8")
    hits = module.check_ui_account()
    assert any(item["gate"] == "DSH-2" for item in hits), hits


# --- 三条硬判据（主人 2026-11-25 指定） -----------------------------------

def mapping_args(module, tmp_path, descriptor, *, instances=None, approved=True):
    (tmp_path / "d.json").write_text(json.dumps(descriptor), encoding="utf-8")
    if approved:
        (tmp_path / "a.json").write_text(json.dumps({"instances": [
            {"id": "X", "dsh_home": "D:/DeepSeek Harness/.dsh", "profile": "desktop",
             "host": "http://127.0.0.1:4310"}]}), encoding="utf-8")
    if instances:
        (tmp_path / "i.json").write_text(json.dumps({"instances": instances}), encoding="utf-8")
    return Args(descriptor=str(tmp_path / "d.json"), dsh_home=None,
                approved=str(tmp_path / "a.json") if approved else None,
                allow_host_inspection=False, active_pid=None,
                instances=str(tmp_path / "i.json") if instances else None)


GOOD_DESCRIPTOR = {"origin": "http://127.0.0.1:4310", "auth_url": "http://127.0.0.1:4310/login",
                   "pid": 9400, "pid_started_at": "2026-11-25T01:00:00Z", "profile": "desktop",
                   "dsh_home": "D:/DeepSeek Harness/.dsh", "instance_kind": "bundled"}


def test_dsh1_good_descriptor_passes(dshmod):
    module, tmp_path = dshmod
    problems = module.check_mapping(mapping_args(module, tmp_path, GOOD_DESCRIPTOR,
                                                instances=[{"pid": 9400}, {"pid": 14976}]))
    assert problems == [], problems


def test_dsh1_bare_pid_without_reuse_proof_is_caught(dshmod):
    """PID 会被复用，裸 PID 不能当契约：必须有 pid_started_at 或 instance_token。"""
    module, tmp_path = dshmod
    stripped = {k: v for k, v in GOOD_DESCRIPTOR.items() if k != "pid_started_at"}
    hits = module.check_mapping(mapping_args(module, tmp_path, stripped,
                                            instances=[{"pid": 9400}]))
    assert any("PID 会被复用" in item["why"] or "pid_started_at" in item["why"] for item in hits), hits


def test_dsh1_stale_pid_is_caught(dshmod):
    module, tmp_path = dshmod
    hits = module.check_mapping(mapping_args(module, tmp_path, {**GOOD_DESCRIPTOR, "pid": 5555},
                                            instances=[{"pid": 9400}, {"pid": 14976}]))
    assert any("不在当前活跃 DSH 实例集合" in item["why"] for item in hits), hits


def test_dsh1_requires_instance_kind_profile_home(dshmod):
    module, tmp_path = dshmod
    stripped = {k: v for k, v in GOOD_DESCRIPTOR.items()
                if k not in ("instance_kind", "profile", "dsh_home")}
    hits = " ".join(item["why"] for item in module.check_mapping(
        mapping_args(module, tmp_path, stripped, instances=[{"pid": 9400}])))
    assert "instance_kind" in hits and "profile" in hits and "DSH_HOME" in hits, hits


def test_dsh6_only_mtime_exempt_is_not_enough(dshmod):
    """只豁免到期分支不够：数量溢出同样会挤掉已登录分区。"""
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, gc_protected=True,
                   selector_protected=True, stale_only=True)
    hits = module.check_auth_reset()
    assert any("溢出" in item["why"] for item in hits), hits


def test_dsh6_clean_contract_needs_both_branches(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, gc_protected=True, selector_protected=True)
    assert module.check_auth_reset() == [], module.check_auth_reset()


def test_dsh2_unknown_required_without_account_op(dshmod):
    """后端没有账号 endpoint 时只能显示 unknown，不得凭 Hub 登录态推断。"""
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE,
                   ui="const dshAccountState = { pid: status.pid, profile: status.profile } // reload")
    hits = module.check_ui_account()
    assert any("unknown" in item["why"] for item in hits), hits


def test_dsh2_hub_loggedin_conflation_is_caught(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE,
                   ui="const dshAccountState = 'unknown'\nconst shown = loggedIn && dshAccountState")
    hits = module.check_ui_account()
    assert any("Hub 会话" in item["why"] or "全局 DSH 登录布尔" in item["why"] for item in hits), hits


def test_dsh_gates_registered(runner):
    module, _ = runner
    for gate_id in ("DSH-1", "DSH-2", "DSH-3", "DSH-4", "DSH-5", "DSH-6"):
        assert gate_id in module.GATE_BY_ID, gate_id


def test_dsh6_clean_contract_passes(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, gc_protected=True, selector_protected=True)
    assert module.check_auth_reset() == [], module.check_auth_reset()


def test_dsh6_comment_words_are_not_an_exemption(dshmod):
    """注释里写着 "keep a warm cache" 不算保护入参，否则这条门禁恒绿。"""
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE)
    hits = module.check_auth_reset()
    assert any("selectStalePartitions" in item["why"] for item in hits), hits
    assert any("保护集" in item["why"] for item in hits), hits


def test_dsh6_missing_audit_and_guards_are_caught(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, "EXE_NAME = 'x'\n", audit=False, selector_protected=True,
                   gc_protected=True)
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "审计" in hits and "repair_auth" in hits, hits


MODERN_MAINTENANCE = r"""
const PARTITION_CREDENTIAL_CANDIDATES = [['Network', 'Cookies'], ['Cookies']]
const PARTITION_CACHE_SUBDIRS = ['Cache', 'Code Cache']
function partitionDirectoryName(name) { return String(name || '').replace(/^persist:/, '') }
function normalizeLoginEntries(loginEntries) {
  const normalized = {}
  for (const [key, value] of Object.entries(loginEntries || {})) normalized[partitionDirectoryName(key)] = value
  return normalized
}
function partitionHasCredentialEvidence(directory) {
  return PARTITION_CREDENTIAL_CANDIDATES.some((parts) => fs.existsSync(path.join(directory, ...parts)))
}
function normalizeEntries(entries, loginEntries) {
  const keys = normalizeLoginEntries(loginEntries)
  return entries.map((entry) => ({
    name: partitionDirectoryName(entry.name),
    mtimeMs: entry.mtimeMs,
    hasLoginState: entry.hasLoginState || entry.hasCredentialEvidence || Boolean(keys[partitionDirectoryName(entry.name)])
  }))
}
function partitionBudgetReport(entries, { activePartitions = [], protectedPartitions = [], loginEntries = {} } = {}) {
  const protectedNames = new Set([...activePartitions, ...protectedPartitions].map(partitionDirectoryName))
  const partitions = normalizeEntries(entries, loginEntries)
  const removable = []
  const protectedSet = protectedNames
  const eligible = partitions.filter((entry) => !protectedSet.has(entry.name))
  const anonymous = eligible.filter((entry) => !entry.hasLoginState)
  const anonymousStale = anonymous.filter((entry) => Date.now() - entry.mtimeMs >= maxAgeMs)
  removable.push(...anonymousStale)
  const anonymousFresh = anonymous.filter((entry) => Date.now() - entry.mtimeMs < maxAgeMs)
  const freshOverflow = Math.max(0, anonymousFresh.length - maxCount)
  removable.push(...anonymousFresh.slice(0, freshOverflow))
  return { removable: removable.map((entry) => entry.name), cacheTrim: [] }
}
"""

MODERN_MAIN = r"""
function inspectDshAuthCookiePartition(partitionDirectory, name) {
  const evidence = partitionHasCredentialEvidence(partitionDirectory)
  return { checked: true, evidence, logged: false }
}
function clearWorkbenchCacheOnly(dir, name) {
  for (const relative of PARTITION_CACHE_SUBDIRS) fs.rmSync(path.join(dir, name, relative))
}
function gcWorkbenchPartitions() {
  const loginState = readWorkbenchLoginState()
  const unknownAccountSource = []
  const cookieEvidencePartitions = []
  for (const name of raw) {
    const key = 'persist:' + name
    if (loginState.entries[key]) continue
    if (partitionHasCredentialEvidence(path.join(dir, name))) cookieEvidencePartitions.push(name)
  }
  const state = inspectDshAuthCookiePartition(partitionDirectory, name)
  if (!state.checked && !state.evidence) unknownAccountSource.push(name)
  const entries = [{ name, mtimeMs: 0, hasLoginState: state.logged || state.evidence }]
  const protectedPartitions = [
    'tether-dsh-local',
    ...unknownAccountSource,
    ...cookieEvidencePartitions,
    ...nativeWorkbench.activeServicePartitions().map(partitionDirectoryName)
  ]
  const report = partitionBudgetReport(entries, { protectedPartitions, loginEntries: loginState.entries })
  for (const name of report.removable) fs.rmSync(path.join(dir, name), { recursive: true })
  for (const name of report.cacheTrim) clearWorkbenchCacheOnly(dir, name)
}
"""


def seed_modern_dsh6(module, tmp_path):
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, gc_protected=True, selector_protected=True)
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        MODERN_MAINTENANCE, encoding="utf-8")
    (tmp_path / "apps/tether-app/main.js").write_text(MODERN_MAIN, encoding="utf-8")


def test_dsh6_real_source_contract_passes(dshmod):
    """真实首启兜底源码必须被门禁认可，不能再拿旧文本形状判假红。"""
    module, _ = dshmod
    module.ROOT = Path(__file__).resolve().parents[1]
    assert module.check_auth_reset() == [], module.check_auth_reset()


def test_dsh6_unified_budget_contract_passes(dshmod):
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    assert module.check_auth_reset() == [], module.check_auth_reset()


def test_dsh6_removable_without_protected_exempt_fails(dshmod):
    """反例：把 removable 的 protectedSet 豁免拿掉，统一实现也必须 FAIL。"""
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        MODERN_MAINTENANCE.replace(
            "const eligible = partitions.filter((entry) => !protectedSet.has(entry.name))",
            "const eligible = partitions.filter(() => true)"),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "protectedSet" in hits, hits


def test_dsh6_first_boot_cookie_evidence_required(dshmod):
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        MODERN_MAINTENANCE.replace(
            "hasLoginState: entry.hasLoginState || entry.hasCredentialEvidence",
            "hasLoginState: entry.hasLoginState === true"),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "首启" in hits, hits


def test_dsh6_first_boot_cookie_partitions_must_join_protection(dshmod):
    """反例：检查了 Cookie，却没有把 cookieEvidencePartitions 并入保护集，仍必须 FAIL。"""
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/main.js").write_text(
        MODERN_MAIN.replace("    ...cookieEvidencePartitions,\n", ""),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "cookieEvidencePartitions" in hits, hits


def test_dsh6_prefixed_protected_key_normalization_required(dshmod):
    """反例：拿掉 protectedNames 的目录名归一化，门禁必须抓到键形失配。"""
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        MODERN_MAINTENANCE.replace(
            "].map(partitionDirectoryName))",
            "])"),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "persist:" in hits and "protectedNames" in hits, hits


def test_dsh6_prefixed_login_state_key_normalization_required(dshmod):
    """反例：loginEntries 仍按 persist: 原键匹配，门禁必须抓到登录豁免静默落空。"""
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/data-maintenance.js").write_text(
        MODERN_MAINTENANCE.replace(
            "normalized[partitionDirectoryName(key)] = value",
            "normalized[key] = value"),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "loginEntries" in hits, hits


def test_dsh6_main_cookie_boundary_must_emit_canonical_directory_name(dshmod):
    """反例：gc 首启集写 persist: 键，与生产预算目录名不一致时必须 FAIL。"""
    module, tmp_path = dshmod
    seed_modern_dsh6(module, tmp_path)
    (tmp_path / "apps/tether-app/main.js").write_text(
        MODERN_MAIN.replace(
            "cookieEvidencePartitions.push(name)",
            "cookieEvidencePartitions.push('persist:' + name)"),
        encoding="utf-8")
    hits = " ".join(item["why"] for item in module.check_auth_reset())
    assert "目录名规范键" in hits, hits


def test_dsh2_requires_instance_identity_binding(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE,
                   ui="const dshAccountState = { name: status.account } // reload")
    hits = module.check_ui_account()
    assert any("PID/profile" in item["why"] for item in hits), hits


def test_dsh2_surface_without_pid_field_is_caught(dshmod):
    module, tmp_path = dshmod
    seed_dsh_files(tmp_path, DESKTOP_TEMPLATE, surface=False,
                   ui="const dshAccountState = { pid: 1, profile: 'desktop' } // reload")
    hits = module.check_ui_account()
    assert any("native_surface.py" in item["file"] for item in hits), hits


# --- 内存上限：环境降级不拦发布 -------------------------------------------

def _run_memory_probe(monkeypatch, capsys, state: str) -> tuple[int, dict]:
    module = load_script("release_gate_memory")
    monkeypatch.setattr(module.sys, "platform", "linux")
    monkeypatch.setattr(module, "probe", lambda **_kwargs: {
        "state": state,
        "backend": "cgroup2",
        "controller_available": False,
        "dir_present": True,
        "declared_max_bytes": 402_653_184,
        "effective_max": None,
        "error": ""
    })
    monkeypatch.setattr(sys, "argv", ["release_gate_memory.py", "--json"])
    code = module.main()
    return code, json.loads(capsys.readouterr().out.strip())


def test_memory_declared_not_enforced_returns_degraded_not_blocked(monkeypatch, capsys, tmp_path):
    module = load_script("release_gate_memory")
    from tether.node.memory_guard import STATE_DECLARED_NOT_ENFORCED

    code, result = _run_memory_probe(monkeypatch, capsys, STATE_DECLARED_NOT_ENFORCED)
    assert code == module.DEGRADED_EXIT == 4
    assert result["verdict"] == "DEGRADED"

    runner = load_script("release_gate")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    args = runner.defaults_namespace()
    args.version = "0.5.16"
    args.evidence_root = str(tmp_path / "release-gate")
    process = type("Proc", (), {"returncode": 4, "stdout": "DEGRADED 内存上限判据\n",
                                "stderr": ""})()
    monkeypatch.setattr(runner.subprocess, "run", lambda *args, **kwargs: process)
    record = runner.run_auto_gate({"id": "MEM-1", "blocking": True, "kind": "auto",
                                   "title": "memory", "command": ["unused"]}, args)
    assert record["verdict"] == "DEGRADED"
    assert record["exit_code"] == 4

    counts = {"PASS": 0, "FAIL": 0, "BLOCKED": 0, "DEGRADED": 0}
    blockers = []
    if record["blocking"] and record["verdict"] in {"FAIL", "BLOCKED"}:
        blockers.append(record)
    counts[record["verdict"]] += 1
    assert counts["DEGRADED"] == 1
    assert blockers == [], "内核未开 memory controller 属宿主属性，不能拦发布"


def test_memory_cgroup_not_ready_remains_blocked(monkeypatch, capsys):
    module = load_script("release_gate_memory")
    from tether.node.memory_guard import STATE_UNDETERMINED

    code, result = _run_memory_probe(monkeypatch, capsys, STATE_UNDETERMINED)
    assert code == module.BLOCKED
    assert result["verdict"] == "BLOCKED"


# --- 装配产物完整性 -------------------------------------------------------

def test_empty_runtime_is_reported_missing(monkeypatch, tmp_path):
    module = load_script("release_gate_assets")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    empty = tmp_path / ".runtime/desktop-candidate"
    empty.mkdir(parents=True)
    problems: list[str] = []
    for component in module.COMPONENTS:
        _, missing = module.find_entries(empty, component)
        problems.extend(missing)
    problems.extend(module.check_declared_digests(empty))
    module.check_codeg_web(empty, problems)
    assert problems, "空装配产物不能被判为完整"


def test_assembled_runtime_passes(monkeypatch, tmp_path):
    module = load_script("release_gate_assets")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    runtime = tmp_path / ".runtime/desktop-candidate"
    for relative in ["components/nodejs/node.exe", "components/nodejs/pnpm.cmd",
                     "components/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
                     "components/dsh/node_modules/pnpm/bin/pnpm.mjs",
                     "components/codeg/asset.json", "node-bin/herdr.exe",
                     "node-bin/agents-runtime/codeg-server.exe",
                     "node-bin/agents-runtime/codeg-mcp.exe",
                     "components/easytier/asset.json", "components/meshcentral/meshcentral.js",
                     "node-bin/agents-runtime/web/index.html", "node-bin/agents-runtime/web/login.html",
                     "node-bin/agents-runtime/web/workspace.html", "node-bin/agents-runtime/web/token.html",
                     "node-bin/agents-runtime/web/_next/static/chunks/a.js"]:
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
    descriptors = {
        "components/nodejs/runtime.json": {"component": "nodejs", "version": "24.22.2"},
        "components/nodejs/pnpm.json": {"component": "pnpm", "version": "11.28.5",
                                        "shim": "pnpm.cmd",
                                        "entry": "../dsh/node_modules/pnpm/bin/pnpm.mjs"},
        "components/dsh/runtime.json": {"component": "@deepseek-ai/dsh", "version": "0.2.1-rc.5",
                                        "entry": "node_modules/@deepseek-ai/dsh/lib/bin.js"},
        "components/dsh-plugin/asset.json": {"component": "dsh-plugin", "version": "0.2.93"},
        "components/codeg/asset.json": {"component": "codeg", "version": "v0.42.0"},
        "components/easytier/asset.json": {"component": "easytier", "version": "v2.6.4"},
    }
    for relative, payload in descriptors.items():
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    problems = []
    for component in module.COMPONENTS:
        _, missing = module.find_entries(runtime, component)
        problems.extend(f"{component['name']}: {item}" for item in missing)
    problems.extend(module.check_declared_digests(runtime))
    module.check_codeg_web(runtime, problems)
    assert problems == [], problems


def test_declared_digest_mismatch_is_caught(monkeypatch, tmp_path):
    module = load_script("release_gate_assets")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    runtime = tmp_path / ".runtime/desktop-candidate"
    directory = runtime / "components/codeg"
    directory.mkdir(parents=True)
    (directory / "asset.zip").write_bytes(b"payload")
    (directory / "asset.json").write_text(json.dumps(
        {"component": "codeg", "version": "v0.42.0", "asset": "asset.zip",
         "sha256": "b" * 64, "size": 7}), encoding="utf-8")
    problems = module.check_declared_digests(runtime)
    assert any("SHA-256" in item for item in problems), problems
