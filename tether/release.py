"""Signed release manifest contract shared by the updater and release tooling."""

from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from . import ed25519

PUBLIC_KEY_HEX = "cb8cfd9c5dca0a09b80d865f4cb83211aca9857322cb74a004bdcd4ba36eb1d9"
SIGNATURE_FIELD = "signature"


class ReleaseSignatureError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def canonical_bytes(manifest: dict[str, Any]) -> bytes:
    payload = {key: value for key, value in manifest.items() if key != SIGNATURE_FIELD}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def verify_signature(manifest: dict[str, Any], public_key_hex: str | None = None) -> None:
    signature = manifest.get(SIGNATURE_FIELD)
    if not isinstance(signature, str) or not signature:
        raise ReleaseSignatureError("signature_missing")
    try:
        raw = base64.b64decode(signature.encode("ascii"), validate=True)
    except (ValueError, binascii.Error, UnicodeError):
        raise ReleaseSignatureError("signature_invalid") from None
    key_hex = public_key_hex or PUBLIC_KEY_HEX
    try:
        public_key = bytes.fromhex(key_hex)
    except ValueError:
        raise ReleaseSignatureError("signature_invalid") from None
    if not ed25519.verify(public_key, canonical_bytes(manifest), raw):
        raise ReleaseSignatureError("signature_invalid")
