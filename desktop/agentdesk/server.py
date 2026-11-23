"""WebSocket 服务：对网页暴露 MCP 语义（initialize / tools/list / tools/call）。"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from . import tools
from .config import ORIGIN_HINT, Settings
from .mcp_bridge import McpHub
from .sandbox import Sandbox
from .tools import ToolContext


@dataclass
class LogEntry:
    at: str
    tool: str
    detail: str
    ms: int
    ok: bool
    client: str = ""


@dataclass
class AppState:
    settings: Settings
    hub: McpHub
    connections: int = 0
    calls: int = 0
    failures: int = 0
    logs: deque[LogEntry] = field(default_factory=lambda: deque(maxlen=120))
    started_at: float = field(default_factory=time.time)
    clients: dict[str, str] = field(default_factory=dict)

    def log(self, tool: str, detail: str, ms: int, ok: bool, client: str = "") -> None:
        self.calls += 1
        if not ok:
            self.failures += 1
        self.logs.append(
            LogEntry(
                at=time.strftime("%H:%M:%S"),
                tool=tool,
                detail=detail,
                ms=ms,
                ok=ok,
                client=client,
            )
        )


def origin_allowed(origin: str | None, extras: list[str]) -> bool:
    if not origin:
        return True
    if origin == "null":
        return True
    parsed = urlparse(origin)
    host = parsed.hostname or ""
    if parsed.scheme in ("http", "https") and host in ("localhost", "127.0.0.1", "::1"):
        return True
    if parsed.scheme == "https" and (host.endswith(".github.io") or host == "github.io"):
        return True
    for extra in extras:
        if extra == origin:
            return True
        if extra.startswith("*.") and host.endswith(extra[1:]):
            return True
    return False


class StaticHandler(SimpleHTTPRequestHandler):
    """托管 dist；找不到的路径回落到 index.html，支持前端路由。"""

    def log_message(self, *args: Any) -> None:  # noqa: D102 - 静默访问日志
        return

    def do_GET(self) -> None:  # noqa: N802 - 标准库约定
        target = Path(self.translate_path(self.path))
        if self.path != "/" and not target.exists():
            self.path = "/index.html"
        super().do_GET()


def start_static_server(root: Path, port: int) -> ThreadingHTTPServer:
    handler = lambda *args, **kwargs: StaticHandler(*args, directory=str(root), **kwargs)  # noqa: E731
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class AgentServer:
    def __init__(self, state: AppState) -> None:
        self.state = state
        self.sandbox = Sandbox(state.settings.sandbox, state.settings.allowed_paths)
        self.static: ThreadingHTTPServer | None = None
        self._server: Any = None

    # ---------- JSON-RPC ----------
    async def handle(self, connection: ServerConnection) -> None:
        client = f"{connection.remote_address[0]}:{connection.remote_address[1]}"
        self.state.connections += 1
        self.state.clients[client] = time.strftime("%H:%M:%S")
        try:
            async for raw in connection:
                try:
                    payload = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(payload, dict):
                    continue
                if "id" not in payload:
                    continue  # 通知不需要响应
                response = await self.dispatch(payload, client)
                await connection.send(json.dumps(response, ensure_ascii=False))
        except ConnectionClosed:
            pass
        finally:
            self.state.connections = max(0, self.state.connections - 1)
            self.state.clients.pop(client, None)

    async def dispatch(self, payload: dict[str, Any], client: str) -> dict[str, Any]:
        message_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params") or {}
        try:
            if method == "initialize":
                return self._ok(message_id, {"serverInfo": self.state.settings.describe(), "protocolVersion": "2024-11-05"})
            if method == "tools/list":
                return self._ok(message_id, {"tools": self.definitions()})
            if method == "tools/call":
                name = str(params.get("name", ""))
                arguments = params.get("arguments") or {}
                if not isinstance(arguments, dict):
                    arguments = {}
                result = await self.call_tool(name, arguments, client)
                return self._ok(message_id, result)
            if method == "ping":
                return self._ok(message_id, {})
            return self._error(message_id, -32601, f"未知方法：{method}")
        except Exception as error:  # noqa: BLE001 - 兜底，避免连接中断
            return self._error(message_id, -32603, f"{type(error).__name__}: {error}")

    @staticmethod
    def _ok(message_id: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": message_id, "result": result}

    @staticmethod
    def _error(message_id: Any, code: int, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": message}}

    def definitions(self) -> list[dict[str, Any]]:
        builtin = [
            {
                "name": item["name"],
                "description": item["description"],
                "inputSchema": item["inputSchema"],
                "annotations": item.get("annotations", {}),
            }
            for item in tools.definitions()
        ]
        mcp = [
            {
                "name": item["name"],
                "description": f"[{item['server']}] {item['description']}",
                "inputSchema": item["inputSchema"],
                "annotations": item.get("annotations", {}),
                # 网页端用它把不同 stdio 服务器的工具分到不同组
                "server": item["server"],
            }
            for item in self.state.hub.definitions()
        ]
        return builtin + mcp

    async def call_tool(self, name: str, arguments: dict[str, Any], client: str) -> dict[str, Any]:
        if name.startswith("desk_mcp_"):
            started = time.monotonic()
            try:
                result = await self.state.hub.call(name, arguments)
                self.state.log(name, "本地 MCP", int((time.monotonic() - started) * 1000), not result.get("isError"), client)
                return result
            except Exception as error:  # noqa: BLE001
                self.state.log(name, str(error), int((time.monotonic() - started) * 1000), False, client)
                return {"content": [{"type": "text", "text": f"MCP 调用失败：{error}"}], "isError": True}

        context = ToolContext(
            settings=self.state.settings,
            sandbox=self.sandbox,
            log=lambda tool, detail, ms, ok: self.state.log(tool, detail, ms, ok, client),
            client=client,
        )
        return await tools.call(name, arguments, context)

    # ---------- 生命周期 ----------
    async def run(self) -> None:
        settings = self.state.settings
        if settings.web_root:
            self.static = start_static_server(settings.web_root, settings.web_port)
        self._server = await serve(
            self.handle,
            settings.host,
            settings.port,
            max_size=8 * 1024 * 1024,
            process_request=self._check_request,
            ping_interval=20,
            ping_timeout=20,
        )
        try:
            await asyncio.Future()
        finally:
            self._server.close()
            if self.static:
                self.static.shutdown()

    def _check_request(self, connection: ServerConnection, request: Any) -> Any:
        parsed = urlparse(request.path)
        if parsed.path not in ("/", "/ws"):
            return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
        token = parse_qs(parsed.query).get("token", [""])[0]
        if token != self.state.settings.token:
            return connection.respond(HTTPStatus.UNAUTHORIZED, "invalid token\n")
        origin = request.headers.get("Origin")
        if not origin_allowed(origin, self.state.settings.allowed_origins):
            return connection.respond(
                HTTPStatus.FORBIDDEN, f"origin not allowed\n{ORIGIN_HINT}\n"
            )
        return None
