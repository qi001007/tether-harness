"""Minimal RFC 8032 Ed25519 verification.

The updater runs on machines that only guarantee a stock Python runtime, so the
release manifest signature must be verifiable without third-party packages.
Signing stays in the release tooling, which may use ``cryptography``.
"""

from __future__ import annotations

import hashlib

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _inv(value: int) -> int:
    return pow(value, _P - 2, _P)


def _recover_x(y: int, sign: int) -> int | None:
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _I % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _point_add(left, right):
    x1, y1, z1, t1 = left
    x2, y2, z2, t2 = right
    a = (y1 - x1) * (y2 - x2) % _P
    b = (y1 + x1) * (y2 + x2) % _P
    c = t1 * 2 * _D * t2 % _P
    d = z1 * 2 * z2 % _P
    e = b - a
    f = d - c
    g = d + c
    h = b + a
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _point_double(point):
    x, y, z, _t = point
    a = x * x % _P
    b = y * y % _P
    c = 2 * z * z % _P
    h = a + b
    e = h - (x + y) * (x + y) % _P
    g = a - b
    f = c + g
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _scalar_mult(scalar: int, point):
    result = (0, 1, 1, 0)
    addend = point
    while scalar:
        if scalar & 1:
            result = _point_add(result, addend)
        addend = _point_double(addend)
        scalar >>= 1
    return result


def _encode_point(point) -> bytes:
    x, y, z, _t = point
    zinv = _inv(z)
    x = x * zinv % _P
    y = y * zinv % _P
    encoded = bytearray(y.to_bytes(32, "little"))
    encoded[31] |= (x & 1) << 7
    return bytes(encoded)


def _decode_point(raw: bytes):
    if len(raw) != 32:
        return None
    sign = raw[31] >> 7
    y = int.from_bytes(raw, "little") & ((1 << 255) - 1)
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


def _base_point():
    y = 4 * _inv(5) % _P
    x = _recover_x(y, 0)
    assert x is not None
    return (x, y, 1, x * y % _P)


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Return True only for a valid Ed25519 signature."""
    try:
        if not isinstance(public_key, (bytes, bytearray)) or len(public_key) != 32:
            return False
        if not isinstance(signature, (bytes, bytearray)) or len(signature) != 64:
            return False
        public_key = bytes(public_key)
        signature = bytes(signature)
        try:
            from cryptography.exceptions import InvalidSignature
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

            Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
            return True
        except InvalidSignature:
            return False
        except ImportError:
            pass

        r_raw, s_raw = signature[:32], signature[32:]
        s = int.from_bytes(s_raw, "little")
        if s >= _L:
            return False
        a_point = _decode_point(public_key)
        r_point = _decode_point(r_raw)
        if a_point is None or r_point is None:
            return False
        digest = hashlib.sha512(r_raw + public_key + message).digest()
        k = int.from_bytes(digest, "little") % _L
        expected = _point_add(r_point, _scalar_mult(k, a_point))
        actual = _scalar_mult(s, _base_point())
        return _encode_point(expected) == _encode_point(actual)
    except Exception:
        return False
