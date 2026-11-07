from pathlib import Path


def test_dsh_web_worker_unit_has_memory_headroom_without_raising_hard_limit():
    source = (Path(__file__).parents[1] / "tether/node/dsh_web.py").read_text(encoding="utf-8")
    assert '"Restart=always\\nRestartSec=3\\nMemoryHigh=384M\\nMemoryMax=600M\\n\\n"' in source
    assert '"Restart=always\\nRestartSec=3\\nMemoryHigh=80M\\nMemoryMax=160M\\n\\n"' in source
