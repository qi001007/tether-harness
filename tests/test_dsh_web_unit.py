from pathlib import Path


def test_dsh_web_node_does_not_own_a_system_wide_systemd_unit():
    """The Node keeps DSH Web inside its own data directory (9e96bedd).

    Linux DSH Web was previously installed as root-owned
    /etc/systemd/system/tether-dsh-{web,gateway}.service units with MemoryHigh
    and MemoryMax caps. The isolated per-device workspace packaging replaced
    that model, so this regression now asserts the retired contract instead of
    the removed unit text: the manager must not write system-wide units or
    host-wide memory limits.
    """
    source = (Path(__file__).parents[1] / "tether/node/dsh_web.py").read_text(encoding="utf-8")
    assert "/etc/systemd/system" not in source
    assert "MemoryHigh=" not in source
    assert "MemoryMax=" not in source