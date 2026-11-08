"""Private, raw-content HTTP API for one Node's file service."""

from __future__ import annotations

import asyncio
import base64
import socket
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

try:
    import uvicorn
    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response, StreamingResponse
    from starlette.routing import Route
except ImportError:  # packaged builds must include the pinned ASGI runtime
    uvicorn = None
    Starlette = Request = JSONResponse = Response = StreamingResponse = Route = None  # type: ignore[assignment]


class FilesHttpError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class FilesHttpService:
    WRITE_OPS = {"write", "write_chunk", "mkdir", "rename", "copy", "delete"}

    def __init__(self, fs: Any, service_access: Any) -> None:
        self.fs = fs
        self.service_access = service_access
        self._lock = threading.RLock()
        self._server: Any = None
        self._thread: threading.Thread | None = None
        self._socket: socket.socket | None = None
        self._port = 0
        self._startup_error = ""

    def status(self) -> dict[str, Any]:
        if Starlette is None or uvicorn is None:
            return {"state": "missing", "reason": "files_dependencies_missing"}
        if self._thread is not None and self._thread.is_alive() and self._server is not None and self._server.started:
            return {"state": "ready", "port": self._port}
        if self._startup_error:
            return {"state": "failed", "reason": self._startup_error}
        return {"state": "stopped"}

    def start(self) -> int:
        with self._lock:
            if Starlette is None or uvicorn is None:
                raise FilesHttpError("files_dependencies_missing", "Starlette and Uvicorn are required for the private files API")
            if self._thread is not None and self._thread.is_alive() and self._server is not None and self._server.started:
                return self._port
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
                sock.bind(("127.0.0.1", 0))
                sock.listen(128)
                sock.setblocking(False)
                self._port = int(sock.getsockname()[1])
                self._socket = sock
                config = uvicorn.Config(self._app(), host="127.0.0.1", port=self._port,
                                        log_level="critical", access_log=False, lifespan="off")
                server = uvicorn.Server(config)
                thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]},
                                          name="tether-files-http", daemon=True)
                self._server, self._thread, self._startup_error = server, thread, ""
                thread.start()
            except Exception as exc:
                sock.close()
                self._socket = None
                self._server = self._thread = None
                self._startup_error = "files_server_start_failed"
                raise FilesHttpError(self._startup_error, "private files API could not start") from exc
        import time
        until = time.monotonic() + 5
        while time.monotonic() < until:
            if self._server is not None and self._server.started:
                return self._port
            if self._thread is None or not self._thread.is_alive():
                break
            time.sleep(0.05)
        with self._lock:
            self._startup_error = "files_server_start_failed"
            self.stop()
        raise FilesHttpError("files_server_start_failed", "private files API did not become ready")

    def stop(self) -> bool:
        with self._lock:
            server, thread, sock = self._server, self._thread, self._socket
            if server is not None:
                server.should_exit = True
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5)
        stopped = thread is None or not thread.is_alive()
        if stopped:
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
            with self._lock:
                self._server = self._thread = self._socket = None
                self._port = 0
        return stopped

    def _app(self):
        return Starlette(routes=[
            Route("/api/files/v1/list", self._list, methods=["POST"]),
            Route("/api/files/v1/stat", self._stat, methods=["POST"]),
            Route("/api/files/v1/drives", self._drives, methods=["POST"]),
            Route("/api/files/v1/workspaces", self._workspaces, methods=["POST"]),
            Route("/api/files/v1/fingerprint", self._fingerprint, methods=["POST"]),
            Route("/api/files/v1/copy", self._copy, methods=["POST"]),
            Route("/api/files/v1/mkdir", self._mkdir, methods=["POST"]),
            Route("/api/files/v1/rename", self._rename, methods=["POST"]),
            Route("/api/files/v1/delete", self._delete, methods=["POST"]),
            Route("/api/files/v1/preview", self._preview, methods=["POST"]),
            Route("/api/files/v1/preview/content", self._preview_content, methods=["GET"]),
            Route("/api/files/v1/content", self._content, methods=["GET", "PUT"]),
        ])

    def _authorize(self, request: Request):
        worker = self.service_access.authenticated_files_worker(request.headers, request.headers.get("host", ""),
                                                               request.method)
        if worker is None:
            return None, self._error(401, "file grant is not active", "grant_missing")
        authority = getattr(worker, "authority", {})
        has_read, has_write = "read_roots" in authority, "write_roots" in authority
        if has_read != has_write:
            return None, self._error(403, "file grant roots are incomplete", "shared_scope_denied")
        if has_read:
            if not isinstance(authority.get("read_roots"), list) or not isinstance(authority.get("write_roots"), list):
                return None, self._error(403, "file grant roots are invalid", "shared_scope_denied")
            scope = {"read_roots": list(authority["read_roots"]),
                     "write_roots": list(authority["write_roots"])}
        else:
            scope = {"_owner_policy": True}
        scope.update({"actor_id": worker.actor_id, "grant_id": worker.grant_id,
                      "operation_id": authority.get("operation_id"),
                      "_grant_check": lambda: self.service_access.assert_active_worker(worker)})
        token = self.fs._hub_file_scope.set(scope)
        return (worker, scope, token), None

    async def _json_args(self, request: Request) -> dict[str, Any]:
        length = int(request.headers.get("content-length") or 0)
        if length > 64 * 1024:
            raise FilesHttpError("bad_args", "files metadata request is too large")
        try:
            value = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise FilesHttpError("bad_args", "files metadata request must be JSON") from None
        if not isinstance(value, dict):
            raise FilesHttpError("bad_args", "files metadata request must be a JSON object")
        return value

    async def _call(self, request: Request, op: str, args: dict[str, Any]):
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, _scope, token = context
        try:
            result = await asyncio.to_thread(self._dispatch_worker, worker, op, args)
            self.service_access.assert_active_worker(worker)
            return JSONResponse({"target_id": self.fs.device, **result})
        except Exception as exc:
            return self._exception(exc)
        finally:
            self.fs._hub_file_scope.reset(token)

    def _dispatch_worker(self, worker: Any, op: str, args: dict[str, Any]):
        if op in self.WRITE_OPS:
            with self.service_access.publish_guard(worker):
                return self.fs.dispatch(op, args)
        return self.fs.dispatch(op, args)

    async def _list(self, request: Request):
        try:
            return await self._call(request, "list", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _stat(self, request: Request):
        try:
            return await self._call(request, "stat", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _drives(self, request: Request):
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, scope, token = context
        try:
            result = await asyncio.to_thread(self.fs.dispatch, "drives", {})
            if not scope.get("_owner_policy"):
                roots = self.fs._scope_roots(scope, "read_roots", required=True)
                visible = []
                for root in roots:
                    try:
                        await asyncio.to_thread(self.fs._read_guard, root)
                        visible.append({"name": root.name or str(root), "path": str(root)})
                    except Exception:
                        continue
                result = {"drives": visible}
            self.service_access.assert_active_worker(worker)
            return JSONResponse({"target_id": self.fs.device, **result})
        except Exception as exc:
            return self._exception(exc)
        finally:
            self.fs._hub_file_scope.reset(token)

    async def _workspaces(self, request: Request):
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, scope, token = context
        try:
            result = await asyncio.to_thread(self.fs.dispatch, "workspaces", {})
            if not scope.get("_owner_policy"):
                roots = self.fs._scope_roots(scope, "read_roots", required=True)
                visible = []
                for item in result.get("workspaces", []):
                    try:
                        candidate = Path(item["path"]).resolve()
                        from .fs_service import _inside
                        if any(_inside(candidate, root) for root in roots):
                            self.fs._read_guard(candidate)
                            visible.append(item)
                    except Exception:
                        continue
                from .fs_service import _inside
                result = {"root": str(self.fs.workspaces_root) if any(_inside(self.fs.workspaces_root, r) for r in roots) else "",
                          "node_workspace": str(self.fs.workspace) if any(_inside(self.fs.workspace, r) for r in roots) else "",
                          "workspaces": visible}
            self.service_access.assert_active_worker(worker)
            return JSONResponse({"target_id": self.fs.device, **result})
        except Exception as exc:
            return self._exception(exc)
        finally:
            self.fs._hub_file_scope.reset(token)

    async def _fingerprint(self, request: Request):
        try:
            return await self._call(request, "destination_fingerprint", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _copy(self, request: Request):
        try:
            return await self._call(request, "copy", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _mkdir(self, request: Request):
        try:
            return await self._call(request, "mkdir", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _rename(self, request: Request):
        try:
            return await self._call(request, "rename", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _delete(self, request: Request):
        try:
            return await self._call(request, "delete", await self._json_args(request))
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)

    async def _preview(self, request: Request):
        try:
            args = await self._json_args(request)
        except FilesHttpError as exc:
            return self._error(400, str(exc), exc.code)
        context, error = self._authorize(request)
        if error is not None:
            return error
        _worker, _scope, token = context
        try:
            result = await asyncio.to_thread(self.fs.dispatch, "preview", args)
            binary_payload = result.pop("base64", None)
            is_summary = Path(str(result.get("path") or "")).suffix.lower() in {".zip", ".xlsx", ".xlsm"}
            if result.get("kind") in {"text", "markdown"} and not is_summary:
                result.pop("text", None)
                result["content_url"] = "/api/files/v1/preview/content?" + urlencode(
                    {"path": result["path"], "version": result["version"]})
            elif binary_payload is not None:
                result["content_url"] = "/api/files/v1/preview/content?" + urlencode(
                    {"path": result["path"], "version": result["version"]})
            self.service_access.assert_active_worker(_worker)
            return JSONResponse({"target_id": self.fs.device, **result})
        except Exception as exc:
            return self._exception(exc)
        finally:
            self.fs._hub_file_scope.reset(token)

    async def _preview_content(self, request: Request):
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, scope, token = context
        path = request.query_params.get("path") or ""
        version = request.query_params.get("version") or ""
        self.fs._hub_file_scope.reset(token)
        token = None
        try:
            meta, token = await self._scoped_dispatch(worker, "preview", {"path": path})
            if meta.get("version") != version:
                raise FilesHttpError("conflict", "preview source changed")
            kind = str(meta.get("kind") or "")
            if kind in {"text", "markdown"} and Path(path).suffix.lower() not in {".zip", ".xlsx", ".xlsm"}:
                body = str(meta.get("text") or "").encode("utf-8")
                content_type = "text/markdown; charset=utf-8" if kind == "markdown" else "text/plain; charset=utf-8"
            elif meta.get("base64"):
                body = base64.b64decode(meta["base64"], validate=True)
                content_type = str(meta.get("mime") or "application/octet-stream")
            else:
                return self._error(404, "this preview has no raw content", "preview_unavailable")
            self.service_access.assert_active_worker(worker)
            headers = {"ETag": self._etag(version), "X-Tether-Target-Id": str(self.fs.device),
                       "X-Tether-Preview-Kind": kind,
                       "X-Tether-Preview-Converted": "true" if meta.get("converted") else "false",
                       "X-Tether-Preview-Version": str(meta.get("version") or ""),
                       "X-Tether-Preview-Size": str(meta.get("size") or 0)}
            if meta.get("encoding") in {"utf-8", "utf-8-bom", "utf-16-le", "utf-16-be", "gb18030"}:
                headers["X-Tether-Text-Encoding"] = str(meta["encoding"])
            if meta.get("newline") in {"lf", "crlf", "cr"}:
                headers["X-Tether-Newline"] = str(meta["newline"])
            return Response(body, media_type=content_type, headers=headers)
        except FilesHttpError as exc:
            return self._error(409 if exc.code == "conflict" else 400, str(exc), exc.code)
        except Exception as exc:
            return self._exception(exc)
        finally:
            if token is not None:
                self.fs._hub_file_scope.reset(token)

    async def _content(self, request: Request):
        if request.method == "PUT":
            return await self._put_content(request)
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, scope, token = context
        self.fs._hub_file_scope.reset(token)
        token = None
        path = request.query_params.get("path") or ""
        try:
            start, limit, status_code, content_range = self._read_range(request)
            token = self.fs._hub_file_scope.set(scope)
            file_path = await asyncio.to_thread(self.fs._resolve, path)
            await asyncio.to_thread(self.fs._read_guard, file_path)
            stat = await asyncio.to_thread(file_path.stat)
            if not file_path.is_file():
                return self._error(400, "not a file", "not_file")
            from .fs_service import _path_version
            version = await asyncio.to_thread(_path_version, file_path)
            if start > stat.st_size or (start == stat.st_size and stat.st_size > 0):
                return Response(status_code=416, headers={"Content-Range": f"bytes */{stat.st_size}"})
            length = min(limit, max(0, stat.st_size - start))
            partial = (request.headers.get("range") is not None or
                       request.query_params.get("offset") is not None or
                       request.query_params.get("limit") is not None or length < stat.st_size)
            if partial:
                content_range = f"bytes {start}-{start + length - 1}/{stat.st_size}" if length else f"bytes */{stat.st_size}"
            headers = {"ETag": self._etag(version), "Accept-Ranges": "bytes",
                       "Content-Length": str(length), "X-Tether-Target-Id": str(self.fs.device)}
            if content_range is not None:
                headers["Content-Range"] = content_range
            if not partial:
                status_code = 200

            async def chunks():
                read_token = self.fs._hub_file_scope.set(scope)
                try:
                    with file_path.open("rb") as stream:
                        stream.seek(start)
                        remaining = length
                        while remaining:
                            self.service_access.assert_active_worker(worker)
                            await asyncio.to_thread(self.fs._read_guard, file_path)
                            chunk = await asyncio.to_thread(stream.read, min(256 * 1024, remaining))
                            if not chunk:
                                break
                            remaining -= len(chunk)
                            yield chunk
                finally:
                    self.fs._hub_file_scope.reset(read_token)

            return StreamingResponse(chunks(), status_code=status_code, media_type="application/octet-stream", headers=headers)
        except Exception as exc:
            return self._exception(exc)
        finally:
            if token is not None:
                self.fs._hub_file_scope.reset(token)

    async def _put_content(self, request: Request):
        context, error = self._authorize(request)
        if error is not None:
            return error
        worker, scope, token = context
        path = request.query_params.get("path") or ""
        expected = request.headers.get("x-tether-expected-version")
        if expected != "absent" and (not expected or len(expected) != 64 or
                                     any(char not in "0123456789abcdefABCDEF" for char in expected)):
            self.fs._hub_file_scope.reset(token)
            return self._error(400, "X-Tether-Expected-Version must be a SHA-256 digest or absent", "bad_args")
        raw_length = request.headers.get("content-length")
        try:
            total = int(raw_length) if raw_length is not None else -1
        except ValueError:
            total = -1
        if total < 0 or total > 64 * 1024 * 1024 * 1024:
            self.fs._hub_file_scope.reset(token)
            return self._error(413, "upload length is missing or out of range", "too_large")
        content_type = request.headers.get("content-type", "").lower()
        text_write = content_type.startswith("text/plain")
        try:
            if text_write:
                if "charset=utf-8" not in content_type or total > 512 * 1024:
                    return self._error(413, "text uploads must be UTF-8 and within the editable size limit", "too_large")
                encoding = request.headers.get("x-tether-text-encoding") or ""
                newline = request.headers.get("x-tether-newline") or ""
                parts = bytearray()
                async for chunk in request.stream():
                    self.service_access.assert_active_worker(worker)
                    if len(parts) + len(chunk) > 512 * 1024:
                        return self._error(413, "text upload exceeds the editable size limit", "too_large")
                    parts.extend(chunk)
                if len(parts) != total:
                    raise FilesHttpError("bad_args", "upload does not match its declared length")
                try:
                    text = parts.decode("utf-8")
                except UnicodeDecodeError:
                    return self._error(400, "text upload is not valid UTF-8", "bad_args")
                result = await asyncio.to_thread(self._dispatch_worker, worker, "write", {
                    "path": path, "text": text, "encoding": encoding, "newline": newline,
                    "expected_version": expected,
                })
            else:
                if content_type.split(";", 1)[0].strip() != "application/octet-stream":
                    return self._error(415, "binary uploads require application/octet-stream", "bad_content_type")
                import secrets
                writer = await asyncio.to_thread(self.fs.open_write_stream, path, secrets.token_hex(8),
                                                 total, expected != "absent", expected_version=expected,
                                                 discard_on_abort=True)
                received = 0
                async for chunk in request.stream():
                    self.service_access.assert_active_worker(worker)
                    received += len(chunk)
                    if received > total:
                        raise FilesHttpError("bad_args", "upload exceeds its declared length")
                    if chunk:
                        await asyncio.to_thread(writer.write, chunk)
                if received != total:
                    raise FilesHttpError("bad_args", "upload does not match its declared length")
                def finish_write():
                    with self.service_access.publish_guard(worker):
                        return writer.finish()
                result = await asyncio.to_thread(finish_write)
                result = {key: result[key] for key in ("path", "size", "mtime", "version") if key in result}
                result.update({"bytes": total})
            self.service_access.assert_active_worker(worker)
            version = str(result.get("version") or "")
            return JSONResponse({"target_id": self.fs.device, **result}, headers={"ETag": self._etag(version)})
        except Exception as exc:
            if "writer" in locals():
                await asyncio.to_thread(writer.abort)
            return self._exception(exc)
        finally:
            self.fs._hub_file_scope.reset(token)

    async def _scoped_dispatch(self, worker: Any, op: str, args: dict[str, Any]):
        authority = worker.authority
        if "read_roots" in authority:
            scope = {"read_roots": list(authority["read_roots"]), "write_roots": list(authority["write_roots"])}
        else:
            scope = {"_owner_policy": True}
        scope.update({"actor_id": worker.actor_id, "grant_id": worker.grant_id,
                      "operation_id": authority.get("operation_id"),
                      "_grant_check": lambda: self.service_access.assert_active_worker(worker)})
        token = self.fs._hub_file_scope.set(scope)
        try:
            result = await asyncio.to_thread(self.fs.dispatch, op, args)
            return result, token
        except Exception:
            self.fs._hub_file_scope.reset(token)
            raise

    def _read_range(self, request: Request) -> tuple[int, int, int, str | None]:
        from .fs_service import MAX_READ
        offset_value = request.query_params.get("offset")
        limit_value = request.query_params.get("limit")
        range_header = request.headers.get("range")
        if range_header:
            if offset_value is not None or limit_value is not None or not range_header.startswith("bytes=") or "," in range_header:
                raise FilesHttpError("bad_range", "only one byte range may be requested")
            left, sep, right = range_header[6:].partition("-")
            if not sep or not left.isdigit() or (right and not right.isdigit()):
                raise FilesHttpError("bad_range", "invalid byte range")
            start = int(left)
            end = int(right) if right else start + MAX_READ - 1
            if end < start:
                raise FilesHttpError("bad_range", "invalid byte range")
            return start, min(MAX_READ, end - start + 1), 206, "range"
        try:
            start = max(0, int(offset_value or 0))
            limit = min(MAX_READ, max(1, int(limit_value or MAX_READ)))
        except ValueError:
            raise FilesHttpError("bad_range", "offset and limit must be integers") from None
        return start, limit, 206, None

    @staticmethod
    def _etag(version: str) -> str:
        return '"' + version + '"'

    @staticmethod
    def _error(status: int, message: str, code: str):
        return JSONResponse({"detail": {"error": message, "code": code}}, status_code=status)

    def _exception(self, exc: Exception):
        code = getattr(exc, "code", "files_error")
        status = 403 if code in {"denied", "shared_scope_denied", "trusted_hub_required", "grant_revoked"} else (
            404 if code == "not_found" else 409 if code in {"conflict", "exists"} else 400)
        return self._error(status, str(exc), str(code))
