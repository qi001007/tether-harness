import io
import json
import zipfile
from pathlib import Path

import pytest

from tether.node import dsh_plugin


def _write_profile(root: Path, *, plugins=("tether-dsh-plugin", "tether-dsh-client",
                                           "tether-dsh-surface", "tether-dsh-native-ui"),
                   ui=("dsh-client-ui-chat", "dsh-client-ui-conversation",
                       "dsh-client-ui-sidebar-files", "dsh-client-ui-tool",
                       "dsh-client-ui-workspace")):
    profile = root / "profiles" / "desktop"
    profile.mkdir(parents=True)
    package = {
        "name": "dsh-profile-desktop",
        "private": True,
        "dependencies": {"tether-dsh-plugin": "0.2.83"},
        "dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                                        "tether-dsh-plugin"]}},
    }
    (profile / "package.json").write_text(json.dumps(package), encoding="utf-8")
    for name in plugins:
        folder = profile / "node_modules" / name
        folder.mkdir(parents=True)
        (folder / "package.json").write_text(json.dumps({"name": name, "version": "0.2.83"}),
                                             encoding="utf-8")
    for name in ui:
        folder = profile / "node_modules" / "@deepseek-ai" / name / "lib"
        folder.mkdir(parents=True)
        (folder / "client.js").write_text("export {}", encoding="utf-8")
    return profile


def test_cli_uses_electron_in_node_mode_without_a_console(tmp_path):
    install_root = tmp_path / "install"
    cli = install_root / "resources" / "runtime" / "cli" / "bin" / "dsh.cmd"
    cli.parent.mkdir(parents=True)
    cli.write_text("", encoding="utf-8")
    (install_root / "DeepSeek Harness.exe").write_bytes(b"")
    argv, env = dsh_plugin._cli_argv(cli, ["plugin", "--profile", "desktop", "add", "file:C:\\x"])
    assert argv[0] == str(install_root / "DeepSeek Harness.exe")
    assert argv[1] == "--expose-internals"
    assert Path(argv[2]).as_posix().endswith(
        "resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js")
    assert env == {"ELECTRON_RUN_AS_NODE": "1"}


def test_hoisted_layout_is_added_without_overwriting_existing_settings(tmp_path):
    profile = tmp_path / "profiles" / "desktop"
    profile.mkdir(parents=True)
    (profile / "pnpm-workspace.yaml").write_text("packages:\n  - .\n", encoding="utf-8")
    dsh_plugin._ensure_hoisted_layout(profile)
    content = (profile / "pnpm-workspace.yaml").read_text(encoding="utf-8")
    assert "packages:" in content
    assert "nodeLinker: hoisted" in content
    assert "autoInstallPeers: false" in content
    dsh_plugin._ensure_hoisted_layout(profile)
    assert content.count("nodeLinker: hoisted") == (profile / "pnpm-workspace.yaml").read_text(
        encoding="utf-8").count("nodeLinker: hoisted")


def test_verify_profile_requires_plugin_packages_registration_and_ui_tree(tmp_path):
    profile = _write_profile(tmp_path)
    result = dsh_plugin._verify_profile(profile)
    assert result["versions"]["tether-dsh-plugin"] == "0.2.83"
    assert result["missing_ui"] == []

    (profile / "node_modules" / "@deepseek-ai" / "dsh-client-ui-workspace" / "lib" / "client.js").unlink()
    with pytest.raises(dsh_plugin.DshPluginError) as error:
        dsh_plugin._verify_profile(profile)
    assert error.value.code == "plugin_verify_failed"
    assert "dsh-client-ui-workspace" in error.value.details["missing_ui"]


def test_verify_profile_rejects_a_profile_without_the_bundle_registration(tmp_path):
    profile = _write_profile(tmp_path)
    package = json.loads((profile / "package.json").read_text(encoding="utf-8"))
    package["dsh"]["profile"]["bundles"] = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    (profile / "package.json").write_text(json.dumps(package), encoding="utf-8")
    with pytest.raises(dsh_plugin.DshPluginError) as error:
        dsh_plugin._verify_profile(profile)
    assert error.value.code == "plugin_verify_failed"
    assert "profile-registration" in error.value.details["missing"]


class _MissingDsh:
    def status(self):
        return {"installed": False, "running": False, "pid": 0}


def test_install_fails_cleanly_when_dsh_is_not_installed():
    with pytest.raises(dsh_plugin.DshPluginError) as error:
        dsh_plugin.install(_MissingDsh())
    assert error.value.code == "dsh_not_installed"


def test_plugin_archive_rejects_path_traversal(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../outside.txt", "x")
    with pytest.raises(dsh_plugin.DshPluginError) as error:
        dsh_plugin._extract_plugin_archive(buffer.getvalue(), tmp_path / "source")
    assert error.value.code == "plugin_archive_invalid"


def test_plugin_archive_extracts_a_versioned_package_tree(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in ("dsh-plugin-tether", "dsh-plugin-tether-client",
                     "tether-dsh-native-ui", "tether-dsh-surface"):
            archive.writestr(f"tether-plugin-0.2.83/packages/{name}/package.json",
                             json.dumps({"name": name, "version": "0.2.83"}))
        archive.writestr("tether-plugin-0.2.83/README-INSTALL.md", "install")
    root = dsh_plugin._extract_plugin_archive(buffer.getvalue(), tmp_path / "source")
    assert (root / "packages" / "dsh-plugin-tether" / "package.json").is_file()
