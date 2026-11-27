"""发布门禁自身的回归。

门禁脚本最怕两种失效：永远 FAIL（没人用）和永远 PASS（假绿灯）。这里用合成数据
把每条判据都跑一遍正反两面。不落任何真实证据文件，不改仓库状态。
"""
from __future__ import annotations

import importlib.util
import json
import sys
from argparse import Namespace
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


@pytest.mark.parametrize(("only", "exit_code", "expected"), [
    (None, 0, "READY-FOR-APPROVAL"), ("ENT-1", 2, "PARTIAL")
])
def test_success_requires_every_gate(tmp_path, monkeypatch, only, exit_code, expected):
    gate = load_script("release_gate")
    command = [sys.executable, "-c", "pass"]
    monkeypatch.setattr(gate, "commands", lambda *_: {"ENT-1": command, "VER-1": command})
    args = ["run", "--version", "1.0.0", "--evidence-root", str(tmp_path)]
    assert gate.main(args + (["--only", only] if only else [])) == exit_code
    assert json.loads((tmp_path / "1.0.0/verdict.json").read_text())["verdict"] == expected


def test_gate_failure_blocks_release(tmp_path, monkeypatch):
    gate = load_script("release_gate")
    monkeypatch.setattr(gate, "commands", lambda *_: {"VER-1": [sys.executable, "-c", "exit(1)"]})
    assert gate.main(["run", "--version", "1.0.0", "--evidence-root", str(tmp_path)]) == 1
    assert json.loads((tmp_path / "1.0.0/verdict.json").read_text())["verdict"] == "PUBLISH-BLOCKED"


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
    args = Namespace(descriptor=str(tmp_path / "d.json"), dsh_home=None,
                approved=str(tmp_path / "approved.json"), allow_host_inspection=False)
    whys = " ".join(item["why"] for item in module.check_mapping(args))
    assert "回环" in whys and "批准实例" in whys, whys


def test_dsh1_missing_descriptor_exits_two(dshmod):
    module, tmp_path = dshmod
    args = Namespace(descriptor=None, dsh_home=None, approved=None, allow_host_inspection=False)
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
    return Namespace(descriptor=str(tmp_path / "d.json"), dsh_home=None,
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

def test_memory_cgroup_not_ready_remains_blocked(monkeypatch, capsys):
    module = load_script("release_gate_memory")
    from tether.node.memory_guard import STATE_UNDETERMINED

    code, result = _run_memory_probe(monkeypatch, capsys, STATE_UNDETERMINED)
    assert code == module.BLOCKED
    assert result["verdict"] == "BLOCKED"
