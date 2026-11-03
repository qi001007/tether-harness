import http.client
import json

from tether.node.direct_api import DirectApi
from tether.node.fs_service import FsError


def _dispatch(op: str, args: dict) -> dict:
    if op == "read":
        return {"path": args.get("path"), "ok": True}
    raise FsError("not found", "not_found")


def _post(port: int, path: str, body: dict, token: str | None) -> tuple[int, dict]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    connection.request("POST", path, body=json.dumps(body), headers=headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


def test_direct_api_forwards_authorized_fs_operations() -> None:
    api = DirectApi(_dispatch, port=0, token="secret", allowed=("127.0.0.0/8",))
    api.start()
    try:
        status, payload = _post(api.port, "/fs/read", {"path": "/tmp/a"}, "secret")
        assert status == 200
        assert payload == {"ok": True, "value": {"path": "/tmp/a", "ok": True}}
        status, payload = _post(api.port, "/fs/missing", {}, "secret")
        assert status == 200
        assert payload["ok"] is False
        assert payload["error"]["code"] == "not_found"
    finally:
        api.stop()


def test_direct_api_rejects_missing_or_wrong_token() -> None:
    api = DirectApi(_dispatch, port=0, token="secret", allowed=("127.0.0.0/8",))
    api.start()
    try:
        assert _post(api.port, "/fs/read", {"path": "/tmp/a"}, None)[0] == 401
        assert _post(api.port, "/fs/read", {"path": "/tmp/a"}, "wrong")[0] == 401
    finally:
        api.stop()


def test_direct_api_rejects_clients_outside_the_mesh() -> None:
    api = DirectApi(_dispatch, port=0, token="secret", allowed=("10.144.0.0/24",))
    api.start()
    try:
        assert _post(api.port, "/fs/read", {"path": "/tmp/a"}, "secret")[0] == 401
    finally:
        api.stop()


def test_direct_api_health_reports_the_bound_port() -> None:
    api = DirectApi(_dispatch, port=0, token="secret", allowed=("127.0.0.0/8",))
    api.start()
    try:
        connection = http.client.HTTPConnection("127.0.0.1", api.port, timeout=5)
        connection.request("GET", "/health", headers={"Authorization": "Bearer secret"})
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        assert response.status == 200
        assert payload["ok"] is True
        assert payload["port"] == api.port
    finally:
        api.stop()