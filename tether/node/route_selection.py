"""Order routes supplied by a caller that has already authorized each endpoint."""

from __future__ import annotations

from typing import Callable, TypeVar

Route = TypeVar("Route")


def rank_routes(routes: list[Route], probe_status: Callable[[Route], bool | None], *,
                check_cancel: Callable[[], None], clock: Callable[[], float],
                sleep: Callable[[float], None], timeout: float, settle: float) -> tuple[list[Route], list[Route]]:
    """Rank completed probes first and keep unfinished ones as backups.

    The adapter reports True for a usable sample and False for a failed probe.
    Once a route succeeds, give other probes a short window to finish.
    """
    pending = list(routes)
    ready = []
    deadline = clock() + timeout
    while pending and clock() < deadline:
        check_cancel()
        unfinished = []
        for route in pending:
            result = probe_status(route)
            if result is None:
                unfinished.append(route)
            elif result:
                if not ready:
                    deadline = min(deadline, clock() + settle)
                ready.append(route)
        pending = unfinished
        remaining = deadline - clock()
        if pending and remaining > 0:
            sleep(min(0.05, remaining))
    return ready, pending
