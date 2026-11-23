"""从 one_cedric 移植过来的工具集：检索、计算、时间、编码、数据、文档、图片、二维码。

设计原则沿用 tools_extra：
1. 只用标准库；需要第三方库的能力做成可选，缺库时给一句可执行的安装提示，而不是抛栈。
2. 所有路径都过沙箱校验，绝不因为「模型说这是绝对路径」就放行。
3. 输出偏向可读的纯文本，模型和用户看同一份内容。
"""

from __future__ import annotations

import ast
import base64
import csv
import difflib
import fnmatch
import hashlib
import html
import io
import ipaddress
import json
import math
import os
import platform
import re
import secrets
import shutil
import socket
import sqlite3
import ssl
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .sandbox import Sandbox, SandboxError
from .tools_extra import ExtraToolError, _human, _read_text, _text

MAX_ROWS = 200
MAX_DIFF = 8000
MAX_EXPR = 300
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next"}


# --------------------------------------------------------------------------- 基础工具


def _arg(args: dict[str, Any], key: str, default: str = "") -> str:
    value = args.get(key)
    return value if isinstance(value, str) else default


def _need(args: dict[str, Any], key: str) -> str:
    value = _arg(args, key).strip()
    if not value:
        raise ExtraToolError(f"缺少参数 {key}")
    return value


def _int(args: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    try:
        value = int(args.get(key, default))
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def _optional(module: str, hint: str) -> Any:
    try:
        import importlib

        return importlib.import_module(module)
    except ImportError:
        raise ExtraToolError(f"需要可选依赖 {module}：{hint}") from None


def _walk(base: Path, limit: int) -> list[Path]:
    """按文件名字典序遍历，跳过依赖与构建目录。"""
    found: list[Path] = []
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(item for item in dirs if item not in SKIP_DIRS)
        for name in sorted(files):
            found.append(Path(root) / name)
            if len(found) >= limit:
                return found
    return found


# --------------------------------------------------------------------------- 声明


def definitions() -> list[dict[str, Any]]:
    read_only = {"readOnlyHint": True}
    return [
        {
            "name": "desk_glob",
            "description": "按通配符找文件，支持 ** 递归。自动跳过 .git、node_modules 等目录。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "例如 src/**/*.ts"},
                    "path": {"type": "string", "description": "起点目录，默认当前工作区"},
                    "limit": {"type": "integer", "description": "最多返回多少个，默认 200"},
                },
                "required": ["pattern"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_diff",
            "description": "比较两份内容：两个文件，或两段文本。返回统一 diff。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path_a": {"type": "string"},
                    "path_b": {"type": "string"},
                    "text_a": {"type": "string"},
                    "text_b": {"type": "string"},
                },
            },
            "annotations": read_only,
        },
        {
            "name": "desk_calculate",
            "description": "计算数学表达式。支持 + - * / // % **、括号与 sqrt/abs/round/min/max/sin/cos/log 等函数，不做任意代码执行。",
            "inputSchema": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_time",
            "description": "时间工具：action=now 当前时间，add 加减时间，diff 两个时间差，timezone 时区换算。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["now", "add", "diff", "timezone"]},
                    "time": {"type": "string", "description": "ISO 时间，默认现在"},
                    "other": {"type": "string", "description": "diff 的另一个时间"},
                    "amount": {"type": "number", "description": "add 的数值，可为负"},
                    "unit": {
                        "type": "string",
                        "enum": ["seconds", "minutes", "hours", "days", "weeks"],
                    },
                    "from_tz": {"type": "string", "description": "例如 Asia/Shanghai"},
                    "to_tz": {"type": "string"},
                },
            },
            "annotations": read_only,
        },
        {
            "name": "desk_regex",
            "description": "正则：action=extract 提取匹配，replace 替换，test 判断是否匹配，split 分割。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["extract", "replace", "test", "split"]},
                    "pattern": {"type": "string"},
                    "text": {"type": "string"},
                    "path": {"type": "string", "description": "也可以从文件读"},
                    "replacement": {"type": "string"},
                    "flags": {"type": "string", "description": "i/m/s 的组合"},
                    "group": {"type": "integer", "description": "extract 取第几个捕获组"},
                    "limit": {"type": "integer"},
                },
                "required": ["action", "pattern"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_codec",
            "description": "编解码：url / base64 / base64url / hex / html 转义，以及 jwt_decode 查看令牌内容。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "url_encode",
                            "url_decode",
                            "base64_encode",
                            "base64_decode",
                            "base64url_encode",
                            "base64url_decode",
                            "hex_encode",
                            "hex_decode",
                            "html_escape",
                            "html_unescape",
                            "jwt_decode",
                        ],
                    },
                    "text": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_csv",
            "description": "CSV 处理：action=to_json 转 JSON，query 按列筛选，stats 统计列，to_csv 把 JSON 转回 CSV。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["to_json", "query", "stats", "to_csv"]},
                    "path": {"type": "string"},
                    "columns": {"type": "array", "items": {"type": "string"}},
                    "where": {"type": "string", "description": "形如 status=done 的等值过滤"},
                    "delimiter": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["action", "path"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_sqlite",
            "description": "只读查询 SQLite 数据库：action=tables 列表，schema 看结构，query 执行 SELECT。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["tables", "schema", "query"]},
                    "path": {"type": "string"},
                    "sql": {"type": "string"},
                    "table": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["action", "path"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_tree",
            "description": "目录结构树，带文件大小，默认两层。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "depth": {"type": "integer"},
                    "limit": {"type": "integer"},
                },
            },
            "annotations": read_only,
        },
        {
            "name": "desk_dupes",
            "description": "按内容哈希找重复文件，先比大小再算摘要，返回可安全删除的重复组。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "min_size": {"type": "integer", "description": "小于该字节数忽略，默认 1"},
                    "limit": {"type": "integer"},
                },
            },
            "annotations": read_only,
        },
        {
            "name": "desk_download",
            "description": "把 URL 下载到工作区文件。限制大小与超时，路径过沙箱校验。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "path": {"type": "string"},
                    "max_mb": {"type": "integer"},
                },
                "required": ["url", "path"],
            },
        },
        {
            "name": "desk_net",
            "description": "网络诊断：action=dns 解析，ssl 看证书有效期，http_head 看响应头，public_ip 查出口 IP。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["dns", "ssl", "http_head", "public_ip"]},
                    "host": {"type": "string"},
                    "port": {"type": "integer"},
                    "url": {"type": "string"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_password",
            "description": "生成口令、令牌或随机字节。默认排除易混字符。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["password", "token", "bytes"]},
                    "length": {"type": "integer"},
                    "count": {"type": "integer"},
                    "symbols": {"type": "boolean"},
                },
            },
        },
        {
            "name": "desk_markdown",
            "description": "Markdown 工具：action=to_html 转 HTML，toc 提取目录，stats 统计字数。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["to_html", "toc", "stats"]},
                    "text": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_similarity",
            "description": "文本相似度：action=compare 比较两段文本，dedupe 去掉近似重复的行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["compare", "dedupe"]},
                    "text": {"type": "string"},
                    "other": {"type": "string"},
                    "threshold": {"type": "number"},
                    "path": {"type": "string"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_pdf",
            "description": "读 PDF：action=extract 抽文本（可指定页范围），info 看页数与元数据。需要 pypdf。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["extract", "info"]},
                    "path": {"type": "string"},
                    "pages": {"type": "string", "description": "例如 1-3 或 2"},
                },
                "required": ["action", "path"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_image",
            "description": "图片处理：info 看尺寸，resize 缩放，convert 转格式，thumbnail 缩略图，crop 裁剪，rotate 旋转。需要 Pillow。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["info", "resize", "convert", "thumbnail", "crop", "rotate"],
                    },
                    "path": {"type": "string"},
                    "out": {"type": "string", "description": "输出路径，默认同名加后缀"},
                    "width": {"type": "integer"},
                    "height": {"type": "integer"},
                    "format": {"type": "string", "description": "png/jpeg/webp"},
                    "quality": {"type": "integer"},
                    "left": {"type": "integer", "description": "crop 左边界"},
                    "top": {"type": "integer", "description": "crop 上边界"},
                    "right": {"type": "integer", "description": "crop 右边界"},
                    "bottom": {"type": "integer", "description": "crop 下边界"},
                    "angle": {"type": "number", "description": "rotate 角度，逆时针"},
                },
                "required": ["action", "path"],
            },
        },
        {
            "name": "desk_qr",
            "description": "生成二维码：generate 普通文本，wifi 配网码，vcard 名片，email 邮件，sms 短信，geo 坐标。输出 png 或 svg。需要 qrcode。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["generate", "wifi", "vcard", "email", "sms", "geo"],
                    },
                    "text": {"type": "string"},
                    "path": {"type": "string", "description": "输出文件，默认 qrcode.png"},
                    "ssid": {"type": "string"},
                    "password": {"type": "string"},
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "org": {"type": "string"},
                    "email": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                    "message": {"type": "string"},
                    "lat": {"type": "number"},
                    "lng": {"type": "number"},
                    "size": {"type": "integer"},
                },
                "required": ["action"],
            },
        },
        {
            "name": "desk_office",
            "description": "读写 Office：docx_read/xlsx_read/pptx_read 抽文本，docx_write/xlsx_write 生成文件。需要 python-docx / openpyxl / python-pptx。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["docx_read", "docx_write", "xlsx_read", "xlsx_write", "pptx_read"],
                    },
                    "path": {"type": "string"},
                    "text": {"type": "string", "description": "写入 docx 的正文"},
                    "rows": {
                        "type": "array",
                        "items": {"type": "array", "items": {"type": "string"}},
                        "description": "写入 xlsx 的二维数据",
                    },
                    "sheet": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["action", "path"],
            },
        },
        {
            "name": "desk_json",
            "description": "JSON 工具：action=format 美化/压缩，diff 对比两份 JSON，validate 只校验语法。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["format", "diff", "validate"]},
                    "text": {"type": "string", "description": "JSON 文本"},
                    "path": {"type": "string", "description": "JSON 文件（沙箱内），与 text 二选一"},
                    "other": {"type": "string", "description": "diff 的第二段 JSON"},
                    "other_path": {"type": "string", "description": "diff 的第二个文件"},
                    "indent": {"type": "integer", "description": "缩进空格 0-8，默认 2"},
                    "compact": {"type": "boolean", "description": "压缩成一行"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_text",
            "description": "文本工具：word_frequency 词频，dedupe 行去重，strip_invisible 清不可见字符，strip_ansi 去终端色控，template 渲染 {{变量}}。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["word_frequency", "dedupe", "strip_invisible", "strip_ansi", "template"],
                    },
                    "text": {"type": "string"},
                    "path": {"type": "string", "description": "从沙箱文件读取，与 text 二选一"},
                    "top": {"type": "integer", "description": "词频前 N 个，默认 30"},
                    "min_len": {"type": "integer", "description": "中文片段长度 2-4，默认 2"},
                    "stopwords": {"type": "string", "description": "逗号分隔的停用词"},
                    "case_insensitive": {"type": "boolean"},
                    "strip_whitespace": {"type": "boolean"},
                    "keep_order": {"type": "boolean"},
                    "template": {"type": "string", "description": "template 动作的模板文本"},
                    "variables": {"type": "object", "description": "template 动作的变量"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_cron",
            "description": "计算 5 段 cron（分 时 日 月 周）接下来几次执行时间，使用本机时区。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "例如 0 9 * * 1-5"},
                    "count": {"type": "integer", "description": "返回几条，默认 3"},
                    "start": {"type": "string", "description": "从这个 ISO 时间开始算，默认现在"},
                },
                "required": ["expression"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_system",
            "description": "系统信息：action=env 运行环境，metrics CPU/内存/磁盘，disk 指定路径的磁盘占用。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["env", "metrics", "disk"]},
                    "path": {"type": "string", "description": "disk 动作的路径，默认沙箱根目录"},
                },
                "required": ["action"],
            },
            "annotations": read_only,
        },
        {
            "name": "desk_http",
            "description": "发 HTTP 请求：支持 GET/POST/PUT/PATCH/DELETE/HEAD、请求头与文本请求体。只允许公网地址，返回状态码、响应头与正文片段。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "method": {
                        "type": "string",
                        "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
                    },
                    "headers": {"type": "object", "description": "请求头键值对"},
                    "body": {"type": "string", "description": "文本请求体"},
                    "timeout": {"type": "number", "description": "超时秒数，默认 15"},
                    "max_chars": {"type": "integer", "description": "正文最多返回多少字符，默认 20000"},
                },
                "required": ["url"],
            },
        },
        {
            "name": "desk_replace",
            "description": "批量查找替换：默认只预览改动（dry_run=true），确认后传 dry_run=false 才写回文件。支持正则与大小写忽略。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "起点目录或单个文件"},
                    "pattern": {"type": "string"},
                    "replacement": {"type": "string"},
                    "glob": {"type": "string", "description": "文件名通配，默认 *"},
                    "use_regex": {"type": "boolean"},
                    "case_insensitive": {"type": "boolean"},
                    "dry_run": {"type": "boolean", "description": "默认 true，只预览"},
                    "max_files": {"type": "integer", "description": "最多处理多少个文件，默认 20"},
                },
                "required": ["path", "pattern", "replacement"],
            },
        },
    ]


# --------------------------------------------------------------------------- 实现


def _glob(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    pattern = _need(args, "pattern")
    if ".." in pattern:
        raise ExtraToolError("pattern 里不能有 ..")
    base = sandbox.resolve(_arg(args, "path") or ".", must_exist=True)
    limit = _int(args, "limit", 200, 1, 2000)
    matches: list[str] = []
    if "/" in pattern or "\\" in pattern:
        for path in base.glob(pattern):
            if path.is_file():
                matches.append(sandbox.relative(path))
            if len(matches) >= limit:
                break
    else:
        for path in _walk(base, limit * 20):
            if fnmatch.fnmatch(path.name, pattern):
                matches.append(sandbox.relative(path))
                if len(matches) >= limit:
                    break
    if not matches:
        return _text(f"没有匹配 {pattern} 的文件（起点 {sandbox.relative(base)}）")
    return _text(f"匹配 {len(matches)} 个文件：\n" + "\n".join(matches))


def _diff(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    def load(path_key: str, text_key: str, label: str) -> tuple[str, str]:
        path = _arg(args, path_key)
        if path:
            target = sandbox.resolve(path, must_exist=True)
            return _read_text(target), sandbox.relative(target)
        if text_key in args:
            return _arg(args, text_key), label
        return "", label

    left, left_name = load("path_a", "text_a", "A")
    right, right_name = load("path_b", "text_b", "B")
    if not left and not right:
        raise ExtraToolError("请给 path_a/path_b 或 text_a/text_b")
    diff = list(
        difflib.unified_diff(
            left.splitlines(),
            right.splitlines(),
            fromfile=left_name,
            tofile=right_name,
            lineterm="",
        )
    )
    if not diff:
        return _text("两边内容一致，没有差异。")
    body = "\n".join(diff)
    if len(body) > MAX_DIFF:
        body = body[:MAX_DIFF] + "\n…（差异过长已截断）"
    return _text(body)


_FUNCS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
}
_CONSTS = {"pi": math.pi, "e": math.e, "tau": math.tau}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id in _CONSTS:
            return _CONSTS[node.id]
        raise ExtraToolError(f"不认识的常量：{node.id}")
    if isinstance(node, ast.UnaryOp):
        value = _eval_node(node.operand)
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return value
        raise ExtraToolError("只支持正负号")
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.FloorDiv):
            return left // right
        if isinstance(node.op, ast.Mod):
            return left % right
        if isinstance(node.op, ast.Pow):
            if abs(right) > 64:
                raise ExtraToolError("指数太大，拒绝计算")
            return left**right
        raise ExtraToolError("不支持的运算符")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
            raise ExtraToolError("只支持 sqrt/abs/round/min/max/sin/cos/tan/log/log10/exp/floor/ceil")
        if node.keywords:
            raise ExtraToolError("函数不支持关键字参数")
        return float(_FUNCS[node.func.id](*[_eval_node(arg) for arg in node.args]))
    raise ExtraToolError("表达式里含有不支持的语法")


def _calculate(args: dict[str, Any]) -> dict[str, Any]:
    expression = _need(args, "expression")
    if len(expression) > MAX_EXPR:
        raise ExtraToolError("表达式太长")
    try:
        tree = ast.parse(expression, mode="eval")
        value = _eval_node(tree)
    except SyntaxError as error:
        raise ExtraToolError(f"表达式语法错误：{error.msg}") from None
    except ZeroDivisionError:
        raise ExtraToolError("除数为 0") from None
    if value.is_integer():
        return _text(f"{expression} = {int(value)}")
    return _text(f"{expression} = {value:.10g}")


def _parse_time(raw: str) -> datetime:
    text = raw.strip()
    if not text or text.lower() == "now":
        return datetime.now().astimezone()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            raise ExtraToolError(f"看不懂的时间格式：{raw}") from None
    return parsed if parsed.tzinfo else parsed.astimezone()


def _time(args: dict[str, Any]) -> dict[str, Any]:
    action = _arg(args, "action", "now")
    if action == "now":
        now = datetime.now().astimezone()
        utc = now.astimezone(timezone.utc)
        return _text(
            "\n".join(
                [
                    f"本地：{now.isoformat(timespec='seconds')}（{now.tzname() or now.tzinfo}）",
                    f"UTC：{utc.isoformat(timespec='seconds')}",
                    f"时间戳：{int(now.timestamp())}",
                    f"星期：{'一二三四五六日'[now.weekday()]}",
                ]
            )
        )
    if action == "add":
        base = _parse_time(_arg(args, "time") or "now")
        amount = args.get("amount", 0)
        try:
            value = float(amount)
        except (TypeError, ValueError):
            raise ExtraToolError("amount 必须是数字") from None
        unit = _arg(args, "unit", "days")
        keyword = unit if unit in {"seconds", "minutes", "hours", "days", "weeks"} else "days"
        delta = timedelta(**{keyword: value})
        result = base + delta
        return _text(f"{base.isoformat(timespec='seconds')} {value:+g}{unit} = {result.isoformat(timespec='seconds')}")
    if action == "diff":
        left = _parse_time(_arg(args, "time") or "now")
        right = _parse_time(_need(args, "other"))
        seconds = (right - left).total_seconds()
        return _text(
            f"{left.isoformat(timespec='seconds')} → {right.isoformat(timespec='seconds')}\n"
            f"{seconds:+.0f} 秒（{seconds / 3600:+.2f} 小时，{seconds / 86400:+.2f} 天）"
        )
    if action == "timezone":
        try:
            from zoneinfo import ZoneInfo
        except ImportError:  # pragma: no cover - Python 3.9+ 均有
            raise ExtraToolError("当前 Python 不支持 zoneinfo") from None
        try:
            source = ZoneInfo(_arg(args, "from_tz", "UTC"))
            target = ZoneInfo(_need(args, "to_tz"))
        except Exception as error:  # noqa: BLE001 - 时区名非法
            raise ExtraToolError(f"时区名无效：{error}。Windows 上需要 pip install tzdata") from None
        moment = _parse_time(_arg(args, "time") or "now").astimezone(source)
        return _text(
            f"{moment.isoformat(timespec='seconds')}（{source.key}）"
            f" = {moment.astimezone(target).isoformat(timespec='seconds')}（{target.key}）"
        )
    raise ExtraToolError(f"不支持的 action：{action}")


def _load_text(args: dict[str, Any], sandbox: Sandbox) -> str:
    if _arg(args, "text"):
        return _arg(args, "text")
    path = _arg(args, "path")
    if path:
        return _read_text(sandbox.resolve(path, must_exist=True))
    return ""


def _regex(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "extract")
    source = _load_text(args, sandbox)
    if not source:
        raise ExtraToolError("请给 text 或 path")
    flags = 0
    for flag in _arg(args, "flags"):
        flags |= {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL}.get(flag, 0)
    try:
        pattern = re.compile(_need(args, "pattern"), flags)
    except re.error as error:
        raise ExtraToolError(f"正则无效：{error}") from None
    limit = _int(args, "limit", 100, 1, 2000)

    if action == "test":
        hit = pattern.search(source)
        return _text("匹配成功" if hit else "没有匹配")
    if action == "replace":
        count = 0 if "limit" not in args else limit
        replaced = pattern.sub(_arg(args, "replacement"), source, count=count)
        return _text(replaced[:MAX_DIFF])
    if action == "split":
        parts = [part for part in pattern.split(source) if part != ""][:limit]
        return _text(f"切成 {len(parts)} 段：\n" + "\n---\n".join(parts))
    if action == "extract":
        group = _int(args, "group", 0, 0, 99)
        hits: list[str] = []
        for match in pattern.finditer(source):
            try:
                value = match.group(group)
            except IndexError:
                value = match.group(0)
            hits.append(value)
            if len(hits) >= limit:
                break
        if not hits:
            return _text("没有匹配")
        return _text(f"匹配 {len(hits)} 处：\n" + "\n".join(hits))
    raise ExtraToolError(f"不支持的 action：{action}")


def _codec(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action")
    source = _load_text(args, sandbox)
    if not source:
        raise ExtraToolError("请给 text 或 path")
    try:
        if action == "url_encode":
            return _text(urllib.parse.quote(source, safe=""))
        if action == "url_decode":
            return _text(urllib.parse.unquote(source))
        if action == "base64_encode":
            return _text(base64.b64encode(source.encode()).decode())
        if action == "base64_decode":
            return _text(base64.b64decode(source + "=" * (-len(source) % 4)).decode("utf-8", "replace"))
        if action == "base64url_encode":
            return _text(base64.urlsafe_b64encode(source.encode()).decode().rstrip("="))
        if action == "base64url_decode":
            return _text(
                base64.urlsafe_b64decode(source + "=" * (-len(source) % 4)).decode("utf-8", "replace")
            )
        if action == "hex_encode":
            return _text(source.encode().hex())
        if action == "hex_decode":
            return _text(bytes.fromhex(source.replace(" ", "")).decode("utf-8", "replace"))
        if action == "html_escape":
            return _text(html.escape(source))
        if action == "html_unescape":
            return _text(html.unescape(source))
        if action == "jwt_decode":
            parts = source.strip().split(".")
            if len(parts) < 2:
                raise ExtraToolError("不是合法的 JWT")
            def seg(value: str) -> str:
                padded = value + "=" * (-len(value) % 4)
                return base64.urlsafe_b64decode(padded).decode("utf-8", "replace")
            payload = json.loads(seg(parts[1]))
            header = json.loads(seg(parts[0]))
            return _text(
                "header:\n"
                + json.dumps(header, ensure_ascii=False, indent=2)
                + "\n\npayload:\n"
                + json.dumps(payload, ensure_ascii=False, indent=2)
                + "\n\n注意：这里只解码，不校验签名。"
            )
    except (ValueError, json.JSONDecodeError) as error:
        raise ExtraToolError(f"解码失败：{error}") from None
    raise ExtraToolError(f"不支持的 action：{action}")


def _csv(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "to_json")
    target = sandbox.resolve(_need(args, "path"), must_exist=True)
    if action == "to_csv":
        raw = _read_text(target)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ExtraToolError(f"JSON 无法解析：{error}") from None
        if not isinstance(data, list) or not data:
            raise ExtraToolError("需要一个非空的对象数组")
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(data[0].keys()))
        writer.writeheader()
        writer.writerows(data)
        return _text(buffer.getvalue()[:MAX_DIFF])

    delimiter = _arg(args, "delimiter") or ","
    with target.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=delimiter))
    limit = _int(args, "limit", 50, 1, MAX_ROWS)
    if action == "stats":
        if not rows:
            return _text("空表")
        lines = [f"行数：{len(rows)}，列数：{len(rows[0])}"]
        for key in rows[0].keys():
            values = [row.get(key, "") for row in rows]
            filled = sum(1 for value in values if value.strip())
            unique = len({value for value in values})
            lines.append(f"- {key}：非空 {filled}/{len(values)}，去重 {unique}")
        return _text("\n".join(lines))
    if action == "query":
        columns = args.get("columns")
        where = _arg(args, "where")
        selected = rows
        if where and "=" in where:
            key, _, expected = where.partition("=")
            key, expected = key.strip(), expected.strip()
            selected = [row for row in rows if row.get(key, "").strip() == expected]
        if isinstance(columns, list) and columns:
            selected = [{key: row.get(key, "") for key in columns} for row in selected]
        return _text(json.dumps(selected[:limit], ensure_ascii=False, indent=2))
    if action == "to_json":
        return _text(json.dumps(rows[:limit], ensure_ascii=False, indent=2))
    raise ExtraToolError(f"不支持的 action：{action}")


def _sqlite(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "tables")
    target = sandbox.resolve(_need(args, "path"), must_exist=True)
    uri = f"file:{urllib.parse.quote(str(target).replace(os.sep, '/'))}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as error:
        raise ExtraToolError(f"打不开数据库：{error}") from None
    connection.row_factory = sqlite3.Row
    try:
        cursor = connection.cursor()
        if action == "tables":
            rows = cursor.execute(
                "select name from sqlite_master where type='table' order by name"
            ).fetchall()
            names = [row["name"] for row in rows]
            return _text("表：" + "、".join(names) if names else "没有表")
        if action == "schema":
            table = _arg(args, "table")
            if not table:
                rows = cursor.execute(
                    "select name, sql from sqlite_master where type in ('table','index')"
                ).fetchall()
                return _text("\n\n".join(f"{row['name']}:\n{row['sql']}" for row in rows)[:MAX_DIFF])
            rows = cursor.execute("select sql from sqlite_master where name = ?", (table,)).fetchall()
            if not rows:
                raise ExtraToolError(f"没有这张表：{table}")
            return _text(str(rows[0]["sql"]))
        if action == "query":
            sql = _need(args, "sql").strip()
            if not re.match(r"(?is)^\s*(select|with|pragma|explain)\b", sql):
                raise ExtraToolError("只允许 SELECT / WITH / PRAGMA / EXPLAIN")
            limit = _int(args, "limit", 100, 1, MAX_ROWS)
            rows = cursor.execute(sql).fetchmany(limit)
            if not rows:
                return _text("查询没有结果")
            data = [dict(row) for row in rows]
            return _text(json.dumps(data, ensure_ascii=False, indent=2)[:MAX_DIFF])
        raise ExtraToolError(f"不支持的 action：{action}")
    except sqlite3.Error as error:
        raise ExtraToolError(f"SQL 执行失败：{error}") from None
    finally:
        connection.close()


def _tree(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    base = sandbox.resolve(_arg(args, "path") or ".", must_exist=True)
    depth = _int(args, "depth", 2, 0, 6)
    limit = _int(args, "limit", 200, 1, 2000)
    lines: list[str] = [f"{sandbox.relative(base)}/"]
    count = 0

    def walk(directory: Path, prefix: str, level: int) -> None:
        nonlocal count
        if level > depth or count >= limit:
            return
        try:
            entries = sorted(
                (item for item in directory.iterdir() if item.name not in SKIP_DIRS),
                key=lambda item: (item.is_file(), item.name.lower()),
            )
        except OSError:
            return
        for index, entry in enumerate(entries):
            if count >= limit:
                lines.append(prefix + "…（已截断）")
                return
            last = index == len(entries) - 1
            branch = "└── " if last else "├── "
            if entry.is_dir():
                lines.append(prefix + branch + entry.name + "/")
                walk(entry, prefix + ("    " if last else "│   "), level + 1)
            else:
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0
                lines.append(prefix + branch + f"{entry.name}  {_human(size)}")
                count += 1

    walk(base, "", 1)
    return _text("\n".join(lines))


def _dupes(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    base = sandbox.resolve(_arg(args, "path") or ".", must_exist=True)
    min_size = _int(args, "min_size", 1, 0, 1 << 30)
    limit = _int(args, "limit", 30, 1, 200)
    buckets: dict[int, list[Path]] = {}
    for path in _walk(base, 20000):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size >= min_size:
            buckets.setdefault(size, []).append(path)
    groups: list[str] = []
    for size, paths in buckets.items():
        if len(paths) < 2:
            continue
        by_hash: dict[str, list[Path]] = {}
        for path in paths:
            try:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
            except OSError:
                continue
            by_hash.setdefault(digest, []).append(path)
        for digest, same in by_hash.items():
            if len(same) < 2:
                continue
            names = "\n".join("  " + sandbox.relative(item) for item in same)
            groups.append(f"{_human(size)} · {digest[:12]}\n{names}")
            if len(groups) >= limit:
                break
    if not groups:
        return _text("没有发现重复文件")
    return _text(f"发现 {len(groups)} 组重复文件：\n\n" + "\n\n".join(groups))


def _download(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    url = _need(args, "url")
    if not re.match(r"^https?://", url, re.I):
        raise ExtraToolError("只支持 http/https")
    target = sandbox.resolve(_need(args, "path"))
    max_bytes = _int(args, "max_mb", 50, 1, 500) * 1024 * 1024
    sandbox.ensure_parent(target)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (agentdesk)"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > max_bytes:
                raise ExtraToolError(f"文件太大：{_human(int(declared))}，上限 {_human(max_bytes)}")
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ExtraToolError(f"超过上限 {_human(max_bytes)}，已中止")
            target.write_bytes(data)
            return _text(
                f"已下载 {url}\n保存到 {sandbox.relative(target)}（{_human(len(data))}，"
                f"{response.headers.get('Content-Type', '未知类型')}）"
            )
    except urllib.error.URLError as error:
        raise ExtraToolError(f"下载失败：{error.reason}") from None
    except TimeoutError:
        raise ExtraToolError("下载超时") from None


def _net(args: dict[str, Any]) -> dict[str, Any]:
    action = _arg(args, "action", "dns")
    if action == "public_ip":
        try:
            with urllib.request.urlopen("https://api.ipify.org", timeout=8) as response:
                return _text("出口 IP：" + response.read().decode().strip())
        except Exception as error:  # noqa: BLE001 - 网络不可用
            raise ExtraToolError(f"取不到出口 IP：{error}") from None
    if action == "http_head":
        url = _need(args, "url")
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                headers = "\n".join(f"{key}: {value}" for key, value in response.headers.items())
                return _text(f"{url}\n状态：{response.status}\n\n{headers}")
        except urllib.error.HTTPError as error:
            return _text(f"{url}\n状态：{error.code} {error.reason}")
        except urllib.error.URLError as error:
            raise ExtraToolError(f"请求失败：{error.reason}") from None
    host = _need(args, "host")
    if action == "dns":
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as error:
            raise ExtraToolError(f"解析失败：{error}") from None
        addresses = sorted({info[4][0] for info in infos})
        return _text(f"{host} 解析到 {len(addresses)} 个地址：\n" + "\n".join(addresses))
    if action == "ssl":
        port = _int(args, "port", 443, 1, 65535)
        context = ssl.create_default_context()
        try:
            with socket.create_connection((host, port), timeout=10) as sock:
                with context.wrap_socket(sock, server_hostname=host) as tls:
                    cert = tls.getpeercert() or {}
        except (OSError, ssl.SSLError) as error:
            raise ExtraToolError(f"TLS 握手失败：{error}") from None
        subject = {key: value for item in cert.get("subject", ()) for key, value in item}
        issuer = {key: value for item in cert.get("issuer", ()) for key, value in item}
        return _text(
            "\n".join(
                [
                    f"{host}:{port}",
                    f"主体：{subject.get('commonName', '未知')}",
                    f"签发：{issuer.get('organizationName', issuer.get('commonName', '未知'))}",
                    f"生效：{cert.get('notBefore', '未知')}",
                    f"到期：{cert.get('notAfter', '未知')}",
                ]
            )
        )
    raise ExtraToolError(f"不支持的 action：{action}")


def _password(args: dict[str, Any]) -> dict[str, Any]:
    action = _arg(args, "action", "password")
    length = _int(args, "length", 20, 4, 4096)
    count = _int(args, "count", 1, 1, 20)
    if action == "bytes":
        return _text("\n".join(secrets.token_hex(length // 2) for _ in range(count)))
    if action == "token":
        return _text("\n".join(secrets.token_urlsafe(length) for _ in range(count)))
    alphabet = string.ascii_letters + string.digits
    if args.get("symbols"):
        alphabet += "!@#$%^&*()-_=+[]{};:,.?/"
    # 保证四类字符各出现一次，避免生成出口令但全是数字的组合
    pools = [string.ascii_lowercase, string.ascii_uppercase, string.digits]
    if args.get("symbols"):
        pools.append("!@#$%^&*()-_=+[]{};:,.?/")
    results = []
    for _ in range(count):
        chars = [secrets.choice(pool) for pool in pools]
        chars += [secrets.choice(alphabet) for _ in range(max(0, length - len(chars)))]
        secrets.SystemRandom().shuffle(chars)
        results.append("".join(chars[:length]))
    return _text("\n".join(results))


_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _md_to_html(source: str) -> str:
    """够用的 Markdown → HTML：标题、列表、引用、代码块、行内样式。先转义再加标签。"""
    lines = source.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    in_code = False
    in_list = False
    for raw in lines:
        line = raw.rstrip()
        if line.startswith("```"):
            if in_code:
                out.append("</code></pre>")
                in_code = False
            else:
                if in_list:
                    out.append("</ul>")
                    in_list = False
                out.append("<pre><code>")
                in_code = True
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        heading = _MD_HEADING.match(line)
        if heading:
            if in_list:
                out.append("</ul>")
                in_list = False
            level = len(heading.group(1))
            out.append(f"<h{level}>{html.escape(heading.group(2).strip())}</h{level}>")
            continue
        if re.match(r"^\s*[-*+]\s+", line):
            if not in_list:
                out.append("<ul>")
                in_list = True
            item = re.sub(r"^\s*[-*+]\s+", "", line)
            out.append(f"<li>{_inline_md(item)}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if line.startswith(">"):
            out.append(f"<blockquote>{_inline_md(line.lstrip('> ').strip())}</blockquote>")
            continue
        if re.match(r"^\s*(-{3,}|\*{3,})\s*$", line):
            out.append("<hr />")
            continue
        if line.strip():
            out.append(f"<p>{_inline_md(line)}</p>")
    if in_list:
        out.append("</ul>")
    if in_code:
        out.append("</code></pre>")
    return "\n".join(out)


def _inline_md(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', escaped)
    return escaped


def _markdown(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "to_html")
    source = _load_text(args, sandbox)
    if not source:
        raise ExtraToolError("请给 text 或 path")
    if action == "to_html":
        return _text(_md_to_html(source))
    if action == "toc":
        entries = []
        for line in source.split("\n"):
            match = _MD_HEADING.match(line)
            if match:
                level = len(match.group(1))
                title = match.group(2).strip()
                anchor = re.sub(r"[^\w\u4e00-\u9fa5-]+", "-", title).strip("-").lower()
                entries.append(f"{'  ' * (level - 1)}- [{title}](#{anchor})")
        return _text("\n".join(entries) if entries else "没有标题")
    if action == "stats":
        words = len(re.findall(r"[\w\u4e00-\u9fa5]+", source))
        cjk = len(re.findall(r"[\u4e00-\u9fa5]", source))
        return _text(
            f"字符 {len(source)}、词 {words}、汉字 {cjk}、行 {len(source.splitlines())}、"
            f"标题 {len(re.findall(r'(?m)^#{1,6}\\s', source))}"
        )
    raise ExtraToolError(f"不支持的 action：{action}")


def _similarity(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "compare")
    threshold = float(args.get("threshold", 0.9))
    if action == "compare":
        left = _arg(args, "text") or _read_text(sandbox.resolve(_need(args, "path"), must_exist=True))
        right = _need(args, "other")
        ratio = difflib.SequenceMatcher(None, left, right).ratio()
        return _text(f"相似度 {ratio:.4f}（1 表示完全一致）")
    if action == "dedupe":
        source = _load_text(args, sandbox)
        if not source:
            raise ExtraToolError("请给 text 或 path")
        kept: list[str] = []
        removed: list[str] = []
        for line in source.splitlines():
            stripped = line.strip()
            if not stripped:
                kept.append(line)
                continue
            if any(difflib.SequenceMatcher(None, stripped, item).ratio() >= threshold for item in kept):
                removed.append(stripped)
            else:
                kept.append(stripped)
        return _text(
            f"去掉 {len(removed)} 行近似重复，保留 {len(kept)} 行。\n\n" + "\n".join(kept)[:MAX_DIFF]
        )
    raise ExtraToolError(f"不支持的 action：{action}")


def _pages(raw: str, total: int) -> list[int]:
    # 不指定页范围时只读前 10 页，避免一份长 PDF 把上下文冲爆
    if not raw:
        return list(range(min(total, 10)))
    result: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if "-" in part:
            start, _, end = part.partition("-")
            try:
                result.extend(range(int(start) - 1, int(end)))
            except ValueError:
                continue
        elif part.isdigit():
            result.append(int(part) - 1)
    return [index for index in result if 0 <= index < total]


def _pdf(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    pypdf = _optional("pypdf", "pip install pypdf")
    target = sandbox.resolve(_need(args, "path"), must_exist=True)
    try:
        reader = pypdf.PdfReader(str(target))
    except Exception as error:  # noqa: BLE001 - 损坏的 PDF
        raise ExtraToolError(f"打不开 PDF：{error}") from None
    if _arg(args, "action", "extract") == "info":
        meta = reader.metadata or {}
        return _text(
            "\n".join(
                [
                    f"页数：{len(reader.pages)}",
                    f"标题：{meta.get('/Title', '未知')}",
                    f"作者：{meta.get('/Author', '未知')}",
                    f"生成器：{meta.get('/Producer', '未知')}",
                ]
            )
        )
    indexes = _pages(_arg(args, "pages"), len(reader.pages))
    chunks: list[str] = []
    for index in indexes:
        try:
            text = reader.pages[index].extract_text() or ""
        except Exception:  # noqa: BLE001 - 单页损坏不影响其它页
            text = "（这一页无法抽取文本）"
        chunks.append(f"--- 第 {index + 1} 页 ---\n{text.strip()}")
    body = "\n\n".join(chunks)
    if len(body) > 30000:
        body = body[:30000] + "\n…（内容过长已截断）"
    return _text(body or "没有抽取到文本，可能是扫描件。")


def _image(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    pillow = _optional("PIL.Image", "pip install Pillow")
    action = _arg(args, "action", "info")
    target = sandbox.resolve(_need(args, "path"), must_exist=True)
    try:
        with pillow.open(str(target)) as image:
            if action == "info":
                return _text(
                    f"{sandbox.relative(target)}\n尺寸：{image.width}×{image.height}\n"
                    f"模式：{image.mode}\n格式：{image.format}\n大小：{_human(target.stat().st_size)}"
                )
            out_raw = _arg(args, "out")
            if not out_raw:
                suffix = ".webp" if action == "convert" else target.suffix
                out_raw = str(target.with_name(target.stem + f".{action}" + suffix))
            output = sandbox.resolve(out_raw)
            sandbox.ensure_parent(output)
            if action == "resize":
                width = _int(args, "width", image.width, 1, 20000)
                height = _int(args, "height", image.height, 1, 20000)
                result = image.resize((width, height))
            elif action == "thumbnail":
                size = _int(args, "width", 320, 16, 4096)
                result = image.copy()
                result.thumbnail((size, size))
            elif action == "crop":
                left = _int(args, "left", 0, 0, image.width)
                top = _int(args, "top", 0, 0, image.height)
                right = _int(args, "right", image.width, 0, image.width)
                bottom = _int(args, "bottom", image.height, 0, image.height)
                if right <= left or bottom <= top:
                    raise ExtraToolError("裁剪区域为空：需要 right>left 且 bottom>top")
                result = image.crop((left, top, right, bottom))
            elif action == "rotate":
                try:
                    angle = float(args.get("angle", 90))
                except (TypeError, ValueError):
                    raise ExtraToolError("angle 需要是数字") from None
                result = image.rotate(angle, expand=True)
            else:
                result = image.copy()
                fmt = _arg(args, "format", "webp").lower()
                if fmt == "webp":
                    result.save(output, format="WEBP", quality=_int(args, "quality", 82, 1, 100))
                    return _text(f"已转换 → {sandbox.relative(output)}（{_human(output.stat().st_size)}）")
                result.save(output, format=fmt.upper())
                return _text(f"已转换 → {sandbox.relative(output)}（{_human(output.stat().st_size)}）")
            result.save(output)
            return _text(
                f"已处理 → {sandbox.relative(output)}（{result.width}×{result.height}，"
                f"{_human(output.stat().st_size)}）"
            )
    except OSError as error:
        raise ExtraToolError(f"图片处理失败：{error}") from None


def _qr(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    qrcode = _optional("qrcode", "pip install qrcode[pil]")
    action = _arg(args, "action", "generate")
    if action == "wifi":
        ssid = _need(args, "ssid")
        password = _arg(args, "password")
        payload = f"WIFI:T:{'WPA' if password else 'nopass'};S:{ssid};P:{password};;"
    elif action == "vcard":
        name = _need(args, "name")
        cards = ["BEGIN:VCARD", "VERSION:3.0", f"FN:{name}"]
        if _arg(args, "org"):
            cards.append(f"ORG:{_arg(args, 'org')}")
        if _arg(args, "phone"):
            cards.append(f"TEL:{_arg(args, 'phone')}")
        cards.append("END:VCARD")
        payload = "\n".join(cards)
    elif action == "email":
        query = urllib.parse.urlencode(
            {key: value for key, value in (("subject", _arg(args, "subject")), ("body", _arg(args, "body"))) if value}
        )
        payload = f"mailto:{_need(args, 'email')}" + (f"?{query}" if query else "")
    elif action == "sms":
        payload = f"SMSTO:{_need(args, 'phone')}:{_arg(args, 'message')}"
    elif action == "geo":
        try:
            latitude = float(args["lat"])
            longitude = float(args["lng"])
        except (KeyError, TypeError, ValueError):
            raise ExtraToolError("geo 需要数字 lat 与 lng") from None
        payload = f"geo:{latitude},{longitude}"
    else:
        payload = _need(args, "text")
    out_raw = _arg(args, "path") or "qrcode.png"
    output = sandbox.resolve(out_raw)
    sandbox.ensure_parent(output)
    size = _int(args, "size", 8, 1, 40)
    try:
        code = qrcode.QRCode(border=2, box_size=size, error_correction=qrcode.constants.ERROR_CORRECT_M)
        code.add_data(payload)
        code.make(fit=True)
        image = code.make_image(fill_color="black", back_color="white")
        image.save(str(output))
    except Exception as error:  # noqa: BLE001 - 内容过长等
        raise ExtraToolError(f"生成二维码失败：{error}") from None
    return _text(f"已生成二维码 → {sandbox.relative(output)}\n内容长度 {len(payload)} 字符")


def _office(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action")
    target = sandbox.resolve(_need(args, "path"))
    limit = _int(args, "limit", 200, 1, 2000)

    if action == "docx_read":
        docx = _optional("docx", "pip install python-docx")
        document = docx.Document(str(sandbox.resolve(_arg(args, "path"), must_exist=True)))
        paragraphs = [item.text for item in document.paragraphs if item.text.strip()]
        return _text(f"{len(paragraphs)} 段：\n\n" + "\n".join(paragraphs)[:30000])

    if action == "docx_write":
        docx = _optional("docx", "pip install python-docx")
        sandbox.ensure_parent(target)
        document = docx.Document()
        for line in _need(args, "text").split("\n"):
            if line.startswith("## "):
                document.add_heading(line[3:].strip(), level=2)
            elif line.startswith("# "):
                document.add_heading(line[2:].strip(), level=1)
            elif line.startswith("- "):
                document.add_paragraph(line[2:].strip(), style="List Bullet")
            else:
                document.add_paragraph(line)
        document.save(str(target))
        return _text(f"已生成 {sandbox.relative(target)}（{len(document.paragraphs)} 段）")

    if action == "xlsx_read":
        openpyxl = _optional("openpyxl", "pip install openpyxl")
        workbook = openpyxl.load_workbook(str(sandbox.resolve(_arg(args, "path"), must_exist=True)), read_only=True, data_only=True)
        try:
            lines: list[str] = []
            for sheet in workbook.worksheets:
                lines.append(f"[{sheet.title}]")
                for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
                    if row_index >= limit:
                        lines.append("…（已截断）")
                        break
                    lines.append("\t".join("" if cell is None else str(cell) for cell in row))
            return _text("\n".join(lines)[:30000])
        finally:
            workbook.close()

    if action == "xlsx_write":
        openpyxl = _optional("openpyxl", "pip install openpyxl")
        rows = args.get("rows")
        if not isinstance(rows, list) or not rows:
            raise ExtraToolError("rows 需要是二维数组")
        sandbox.ensure_parent(target)
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = _arg(args, "sheet") or "Sheet1"
        for row in rows:
            sheet.append(list(row) if isinstance(row, list) else [row])
        workbook.save(str(target))
        return _text(f"已生成 {sandbox.relative(target)}（{len(rows)} 行）")

    if action == "pptx_read":
        pptx = _optional("pptx", "pip install python-pptx")
        presentation = pptx.Presentation(str(sandbox.resolve(_arg(args, "path"), must_exist=True)))
        lines = []
        for index, slide in enumerate(presentation.slides, start=1):
            texts = [
                shape.text.strip()
                for shape in slide.shapes
                if hasattr(shape, "text") and shape.text and shape.text.strip()
            ]
            lines.append(f"--- 第 {index} 页 ---\n" + "\n".join(texts))
        return _text("\n\n".join(lines)[:30000])

    raise ExtraToolError(f"不支持的 action：{action}")


# --------------------------------------------------------------------------- JSON / 文本 / 时间 / 系统 / 网络


def _json_input(args: dict[str, Any], sandbox: Sandbox, text_key: str = "text", path_key: str = "path") -> Any:
    raw = _arg(args, text_key)
    if not raw:
        path = _arg(args, path_key).strip()
        if not path:
            raise ExtraToolError(f"需要 {text_key} 或 {path_key}")
        raw = _read_text(sandbox.resolve(path, must_exist=True))
    if not raw.strip():
        raise ExtraToolError("JSON 内容为空")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise ExtraToolError(f"JSON 解析失败：{error}") from None


def _json_diff(left: Any, right: Any, path: str, out: list[str], limit: int = 200) -> None:
    if len(out) >= limit or left == right:
        return
    if type(left) is not type(right):
        out.append(f"{path or '$'}：{type(left).__name__} → {type(right).__name__}")
        return
    if isinstance(left, list) and isinstance(right, list):
        for index in range(max(len(left), len(right))):
            if index >= len(left):
                out.append(f"{path}[{index}]：新增 {json.dumps(right[index], ensure_ascii=False)}")
            elif index >= len(right):
                out.append(f"{path}[{index}]：删除 {json.dumps(left[index], ensure_ascii=False)}")
            else:
                _json_diff(left[index], right[index], f"{path}[{index}]", out, limit)
            if len(out) >= limit:
                return
        return
    if isinstance(left, dict) and isinstance(right, dict):
        for key in list(dict.fromkeys([*left.keys(), *right.keys()])):
            if key not in left:
                out.append(f"{path}.{key}：新增 {json.dumps(right[key], ensure_ascii=False)}")
            elif key not in right:
                out.append(f"{path}.{key}：删除")
            else:
                _json_diff(left[key], right[key], f"{path}.{key}", out, limit)
            if len(out) >= limit:
                return
        return
    out.append(f"{path or '$'}：{json.dumps(left, ensure_ascii=False)} → {json.dumps(right, ensure_ascii=False)}")


def _json(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "format")
    if action == "format":
        value = _json_input(args, sandbox)
        compact = bool(args.get("compact"))
        indent = _int(args, "indent", 2, 0, 8)
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else indent)
        return _text(text[:MAX_DIFF])
    if action == "validate":
        value = _json_input(args, sandbox)
        kind = "数组" if isinstance(value, list) else "对象" if isinstance(value, dict) else type(value).__name__
        size = len(value) if isinstance(value, (list, dict)) else len(str(value))
        return _text(f"JSON 合法：{kind}，{size} 项")
    if action == "diff":
        left = _json_input(args, sandbox, "text", "path")
        right = _json_input(args, sandbox, "other", "other_path")
        out: list[str] = []
        _json_diff(left, right, "", out)
        return _text("\n".join(out) if out else "两段 JSON 一致")
    raise ExtraToolError(f"不支持的 action：{action}")


def _text_tools(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "word_frequency")
    source = _load_text(args, sandbox)
    if not source and action != "template":
        raise ExtraToolError("请给 text 或 path")

    if action == "word_frequency":
        top = _int(args, "top", 30, 1, 200)
        size = _int(args, "min_len", 2, 2, 4)
        stop = {item.strip().lower() for item in _arg(args, "stopwords").split(",") if item.strip()}
        counts: Counter[str] = Counter()
        for word in re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]{2,}", source.lower()):
            if word not in stop:
                counts[word] += 1
        for run in re.findall(r"[\u3400-\u9fff]+", source):
            for index in range(len(run) - size + 1):
                token = run[index : index + size]
                if token not in stop:
                    counts[token] += 1
        lines = [f"总词数：{sum(counts.values())}，唯一词：{len(counts)}", ""]
        most = counts.most_common(top)
        peak = most[0][1] if most else 1
        for word, count in most:
            bar = "█" * max(1, round(count / peak * 20))
            lines.append(f"{word:<18} {count:>5}  {bar}")
        return _text("\n".join(lines))

    if action == "dedupe":
        lines_in = source.replace("\r\n", "\n").split("\n")
        trim = bool(args.get("strip_whitespace", True))
        insensitive = bool(args.get("case_insensitive"))
        keep_order = bool(args.get("keep_order", True))
        seen: set[str] = set()
        result: list[str] = []
        for raw in lines_in:
            line = raw.strip() if trim else raw
            if not line:
                continue
            key = line.lower() if insensitive else line
            if key in seen:
                continue
            seen.add(key)
            result.append(line)
        if not keep_order:
            result.sort()
        return _text(f"去重后 {len(result)} 行：\n" + "\n".join(result)[:MAX_DIFF])

    if action == "strip_invisible":
        cleaned = re.sub(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]", "", source)
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", cleaned)
        if args.get("strip_whitespace"):
            cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
            cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return _text(f"清除了 {len(source) - len(cleaned)} 个字符：\n" + cleaned[:MAX_DIFF])

    if action == "strip_ansi":
        cleaned = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", source)
        return _text(f"清除了 {len(source) - len(cleaned)} 个控制序列：\n" + cleaned[:MAX_DIFF])

    if action == "template":
        template = _arg(args, "template") or source
        if not template:
            raise ExtraToolError("template 不能为空")
        variables = args.get("variables")
        if not isinstance(variables, dict):
            raise ExtraToolError("variables 需要是对象")

        def lookup(key: str) -> Any:
            value: Any = variables
            for part in key.split("."):
                if isinstance(value, dict) and part in value:
                    value = value[part]
                else:
                    return None
            return value

        def replace(match: re.Match[str]) -> str:
            value = lookup(match.group(1).strip())
            return match.group(0) if value is None else str(value)

        return _text(re.sub(r"\{\{\s*([\w.]+)\s*\}\}", replace, template)[:MAX_DIFF])

    raise ExtraToolError(f"不支持的 action：{action}")


_CRON_FIELD = re.compile(r"^(\*|\d+|\d+-\d+|\*/\d+|\d+(?:,\d+)+|\d+-\d+/\d+)$")


def _cron_values(field: str, low: int, high: int) -> set[int]:
    if not _CRON_FIELD.match(field):
        raise ExtraToolError(f"cron 字段不合法：{field}")
    values: set[int] = set()
    for part in field.split(","):
        step = 1
        body = part
        if "/" in part:
            body, raw_step = part.split("/", 1)
            step = int(raw_step)
            if step <= 0:
                raise ExtraToolError("cron 步长必须大于 0")
        if body == "*":
            start, end = low, high
        elif "-" in body:
            start, end = (int(item) for item in body.split("-", 1))
        else:
            start = end = int(body)
        if start < low or end > high or start > end:
            raise ExtraToolError(f"cron 字段超出范围 {low}-{high}：{part}")
        values.update(range(start, end + 1, step))
    return values


def _cron(args: dict[str, Any]) -> dict[str, Any]:
    expression = _need(args, "expression")
    fields = expression.split()
    if len(fields) != 5:
        raise ExtraToolError("需要 5 段 cron：分 时 日 月 周")
    minutes = _cron_values(fields[0], 0, 59)
    hours = _cron_values(fields[1], 0, 23)
    days = _cron_values(fields[2], 1, 31)
    months = _cron_values(fields[3], 1, 12)
    weekdays = _cron_values(fields[4].replace("7", "0") if fields[4] == "7" else fields[4], 0, 6)
    count = _int(args, "count", 3, 1, 10)
    start_raw = _arg(args, "start")
    try:
        cursor = datetime.fromisoformat(start_raw) if start_raw else datetime.now()
    except ValueError:
        raise ExtraToolError(f"start 不是合法 ISO 时间：{start_raw}") from None
    cursor = cursor.replace(second=0, microsecond=0) + timedelta(minutes=1)
    results: list[str] = []
    for _ in range(366 * 24 * 60):
        if len(results) >= count:
            break
        if (
            cursor.minute in minutes
            and cursor.hour in hours
            and cursor.day in days
            and cursor.month in months
            and (cursor.weekday() + 1) % 7 in weekdays
        ):
            results.append(cursor.strftime("%Y-%m-%d %H:%M %A"))
        cursor += timedelta(minutes=1)
    if not results:
        return _text("未来一年内没有匹配的执行时间")
    return _text("\n".join(f"{index}. {item}" for index, item in enumerate(results, 1)))


def _system(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    action = _arg(args, "action", "env")
    root = sandbox.resolve(".")
    if action == "env":
        lines = [
            f"系统：{platform.system()} {platform.release()}（{platform.machine()}）",
            f"Python：{platform.python_version()}（{sys.executable}）",
            f"工作目录：{os.getcwd()}",
            f"沙箱根目录：{root}",
            f"CPU 逻辑核心：{os.cpu_count() or '未知'}",
        ]
        for key in ("LANG", "SHELL", "TERM", "VIRTUAL_ENV", "AGENTDESK_WORKSPACES"):
            if os.environ.get(key):
                lines.append(f"{key}={os.environ[key]}")
        return _text("\n".join(lines))
    if action == "metrics":
        lines = [f"CPU 逻辑核心：{os.cpu_count() or '未知'}"]
        load = getattr(os, "getloadavg", None)
        if load:
            try:
                one, five, fifteen = load()
                lines.append(f"负载：{one:.2f} / {five:.2f} / {fifteen:.2f}")
            except OSError:
                pass
        try:
            usage = shutil.disk_usage(str(root))
            lines.append(
                f"磁盘：总计 {_human(usage.total)}，已用 {_human(usage.used)}，可用 {_human(usage.free)}"
            )
        except OSError:
            pass
        try:
            import psutil  # type: ignore

            memory = psutil.virtual_memory()
            lines.append(f"内存：{_human(memory.used)} / {_human(memory.total)}（{memory.percent}%）")
        except Exception:
            lines.append("内存：安装 psutil 后可查看（pip install psutil）")
        lines.append(f"当前进程：PID {os.getpid()}")
        return _text("\n".join(lines))
    if action == "disk":
        target = sandbox.resolve(_arg(args, "path") or ".", must_exist=True)
        usage = shutil.disk_usage(str(target))
        return _text(
            f"{target}\n总计：{_human(usage.total)}\n已用：{_human(usage.used)}\n可用：{_human(usage.free)}"
        )
    raise ExtraToolError(f"不支持的 action：{action}")


_PRIVATE_HOST_SUFFIX = (".localhost", ".local", ".internal", ".home.arpa")


def _ensure_public_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ExtraToolError("只允许 http/https 地址")
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost" or host.endswith(_PRIVATE_HOST_SUFFIX):
        raise ExtraToolError("出于安全考虑，不访问本机或内网地址")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ExtraToolError(f"无法解析域名：{host}（{error}）") from None
    for info in infos:
        address = str(info[4][0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ExtraToolError("出于安全考虑，不访问本机或内网地址")


class _PublicRedirect(urllib.request.HTTPRedirectHandler):
    """跟随跳转前再校验一次，防止公网 URL 302 到内网。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        _ensure_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _http(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    url = _need(args, "url")
    _ensure_public_url(url)
    method = _arg(args, "method", "GET").upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
        raise ExtraToolError(f"不支持的 method：{method}")
    headers = args.get("headers")
    if headers is not None and not isinstance(headers, dict):
        raise ExtraToolError("headers 需要是对象")
    request_headers = {str(key): str(value) for key, value in (headers or {}).items()}
    request_headers.setdefault("User-Agent", "DeepSeek-Agent-Desktop/0.8")
    body = _arg(args, "body")
    data = body.encode("utf-8") if body and method not in ("GET", "HEAD") else None
    timeout = float(args.get("timeout", 15))
    timeout = max(1.0, min(120.0, timeout))
    max_chars = _int(args, "max_chars", 20000, 200, 200000)
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    opener = urllib.request.build_opener(_PublicRedirect)
    started = time.monotonic()
    try:
        with opener.open(request, timeout=timeout) as response:
            elapsed = (time.monotonic() - started) * 1000
            raw = b"" if method == "HEAD" else response.read(max_chars * 4)
            charset = response.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, "replace")[:max_chars]
            keep = ("content-type", "content-length", "server", "date", "location")
            header_lines = [
                f"{key}: {value}"
                for key, value in response.headers.items()
                if key.lower() in keep
            ]
            return _text(
                f"{method} {url}\n状态：{response.status} {response.reason}\n耗时：{elapsed:.0f} ms\n"
                + "\n".join(header_lines)
                + "\n\n"
                + text
            )
    except urllib.error.HTTPError as error:
        detail = error.read(4000).decode("utf-8", "replace")
        return _text(f"{method} {url}\nHTTP {error.code} {error.reason}\n\n{detail}", error=True)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ExtraToolError(f"请求失败：{error}") from None


def _replace(args: dict[str, Any], sandbox: Sandbox) -> dict[str, Any]:
    base = sandbox.resolve(_need(args, "path"), must_exist=True)
    pattern = _need(args, "pattern")
    replacement = _arg(args, "replacement")
    glob = _arg(args, "glob") or "*"
    flags = re.IGNORECASE if args.get("case_insensitive") else 0
    try:
        regex = re.compile(pattern if args.get("use_regex") else re.escape(pattern), flags)
    except re.error as error:
        raise ExtraToolError(f"正则无效：{error}") from None
    dry_run = args.get("dry_run", True) is not False
    max_files = _int(args, "max_files", 20, 1, 200)
    files = [base] if base.is_file() else [
        path for path in _walk(base, max_files * 20) if fnmatch.fnmatch(path.name, glob)
    ]
    changed: list[str] = []
    previews: list[str] = []
    for path in files:
        if len(changed) >= max_files:
            break
        try:
            if path.stat().st_size > 1_000_000:
                continue
            source = _read_text(path, 1_000_000)
        except OSError:
            continue
        target_text, count = regex.subn(replacement, source)
        if count == 0 or target_text == source:
            continue
        changed.append(f"{sandbox.relative(path)}（{count} 处）")
        diff = list(
            difflib.unified_diff(
                source.splitlines(),
                target_text.splitlines(),
                fromfile=sandbox.relative(path),
                tofile=sandbox.relative(path),
                n=1,
            )
        )
        previews.append("\n".join(diff[:40]))
        if not dry_run:
            try:
                path.write_text(target_text, encoding="utf-8")
            except OSError as error:
                raise ExtraToolError(f"写入失败：{sandbox.relative(path)}（{error}）") from None
    if not changed:
        return _text("没有匹配到需要替换的内容")
    header = ("已预览（未写入）：" if dry_run else "已写入：") + "\n" + "\n".join(f"- {item}" for item in changed)
    return _text(header + "\n\n" + "\n\n".join(previews)[:MAX_DIFF])


# --------------------------------------------------------------------------- 分发


async def dispatch(
    name: str, args: dict[str, Any], sandbox: Sandbox, settings: Settings
) -> dict[str, Any] | None:
    """处理本模块的工具；不是本模块的名字返回 None。"""
    if name == "desk_glob":
        return _glob(args, sandbox)
    if name == "desk_diff":
        return _diff(args, sandbox)
    if name == "desk_calculate":
        return _calculate(args)
    if name == "desk_time":
        return _time(args)
    if name == "desk_regex":
        return _regex(args, sandbox)
    if name == "desk_codec":
        return _codec(args, sandbox)
    if name == "desk_csv":
        return _csv(args, sandbox)
    if name == "desk_sqlite":
        return _sqlite(args, sandbox)
    if name == "desk_tree":
        return _tree(args, sandbox)
    if name == "desk_dupes":
        return _dupes(args, sandbox)
    if name == "desk_download":
        return _download(args, sandbox)
    if name == "desk_net":
        return _net(args)
    if name == "desk_password":
        return _password(args)
    if name == "desk_markdown":
        return _markdown(args, sandbox)
    if name == "desk_similarity":
        return _similarity(args, sandbox)
    if name == "desk_pdf":
        return _pdf(args, sandbox)
    if name == "desk_image":
        return _image(args, sandbox)
    if name == "desk_qr":
        return _qr(args, sandbox)
    if name == "desk_office":
        return _office(args, sandbox)
    if name == "desk_json":
        return _json(args, sandbox)
    if name == "desk_text":
        return _text_tools(args, sandbox)
    if name == "desk_cron":
        return _cron(args)
    if name == "desk_system":
        return _system(args, sandbox)
    if name == "desk_http":
        return _http(args, sandbox)
    if name == "desk_replace":
        return _replace(args, sandbox)
    return None


__all__ = ["definitions", "dispatch"]
