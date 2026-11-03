import json
import sys


def send(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


prompt_id = None
for line in sys.stdin:
    try:
        message = json.loads(line)
    except ValueError:
        continue
    method = message.get("method")
    if message.get("id") is not None and method is None:
        if message.get("id") == 9001:
            send({"jsonrpc": "2.0", "method": "session/update", "params": {
                "sessionId": "fake-session",
                "update": {"sessionUpdate": "agent_message_chunk",
                           "content": {"type": "text", "text": "bye"}}}})
            if prompt_id is not None:
                send({"jsonrpc": "2.0", "id": prompt_id, "result": {"stopReason": "end_turn"}})
        continue
    if message.get("id") is None:
        continue
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {
            "protocolVersion": 1, "agentCapabilities": {}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"sessionId": "fake-session"}})
    elif method == "session/prompt":
        prompt_id = message["id"]
        send({"jsonrpc": "2.0", "method": "session/update", "params": {
            "sessionId": "fake-session",
            "update": {"sessionUpdate": "agent_message_chunk",
                       "content": {"type": "text", "text": "hello"}}}})
        send({"jsonrpc": "2.0", "id": 9001, "method": "session/request_permission", "params": {
            "sessionId": "fake-session",
            "toolCall": {"toolCallId": "tool-1", "title": "Run tests"},
            "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}]}})
    else:
        send({"jsonrpc": "2.0", "id": message["id"], "error": {"message": "unsupported"}})