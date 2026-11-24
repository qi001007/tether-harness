"""Report whether a declared memory limit is actually enforced on this host.

Declarative capability bits have twice been mistaken for enforcement in this
project: a unit file that mentions ``MemoryMax`` and a ``supported`` flag
derived from the OS name both read like promises while enforcing nothing. This
module answers one question, by measurement: when the service manager says this
process may use N bytes, can that limit be read back from the kernel?

Four states, and nothing else:

``enforced``
    A limit was declared *and* the cgroup exposes a readable limit file.
``declared_but_not_enforced``
    A limit was declared, the unit is running, but the kernel offers no way to
    read it back — either the memory controller is absent
    (``cgroup_disable=memory`` on the kernel command line, a trimmed image, or
    a container without the controller delegated) or the unit's cgroup has no
    ``memory.*`` files. This must never be reported as ``enforced``: a present
    controller is not a present limit, and "no OOM has been recorded" is not
    evidence of protection.
``undeclared``
    Nothing was declared, or this platform has no cgroup backend to declare
    one through.
``undetermined``
    The unit exists and declares a limit, but its cgroup directory was not
    present within the allotted wait — i.e. the service had not started yet.
    Measured on PI-01: an inactive unit still reports ``MemoryMax`` (the value
    comes from the unit file), while ``/sys/fs/cgroup/system.slice/<unit>.service``
    does not exist until the unit starts, and appears within ~100 ms after
    start. Reporting that as ``declared_but_not_enforced`` would brand every
    healthy Linux node as unprotected, so it gets its own state and the gate
    treats it as BLOCKED rather than as a verdict.

Why the fourth state exists — measured on PI-01 (Raspberry Pi OS, systemd 257,
cgroup2 unified) on 2026-11-25, reproducible with the commands in the docstring
of ``release_gate_memory.py``:

    is-active=inactive
    systemctl show tether-idle-probe -p MemoryMax --value  -> 67108864
    test -d /sys/fs/cgroup/system.slice/tether-idle-probe.service -> NO
    (after systemctl start) dir_appeared_after_ms=100

An inactive unit already reports a declared limit while its cgroup directory
does not exist yet, and the directory appears ~100 ms after start. Without
``undetermined``, probing in that window would answer "declared but not
enforced" for every healthy Linux node — a structural false alarm, which is as
bad as the false green light this gate exists to prevent. Consumers must render
this as "undetermined / missing input" and never fall back to "not enforced" or
"enforced"; ``dir_present`` and ``error=cgroup_dir_absent_after_start`` are
reported together so the three different causes (timing window, controller
genuinely absent, unit not started) stay separable on the Hub side.

Three rulings that belong to this module rather than to a README:

1. Windows and macOS have no cgroup backend. They report ``undeclared`` with
   ``backend="none"`` and a reason string. ``undeclared`` is *not*
   ``declared_but_not_enforced``: the first means "no promise was made", the
   second means "a promise was made and the kernel ignores it". Rendering
   Windows as the second state would be a false alarm, which is as harmful as
   a false green light.
2. ``backend`` is an open enum: ``cgroup2``, ``cgroup1``, ``none``. A future
   launchd (or Job Object) limit needs a new name here plus its own read-back
   path; adding it must not reuse ``cgroup*``.
3. The reverse test is a fixed case, not prose: controller present, unit
   running, a declared limit, but no readable limit file, still has to
   classify as ``declared_but_not_enforced``. See ``classify_state``.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional, Union

STATE_ENFORCED = "enforced"
STATE_DECLARED_NOT_ENFORCED = "declared_but_not_enforced"
STATE_UNDECLARED = "undeclared"
STATE_UNDETERMINED = "undetermined"

BACKEND_CGROUP2 = "cgroup2"
BACKEND_CGROUP1 = "cgroup1"
BACKEND_NONE = "none"

NO_BACKEND_REASON = "no_cgroup_backend_on_platform"
UNREADABLE_REASON = "limit_file_unreadable"
CONTROLLER_ABSENT_REASON = "memory_controller_absent"
DIR_ABSENT_REASON = "cgroup_dir_absent_after_start"

LimitValue = Union[int, str, None]  # bytes, "max" (no limit), or None (absent)


def classify_state(
    *,
    declared_max: LimitValue,
    controller_available: bool,
    effective_max: LimitValue,
    backend: str,
    dir_present: bool = True,
) -> str:
    """Decide the state from measured inputs only.

    Kept as a pure function so the reverse case (controller exists, limit file
    does not) and the timing case (unit not started yet) can be tested without
    a kernel that behaves that way.
    """
    if backend == BACKEND_NONE or declared_max is None:
        return STATE_UNDECLARED
    if not dir_present:
        return STATE_UNDETERMINED
    if controller_available and effective_max is not None:
        return STATE_ENFORCED
    return STATE_DECLARED_NOT_ENFORCED


def _read_int_or_max(path: Path) -> LimitValue:
    """Read a cgroup limit file: bytes, ``max`` for unlimited, None if absent."""
    try:
        raw = path.read_text().strip()
    except (FileNotFoundError, NotADirectoryError, PermissionError, OSError):
        return None
    if raw == "max":
        return "max"
    try:
        value = int(raw)
    except ValueError:
        return None
    # cgroup v1 encodes "no limit" as a huge sentinel; normalise it.
    if value >= 9_223_372_036_854_775_800:
        return "max"
    return value


def _detect_backend(root: Path) -> str:
    if (root / "cgroup.controllers").is_file():
        return BACKEND_CGROUP2
    if (root / "memory").is_dir():
        return BACKEND_CGROUP1
    return BACKEND_NONE


def _controller_available(root: Path, backend: str) -> bool:
    if backend == BACKEND_CGROUP2:
        try:
            return "memory" in (root / "cgroup.controllers").read_text().split()
        except OSError:
            return False
    if backend == BACKEND_CGROUP1:
        return (root / "memory").is_dir()
    return False


def normalize_declared(raw: str) -> LimitValue:
    """Turn a ``systemctl show -p MemoryMax --value`` string into a declared value.

    Measured on PI-01, the shapes are:
      ``[not set]``  unit exists, property unset
      ``""``         unit does not exist at all (or systemctl failed)
      ``infinity``   **unit exists and declares no limit** — this is the
                     common case, not a declaration. Treating it as a declared
                     value inverts the verdict: a node with no limit would be
                     reported as "limit not enforced" instead of "no limit".
      ``max``        same meaning as ``infinity``
      digits         an actual limit
    """
    raw = (raw or "").strip()
    if not raw or raw == "[not set]":
        return None
    if raw in ("infinity", "max"):
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def read_declared_max(unit: str) -> LimitValue:
    """Ask the service manager what it *thinks* it configured."""
    try:
        out = subprocess.run(
            ["systemctl", "show", unit, "-p", "MemoryMax", "--value"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return normalize_declared(out.stdout or "")


def probe(
    *,
    unit: str = "tether-node",
    sysfs_root: Optional[Path] = None,
    cgroup_dir: Optional[Path] = None,
    declared_reader: Callable[[str], LimitValue] = read_declared_max,
    system: Optional[str] = None,
    wait_ms: int = 0,
    poll_ms: int = 50,
) -> dict:
    """Measure the memory-limit state for ``unit`` on this host.

    ``cgroup_dir``, ``declared_reader`` and ``wait_ms`` are injectable so gate
    scripts and tests can point at a transient probe unit and tolerate the
    ~100 ms window between ``systemctl start`` and the cgroup directory
    appearing.
    """
    root = Path(sysfs_root or "/sys/fs/cgroup")
    os_name = system if system is not None else (
        os.uname().sysname if hasattr(os, "uname") else "Windows"
    )
    backend = _detect_backend(root) if os_name == "Linux" else BACKEND_NONE

    if backend == BACKEND_NONE:
        return {
            "state": STATE_UNDECLARED,
            "backend": BACKEND_NONE,
            "controller_available": False,
            "declared_max_bytes": None,
            "effective_max": None,
            "effective_high": None,
            "dir_present": False,
            "error": NO_BACKEND_REASON,
        }

    target = Path(cgroup_dir) if cgroup_dir else root / "system.slice" / f"{unit}.service"
    controller = _controller_available(root, backend)
    declared = declared_reader(unit)

    deadline = time.monotonic() + (wait_ms / 1000.0)
    dir_present = target.is_dir()
    while not dir_present and time.monotonic() < deadline:
        time.sleep(poll_ms / 1000.0)
        dir_present = target.is_dir()

    if backend == BACKEND_CGROUP2:
        effective_max = _read_int_or_max(target / "memory.max") if dir_present else None
        effective_high = _read_int_or_max(target / "memory.high") if dir_present else None
    else:
        effective_max = (
            _read_int_or_max(target / "memory.limit_in_bytes") if dir_present else None
        )
        effective_high = (
            _read_int_or_max(target / "memory.soft_limit_in_bytes") if dir_present else None
        )

    state = classify_state(
        declared_max=declared,
        controller_available=controller,
        effective_max=effective_max,
        backend=backend,
        dir_present=dir_present,
    )
    error = ""
    if state == STATE_UNDETERMINED:
        error = DIR_ABSENT_REASON
    elif state == STATE_DECLARED_NOT_ENFORCED:
        error = CONTROLLER_ABSENT_REASON if not controller else UNREADABLE_REASON

    return {
        "state": state,
        "backend": backend,
        "controller_available": controller,
        "declared_max_bytes": declared,
        "effective_max": effective_max,
        "effective_high": effective_high,
        "dir_present": dir_present,
        "error": error,
    }
