import tempfile
import unittest
from pathlib import Path

from tether.node.agents_runtime import AgentsRuntime


class DeepseekAcpPresenceTest(unittest.TestCase):
    def test_detects_binary_in_agent_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / "deepseek-acp.cmd").write_text("", encoding="utf-8")
            self.assertTrue(AgentsRuntime._deepseek_acp_present(home))

    def test_detects_binary_in_node_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            bin_dir = home / "node_modules" / ".bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "deepseek-acp").write_text("", encoding="utf-8")
            self.assertTrue(AgentsRuntime._deepseek_acp_present(home))

    def test_missing_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(AgentsRuntime._deepseek_acp_present(Path(tmp)))

    def test_parse_version(self):
        self.assertEqual(AgentsRuntime._parse_version("0.11.0"), (0, 11, 0))
        self.assertEqual(AgentsRuntime._parse_version("garbage"), ())


if __name__ == "__main__":
    unittest.main()