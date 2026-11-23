"""把本地 stdio MCP 服务器挂到桌面端，网页通过桌面端间接使用它们的工具。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
from collections import deque
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "agentdesk", "version": "1.0.0"}


def sanitize(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


def spawn_command(command: str, args: list[str]) -> list[str]:
    """解析可执行文件；Windows 上 npx 等需要经由 cmd 启动。"""
    resolved = shutil.which(command)
    if resolved is None:
        if sys.platform == "win32":
            return ["cmd", "/c", command, *args]
        return [command, *args]
    if sys.platform == "win32" and resolved.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", resolved, *args]
    return [resolved, *args]


class StdioMcp:
    def __init__(self, name: str, config: dict[str, Any]) -> None:
        self.name = name
        self.config = config
        self.status = "idle"
        self.error = ""
        self.tools: list[dict[str, Any]] = []
        self.tool_map: dict[str, str] = {}
        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._next_id = 1
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr: deque[str] = deque(maxlen=20)

    @property
    def prefix(self) -> str:
        return f"desk_mcp_{sanitize(self.name)}"

    async def start(self) -> None:
        self.status = "starting"
        command = spawn_command(str(self.config.get("command", "")), [str(a) for a in self.config.get("args", [])])
        env = {**os.environ, **{str(k): str(v) for k, v in (self.config.get("env") or {}).items()}}
        try:
            self._process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except OSError as error:
            self.status = "error"
            self.error = f"无法启动：{error}"
            return

        self._reader_task = asyncio.create_task(self._read_stdout())
        asyncio.create_task(self._read_stderr())

        try:
            result = await self._request(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": CLIENT_INFO,
                },
            )
            server_info = (result or {}).get("serverInfo", {})
            self.version = str(server_info.get("version", ""))
            await self._notify("notifications/initialized")
            listing = await self._request("tools/list", {})
            tools = (listing or {}).get("tools", [])
            self.tools = []
            self.tool_map = {}
            for item in tools:
                if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                    continue
                exposed = f"{self.prefix}_{sanitize(item['name'])}"[:64]
                self.tool_map[exposed] = item["name"]
                self.tools.append(
                    {
                        "name": exposed,
                        "original": item["name"],
                        "description": item.get("description", ""),
                        "inputSchema": item.get("inputSchema") or {"type": "object", "properties": {}},
                        "annotations": item.get("annotations") or {},
                        "server": self.name,
                    }
                )
            self.status = "ready"
        except Exception as error:  # noqa: BLE001 - 单个服务器失败不影响桌面端
            self.status = "error"
            self.error = f"初始化失败：{error}"

    async def _read_stdout(self) -> None:
        assert self._process and self._process.stdout
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            try:
                message = json.loads(text)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            message_id = message.get("id")
            if isinstance(message_id, int) and message_id in self._pending:
                future = self._pending.pop(message_id)
                if not future.done():
                    if "error" in message:
                        future.set_exception(RuntimeError((message.get("error") or {}).get("message", "MCP 错误")))
                    else:
                        future.set_result(message.get("result"))

    async def _read_stderr(self) -> None:
        assert self._process and self._process.stderr
        while True:
            line = await self._process.stderr.readline()
            if not line:
                break
            self._stderr.append(line.decode("utf-8", "replace").strip())

    def _write(self, payload: dict[str, Any]) -> None:
        if not self._process or not self._process.stdin:
            raise RuntimeError("MCP 进程未启动")
        self._process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))

    async def _request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        message_id = self._next_id
        self._next_id += 1
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        self._write({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params or {}})
        return await asyncio.wait_for(future, timeout=45)

    async def _notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params or {}})

    async def call(self, exposed: str, arguments: dict[str, Any]) -> dict[str, Any]:
        original = self.tool_map.get(exposed)
        if not original:
            raise RuntimeError(f"未知工具 {exposed}")
        result = await asyncio.wait_for(
            self._request("tools/call", {"name": original, "arguments": arguments}), timeout=180
        )
        content = (result or {}).get("content")
        return {
            "content": content if isinstance(content, list) else [{"type": "text", "text": str(result)}],
            "isError": bool((result or {}).get("isError")),
        }

    async def stop(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=3)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self._process.kill()
                except ProcessLookupError:
                    pass
        self.status = "stopped"


class McpHub:
    def __init__(self) -> None:
        self.servers: dict[str, StdioMcp] = {}

    async def start_all(self, configs: dict[str, dict[str, Any]]) -> None:
        tasks = []
        for name, config in configs.items():
            server = StdioMcp(name, config)
            self.servers[name] = server
            tasks.append(server.start())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def definitions(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for server in self.servers.values():
            for tool in server.tools:
                result.append(tool)
        return result

    def find(self, exposed: str) -> StdioMcp | None:
        for server in self.servers.values():
            if exposed in server.tool_map:
                return server
        return None

    async def call(self, exposed: str, arguments: dict[str, Any]) -> dict[str, Any]:
        server = self.find(exposed)
        if not server:
            raise RuntimeError(f"没有服务器提供工具 {exposed}")
        return await server.call(exposed, arguments)

    def status(self) -> list[dict[str, Any]]:
        return [
            {
                "name": server.name,
                "status": server.status,
                "error": server.error,
                "tools": len(server.tools),
            }
            for server in self.servers.values()
        ]

    async def stop_all(self) -> None:
        await asyncio.gather(*(server.stop() for server in self.servers.values()), return_exceptions=True)
