import json
import tempfile
import unittest
from pathlib import Path

from tether.node import project_sync


class ProjectPathTests(unittest.TestCase):
    def test_normalizes_case_and_slashes(self):
        self.assertEqual(
            project_sync.normalize_project_path("D:/TetherWorkSpaces/Demo/"),
            project_sync.normalize_project_path("d:\\tetherworkspaces\\demo")
        )


class DshWorkspacePathsTests(unittest.TestCase):
    def test_reads_workspace_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            storages = home / "storages"
            storages.mkdir(parents=True)
            (storages / "workspace.json").write_text(json.dumps({
                "tables": {"workspaces": {
                    "a": {"path": "D:\\TetherWorkspaces\\demo", "title": "demo"}
                }}
            }), encoding="utf-8")
            paths = project_sync._dsh_workspace_paths(home)
            self.assertEqual(list(paths.values()), ["D:\\TetherWorkspaces\\demo"])


class CodegFolderTests(unittest.TestCase):
    def test_filters_chat_and_deleted(self):
        original = project_sync._post_codeg
        project_sync._post_codeg = lambda port, token, route, body: [
            {"path": "D:\\a", "kind": "regular"},
            {"path": "D:\\b", "kind": "chat"},
            {"path": "D:\\c", "deletedAt": "2026-01-01"},
        ]
        try:
            paths = project_sync._codeg_folder_paths(18899, "t")
        finally:
            project_sync._post_codeg = original
        self.assertEqual(paths, {project_sync.normalize_project_path("D:\\a"): "D:\\a"})


if __name__ == "__main__":
    unittest.main()