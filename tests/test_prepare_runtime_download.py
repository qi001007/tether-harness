import hashlib
from pathlib import Path

import pytest

from desktop.packaging.prepare_runtime import download


def asset(payload: bytes, *, name: str = "example.bin"):
    return {
        "name": name,
        "url": "https://example.invalid/" + name,
        "size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


class FakeResponse:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.cursor = 0
        self.headers = {"Content-Length": str(len(payload))}

    def read(self, size):
        value = self.payload[self.cursor:self.cursor + size]
        self.cursor += len(value)
        return value

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_download_retries_transient_hash_mismatch(tmp_path, monkeypatch):
    asset_value = asset(b"good")
    attempts = [b"bad!", b"good"]
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        return FakeResponse(attempts[len(calls) - 1])

    monkeypatch.setattr("desktop.packaging.prepare_runtime.time.sleep", lambda _: None)
    monkeypatch.setattr("desktop.packaging.prepare_runtime.urllib.request.urlopen", fake_urlopen)
    destination = tmp_path / "example.bin"

    download(asset_value, destination, attempts=2)

    assert destination.read_bytes() == b"good"
    assert len(calls) == 2


def test_download_exhausts_all_attempts_and_removes_partial(tmp_path, monkeypatch):
    asset_value = asset(b"good")
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        return FakeResponse(b"bad!")

    monkeypatch.setattr("desktop.packaging.prepare_runtime.time.sleep", lambda _: None)
    monkeypatch.setattr("desktop.packaging.prepare_runtime.urllib.request.urlopen", fake_urlopen)
    destination = tmp_path / "example.bin"

    with pytest.raises(ValueError, match="download failed size/SHA-256"):
        download(asset_value, destination, attempts=2)

    assert len(calls) == 2
    assert not destination.exists()
