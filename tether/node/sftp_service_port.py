"""Dispatch the existing SFTP service port to its local SSH or mTLS endpoint."""

import asyncio
import socket
from threading import Event, Lock, Thread


SFTP_SERVICE_PORT = 20222
SHARED_PORT_VERSION = 1
_SSH_BANNER_GRACE = 1


def bind_sftp_backend():
    """Reserve an ephemeral loopback TCP socket outside EasyTier's ingress ACL."""
    while True:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            if port not in range(52000, 52064) and port not in (SFTP_SERVICE_PORT, 20223):
                return listener
        except OSError:
            listener.close()
            raise
        listener.close()


class SftpServicePort:
    def __init__(self, port=SFTP_SERVICE_PORT):
        self.port = port
        self._routes = {}
        self._server = None
        self._loop = None
        self._lock = Lock()

    def attach(self, kind, backend, *, allowed=None):
        if kind not in {"ssh", "tls"} or not 1 <= backend <= 65535 or backend == self.port:
            raise ValueError("invalid SFTP service endpoint")
        with self._lock:
            if self._loop is None:
                started = Event()

                def run():
                    self._loop = asyncio.new_event_loop()
                    started.set()
                    self._loop.run_forever()

                Thread(target=run, daemon=True, name="tether-sftp-service-port").start()
                started.wait()
            self._update(kind, (backend, allowed))

    def detach(self, kind, backend):
        with self._lock:
            if self._loop is not None:
                self._update(kind, None, backend)

    def _update(self, kind, route, backend=None):
        asyncio.run_coroutine_threadsafe(self._configure(kind, route, backend), self._loop).result()

    async def _configure(self, kind, route, backend):
        if route is None:
            if self._routes.get(kind, (None,))[0] == backend:
                self._routes.pop(kind)
            if not self._routes and self._server is not None:
                self._server.close()
                self._server = None
            return
        if self._server is None:
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                else:
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", self.port))
                listener.listen()
                listener.setblocking(False)
                self._server = await asyncio.start_server(self._handle, sock=listener)
            except BaseException:
                listener.close()
                raise
        self._routes[kind] = route

    @staticmethod
    async def _pipe(reader, writer):
        while block := await reader.read(64 * 1024):
            writer.write(block)
            await writer.drain()
        writer.write_eof()

    async def _handle(self, reader, writer):
        backend = None
        try:
            prefix = b""
            if len(self._routes) == 2:
                try:
                    prefix = await asyncio.wait_for(reader.read(1), timeout=_SSH_BANNER_GRACE)
                    if not prefix:
                        return
                except asyncio.TimeoutError:
                    # RFC 4253 SSH may wait for the server identification.
                    pass
                if prefix == b"\x16":  # TLS handshake record.
                    route = self._routes.get("tls")
                elif prefix in {b"", b"S"}:  # SSH-2.0 identification.
                    route = self._routes.get("ssh")
                else:
                    return
            else:
                route = next(iter(self._routes.values()), None)
            if route is None or (route[1] is not None and not route[1]()):
                return
            incoming, backend = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", route[0]), timeout=1)
            if prefix:
                backend.write(prefix)
            upload = asyncio.create_task(self._pipe(reader, backend))
            download = asyncio.create_task(self._pipe(incoming, writer))
            try:
                await asyncio.gather(upload, download)
            finally:
                upload.cancel()
                download.cancel()
                await asyncio.gather(upload, download, return_exceptions=True)
        except (OSError, asyncio.TimeoutError):
            pass
        finally:
            if backend is not None:
                backend.close()
            writer.close()
