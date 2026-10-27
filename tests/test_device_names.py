import sqlite3

import pytest

from tether.controller.store import NotFound, Store


def test_display_name_survives_node_reconnect(tmp_path):
    store = Store(tmp_path / "controller.db")
    try:
        store.register_device("d1", "HOST-NAME", "Windows", {}, "token")
        renamed = store.rename_device("d1", "工作站")
        assert renamed["name"] == "工作站"
        assert renamed["host_name"] == "HOST-NAME"
        assert renamed["display_name"] == "工作站"

        reconnected = store.register_device("d1", "HOST-NAME", "Windows", {}, "token")
        assert reconnected["name"] == "工作站"
        assert reconnected["host_name"] == "HOST-NAME"
        assert store.list_devices()[0]["name"] == "工作站"
    finally:
        store.close()


def test_store_adds_display_name_to_legacy_database(tmp_path):
    path = tmp_path / "controller.db"
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE devices (
        device_id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT,
        capabilities TEXT NOT NULL DEFAULT '{}', token_hash TEXT NOT NULL,
        online INTEGER NOT NULL DEFAULT 0, last_seen REAL)""")
    db.execute("INSERT INTO devices(device_id,name,token_hash,online) VALUES('d1','HOST','x',0)")
    db.commit()
    db.close()

    store = Store(path)
    try:
        assert store.get_device("d1")["name"] == "HOST"
        assert store.rename_device("d1", "旧机器")["name"] == "旧机器"
    finally:
        store.close()


def test_rename_missing_device_raises(tmp_path):
    store = Store(tmp_path / "controller.db")
    try:
        with pytest.raises(NotFound):
            store.rename_device("missing", "nope")
    finally:
        store.close()