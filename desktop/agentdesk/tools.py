"""桌面端内置工具：文件读写、命令执行、Python 执行。"""

from __future__ import annotations

import asyncio
import locale
import os
import platform
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import computer, tools_extra, tools_port
from .config import Settings
from .sandbox import Sandbox, SandboxError

MAX_READ_BYTES = 400_000
MAX_TIMEOUT = 600
DEFAULT_TIMEOUT = 120

# 明显不可逆的破坏性命令，即使审批通过也不执行
BLOCKED_COMMANDS = [
    r"\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\s+/(\s|$)",
    r"\bmkfs(\.\w+)?\b",
    r"\bdd\s+if=/dev/(zero|random|urandom)\s+of=/dev/[sh]d",
    r"\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b",
    r":\(\)\s*\{.*\};\s*:",
    r"\bformat\s+[a-zA-Z]:",
]


class ToolError(Exception):
    """可预期的工具错误，直接回传给模型"""


def decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", locale.getpreferredencoding(False) or "utf-8", "gbk"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", "replace")


def human_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    return f"{size / 1024 / 1024 / 1024:.2f} GB"


@dataclass
class ToolContext:
    settings: Settings
    sandbox: Sandbox
    log: Callable[[str, str, int, bool], None]
    client: str = ""


def _text(value: str, *, error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": value}], "isError": error}


def definitions() -> list[dict[str, Any]]:
    read_only = {"readOnlyHint": True}
    return _builtin_definitions() + tools_extra.definitions() + tools_port.definitions()


def _builtin_definitions() -> list[dict[str, Any]]:
    read_only = {"readOnlyHint": True}
    return [
        {
            "name": "desk_fs_read",
            "description": "读取沙箱内文件的文本内容。支持按行范围读取，超过 400KB 会截断。用于查看代码、文档、日志。也可以用绝对路径或 ~ 开头的路径读取 ~/.skills 等已放行的目录。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "相对沙箱的路径（如 src/app.tsx），或 ~/.skills/xxx/SKILL.md 这类已放行目录的路径",
                    },
                    "start_line": {"type": "number", "description": "起始行，从 1 开始"},
                    "end_line": {"type": "number", "description": "结束行（含）"},
                },
                "required": ["path"],
            },
            "annotations": {**read_only, "title": "读取文件"},
        },
        {
            "name": "desk_fs_list",
            "description": "列出沙箱内目录的内容，返回树状文本，标注文件大小。也可以列 ~/.skills 等已放行目录。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目录路径，默认沙箱根目录"},
                    "depth": {"type": "number", "description": "递归深度 1-3，默认 1"},
                },
            },
            "annotations": {**read_only, "title": "列出目录"},
        },
        {
            "name": "desk_fs_stat",
            "description": "查看文件或目录的元信息：类型、大小、修改时间、行数。",
            "inputSchema": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
            "annotations": {**read_only, "title": "文件信息"},
        },
        {
            "name": "desk_fs_write",
            "description": "在沙箱内创建或修改文本文件。会自动创建父目录；mode=append 追加到末尾。写入前请先读取原文，避免覆盖用户内容。",
            "annotations": {"title": "写入文件"},
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "目标文件路径"},
                    "content": {"type": "string", "description": "完整文本内容"},
                    "mode": {
                        "type": "string",
                        "enum": ["overwrite", "append"],
                        "description": "默认 overwrite",
                    },
                },
                "required": ["path", "content"],
            },
        },
        {
            "name": "desk_fs_delete",
            "description": "删除沙箱内的文件或目录。目录需要 recursive=true。此操作不可恢复。",
            "annotations": {"title": "删除文件"},
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "recursive": {"type": "boolean", "description": "删除非空目录时设为 true"},
                },
                "required": ["path"],
            },
        },
        {
            "name": "desk_fs_move",
            "description": "移动或重命名沙箱内的文件/目录。",
            "annotations": {"title": "移动文件"},
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                },
                "required": ["from", "to"],
            },
        },
        {
            "name": "desk_shell_exec",
            "description": "在沙箱工作目录中执行 shell 命令，返回退出码与输出。适合运行构建、测试、git、包管理等。命令在用户本机执行，调用前会请求用户确认。",
            "annotations": {"title": "执行命令"},
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "完整命令，例如 pnpm test"},
                    "cwd": {"type": "string", "description": "相对沙箱的工作目录，默认根目录"},
                    "timeout": {"type": "number", "description": "超时秒数，默认 120，最大 600"},
                },
                "required": ["command"],
            },
        },
        {
            "name": "desk_python_exec",
            "description": "在沙箱内用当前 Python 解释器执行一段代码，返回 stdout/stderr 与退出码。适合数据处理、计算、脚本验证。",
            "annotations": {"title": "执行 Python"},
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "完整的 Python 代码"},
                    "timeout": {"type": "number", "description": "超时秒数，默认 120，最大 600"},
                },
                "required": ["code"],
            },
        },
        {
            "name": "desk_system_info",
            "description": "获取本机环境信息：操作系统、Python 版本、沙箱路径、磁盘空间、可用工具。",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {**read_only, "title": "系统信息"},
        },
        {
            "name": "desk_screen_capture",
            "description": "截取整个屏幕并返回 PNG，网页会把它保存成可预览的图片产物。用于查看桌面当前状态，坐标以截图左上角为原点。",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {**read_only, "title": "截取屏幕"},
        },
        {
            "name": "desk_mouse",
            "description": "移动鼠标或点击屏幕坐标。点击前先用 desk_screen_capture 确认目标位置；坐标与截图一致，原点在左上角。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["move", "click"],
                        "description": "move 只移动，click 移动后点击，默认 click",
                    },
                    "x": {"type": "number", "description": "横坐标（像素）"},
                    "y": {"type": "number", "description": "纵坐标（像素）"},
                    "button": {
                        "type": "string",
                        "enum": ["left", "right", "middle"],
                        "description": "默认 left",
                    },
                    "clicks": {"type": "number", "description": "点击次数 1-3，默认 1"},
                },
                "required": ["x", "y"],
            },
            "annotations": {"title": "鼠标操作"},
        },
        {
            "name": "desk_keyboard",
            "description": "向当前焦点窗口输入文本或发送组合键。中文会自动走剪贴板粘贴；发送前请先用 desk_window 聚焦目标窗口。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["type", "press"],
                        "description": "type 输入文本，press 发送组合键，默认 type",
                    },
                    "text": {"type": "string", "description": "要输入的文本"},
                    "keys": {"type": "string", "description": "组合键，如 ctrl+s、Return、Escape"},
                    "submit": {"type": "boolean", "description": "输入完成后是否回车"},
                },
            },
            "annotations": {"title": "键盘输入"},
        },
        {
            "name": "desk_window",
            "description": "列出当前可见窗口，或按标题聚焦某个窗口。聚焦支持部分匹配。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "focus"],
                        "description": "默认 list",
                    },
                    "title": {"type": "string", "description": "focus 时的窗口标题"},
                },
            },
            "annotations": {"title": "窗口管理"},
        },
    ]


def _is_blocked(command: str) -> str | None:
    for pattern in BLOCKED_COMMANDS:
        if re.search(pattern, command):
            return pattern
    return None


async def _run(
    command: list[str] | str,
    *,
    shell: bool,
    cwd: Path,
    timeout: int,
    context: ToolContext,
) -> tuple[int, str]:
    started = time.monotonic()
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    if shell:
        process = await asyncio.create_subprocess_shell(
            str(command),
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
    else:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        elapsed = int((time.monotonic() - started) * 1000)
        context.log("timeout", f"超过 {timeout}s", elapsed, False)
        raise ToolError(f"命令执行超时（{timeout} 秒），进程已被终止。") from None
    text = decode_bytes(output or b"")
    limit = context.settings.max_output
    if len(text) > limit:
        text = text[:limit] + f"\n\n…（输出超过 {limit} 字符，已截断）"
    return process.returncode or 0, text


async def call(name: str, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    started = time.monotonic()
    try:
        result = await _dispatch(name, args, context)
        elapsed = int((time.monotonic() - started) * 1000)
        context.log(name, _summary(args), elapsed, not result.get("isError", False))
        return result
    except (ToolError, SandboxError, computer.ComputerError, tools_extra.ExtraToolError) as error:
        elapsed = int((time.monotonic() - started) * 1000)
        context.log(name, str(error), elapsed, False)
        return _text(str(error), error=True)
    except Exception as error:  # noqa: BLE001 - 工具异常需回传模型
        elapsed = int((time.monotonic() - started) * 1000)
        context.log(name, f"{type(error).__name__}: {error}", elapsed, False)
        return _text(f"{type(error).__name__}: {error}", error=True)


def _summary(args: dict[str, Any]) -> str:
    for key in ("path", "command", "from", "code", "cwd"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip().replace("\n", " ")
            return text if len(text) <= 60 else text[:60] + "…"
    return ""


async def _dispatch(name: str, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    sandbox = context.sandbox
    settings = context.settings

    # 扩展工具集：哈希、检索、压缩包、JSON、网络、进程、文本、剪贴板、git
    extended = await tools_extra.dispatch(name, args, sandbox, settings)
    if extended is not None:
        return extended

    # 从 one_cedric 移植的工具集：检索、计算、时间、编码、数据、文档、图片、二维码
    ported = await tools_port.dispatch(name, args, sandbox, settings)
    if ported is not None:
        return ported

    if name == "desk_system_info":
        usage = shutil.disk_usage(sandbox.root)
        allowed = "、".join(sandbox.label(path) for path in sandbox.allowed) or "无"
        return _text(
            "\n".join(
                [
                    f"系统：{platform.platform()}",
                    f"Python：{sys.version.split()[0]}（{sys.executable}）",
                    f"沙箱：{sandbox.root}",
                    f"额外放行：{allowed}",
                    f"磁盘：可用 {human_size(usage.free)} / 共 {human_size(usage.total)}",
                    f"Shell：{'允许' if settings.allow_shell else '已禁用'}",
                    "可用工具：" + " / ".join(item["name"].removeprefix("desk_") for item in definitions()),
                ]
            )
        )

    if name == "desk_screen_capture":
        mime, data = computer.capture_screen()
        payload = computer.as_image_content(mime, data)
        try:
            width, height = computer.screen_size()
            payload["content"].append(
                {"type": "text", "text": f"屏幕分辨率 {width}×{height}，坐标原点在左上角。"}
            )
        except computer.ComputerError:
            pass
        return payload

    if name == "desk_mouse":
        action = str(args.get("action") or "click")
        x = int(args.get("x") or 0)
        y = int(args.get("y") or 0)
        if action == "move":
            return _text(computer.move_mouse(x, y))
        button = str(args.get("button") or "left")
        clicks = int(args.get("clicks") or 1)
        return _text(computer.click(x, y, button, clicks))

    if name == "desk_keyboard":
        action = str(args.get("action") or "type")
        if action == "press":
            return _text(computer.press_keys(str(args.get("keys") or "")))
        return _text(computer.type_text(str(args.get("text") or ""), bool(args.get("submit"))))

    if name == "desk_window":
        action = str(args.get("action") or "list")
        if action == "focus":
            return _text(computer.focus_window(str(args.get("title") or "")))
        windows = computer.list_windows()
        if not windows:
            return _text("没有找到可见窗口。")
        lines = [f"- {item.get('title')}" for item in windows]
        return _text("可见窗口：\n" + "\n".join(lines))

    if name == "desk_fs_read":
        path = sandbox.resolve(str(args.get("path", "")), must_exist=True)
        if path.is_dir():
            raise ToolError(f"这是一个目录：{sandbox.relative(path)}，请用 desk_fs_list")
        size = path.stat().st_size
        if size > MAX_READ_BYTES:
            raw = path.read_bytes()[:MAX_READ_BYTES]
        else:
            raw = path.read_bytes()
        if b"\x00" in raw[:4096]:
            return _text(f"{sandbox.relative(path)} 是二进制文件（{human_size(size)}），无法作为文本读取。")
        text = decode_bytes(raw)
        lines = text.splitlines()
        start = max(1, int(args.get("start_line") or 1))
        end = int(args.get("end_line") or len(lines))
        end = min(end, len(lines))
        chunk = "\n".join(lines[start - 1 : end])
        header = f"{sandbox.relative(path)}（第 {start}-{end} 行，共 {len(lines)} 行，{human_size(size)}）"
        suffix = "\n…（文件较大，仅读取前 400KB）" if size > MAX_READ_BYTES else ""
        return _text(f"{header}\n\n{chunk}{suffix}")

    if name == "desk_fs_list":
        root = sandbox.resolve(str(args.get("path") or "."))
        if not root.is_dir():
            raise ToolError(f"不是目录：{sandbox.relative(root)}")
        depth = max(1, min(3, int(args.get("depth") or 1)))
        lines: list[str] = [f"{sandbox.relative(root)}/"]
        count = 0

        def walk(directory: Path, prefix: str, level: int) -> None:
            nonlocal count
            try:
                entries = sorted(
                    directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
                )
            except OSError as error:
                lines.append(f"{prefix}└─ [无法读取：{error}]")
                return
            for index, entry in enumerate(entries):
                if count >= 400:
                    return
                count += 1
                branch = "└─" if index == len(entries) - 1 else "├─"
                if entry.is_dir():
                    lines.append(f"{prefix}{branch} {entry.name}/")
                    if level < depth:
                        walk(entry, prefix + ("   " if index == len(entries) - 1 else "│  "), level + 1)
                else:
                    try:
                        size = entry.stat().st_size
                    except OSError:
                        size = 0
                    lines.append(f"{prefix}{branch} {entry.name}  ({human_size(size)})")

        walk(root, "", 1)
        if count >= 400:
            lines.append("…（条目过多，仅显示前 400 项）")
        return _text("\n".join(lines))

    if name == "desk_fs_stat":
        path = sandbox.resolve(str(args.get("path", "")), must_exist=True)
        stat = path.stat()
        kind = "目录" if path.is_dir() else "文件"
        extra = ""
        if path.is_file():
            raw = path.read_bytes()[:8192]
            if b"\x00" not in raw:
                full = path.read_bytes() if stat.st_size <= MAX_READ_BYTES else raw
                extra = f"\n行数：约 {decode_bytes(full).count(chr(10)) + 1}"
        return _text(
            f"路径：{sandbox.relative(path)}\n类型：{kind}\n大小：{human_size(stat.st_size)}"
            f"\n修改时间：{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime))}{extra}"
        )

    if name == "desk_fs_write":
        path = sandbox.resolve(str(args.get("path", "")))
        content = args.get("content")
        if not isinstance(content, str):
            raise ToolError("content 必须是字符串")
        sandbox.ensure_parent(path)
        mode = args.get("mode", "overwrite")
        if mode == "append":
            with path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
        else:
            path.write_text(content, encoding="utf-8", newline="\n")
        action = "追加" if mode == "append" else "写入"
        return _text(
            f"已{action} {sandbox.relative(path)}（{human_size(len(content.encode('utf-8')))}，"
            f"{content.count(chr(10)) + 1} 行）"
        )

    if name == "desk_fs_delete":
        path = sandbox.resolve(str(args.get("path", "")), must_exist=True)
        if path == sandbox.root:
            raise ToolError("不能删除沙箱根目录")
        if path.is_dir():
            if args.get("recursive") is not True and any(path.iterdir()):
                raise ToolError("目录非空，需要 recursive=true 才能删除")
            shutil.rmtree(path)
        else:
            path.unlink()
        return _text(f"已删除 {sandbox.relative(path)}")

    if name == "desk_fs_move":
        source = sandbox.resolve(str(args.get("from", "")), must_exist=True)
        target = sandbox.resolve(str(args.get("to", "")))
        sandbox.ensure_parent(target)
        if target.exists():
            raise ToolError(f"目标已存在：{sandbox.relative(target)}")
        shutil.move(str(source), str(target))
        return _text(f"已移动 {sandbox.relative(source)} → {sandbox.relative(target)}")

    if name == "desk_shell_exec":
        if not settings.allow_shell:
            raise ToolError("桌面端已禁用命令执行（--no-shell）")
        command = str(args.get("command", "")).strip()
        if not command:
            raise ToolError("command 不能为空")
        blocked = _is_blocked(command)
        if blocked:
            raise ToolError("该命令包含高风险的破坏性操作，已被桌面端拒绝执行。")
        cwd = sandbox.resolve(str(args.get("cwd") or "."), must_exist=True)
        if not cwd.is_dir():
            cwd = cwd.parent
        timeout = min(MAX_TIMEOUT, max(1, int(args.get("timeout") or DEFAULT_TIMEOUT)))
        code, output = await _run(command, shell=True, cwd=cwd, timeout=timeout, context=context)
        return _text(f"退出码：{code}\n工作目录：{sandbox.relative(cwd)}\n\n{output or '（无输出）'}")

    if name == "desk_python_exec":
        code = str(args.get("code", ""))
        if not code.strip():
            raise ToolError("code 不能为空")
        timeout = min(MAX_TIMEOUT, max(1, int(args.get("timeout") or DEFAULT_TIMEOUT)))
        temp_dir = sandbox.root / ".agentdesk"
        temp_dir.mkdir(exist_ok=True)
        handle, script = tempfile.mkstemp(suffix=".py", dir=temp_dir, text=True)
        os.close(handle)
        Path(script).write_text(code, "utf-8")
        try:
            exit_code, output = await _run(
                [sys.executable, script], shell=False, cwd=sandbox.root, timeout=timeout, context=context
            )
        finally:
            try:
                Path(script).unlink()
            except OSError:
                pass
        return _text(f"退出码：{exit_code}\n\n{output or '（无输出）'}")

    raise ToolError(f"未知工具：{name}")
