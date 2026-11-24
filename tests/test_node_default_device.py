import os

from tether.node.agent import default_device_id


def test_default_device_id_prefers_configured_value(monkeypatch):
    monkeypatch.setenv("TETHER_DEVICE", "NODE-7")
    monkeypatch.setattr("tether.node.agent.platform.node", lambda: "ignored")

    assert default_device_id() == "NODE-7"


def test_default_device_id_uses_hostname_without_test_bed_name(monkeypatch):
    monkeypatch.delenv("TETHER_DEVICE", raising=False)
    monkeypatch.setattr("tether.node.agent.platform.node", lambda: "office workstation.local")

    assert default_device_id() == "office-workstation.local"
