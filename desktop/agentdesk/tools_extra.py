"""扩展工具集：哈希/编码、文本检索、压缩包、JSON、网络探测、进程、剪贴板、Git。

这些工具全部只依赖标准库，可选依赖缺失时降级而不是报错。
数据流向：模型 → 桌面端 → 本机，因此每个工具都要过沙箱路径校验。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

from .config import Settings
from .sandbox import Sandbox, SandboxError

MAX_GREP_FILES = 2000
MAX_GREP_HITS = 200
MAX_ARCHIVE_ENTRIES = 500
MAX_TEXT_BYTES = 2_000_000


class ExtraToolError(Exception):
    """可预期的失败，直接把文案回传模型"""


def _text(value: str, *, error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": value}], "isError": error}


def _human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


def _read_text(path: Path, limit: int = MAX_TEXT_BYTES) -> str:
    raw = path.read_bytes()[:limit]
    for encoding in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def definitions() -> list[dict[str, Any]]:
    read_only = {"readOnlyHint": True}
    return [
        {
            "name": "desk_hash",
            "description": "计算摘要或做过编码转换：md5/sha1/sha256/sha512、base64 编解码、生成 uuid。text 与 path 二选一。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["hash", "base64_encode", "base64_decode", "uuid"],
                        "description": "默认 hash",
                    },
                    "algorithm": {
                        "type": "string",
                        "enum": ["md5", "sha1", "sha256", "sha512"],
                        "description": "action=hash 时的算法，默认 sha256",
                    },
                    "text": {"type": "string", "description": "要处理的文本"},
                    "path": {"type": "string", "description": "要处理的文件（沙箱内）"},
                },
            },
            "annotations": {**read_only, "title": "哈希与编码"},
        },
        {
            "name": "desk_grep",
            "description": "在沙箱里按正则搜索文件内容，返回命中的文件、行号与该行内容。适合定位代码位置，比逐个读文件快得多。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Python 正则"},
                    "path": {"type": "string", "description": "搜索目录，默认沙箱根目录"},
                    "glob": {"type": "string", "description": "文件名通配，例如 *.ts"},
                    "ignore_case": {"type": "boolean", "description": "忽略大小写"},
                    "max_hits": {"type": "number", "description": "最多返回多少条，默认 80"},
                },
                "required": ["pattern"],
            },
            "annotations": {**read_only, "title": "内容检索"},
        },
        {
            "name": "desk_archive",
            "description": "处理 zip：list 列出条目，extract 解压到沙箱内目录（自动防止路径穿越），create 把若干文件/目录打包。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "extract", "create"], "description": "默认 list"},
                    "path": {"type": "string", "description": "zip 文件路径"},
                    "target": {"type": "string", "description": "extract 的目标目录，默认与 zip 同级"},
                    "sources": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "create 时要打包的路径列表",
                    },
                },
                "required": ["action", "path"],
            },
            "annotations": {"title": "压缩包"},
        },
        {
            "name": "desk_json_query",
            "description": "读取 JSON 文件或文本并用点号路径取值，例如 data.items.0.name。返回命中值（过长会截断）与类型。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "JSON 文件路径"},
                    "text": {"type": "string", "description": "直接给 JSON 文本，优先于 path"},
                    "query": {"type": "string", "description": "点号路径，留空返回顶层键"},
                },
            },
            "annotations": {**read_only, "title": "JSON 查询"},
        },
        {
            "name": "desk_net_probe",
            "description": "网络诊断：http 发请求看状态码/耗时/响应头，dns 解析域名，tcp 检测端口是否可连。只做只读探测。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["http", "dns", "tcp"], "description": "默认 http"},
                    "url": {"type": "string", "description": "http 时的地址"},
                    "host": {"type": "string", "description": "dns/tcp 时的主机名或 IP"},
                    "port": {"type": "number", "description": "tcp 端口"},
                    "method": {"type": "string", "description": "http 方法，默认 GET"},
                    "timeout": {"type": "number", "description": "超时秒数，默认 8"},
                },
            },
            "annotations": {**read_only, "title": "网络探测"},
        },
        {
            "name": "desk_process_list",
            "description": "列出本机占用最高的进程（CPU/内存）。有 psutil 时信息更准，没有时退回 ps/tasklist。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {"type": "number", "description": "返回条数，默认 15"},
                    "sort": {"type": "string", "enum": ["cpu", "memory"], "description": "默认 memory"},
                },
            },
            "annotations": {**read_only, "title": "进程列表"},
        },
        {
            "name": "desk_text_stats",
            "description": "统计文本的行数、字符数、词数、字节数与（粗略）token 数。可以针对文件，也可以直接给一段文本。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "text": {"type": "string", "description": "直接给文本"},
                },
            },
            "annotations": {**read_only, "title": "文本统计"},
        },
        {
            "name": "desk_clipboard",
            "description": "读取或写入系统剪贴板。读剪贴板可能涉及隐私，调用前会请求确认。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["read", "write"], "description": "默认 read"},
                    "text": {"type": "string", "description": "action=write 时要写入的文本"},
                },
            },
            "annotations": {"title": "剪贴板"},
        },
        {
            "name": "desk_workspace",
            "description": "查看或切换本机工作区。工作区是文件工具的相对路径根目录，一次只有一个生效。切换后先用 desk_fs_list 确认内容。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "use"], "description": "默认 list"},
                    "path": {"type": "string", "description": "use 时的目标路径，必须在配置的可用工作区里"},
                },
            },
            "annotations": {"title": "工作区"},
        },
        {
            "name": "desk_git",
            "description": "在沙箱仓库里执行常用 git 查询：status、log、diff、branch、show。只读命令，不会提交或改写历史。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["status", "log", "diff", "branch", "show"],
                        "description": "默认 status",
                    },
                    "cwd": {"type": "string", "description": "仓库目录，默认沙箱根目录"},
                    "target": {"type": "string", "description": "log/show 的 revision 或 diff 的路径"},
                    "limit": {"type": "number", "description": "log 条数，默认 15"},
                },
            },
            "annotations": {**read_only, "title": "Git 查询"},
        },
    ]


# ---------- 具体实现 ----------


def _hash(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = str(args.get("action") or "hash")
    if action == "uuid":
        return _text(f"uuid4：{uuid.uuid4()}")

    text = args.get("text")
    path = args.get("path")
    if text is None and not path:
        raise ExtraToolError("text 与 path 至少提供一个")
    if text is not None:
        data = str(text).encode("utf-8")
        source = f"文本（{len(data)} 字节）"
    else:
        file_path = sandbox.resolve(str(path), must_exist=True)
        if file_path.is_dir():
            raise ExtraToolError(f"{sandbox.relative(file_path)} 是目录")
        data = file_path.read_bytes()
        source = f"{sandbox.relative(file_path)}（{_human(len(data))}）"

    if action == "base64_encode":
        return _text(f"base64（{source}）：\n{base64.b64encode(data).decode()}")
    if action == "base64_decode":
        try:
            decoded = base64.b64decode(data, validate=True)
        except Exception as error:  # noqa: BLE001 - 输入不合法
            raise ExtraToolError(f"不是合法的 base64：{error}") from error
        return _text(f"解码结果（{len(decoded)} 字节）：\n{decoded.decode('utf-8', 'replace')[:4000]}")

    algorithm = str(args.get("algorithm") or "sha256").lower()
    if algorithm not in {"md5", "sha1", "sha256", "sha512"}:
        raise ExtraToolError(f"不支持的算法：{algorithm}")
    digest = hashlib.new(algorithm, data).hexdigest()
    return _text(f"{algorithm}（{source}）：\n{digest}")


def _grep(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    pattern = str(args.get("pattern") or "")
    if not pattern:
        raise ExtraToolError("pattern 不能为空")
    flags = re.IGNORECASE if args.get("ignore_case") else 0
    try:
        regex = re.compile(pattern, flags)
    except re.error as error:
        raise ExtraToolError(f"正则写法有误：{error}") from error

    root = sandbox.resolve(str(args.get("path") or "."), must_exist=True)
    if not root.is_dir():
        raise ExtraToolError(f"{sandbox.relative(root)} 不是目录")
    glob = str(args.get("glob") or "").strip()
    max_hits = max(1, min(MAX_GREP_HITS, int(args.get("max_hits") or 80)))

    hits: list[str] = []
    scanned = 0
    binary_skipped = 0
    for current, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in {".git", "node_modules", "__pycache__", ".venv", "dist", "build"}]
        for name in files:
            if glob and not Path(name).match(glob):
                continue
            path = Path(current) / name
            scanned += 1
            if scanned > MAX_GREP_FILES or len(hits) >= max_hits:
                break
            try:
                if path.stat().st_size > 800_000:
                    continue
                raw = path.read_bytes()
            except OSError:
                continue
            if b"\x00" in raw[:2048]:
                binary_skipped += 1
                continue
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                content = raw.decode("utf-8", "replace")
            for number, line in enumerate(content.splitlines(), start=1):
                if regex.search(line):
                    snippet = line.strip()
                    if len(snippet) > 200:
                        snippet = snippet[:200] + "…"
                    hits.append(f"{sandbox.relative(path)}:{number}: {snippet}")
                    if len(hits) >= max_hits:
                        break
        if scanned > MAX_GREP_FILES or len(hits) >= max_hits:
            break

    if not hits:
        return _text(f"在 {sandbox.relative(root)} 下扫描 {scanned} 个文件，没有命中「{pattern}」。")
    more = "\n…（已达上限，可缩小范围或调大 max_hits）" if len(hits) >= max_hits else ""
    skipped = f"，跳过 {binary_skipped} 个二进制文件" if binary_skipped else ""
    return _text(f"命中 {len(hits)} 处（扫描 {scanned} 个文件{skipped}）：\n" + "\n".join(hits) + more)


def _safe_extract(zip_path: Path, target: Path) -> list[str]:
    written: list[str] = []
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            # 防路径穿越：解析后必须仍在目标目录内
            destination = (target / name).resolve()
            if target.resolve() not in destination.parents and destination != target.resolve():
                raise ExtraToolError(f"压缩包内含越界路径，已中止：{name}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, open(destination, "wb") as sink:
                shutil.copyfileobj(source, sink)
            written.append(name)
            if len(written) >= MAX_ARCHIVE_ENTRIES:
                break
    return written


def _archive(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = str(args.get("action") or "list")
    path = sandbox.resolve(str(args.get("path") or ""))
    if action == "extract":
        source = sandbox.resolve(str(args.get("path") or ""), must_exist=True)
        target = sandbox.resolve(str(args.get("target") or source.with_suffix("")))
        target.mkdir(parents=True, exist_ok=True)
        written = _safe_extract(source, target)
        return _text(f"已解压 {len(written)} 个文件到 {sandbox.relative(target)}：\n" + "\n".join(written[:60]))
    if action == "create":
        sources = args.get("sources") or []
        if not isinstance(sources, list) or not sources:
            raise ExtraToolError("create 需要 sources 列表")
        path.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for raw in sources:
                item = sandbox.resolve(str(raw), must_exist=True)
                if item.is_file():
                    inside = sandbox.root in item.parents
                    archive.write(item, item.relative_to(sandbox.root).as_posix() if inside else item.name)
                    count += 1
                    continue
                for child in item.rglob("*"):
                    if child.is_file():
                        archive.write(child, child.relative_to(sandbox.root).as_posix())
                        count += 1
        return _text(f"已打包 {count} 个文件到 {sandbox.relative(path)}（{_human(path.stat().st_size)}）")

    source = sandbox.resolve(str(args.get("path") or ""), must_exist=True)
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        lines = [
            f"{info.filename}（{_human(info.file_size)}）" for info in infos[:MAX_ARCHIVE_ENTRIES]
        ]
    header = f"{sandbox.relative(source)}：{len(infos)} 个条目"
    return _text(header + "\n" + "\n".join(lines))


def _query_json(data: Any, query: str) -> Any:
    current = data
    if not query:
        return current
    for part in query.split("."):
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError) as error:
                raise ExtraToolError(f"列表下标无效：{part}") from error
            continue
        if isinstance(current, dict):
            if part not in current:
                raise ExtraToolError(f"键不存在：{part}（可用键：{', '.join(list(current)[:12])}）")
            current = current[part]
            continue
        raise ExtraToolError(f"{part} 之前的值不是对象或数组")
    return current


def _json_query(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    raw = args.get("text")
    if raw is None:
        path = sandbox.resolve(str(args.get("path") or ""), must_exist=True)
        raw = _read_text(path, 8_000_000)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ExtraToolError(f"JSON 解析失败：{error}") from error
    query = str(args.get("query") or "").strip()
    value = _query_json(data, query)
    rendered = json.dumps(value, ensure_ascii=False, indent=2)
    if len(rendered) > 6000:
        rendered = rendered[:6000] + "\n…（已截断）"
    kind = type(value).__name__
    return _text(f"{query or '<root>'} → {kind}\n{rendered}")


def _net_probe(args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "http")
    timeout = max(1, min(30, int(args.get("timeout") or 8)))

    if action == "dns":
        host = str(args.get("host") or "").strip()
        if not host:
            raise ExtraToolError("host 不能为空")
        try:
            infos = socket.getaddrinfo(host, None)
        except OSError as error:
            raise ExtraToolError(f"解析失败：{error}") from error
        addresses = sorted({info[4][0] for info in infos})
        return _text(f"{host} 解析到 {len(addresses)} 个地址：\n" + "\n".join(addresses))

    if action == "tcp":
        host = str(args.get("host") or "").strip()
        port = int(args.get("port") or 0)
        if not host or port <= 0:
            raise ExtraToolError("tcp 需要 host 与 port")
        started = time.monotonic()
        try:
            with socket.create_connection((host, port), timeout=timeout):
                elapsed = int((time.monotonic() - started) * 1000)
                return _text(f"{host}:{port} 可连接（{elapsed} ms）")
        except OSError as error:
            return _text(f"{host}:{port} 不可连接：{error}", error=True)

    url = str(args.get("url") or "").strip()
    if not url:
        raise ExtraToolError("url 不能为空")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ExtraToolError("只支持 http/https 地址")
    method = str(args.get("method") or "GET").upper()
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "AgentDesk/1.0"})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            elapsed = int((time.monotonic() - started) * 1000)
            headers = [f"{key}: {value}" for key, value in response.headers.items()]
            body = response.read(512) if method != "HEAD" else b""
    except urllib.error.HTTPError as error:
        elapsed = int((time.monotonic() - started) * 1000)
        return _text(f"{url} → HTTP {error.code}（{elapsed} ms）", error=True)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return _text(f"{url} 请求失败：{error}", error=True)
    lines = [
        f"{method} {url} → HTTP {response.status}（{elapsed} ms）",
        f"内容类型：{response.headers.get('content-type', '未知')}",
        "",
        *headers[:20],
    ]
    if body:
        preview = body.decode("utf-8", "replace").strip()
        if preview:
            lines += ["", "响应开头：", preview[:400]]
    return _text("\n".join(lines))


def _process_list(args: dict[str, Any]) -> dict[str, Any]:
    limit = max(1, min(50, int(args.get("limit") or 15)))
    sort_by = str(args.get("sort") or "memory")
    try:
        import psutil  # type: ignore[import-not-found]

        rows = []
        for process in psutil.process_iter(["pid", "name", "memory_info", "cpu_percent"]):
            info = process.info
            memory = info.get("memory_info")
            rows.append(
                {
                    "pid": info.get("pid"),
                    "name": info.get("name") or "?",
                    "rss": getattr(memory, "rss", 0) or 0,
                    "cpu": info.get("cpu_percent") or 0.0,
                }
            )
        key = (lambda item: item["rss"]) if sort_by == "memory" else (lambda item: item["cpu"])
        rows.sort(key=key, reverse=True)
        lines = [
            f"{row['pid']:>7}  {row['name'][:36]:<36} 内存 {_human(row['rss']):>9}  CPU {row['cpu']:.0f}%"
            for row in rows[:limit]
        ]
        return _text(f"进程数 {len(rows)}，按{'内存' if sort_by == 'memory' else 'CPU'}排序：\n" + "\n".join(lines))
    except ImportError:
        pass

    lines = [f"{'PID':>7}  {'NAME':<32}  {'MEM'}", ""]
    try:
        if sys.platform == "win32":
            output = os.popen("tasklist /FO CSV /NH").read().splitlines()
            for line in output[:limit]:
                parts = [item.strip('"') for item in line.split('","')]
                if len(parts) >= 5:
                    lines.append(f"{parts[1]:>7}  {parts[0][:32]:<32}  {parts[4]}")
        else:
            output = os.popen("ps -axo pid,comm,rss | sort -k3 -nr | head -n %d" % limit).read()
            lines.append(output.strip())
    except OSError as error:
        raise ExtraToolError(f"无法列出进程：{error}（可安装 psutil 获取更完整信息）") from error
    return _text("\n".join(line for line in lines if line.strip()))


def _text_stats(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    raw = args.get("text")
    if raw is None:
        if not args.get("path"):
            raise ExtraToolError("path 与 text 至少提供一个")
        path = sandbox.resolve(str(args["path"]), must_exist=True)
        raw = _read_text(path)
    content = str(raw)
    lines = content.splitlines()
    # 与前端一致的粗略估算：中日韩字符按 1 token，其余按 0.3
    tokens = 0.0
    for char in content:
        tokens += 1 if 0x2E80 <= ord(char) <= 0x9FFF else 0.3
    return _text(
        "\n".join(
            [
                f"行数：{len(lines)}",
                f"字符数：{len(content)}",
                f"词数（按空白切分）：{len(content.split())}",
                f"UTF-8 字节：{len(content.encode('utf-8'))}",
                f"估算 token：{round(tokens)}",
            ]
        )
    )


def _clipboard(args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "read")
    if action == "write":
        text = str(args.get("text") or "")
        try:
            import tkinter  # noqa: F401

            root = tkinter.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()
            root.destroy()
            return _text(f"已写入剪贴板（{len(text)} 字符）")
        except Exception as error:  # noqa: BLE001 - 无 GUI 环境
            raise ExtraToolError(f"无法写入剪贴板：{error}") from error

    try:
        import tkinter

        root = tkinter.Tk()
        root.withdraw()
        value = root.clipboard_get()
        root.destroy()
        return _text(value[:8000] if value else "（剪贴板为空）")
    except Exception as error:  # noqa: BLE001 - 无 GUI 或内容不是文本
        raise ExtraToolError(f"无法读取剪贴板：{error}") from error


def _workspace(args: dict[str, Any], sandbox: Sandbox, settings: Settings) -> dict[str, Any]:
    action = str(args.get("action") or "list")
    options = settings.configured_workspaces()
    if action == "list":
        lines = [
            f"{'*' if str(path) == str(sandbox.root) else ' '} {path.name or path}\t{path}"
            for path in options
        ]
        return _text(f"当前工作区：{sandbox.root}\n\n可用工作区：\n" + "\n".join(lines))
    if action != "use":
        raise ExtraToolError(f"不支持的 action：{action}")
    target = str(args.get("path") or "").strip()
    if not target:
        raise ExtraToolError("use 需要 path")
    try:
        resolved = sandbox.switch_root(Path(target), options)
    except SandboxError as error:
        raise ExtraToolError(str(error)) from error
    # 描述信息里要显示新的当前工作区
    settings.sandbox = resolved
    return _text(f"已切换到工作区 {resolved}。后续相对路径都以它为根。")


async def _git(args: dict[str, Any], sandbox: Sandbox, settings: Settings) -> dict[str, Any]:
    action = str(args.get("action") or "status")
    cwd = sandbox.resolve(str(args.get("cwd") or "."))
    if not cwd.is_dir():
        raise ExtraToolError(f"{sandbox.relative(cwd)} 不是目录")
    if not (cwd / ".git").exists():
        raise ExtraToolError(f"{sandbox.relative(cwd)} 不是 git 仓库")

    limit = max(1, min(100, int(args.get("limit") or 15)))
    commands: dict[str, list[str]] = {
        "status": ["git", "status", "--short", "--branch"],
        "log": ["git", "log", f"-n{limit}", "--date=short", "--pretty=%h %ad %an %s"],
        "diff": ["git", "diff", "--stat"],
        "branch": ["git", "branch", "--all", "--no-color"],
        "show": ["git", "show", "--stat", "--date=short", "--pretty=medium", str(args.get("target") or "HEAD")],
    }
    if action == "diff" and args.get("target"):
        commands["diff"] = ["git", "diff", "--", str(args["target"])]
    command = commands.get(action)
    if not command:
        raise ExtraToolError(f"不支持的 action：{action}")

    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "GIT_PAGER": "cat", "PYTHONIOENCODING": "utf-8"},
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=30)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise ExtraToolError("git 命令超时") from None
    text = (output or b"").decode("utf-8", "replace")
    if len(text) > settings.max_output:
        text = text[: settings.max_output] + "\n…（已截断）"
    label = " ".join(command)
    if process.returncode:
        return _text(f"$ {label}\n{text.strip() or '（无输出）'}", error=True)
    return _text(f"$ {label}\n{text.strip() or '（无输出）'}")


async def dispatch(name: str, args: dict[str, Any], sandbox: Sandbox, settings: Settings) -> dict[str, Any] | None:
    """处理本模块的工具；不是本模块的名字返回 None，让上层继续分发。"""
    if name == "desk_hash":
        return _hash(args, sandbox)
    if name == "desk_grep":
        return _grep(args, sandbox)
    if name == "desk_archive":
        return _archive(args, sandbox)
    if name == "desk_json_query":
        return _json_query(args, sandbox)
    if name == "desk_net_probe":
        return _net_probe(args)
    if name == "desk_process_list":
        return _process_list(args)
    if name == "desk_text_stats":
        return _text_stats(args, sandbox)
    if name == "desk_clipboard":
        return _clipboard(args)
    if name == "desk_workspace":
        return _workspace(args, sandbox, settings)
    if name == "desk_git":
        return await _git(args, sandbox, settings)
    return None


__all__ = ["definitions", "dispatch", "ExtraToolError"]
